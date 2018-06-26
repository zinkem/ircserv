const { InformLogger } = require('./informlogger.js');
const { AVAIL_CHAN_MODES } = require('./channel.js');
const { AVAIL_USER_MODES } = require('./user.js');
const {
  version,
  servername,
} = require('./server_config.json');
const rpl_codes = require('../rpl_list.json');
const err_codes = require('../err_list.json');

const VERSION_STRING = version;
const SERVER_STRING = servername;
const CREATION_TIME = new Date().toString();

const inform = new InformLogger();

const lookup = {};

Object.keys(rpl_codes).forEach((k) => {
  const { name } = rpl_codes[k];
  lookup[name] = k;
});

Object.keys(err_codes).forEach((k) => {
  const { name } = err_codes[k];
  lookup[name] = k;
});

inform.log('Loaded reply code lookup table.');

let singleton = null;

function ReplyFactory() {
  if (singleton) return singleton;
  singleton = this;
  return this;
}
module.exports.ReplyFactory = ReplyFactory;

ReplyFactory.prototype.welcomeMessage = function (user) {
  // RFC2812
  const welcome = this.createReply('RPL_WELCOME', user).replace('<nick>!<user>@<host>', user.id);
  const yourhost = this.createReply('RPL_YOURHOST', user)
    .replace('<servername>', SERVER_STRING)
    .replace('<ver>', VERSION_STRING);
  const created = this.createReply('RPL_CREATED', user).replace('<date>', CREATION_TIME);
  const myinfo = this.createReply('RPL_MYINFO', user)
    .replace('<servername>', SERVER_STRING)
    .replace('<version>', VERSION_STRING)
    .replace('<available user modes>', AVAIL_USER_MODES)
    .replace('<available channel modes>', AVAIL_CHAN_MODES);

  const { remoteAddress, remotePort } = user.socket;
  inform.log(`[${remoteAddress}]:${remotePort} registered ${user.nick}`);

  return [welcome, yourhost, created, myinfo].join('\n');
};

ReplyFactory.prototype.createError = function (err_name, user, message, bypass) {
  const err_code = lookup[err_name] || 400;
  const err_message = message || (err_codes[err_code] ? err_codes[err_code].message : 'Error unknown');

  let err_uname = '*';
  if (user && user.registered()) err_uname = user.nick;
  else if (!bypass) return `:${SERVER_STRING} 400 * :Please Register`;

  return `:${SERVER_STRING} ${err_code} ${err_uname} ${err_message}`;
};

ReplyFactory.prototype.createReply = function (rpl_name, user, message) {
  const rpl_code = lookup[rpl_name] || 300;
  const rpl_message = message || (rpl_codes[rpl_code] ? rpl_codes[rpl_code].message : '');

  let rpl_uname = '*';

  if (user && user.registered()) rpl_uname = user.nick;
  else return `:${SERVER_STRING} 400 * :Please Register`;

  return `:${SERVER_STRING} ${rpl_code} ${rpl_uname} ${rpl_message}`;
};
