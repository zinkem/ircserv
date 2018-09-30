const net = require('net');
const proc = require('process');
const fs = require('fs');
const { Transform } = require('stream');

const { UserTable } = require('./usertable.js');
const { ChannelTable } = require('./channel.js');
const { ServerTable } = require('./servertable.js');
const { CommandList } = require('./commandlist.js');
const { logger } = require('./informlogger.js');
const { User } = require('./user.js');

const SERVER_LOG = 'ircserv.log';
const PORT = proc.argv[2] || 6667;
const CREATION_TIME = new Date().toString();

// note this belongs in the logger?
const createLogDir = (logPath) => {
  if (fs.existsSync(logPath)) {
    const logdir = fs.statSync(logPath);
    if (!logdir.isDirectory()) {
      console.error(`${logPath} is not a directory`);
      proc.exit(1);
    }
  } else {
    fs.mkdir(logPath, (err) => {
      if (err) {
        console.error(err);
        proc.exit(1);
      }
    });
  }
};

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

class Server {
  constructor(opts) {
    createLogDir(opts.logs);
    this.version = opts.version;
    this.servername = opts.servername;
    this.logpath = opts.logs;
    this.inform = logger;
    this.inform.setDebug(opts.debug);
    this.inform.pipe(fs.createWriteStream(`${opts.logs}/${SERVER_LOG}`));

    this.users = new UserTable();
    this.channels = new ChannelTable(opts);
    this.remotes = new ServerTable(opts);
    this.command_list = new CommandList(this, opts);

    const { inform, command_list } = this;
    this.server = net.createServer((socket) => {
      const {
        remoteAddress,
        remotePort,
      } = socket;

      inform.log(`New connection from [${remoteAddress}]:${remotePort}`);

      const line_filter = new StreamLines({}, '\n');


      const client = new User(socket, command_list);
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
  }

  listen(port) {
    const { inform, server } = this;
    const bind_port = port || PORT;

    inform.log(`${this.version} started at ${CREATION_TIME}`);
    inform.log(`Server is ${this.servername}`);

    server.listen(bind_port);
    inform.log(`Listening on ${bind_port}`);
  }

  getUser(nick) {
    return this.users.users[nick];
  }

  addUser(nick) {
    this.users.users[nick] = {};
  }

  getUserList() {
    return this.users.users;
  }

  getChannel(chan) {
    return this.channels[chan];
  }

  addUserToChannel(user, chan) {
    return ['not implemented', this, user, chan];
  }

  removeUserFromChannel(user, chan) {
    return ['not implemented', this, user, chan];
  }
}

exports.Server = Server;
