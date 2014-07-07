var fs = require('fs');

function Logger(config) {
    "use strict";

    this._level_error   = 0;
    this._level_warning = 1;
    this._level_notice  = 2;
    this._level_debug   = 3;

    this._file = null;

    this._level     = config.level;
    this._debugKeys = config.debugKeys;
    this._console   = config.console;

    if (null !== config.file) {
        this._file = fs.createWriteStream(config.file, {
            flags: 'a+'
        });
        this._file.on('error', function (err) {
            console.log('Error on open log file: ', err.message);
        });
    }
}

Logger.prototype.destroy = function () {
    "use strict";

    if (null !== this._file) {
        this._file.end();
    }
};

Logger.prototype.error = function (msg) {
    "use strict";

    if (this._level < this._level_error) {
        return;
    }

    this._logConsole('ERROR: ' + msg);
    this._logFile('ERROR: ' + msg);
};

Logger.prototype.warning = function (msg) {
    "use strict";

    if (this._level < this._level_warning) {
        return;
    }

    this._logConsole('WARNING: ' + msg);
    this._logFile('WARNING: ' + msg);
};

Logger.prototype.notice = function (msg) {
    "use strict";

    if (this._level < this._level_notice) {
        return;
    }

    this._logConsole('NOTICE: ' + msg);
    this._logFile('NOTICE: ' + msg);
};

Logger.prototype.debug = function (key, msg) {
    "use strict";

    if (this._level < this._level_debug) {
        return;
    }

    if (0 !== this._debugKeys.length
        && -1 === this._debugKeys.indexOf(key)
    ) {
        return;
    }

    this._logConsole('DEBUG (' + key + '): ' + msg);
    this._logFile('DEBUG (' + key + '): ' + msg);
};

Logger.prototype._logConsole = function (msg) {
    "use strict";

    if (true === this._console) {
        console.log(msg);
    }
};

Logger.prototype._logFile = function (msg) {
    "use strict";

    if (null !== this._file) {
        this._file.write(msg + "\n", 'utf-8');
    }
};

module.exports = Logger;
