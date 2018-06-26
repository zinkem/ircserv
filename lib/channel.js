const { PassThrough } = require('stream');
const fs = require('fs');

const { InformLogger } = require('./informlogger.js');
const { logs } = require('./server_config.json');

const inform = new InformLogger();

const LOGS_DIR = logs;

const channels = {};
module.exports.channels = channels;

const AVAIL_CHAN_MODES = 'opsitnmlvk';
module.exports.AVAIL_CHAN_MODES = AVAIL_CHAN_MODES;

function modeString(mode) {
  let result = '+';

  const modes = Object.keys(mode);
  modes.forEach((k) => {
    if (mode[k] === true) result += k;
  });

  return result;
}
module.exports.modeString = modeString;

function clientSubscribe(chan_id, user) {
  inform.debug('user', user.nick, 'joining', chan_id);
  const channel = chan_id.toLowerCase();
  if (!channels[channel]) {
    channels[channel] = new PassThrough();
    channels[channel].setMaxListeners(100);
    channels[channel].pipe(fs.createWriteStream(`${LOGS_DIR}/ircserv_${channel}.ircservlog`));
    channels[channel].name = channel;
    channels[channel].topic = `:Welcome to ${channel}`;
    channels[channel].created = Math.floor(Date.now() / 1000);
    /*
      The various modes available for channels are as follows:

      o - give/take channel operator privileges;                 STATUS complete
      p - private channel flag;                                  STATUS complete
      s - secret channel flag;                                   STATUS complete
      i - invite-only channel flag;                              STATUS complete
      t - topic settable by channel operator only flag;          STATUS complete
      n - no messages to channel from clients on the outside;    STATUS complete
      m - moderated channel;                                     STATUS complete
      l - set the user limit to channel;                         STATUS complete
      b - set a ban mask to keep users out;                      STATUS incomplete
      v - give/take the ability to speak on a moderated channel; STATUS complete
      k - set a channel key (password).                          STATUS complete
    */
    channels[channel].mode = {
      o: {},
      p: false,
      s: false,
      i: false,
      t: true,
      n: true,
      m: false,
      l: 100,
      b: '',
      v: {},
      k: '',
      invited: {},
    };

    // grant ops to first channel member
    channels[channel].mode.o[user.nick] = true;
    inform.debug('granting ops', user.nick);
  }
  channels[channel].pipe(user.bcast_filter);
}
module.exports.clientSubscribe = clientSubscribe;

function clientUnSubscribe(chan_id, user) {
  const channel = chan_id.toLowerCase();
  if (channels[channel]) channels[channel].unpipe(user.bcast_filter);
}
module.exports.clientUnSubscribe = clientUnSubscribe;

function fetchChannel(chan_id) {
  const channel = chan_id.toLowerCase();
  return channels[channel];
}
module.exports.fetchChannel = fetchChannel;
