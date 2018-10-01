const dns = require('dns');
const { Writable } = require('stream');

const { logger: inform } = require('./informlogger.js');
const { modeString } = require('./channel.js');

class User extends Writable {
  constructor(sock, command_list, opts) {
    super(opts);
    this.socket = sock;
    this.user = null;
    this.id = null;
    this.con_pass = null;
    this.hostname = sock.remoteAddress || '';
    this.nick = null;
    this.real_name = null;
    this.command_list = command_list;

    let lookup_addr = sock.remoteAddress;

    if (sock.remoteFamily === 'IPv6'
        && sock.remoteAddress.indexOf('::ffff:') >= 0) [, lookup_addr] = lookup_addr.split('::ffff:');

    sock.write('NOTICE AUTH :*** Looking up hostname...\n');
    dns.reverse(lookup_addr, (err, hostnames) => {
      if (err) {
        if (err.code !== 'ENOTFOUND') inform.error(err);
        sock.write(`NOTICE AUTH :*** Could not find hostname, using ${this.hostname}\n`);
      } else if (hostnames.length > 0) {
        [this.hostname] = hostnames;
        sock.write(`NOTICE AUTH :*** Found hostname ${this.hostname}\n`);
      } else {
        sock.write(`NOTICE AUTH :*** Could not find hostname, using ${this.hostname}\n`);
      }
      inform.log(['Found hostname', this.hostname, 'for address', lookup_addr].join(' '));
    });
  }

  registered() {
    return this.id !== null;
  }

  configModeUser(nick, flags, params, reply) {
    console.log(nick, this.nick);
    if (nick !== this.nick) {
      return reply.createError('ERR_USERSDONTMATCH', this);
    }

    const user_stream = this;

    console.log(flags);
    console.log(params);

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

  _write(data, encoding, callback) {
    const line = data.toString().trim();
    const res = this.command_list.parse_command(this, line.split(' '));
    if (res) {
      this.socket.write(`${res}\n`);
    }
    callback();
  }
}

module.exports.User = User;
