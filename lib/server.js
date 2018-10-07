const net = require('net');
const proc = require('process');
const fs = require('fs');
const dns = require('dns');
const { Transform } = require('stream');

const { UserTable } = require('./usertable.js');
const { ChannelTable } = require('./channel.js');
const { ServerTable } = require('./servertable.js');
const { CommandList } = require('./commandlist.js');
const { logger } = require('./informlogger.js');
const { ProtocolShell } = require('./protocolshell.js');

const SERVER_LOG = 'ircserv.log';
const PORT = proc.argv[2] || 6667;
const CREATION_TIME = new Date().toString();

// note this belongs in the logger?
const createLogDir = (logPath) => {
  if (fs.existsSync(logPath)) {
    const logdir = fs.statSync(logPath);
    if (!logdir.isDirectory()) {
      logger.error(`${logPath} is not a directory`);
      proc.exit(1);
    }
  } else {
    fs.mkdir(logPath, (err) => {
      if (err) {
        logger.error(err);
        proc.exit(1);
      }
    });
  }
};

const populateConnectionInfo = (sock, user) => {
  const inform = logger;
  let lookup_addr = sock.remoteAddress;
  user.hostname = lookup_addr;
  user.remoteAddress = sock.remoteAddress;
  user.remotePort = sock.remotePort;

  if (sock.remoteFamily === 'IPv6'
      && sock.remoteAddress.indexOf('::ffff:') >= 0) [, lookup_addr] = lookup_addr.split('::ffff:');

  sock.write('NOTICE AUTH :*** Looking up hostname...\n');
  dns.reverse(lookup_addr, (err, hostnames) => {
    if (err) {
      if (err.code !== 'ENOTFOUND') inform.error(err);
      sock.write(`NOTICE AUTH :*** Could not find hostname, using ${user.hostname}\n`);
    } else if (hostnames.length > 0) {
      [user.hostname] = hostnames;
      sock.write(`NOTICE AUTH :*** Found hostname ${user.hostname}\n`);
    } else {
      sock.write(`NOTICE AUTH :*** Could not find hostname, using ${user.hostname}\n`);
    }
    inform.log(['Found hostname', user.hostname, 'for address', lookup_addr].join(' '));
  });
};

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
module.exports.StreamLines = StreamLines;

class Server {
  constructor(opts) {
    createLogDir(opts.logs);
    this.version = opts.version;
    this.servername = opts.servername;
    this.logpath = opts.logs;
    this.operators = opts.operators;
    this.usermodes = 'iosw';

    this.inform = logger;
    this.inform.setDebug(opts.debug);
    this.inform.pipe(fs.createWriteStream(`${opts.logs}/${SERVER_LOG}`));

    this.users = new UserTable();
    this.channels = new ChannelTable(opts);
    this.remotes = new ServerTable(opts);
    this.command_list = new CommandList(this, opts);

    this.server = net.createServer(this.createConnectionListener());
  }

  createConnectionListener() {
    const { inform, command_list } = this;
    return (socket) => {
      const {
        remoteAddress,
        remotePort,
      } = socket;

      inform.log(`New connection from [${remoteAddress}]:${remotePort}`);

      const line_filter = new StreamLines({}, '\n');

      const clientShell = new ProtocolShell(command_list);
      populateConnectionInfo(socket, clientShell.client);

      clientShell.on('drain', () => {
        inform.debug('ClientShell', remoteAddress, 'drained');
      });
      clientShell.on('finish', () => {
        inform.debug('ClientShell', remoteAddress, 'finished');
      });
      clientShell.on('pipe', (src) => {
        inform.debug('ClientShell', remoteAddress, 'pipe', typeof src);
      });
      clientShell.on('unpipe', () => {
        inform.debug('ClientShell', remoteAddress, 'unpipe');
        socket.end();
      });
      clientShell.on('error', (err) => {
        inform.error('ClientShell', remoteAddress, 'error', err);
      });
      clientShell.on('close', () => {
        inform.debug('ClientShell', remoteAddress, 'closed');
        socket.end();
      });
      clientShell.on('end', () => {
        inform.debug('ClientShell', remoteAddress, 'ended');
        socket.end();
      });

      socket.on('drain', () => {
        inform.debug('Socket', remoteAddress, 'drain');
      });
      socket.on('error', (err) => {
        inform.error('Socket', remoteAddress, 'error', err);
      });
      socket.on('close', () => {
        inform.debug('Connection to', remoteAddress, 'closed');
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

      socket.pipe(line_filter).pipe(clientShell).pipe(socket);
      clientShell.client.pipe(socket);
    };
  }

  listen(port) {
    const { inform, server } = this;
    const bind_port = port || PORT;

    inform.log(`${this.version} started at ${CREATION_TIME}`);
    inform.log(`Server is ${this.servername}`);

    server.listen(bind_port);
    inform.log(`Listening on ${bind_port}`);
  }

  grantOperator(nick, role, pass) {
    const opCandidate = this.getUser(nick);
    if (!opCandidate) return false;
    if (this.operators
        && this.operators[role] === pass) {
      opCandidate.mode.o = true;
    }
    return opCandidate.mode.o === true;
  }

  disconnectUser(nick, message) {
    const target = this.users.users[nick];

    if (!target) return { error: 'ERR_NOSUCHNICK' };
    // purge user from users list
    delete this.users.users[nick];

    Object.keys(target.channels).forEach((key) => {
      this.channels.channels[key].write(`:${nick} QUIT :${message}\n`);
      this.channels.clientUnSubscribe(key, target);
    });
    target.end();
    return {};
  }

  configModeUser(nick, flags, params) {
    this.inform.debug(nick, 'configModeUser', flags, params);
    const user = this.getUser(nick);

    if (!flags) return { modes: Object.keys(user.mode).join('') };

    const flag_stack = flags.split('');
    const result = {
      add: '',
      remove: '',
      unknown: '',
    };

    let op = 'none';
    while (flag_stack.length > 0) {
      const c = flag_stack.shift();
      if (c === '+') {
        op = 'add';
      } else if (c === '-') {
        op = 'remove';
      } else if (this.usermodes.includes(c)) {
        // ignore attempts to op self, OPER instead
        if (!(c === 'o' && op === 'add')) {
          user.mode[c] = (op === 'add');
          result[op] += c;
        }
      } else {
        result.unknown += c;
      }
    }
    return result;
  }

  configModeChannel(user, chan, flags_arg, params) {
    return this.channels.configModeChannel(chan, flags_arg, params);
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

module.exports.Server = Server;
