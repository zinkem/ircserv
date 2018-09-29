const dns = require('dns');
const { Writable } = require('stream');

const { InformLogger } = require('./informlogger.js');
const { modeString } = require('./channel.js');
const { ReplyFactory } = require('./replies.js');

const inform = new InformLogger();
// temporary fix, bad scope
let reply = null;

const AVAIL_USER_MODES = '-';
module.exports.AVAIL_USER_MODES = AVAIL_USER_MODES;

class User extends Writable {
  constructor(sock, command_list, opts) {
    super(opts);
    this.socket = sock;
    this.user = null;
    this.id = null;
    this.con_pass = null;
    this.hostname = sock.remoteAddress;
    this.nick = null;
    this.real_name = null;
    this.command_list = command_list;
    reply = new ReplyFactory(opts);

    let lookup_addr = sock.remoteAddress;

    if (sock.remoteFamily === 'IPv6'
        && sock.remoteAddress.indexOf('::ffff:') >= 0) [, lookup_addr] = lookup_addr.split('::ffff:');

    sock.write('NOTICE AUTH :*** Looking up hostname...\n');
    dns.reverse(lookup_addr, (err, hostnames) => {
      if (err) {
        if (err.code !== 'ENOTFOUND') inform.error(err);
        sock.write(`NOTICE AUTH :*** Could not find hostname, using ${this.hostname}\n`);
      } else {
        [this.hostname] = hostnames;
        sock.write(`NOTICE AUTH :*** Found hostname ${this.hostname}\n`);
      }
      inform.log(['Found hostname', this.hostname, 'for address', lookup_addr].join(' '));
    });
  }

  registered() {
    return this.id !== null;
  }

  configModeUser(nick, flags, params) {
    console.log(nick, this.nick);
    if (nick !== this.nick) {
      return reply.createError('ERR_USERSDONTMATCH', this);
    }

    const user_stream = this.user;

    console.log(flags);
    console.log(params);

    if (flags) {
      const op = flags[0];
      const modes = flags.substring(1);

      if (op === '-') {
        // for (const i in modes) delete user_stream.mode[modes[i]];
        modes.forEach((m) => { delete user_stream.mode[m]; });
      }

      if (op === '+') {
        // for (const i in modes) user_stream.mode[modes[i]] = true;
        modes.forEach((m) => { user_stream.mode[m] = true; });
      }
    }
    return reply.createReply('RPL_UMODEIS', this, `${nick} ${modeString(user_stream.mode)}`);
  }

  parse_command(tokens) {
    inform.debug(tokens);
    const { command_list } = this;

    const command = tokens.shift().toUpperCase();
    let result = null;
    inform.debug(command);
    if (command_list[command]) {
      if (this.registered()
          || command === 'NICK'
          || command === 'USER'
          || command === 'PASS') {
        result = command_list[command](this, tokens);
      } else {
        result = reply.createError(400, this);
      }
    } else {
      result = reply.createError('ERR_UNKNOWNCOMMAND', this, `${command} :Unknown command`);
    }

    return result;
  }

  _write(data, encoding, callback) {
    const line = data.toString().trim();
    const res = this.parse_command(line.split(' '));

    if (res) {
      this.socket.write(`${res}\n`);
    }

    callback();
  }
}

module.exports.User = User;
