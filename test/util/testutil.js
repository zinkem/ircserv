const assert = require('assert');

const { Duplex } = require('stream');

const serverConfigOpts = {
  "logs": "./testlogs",
  "version": "ircserv.0.0.2-test",
  "servername": "test.com",
  "debug": false,
  "operators": {
    "admin":"admin"
  },
  "admin_info": {
    "info1" : "Hello! Welcome to our server!",
    "info2" : "http://example.com",
    "email" : "admin@example.com"
  }
}
module.exports.serverConfigOpts = serverConfigOpts;

const waitFor = (id, done) => {
  return function(data) {
    if (serverConfigOpts.debug == true) process.stdout.write(data.toString());
    if (data.toString().includes(id)) {
      done(null, data.toString());
    }
  }
}
module.exports.waitFor = waitFor;

class IRCAgent extends Duplex {
  constructor(nick, opts) {
    super(opts)
    this.remoteAddress = '::1';
    this.remotePort = '32000';
    this.buffer = [];
    this.nick = nick;
  }

  _read(size) {
    const res = this.push(this.buffer.shift());
  }

  _write(chunk, encoding, callback) {
    this.emit('response', chunk.toString());

    if (chunk.toString().includes('NOTICE AUTH :*** Could not find hostname')) {
      this.emit('connected', chunk.toString());
    } else if (chunk.toString().includes('004')) {
      this.emit('registered', chunk.toString());
    }
    callback(null, chunk);
  }

  connect(listener, cb) {
    const { nick } = this;
    this.on('connected', (data) => {
      this.push(`NICK ${nick}\n`);
      this.push(`USER ${nick} 0 * :Test Agent ${nick}\n`);
    });
    this.on('registered', (data) => {
      if (cb) cb();
    });
    listener(this);
  }

  send(message) {
    this.push(`${message}\n`);
  }
}
module.exports.IRCAgent = IRCAgent;

const tryAssert = {
  equal: (act, exp, msg, done) => {
    try {
      assert.equal(act, exp, msg);
      done();
    } catch(e) {
      done(e);
    }
  }
}
module.exports.tryAssert = tryAssert;
