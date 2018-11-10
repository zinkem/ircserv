
const { Transform } = require('stream');

const { logger: inform } = require('./informlogger.js');

class User extends Transform {
  constructor(opts) {
    super(opts);
    this.id = null;
    this.con_pass = null;
    this.hostname = null;
    this.nick = null;
    this.real_name = null;
    this.mode = {};
    this.channels = {};
    this.remoteAddress = null;
    this.remotePort = null;
    this.setMaxListeners(30);
    this.on('error', (err) => {
      inform.error('User', this.nick, err);
    });
  }

  registered() {
    return this.id !== null;
  }

  _transform(data, encoding, callback) {
    // filter out privmsgs to self (from channels)
    if (data.toString().startsWith(`:${this.nick}`)
        && data.toString().includes('PRIVMSG')) {
      callback();
    } else {
      callback(null, data);
    }
  }
}

module.exports.User = User;
