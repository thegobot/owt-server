'use strict';

const log = require('../logger').logger.getLogger('AnalyticsAgent');
const BaseAgent = require('./base-agent');

const VideoPipeline = require('../videoGstPipeline/build/Release/videoAnalyzer-pipeline');
const EventEmitter = require('events').EventEmitter;
const { getVideoParameterForAddon } = require('../mediaUtil');

var portInfo = 0; 

class AnalyticsAgent extends BaseAgent {
  constructor(config) {
    super('analytics', config);
    this.algorithms = config.algorithms;
    this.onStatus = config.onStatus;
    this.onStreamGenerated = config.onStreamGenerated;
    this.onStreamDestroyed = config.onStreamDestroyed;

    this.agentId = config.agentId;
    this.rpcId = config.rpcId;
    // connectionId - {engine, options, output, videoFrom}
    this.inputs = {};
    // connectionId - dispatcher
    this.outputs = {};

    var conf = {
      'hardware': false,
      'simulcast': false,
      'crop': false,
      'gaccplugin': false,
      'MFE_timeout': 0
    };
    this.engine = new VideoPipeline(conf);

    this.flag = 0;
  }

// override
createInternalConnection(connectionId, direction, internalOpt) {
    internalOpt.minport = global.config.internal.minport;
    internalOpt.maxport = global.config.internal.maxport;
    if(direction == 'in'){
      this.engine.emitListenTo(internalOpt.minport,internalOpt.maxport);
      portInfo = this.engine.getListeningPort();
    }
    else {
      super.createInternalConnection(connectionId, direction, internalOpt);
    }
    
    // Create internal connection always success
    return Promise.resolve({ip: global.config.internal.ip_address, port: portInfo});
  }

  // override
  publish(connectionId, connectionType, options) {
    log.debug('publish:', connectionId, connectionType, options);
    if (connectionType !== 'analytics') {
      return Promise.resolve("ok");
    }
    // should not be reached
    return Promise.reject('no analytics publish');
  }

  // override
  unpublish(connectionId) {
    log.debug('unpublish:', connectionId);
    this.engine.clearPipeline();
    return Promise.resolve('ok');
  }

  // override
  subscribe(connectionId, connectionType, options) { 
    log.debug('subscribe:', connectionId, connectionType, JSON.stringify(options));
    if (connectionType !== 'analytics') {
       this.outputs[connectionId] = true;
       return super.subscribe(connectionId, connectionType, options);
    }
      
      const videoFormat = options.connection.video.format;
      const videoParameters = options.connection.video.parameters;
      const algo = options.connection.algorithm;
      const status = {type: 'ready', info: {algorithm: algo}};
      this.onStatus(options.controller, connectionId, 'out', status);

      //const newStreamId = Math.random() * 1000000000000000000 + '';
      const newStreamId = algo + options.media.video.from;
      const streamInfo = {
          type: 'analytics',
          media: {video: Object.assign({}, videoFormat, videoParameters)},
          analyticsId: connectionId,
          locality: {agent:this.agentId, node:this.rpcId},
        };

      const pluginName = this.algorithms[algo].name;
      let codec = videoFormat.codec;
            if (videoFormat.profile) {
              codec += '_' + videoFormat.profile;
            }
      codec = codec.toLowerCase();
      const {resolution, framerate, keyFrameInterval, bitrate}
              = getVideoParameterForAddon(options.connection.video);

      log.debug('resolution:',resolution,'framerate:',framerate,'keyFrameInterval:',
               keyFrameInterval, 'bitrate:',bitrate);
      
      this.engine.setOutputParam(codec,resolution,framerate,bitrate,keyFrameInterval,algo,pluginName);
      this.engine.createPipeline();

      streamInfo.media.video.bitrate = bitrate;
      this.onStreamGenerated(options.controller, newStreamId, streamInfo);

      this.engine.addElementMany();;
      this.connectionclose = () => {
          this.onStreamDestroyed(options.controller, newStreamId);
      }
      this.inputs[connectionId] = true;
      return Promise.resolve();
  }

  // override
  unsubscribe(connectionId) {
    log.debug('unsubscribe:', connectionId);
    if(this.outputs[connectionId]){
      var iConn;
      log.debug('disconnect connection id:', connectionId);
      iConn = this.connections.getConnection(connectionId);
      if (iConn)
      {
        this.engine.disconnect(iConn.connection.receiver());
      }
    }
    this.connectionclose();
    return super.unsubscribe(connectionId);
  }

  // override
  linkup(connectionId, audioFrom, videoFrom) {
    log.debug('linkup:', connectionId, audioFrom, videoFrom);
    if(this.inputs[connectionId]) {
      this.engine.setPlaying();
    }

    if(this.outputs[connectionId]){
      var iConn;
      log.debug('linkup with connection id:', connectionId);
      iConn = this.connections.getConnection(connectionId);
      if (iConn && iConn.direction === 'out' && !iConn.videoFrom)
      {
        this.engine.addOutput(connectionId, iConn.connection.receiver());
      }
    }

    return Promise.resolve();
  }

  // override
  cutoff(connectionId) {
    log.debug('cutoff:', connectionId);
    return Promise.resolve();
  }

  cleanup() {
    log.debug('cleanup');
    return Promise.resolve();
  }
}


module.exports = AnalyticsAgent;
