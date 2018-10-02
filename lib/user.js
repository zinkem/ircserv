
const { Transform } = require('stream');

const { logger: inform } = require('./informlogger.js');
const { modeString } = require('./channel.js');

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
      inform.error('UserPassThrough', this.nick, err);
    });
  }

  registered() {
    return this.id !== null;
  }

  configModeUser(nick, flags, params, reply) {
    inform.debug(this.nick, 'configModeUser', nick, flags, params);
    if (nick !== this.nick) {
      return reply.createError('ERR_USERSDONTMATCH', this);
    }

    const user_stream = this;
    if (flags) {
      const op = flags[0];
      const modes = flags.substring(1);

      if (op === '-') {
        // for (const i in modes) delete user_stream.mode[modes[i]];
        modes.split().forEach((m) => { delete user_stream.mode[m]; });
      }

      if (op === '+') {
        // for (const i in modes) user_stream.mode[modes[i]] = true;
        modes.split().forEach((m) => { if (m !== 'o') user_stream.mode[m] = true; });
      }
    }
    return reply.createReply('RPL_UMODEIS', this, `${nick} ${modeString(user_stream.mode)}`);
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
