const { Transform } = require('stream');

function InformLogger(debugMode) {
  this.debugMode = debugMode;
  this.setMaxListeners(100);
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

InformLogger.prototype.setDebug = function (mode) {
  this.debugMode = mode;
  return this.debugMode;
};

InformLogger.prototype.error = function (...args) {
  const err = Array.prototype.concat.apply(['ERROR!!!'], args);
  console.log.apply(null, err);
};

module.exports.logger = new InformLogger();
