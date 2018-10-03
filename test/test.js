const assert = require('assert');

const { Duplex } = require('stream');

let server_job = null;
let server_exit_code = null;

const { Server, StreamLines } = require('..');

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

    if( chunk.toString().includes('hostname')) {
      this.emit('connected');
    }
    callback(null, chunk);
  }
}

const waitFor = (id, done) => {
  return function(data) {
    if(data.toString().includes(id)) {
      this.removeAllListeners('response');
      done();
    }
  }
}


describe('ircserv basic commands', function() {
  this.timeout(10000);
  const { Server, StreamLines } = require('..');
  const mockServer = new Server({
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
  });
  const mockListener = mockServer.createConnectionListener();
  const mockAgent = new IRCAgent();

  before((done) => {
    //console.log('BEFORE!')

    try {
      mockListener(mockAgent);
    } catch(e) {
      console.log(e);
      assert.equal(e, null);
    }

    mockAgent.on('connected', (data) => {
      mockAgent.push('NICK basic\n');
      mockAgent.push('USER basic 0 * :Test Agent\n');
      done();
    });
  });

  after(() => {
  });

  afterEach(function() {
  });

  it('WHO', function(done) {
    mockAgent.on('response', waitFor('315', done));
    mockAgent.push('who\n');
  });

  it('JOIN', function(done) {
    mockAgent.on('response', waitFor('329', done));
    mockAgent.push('join #cats\n');
  });

  it('TOPIC', function(done) {
    mockAgent.on('response', waitFor('fluffy ass cats', done));
    mockAgent.push('topic #cats :fluffy ass cats\n');
  });

  it('MODE', function(done) {
    mockAgent.on('response', waitFor('+itn', done));
    mockAgent.push('mode #cats +i\n');
  });

  it('PART', function(done) {
    mockAgent.on('response', waitFor('PART', done));
    mockAgent.push('part #cats\n');
  });

  it('WHOIS', function(done) {
    mockAgent.on('response', waitFor('318', done));
    mockAgent.push('whois basic\n');
  });

  it('ADMIN', function(done) {
    mockAgent.on('response', waitFor('259', done));
    mockAgent.push('admin\n');
  });

  it('OPER bad pass', function(done) {
    mockAgent.on('response', waitFor('464', done));
    mockAgent.push('oper boo boo\n');
  });

  it('OPER good pass', function(done) {
    mockAgent.on('response', waitFor('381', done));
    mockAgent.push('oper admin admin\n');
  });
});
