const child_process = require('child_process');
const assert = require('assert');
const net = require('net');
const { Transform } = require('stream');
let server_job = null;
let server_exit_code = null;

//duplicated code, todo: move to a module
class StreamLines extends Transform {
  /**
     Ensures data recieved at next stream is broken by newline
  */
  constructor(opts, linebreak) {
    super(opts);
    this.linebreak = linebreak || '\n';
    this.buffer = '';
  }

  _transform(data, encoding, callback) {
    const input = this.buffer + data.toString('utf8');
    const lines = input.split('\n');
    this.buffer = lines.pop();
    while (lines.length > 0) {
      const line = lines.shift();
      this.push(line);
    }

    callback();
  }

  _flush(callback) {
    this.push(`${this.buffer}\n`);
    callback();
  }
}

describe('ircserv basic commands', function() {
  this.timeout(10000);
  before((done) => {
    console.log('\tStarting server...');
    server_job = child_process.spawn('node', ['irc.js']);
    server_job.on('error', (err) => {
      console.log(err);
      assert.fail(err);
    });

    server_job.on('exit', (code, signal) => {
      console.log('exit', code, signal);
      server_exit_code = code;
    });

    server_job.stdout.pipe(process.stdout);
    server_job.stderr.pipe(process.stderr);
    setTimeout(() => {
      // give server time to start
      done();
    }, 1000);
  });

  after(() => {
    server_job.kill();
  });

  afterEach(function() {
    assert.equal(server_exit_code, null, 'Server terminated unexpectedly');
  });

  it('Client connection handshake', function(done) {
    const client = net.createConnection(6667, 'localhost', () => {
      console.log('\tClient Connected');
      client.setEncoding('utf8');

      const command = new StreamLines();
      command.on('data', (data) => {
        client.write(`${data}\n`);
        console.log(`\t$ ${data}`);
      });

      command.write('NICK basic\n');
      command.write('USER basic 0 * :Test Agent\n');

      const lineparser = new StreamLines();

      client.pipe(lineparser);
      lineparser.on('data', (data) => {
        console.log(`\t  ${data}`);
        if (data.indexOf('004') !== -1) {
          command.write('quit\n');
        }
      });
      client.on('close', () => {
        console.log('\tClient Disconnected');
        done();
      });
    });

    client.on('error', (err) => {
      console.error('error', err);
      assert.fail('Connection closed unexpectedly');
    });
  });
});
