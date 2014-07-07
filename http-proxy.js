"use strict";

var config         = require('./config.js');
var Logger         = require('./Logger');
var RequestHandler = require('./RequestHandler');

var logger  = new Logger(config.log);
var handler = new RequestHandler(config, logger);

function shutdownHandler() {
    logger.notice('Got request to shut down, doing so...');

    handler.destroy();
}

process.on('SIGTERM', shutdownHandler);
process.on('SIGINT', shutdownHandler);
