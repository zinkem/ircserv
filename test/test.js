const assert = require('assert');

const { Duplex } = require('stream');

const { Server, StreamLines } = require('..');

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

class IRCAgent extends Duplex {
  constructor(opts) {
    super(opts)
    this.remoteAddress = '::1';
    this.remotePort = '32000';
    this.buffer = [];
  }

  _read(size) {
    const res = this.push(this.buffer.shift());
  }

  _write(chunk, encoding, callback) {
    this.emit('response', chunk.toString());

    if (chunk.toString().includes('hostname')) {
      this.emit('connected');
    }
    callback(null, chunk);
  }
}

const waitFor = (id, done) => {
  return function(data) {
    if (serverConfigOpts.debug == true) process.stdout.write(data.toString());
    if (data.toString().includes(id)) {
      done(null, data.toString());
    }
  }
}

describe('ircserv basic commands', function() {
  this.timeout(1000);
  const { Server, StreamLines } = require('..');
  const mockServer = new Server(serverConfigOpts);
  const mockListener = mockServer.createConnectionListener();
  const mockAgent = new IRCAgent();
  const otherAgent = new IRCAgent();

  before((done) => {
    try {
      mockListener(mockAgent);
      mockListener(otherAgent);
    } catch(e) {
      console.log(e);
      assert.equal(e, null);
    }

    let registered = 0;
    const finish = () => {
      registered++;
      if (registered == 2) done();
    }

    mockAgent.on('connected', (data) => {
      mockAgent.push('NICK basic\n');
      mockAgent.push('USER basic 0 * :Test Agent basic\n');
      finish();
    });

    otherAgent.on('connected', (data) => {
      otherAgent.push('NICK other\n');
      otherAgent.push('USER other 0 * :Test Agent Other\n');
      finish();
    });
  });

  after(() => {
  });

  afterEach(function() {
    mockAgent.removeAllListeners('response');
    otherAgent.removeAllListeners('response');
  });

  it('SEVERAL: ERR_NEEDMOREPARAMS', function(done) {
    const commands = [
      'PASS',
      'USER',
      'OPER',
      'JOIN',
      'PART',
      'MODE',
      'TOPIC',
      'INVITE',
      'KICK',
      'KILL',
    ]
    otherAgent.on('response', waitFor('461', () => {
      setImmediate(() => {
        if (commands.length <= 0)
          done();
        else
          otherAgent.push(`${commands.pop()}\n`);
      });
    }));
    otherAgent.push(`${commands.pop()}\n`);
  });

  it('PRIVMSG, NOTICE ERR_NORECIPIENT', function(done) {
    const commands = [
      'PRIVMSG',
      'NOTICE',
    ]
    otherAgent.on('response', waitFor('411', () => {
      setImmediate(() => {
        if (commands.length <= 0)
          done();
        else
          otherAgent.push(`${commands.pop()}\n`);
      });
    }));
    otherAgent.push(`${commands.pop()}\n`);
  });

  it('PRIVMSG, NOTICE ERR_NOTEXTTOSEND', function(done) {
    const commands = [
      'PRIVMSG basic :',
      'NOTICE basic',
    ]
    otherAgent.on('response', waitFor('412', () => {
      setImmediate(() => {
        if (commands.length <= 0)
          done();
        else
          otherAgent.push(`${commands.pop()}\n`);
      });
    }));
    otherAgent.push(`${commands.pop()}\n`);
  });

  it('ERR_NONICKNAMEGIVEN', function(done) {
    const commands = [
      'WHOWAS',
      'WHOIS',
      'NICK',
    ]
    otherAgent.on('response', waitFor('431', () => {
      setImmediate(() => {
        if (commands.length <= 0)
          done();
        else
          otherAgent.push(`${commands.pop()}\n`);
      });
    }));
    otherAgent.push(`${commands.pop()}\n`);
  });

  it('ADMIN', function(done) {
    mockAgent.on('response', waitFor('259', done));
    mockAgent.push('admin\n');
  });

  it('VERSION', function(done) {
    mockAgent.on('response', waitFor('351', done));
    mockAgent.push('version\n');
  });

  it('INFO', function(done) {
    mockAgent.on('response', waitFor('374', done));
    mockAgent.push('info\n');
  });

  it('WHO', function(done) {
    mockAgent.on('response', waitFor('315', done));
    mockAgent.push('who\n');
  });

  it('LIST', function(done) {
    mockAgent.on('response', waitFor('323', done));
    mockAgent.push('list\n');
  });

  it('PING', function(done) {
    mockAgent.on('response', waitFor('PONG', done));
    mockAgent.push('ping\n');
  });

  it('PONG', function(done) {
    mockAgent.on('response', waitFor('PONG? PING', done));
    mockAgent.push('pong\n');
  });

  it('JOIN', function(done) {
    mockAgent.on('response', waitFor('329', () => {
      otherAgent.on('response', waitFor('329', () => {
        done();
      }));
      otherAgent.push('join #cats\n');
    }));
    mockAgent.push('join #cats\n');
  });

  it('NOTICE user', function(done) {
    otherAgent.on('response', waitFor('hello other', done));
    mockAgent.push('notice other :hello other\n');
  });

  it('PRIVMSG user', function(done) {
    otherAgent.on('response', waitFor('hello other', done));
    mockAgent.push('privmsg other :hello other\n');
  });

  it('PRIVMSG channel', function(done) {
    otherAgent.on('response', waitFor('hello cats', done));
    mockAgent.push('privmsg #cats :hello cats\n');
  });

  it('TOPIC view', function(done) {
    mockAgent.on('response', waitFor('Welcome to #cats', done));
    mockAgent.push('topic #cats\n');
  });

  it('TOPIC change', function(done) {
    mockAgent.on('response', waitFor('fluffy ass cats', done));
    mockAgent.push('topic #cats :fluffy ass cats\n');
  });

  it('KICK with privs', function(done) {
    mockAgent.on('response', waitFor('KICK #cats other', done));
    mockAgent.push('kick #cats other\n');
  });

  it('PRIVMSG to channel after being kicked', function(done) {
    otherAgent.on('response', waitFor('404', done));
    otherAgent.push('privmsg #cats :hello cats\n');
  });

  it('PART', function(done) {
    mockAgent.on('response', waitFor('PART', done));
    mockAgent.push('part #cats\n');
  });

  it('WHOIS', function(done) {
    mockAgent.on('response', waitFor('318', done));
    mockAgent.push('whois basic\n');
  });

  it('OPER bad pass', function(done) {
    mockAgent.on('response', waitFor('464', done));
    mockAgent.push('oper boo boo\n');
  });

  it('KILL no privs', function(done) {
    mockAgent.on('response', waitFor('481', done));
    mockAgent.push('kill basic :go away\n');
  });

  it('OPER good pass', function(done) {
    mockAgent.on('response', waitFor('381', done));
    mockAgent.push('oper admin admin\n');
  });

  it('KILL with privs', function(done) {
    otherAgent.on('finish', done);
    mockAgent.push('kill other :go away\n');
  });

  it('QUIT', function(done) {
    mockAgent.on('finish', done);
    mockAgent.push('quit\n');
  });
});
