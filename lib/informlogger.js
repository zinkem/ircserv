const { Transform } = require('stream');

let singleton = null;

function InformLogger(debugMode) {
  if (singleton) return singleton;
  this.debugMode = debugMode;
  singleton = this;
  return this;
}

InformLogger.prototype = new Transform();

InformLogger.prototype._transform = function (data, encoding, callback) {
  const xdata = [Date.now(), '[SERVER]', data, '\n'].join(' ');
  callback(null, xdata);
};

InformLogger.prototype.log = InformLogger.prototype.write;

InformLogger.prototype.debug = function (...args) {
  if (this.debugMode) console.log.apply(null, args);
};

InformLogger.prototype.error = function (...args) {
  const err = Array.prototype.concat.apply(['ERROR!!!'], args);
  console.log.apply(null, err);
};

module.exports.InformLogger = InformLogger;
