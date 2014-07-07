var http   = require('http');
var util   = require('util');
var events = require('events');
var crypto = require('crypto');

function RequestHandler(config, logger) {
    "use strict";

    events.EventEmitter.call(this);

    this._cache  = {};
    this._config = config;
    this._logger = logger;
    this._server = http.createServer(this._request.bind(this));

    /**
     * All header defined here that are present in the response
     * from the source will be passed to the response
     **/
    this._headersToPassToResponse = [
        'cache-control',
        'expires',
        'access-control-allow-origin',
        'content-type',
        'last-modified',
        'content-length'
    ];

    /**
     * All headers defined here will be passed over to the source
     * if present
     */
    this._headersToPassToSource = [
        'user-agent',
        'accept',
        'accept-language',
        'accept-encoding'
    ];

    this._server.on('error', (function (err) {
        this._logger.error('Failed to bind to specified port (' + err.message + '), aborting...');

        process.exit(127);
    }).bind(this));

    this._server.listen(this._config.port, this._config.ip, (function () {
        this.emit('bound');

        this._logger.notice('Http proxy up and running, let\'s fetz!');
        this._logger.notice('Listening on ' + this._config.ip + ':' + this._config.port);
        this._logger.notice('Reading from ' + this._config.sourceServer + ':' + this._config.sourcePort);
    }).bind(this));

    setInterval(
        this._runGarbageCollection.bind(this),
        this._config.garbageCollectionInterval
    );
    setInterval(
        this._debugCacheSize.bind(this),
        5000
    );
}

util.inherits(RequestHandler, events.EventEmitter);

/**
 * Logs some information about the current cache status
 */
RequestHandler.prototype._debugCacheSize = function () {
    "use strict";

    var cachePercent = Object.keys(this._cache).length * 100 / this._config.cacheSize;

    this._logger.debug(
        'CacheSize',
        Object.keys(this._cache).length + ' / ' + this._config.cacheSize + ' (' + cachePercent + '%)'
    );
};

/**
 * Clean up cache if the size gets to big
 */
RequestHandler.prototype._runGarbageCollection = function () {
    "use strict";

    if (this._config.cacheSize < Object.keys(this._cache).length) {
        var cacheList = {};
        var counter   = 1;

        Object.keys(this._cache).forEach((function (key) {
            var cacheKey = this._cache[key].expires + (counter/Object.keys(this._cache).length);

            cacheList[cacheKey] = key;

            counter++;
        }).bind(this));

        var sortedList = Object.keys(cacheList);
        sortedList.sort();

        while (this._config.cacheSize < Object.keys(this._cache).length) {
            var value = sortedList.shift();

            this._logger.debug('GarbageCollection', 'evicting entry - ' + cacheList[value] + ' (' + value + ')');

            delete this._cache[cacheList[value]];
            delete cacheList[value];
        }
    }
};

/**
 * Handle the incoming request
 */
RequestHandler.prototype._request = function (request, response) {
    "use strict";

    this._logger.debug('Request', request.url);

    var now = (+new Date())/1000;

    if (true === this._cache.hasOwnProperty(request.url)) {
        // cach entry found

        var cacheEntry = this._cache[request.url];
        var statusCode = cacheEntry.statusCode;
        var content    = cacheEntry.content;

        this._logger.debug('Request', 'cache hit: remaining time: ' + (cacheEntry.expires - now));

        if (now > cacheEntry.expires) {
            // cache expired
            
            delete this._cache[request.url];

            this._getContentFromSource(request, response, request.url);
        } else {
            // cache hit

            var etag = crypto.createHash('md5').update(content).digest('hex');

            // conditional get (responde with 304 without content when
            // content is unchanged)
            if ('undefined' != typeof request.headers['if-modified-since']) {
                var ifModifiedSince = (+new Date(request.headers['if-modified-since']));
                var lastModified    = (+new Date(cacheEntry.headers['last-modified']));
                var ifNoneMatch     = request.headers['if-none-match'];

                if (lastModified <= ifModifiedSince // compare nodified times
                    && ('undefined' === ifNoneMatch  // compare etag if present
                        || etag === ifNoneMatch)
                ) {
                    // no changes, set 304 and empty response
                    statusCode = 304;
                    content    = '';
                }
            }
        
            cacheEntry.headers['x-http-proxy-cache-hit'] = 'yes';
            cacheEntry.headers['etag']                   = etag; 

            this._writeOutput(
                response,
                content,
                statusCode,
                cacheEntry.headers
            );
        }
    } else {
        // no cache entry found

        this._logger.debug('Request', 'no cache hit');

        this._getContentFromSource(request, response, request.url);
    }
};

/**
 * Reads a requested resource from the source
 */
RequestHandler.prototype._getContentFromSource = function (request, response, requestUrl) {
    "use strict";

    var headersToSource = {};

    this._headersToPassToSource.forEach(function (key) {
        if (true === request.headers.hasOwnProperty(key)) {
            headersToSource[key] = request.headers[key];
        }
    });

    var req = http.get({
        hostname: this._config.sourceServer,
        port: this._config.sourcePort,
        path: requestUrl,
        headers: headersToSource
    }, (function (res) {
        if (200 === res.statusCode
            || 404 === res.statusCode
        ) {
            var raw = null;

            res.on('data', function (data) {
                if (null === raw) {
                    raw = data;
                } else {
                    raw = Buffer.concat(
                        [raw, data],
                        raw.length + data.length
                    );
                }
            });

            res.on('end', (function (data) {
                var output  = '';
                var expires = ((+new Date())/1000)+900;
                var headers = {
                    'via': 'http-proxy',
                    'x-http-proxy-cache-hit': 'no'
                };

                if (null !== raw) {
                    output = raw.toString();
                }

                this._headersToPassToResponse.forEach(function (key) {
                    if (true === res.headers.hasOwnProperty(key)) {
                        headers[key] = res.headers[key];
                    }
                });

                if (404 !== res.statusCode) {
                    expires = (+new Date(res.headers.expires))/1000;
                    headers['etag'] = crypto.createHash('md5').update(output).digest('hex');
                }

                this._cache[requestUrl] = {
                    'content': output,
                    'expires': expires,
                    'statusCode': res.statusCode,
                    'headers': headers
                };

                this._writeOutput(response, output, res.statusCode, headers);
            }).bind(this));

            res.on('abort', function () {
                console.log('FUBAR');
            });
        }
    }).bind(this)).on('error', (function (reponse, err) {
        this._logger.error('Source request failed: ' + err.message);

        reponse.writeHead(504);
        reponse.write('Gateway Time-out');
        reponse.end();
    }).bind(this, response));

    setTimeout((function () {
        req.abort();
    }).bind(this), this._config.sourceTimeout);
};

/**
 * Send output to browser
 */
RequestHandler.prototype._writeOutput = function (response, data, statusCode, header) {
    "use strict";

    response.writeHead(statusCode, header);
    response.write(data);
    response.end();
};

RequestHandler.prototype.destroy = function () {
    "use strict";

    this._cache = null;
    this._logger.destroy();
    this._server.close();
    this._server = null;
};

module.exports = RequestHandler;
