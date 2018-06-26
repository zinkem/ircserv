const net = require('net');
const proc = require('process');
const fs = require('fs');
const { Transform } = require('stream');

const { InformLogger } = require('./lib/informlogger.js');
const { users } = require('./lib/usertable.js');
const { User } = require('./lib/user.js');
const {
  logs,
  version,
  servername,
} = require('./lib/server_config.json');

const LOGS_DIR = logs;
const SERVER_LOG = `${LOGS_DIR}/ircserv.log`;
const PORT = proc.argv[2] || 6667;
const VERSION_STRING = version;
const SERVER_NAME = servername;
const CREATION_TIME = new Date().toString();

process.on('uncaughtException', (err) => {
  console.error(err);
  process.exit(1);
});

if (fs.existsSync(LOGS_DIR)) {
  const logdir = fs.statSync(LOGS_DIR);
  if (!logdir.isDirectory()) {
    console.error(`${LOGS_DIR} is not a directory`);
    proc.exit(1);
  }
} else {
  fs.mkdir(LOGS_DIR, (err) => {
    if (err) {
      console.error(err);
      proc.exit(1);
    }
  });
}

const inform = new InformLogger();
inform.pipe(fs.createWriteStream(SERVER_LOG));

inform.log(`${VERSION_STRING} started at ${CREATION_TIME}`);
inform.log(`Server is ${SERVER_NAME}`);

let slc = 0;
class StreamLines extends Transform {
  /**
     Ensures data recieved at next stream is broken by newline
  */
  constructor(opts, linebreak) {
    super(opts);
    this.linebreak = linebreak || '\n';
    this.buffer = '';
    slc += 1;
    this.id = slc;
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

const server = net.createServer((socket) => {
  const {
    remoteAddress,
    remotePort,
  } = socket;

  inform.log(`New connection from [${remoteAddress}]:${remotePort}`);

  const line_filter = new StreamLines({}, '\n');
  const client = new User(socket);
  client.inform = inform;
  client.on('drain', () => {
    inform.debug('CommandParser', remoteAddress, 'drained');
  });
  client.on('finish', () => {
    inform.debug('CommandParser', remoteAddress, 'finished');
  });
  client.on('pipe', (src) => {
    inform.debug('CommandParser', remoteAddress, 'pipe', typeof src);
  });
  client.on('unpipe', () => {
    inform.debug('CommandParser', remoteAddress, 'unpipe');
    socket.end();
  });
  client.on('error', (err) => {
    inform.error('CommandParser', remoteAddress, 'error', err);
  });
  client.on('close', () => {
    inform.debug('CommandParser', remoteAddress, 'closed');
    socket.end();
  });
  client.on('end', () => {
    inform.debug('CommandParser', remoteAddress, 'ended');
    socket.end();
  });

  socket.pipe(line_filter).pipe(client);

  socket.on('drain', () => {
    inform.debug('Socket', remoteAddress, 'drain');
  });

  socket.on('error', (err) => {
    inform.error('Socket', remoteAddress, 'error', err);
  });
  socket.on('close', () => {
    inform.debug('Connection to', remoteAddress, 'closed');
    client.command_list.QUIT(client, ['connection reset by peer']);
  });
  socket.on('end', () => {
    inform.debug('Socket', remoteAddress, 'end');
  });

  socket.on('timeout', () => {
    inform.debug('Socket', remoteAddress, 'timeout');
  });
  socket.on('connect', () => {
    inform.debug('Socket', remoteAddress, 'connect');
  });

  socket.on('pipe', (src) => {
    // src assumed to be a userpassthrough object
    inform.debug('Socket', remoteAddress, 'pipe', src.username);
  });
  socket.on('unpipe', () => {
    inform.debug('Socket', remoteAddress, 'unpipe');
  });
});

server.listen(PORT);
inform.log(`Listening on ${PORT}`);

inform.log(`${proc.memoryUsage().rss / 1000000}M`);
setInterval(() => {
  const mem_string = `${proc.memoryUsage().rss / 1000000}M`;
  inform.log(`${Object.keys(users).length} ${mem_string}`);
}, 30000);
