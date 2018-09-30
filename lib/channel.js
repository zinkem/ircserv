const { PassThrough } = require('stream');
const fs = require('fs');

const { logger: inform } = require('./informlogger.js');

function modeString(mode) {
  let result = '+';

  const modes = Object.keys(mode);
  modes.forEach((k) => {
    if (mode[k] === true) result += k;
  });

  return result;
}
module.exports.modeString = modeString;

class ChannelTable {
  constructor(opts) {
    this.channels = {};
    this.log_path = opts.logs;
  }

  clientSubscribe(chan_id, user) {
    inform.debug('user', user.nick, 'joining', chan_id);
    const channel = chan_id.toLowerCase();
    const { channels } = this;

    if (!channels[channel]) {
      channels[channel] = new PassThrough();
      channels[channel].setMaxListeners(100);
      channels[channel].pipe(fs.createWriteStream(`${this.log_path}/ircserv_${channel}.log`, { flags: 'a' }));
      channels[channel].name = channel;
      channels[channel].topic = `:Welcome to ${channel}`;
      channels[channel].created = Math.floor(Date.now() / 1000);
      channels[channel].write(`:SERVER Channel created at ${Date.now()}\n`);
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

  clientUnSubscribe(chan_id, user) {
    const channel = chan_id.toLowerCase();
    const { channels } = this;
    if (channels[channel]) {
      inform.debug(`${chan_id} removing ${user.nick}, ${channels[chan_id].listenerCount('data')}`);
      channels[channel].unpipe(user.bcast_filter);
      if (channels[channel].mode.o[user.nick]) {
        inform.debug(`${chan_id} removing ${user.nick} from ops list`);
        delete channels[channel].mode.o[user.nick];
      }

      if (channels[chan_id].listenerCount('data') === 1) {
        inform.debug(`deleting ${chan_id}`);
        channels[channel].write(`:SERVER Channel deleted at ${Date.now()}\n`);
        channels[chan_id]._readableState.pipes.end(() => {
          inform.debug(`${chan_id} fstream closed`);
        });
        delete channels[chan_id];
      }
    }
  }

  fetchChannel(chan_id) {
    const channel = chan_id.toLowerCase();
    return this.channels[channel];
  }

  // can this be refactored so 'reply' not passed in?
  // i.e. return a status of operation back to caller
  configModeChannel(user, chan, flags_arg, params, reply) {
    const chan_stream = this.channels[chan];
    const { mode } = chan_stream;
    let flags = flags_arg;

    if (flags) {
      if (!mode.o[user.nick]) return reply.createError('ERR_CHANOPRIVSNEEDED', user).replace('<channel>', chan);

      inform.debug(params);
      inform.debug(flags);
      if (flags[0] === '+') {
        //+
        flags = flags.substring(1);
        flags.split().forEach((op) => {
          inform.debug('set', op, mode[op]);

          if (mode[op] === false) {
            mode[op] = true;
          } else if (op === 'o' || op === 'v') {
            // var u = params.shift();
            const u = params[0];
            mode[op][u] = true;
            inform.debug('set', op, u);
          } else if (op === 'l' || op === 'k') {
            const u = params.shift();
            mode[op] = u;
            inform.debug('set', op, u);
          } else {
            inform.debug('no op', op);
          }
        });
        chan_stream.write(`:${user.id} MODE ${chan} +${flags} ${params[0] ? params[0] : ''}\n`);
      } else if (flags[0] === '-') {
        //-
        flags = flags.substring(1);
        flags.split().forEach((op) => {
          inform.debug('unset', op, mode[op]);

          if (mode[op] && mode[op] === true) {
            mode[op] = false;
          } else if (op === 'o' || op === 'v') {
            const u = params[0];
            mode[op][u] = false;
            inform.debug('unset', op, u);
          } else if (op === 'l') {
            mode.l = -1;
            inform.debug('unset', op, '-1');
          } else if (op === 'k') {
            mode.k = '';
            inform.debug('unset', op, '');
          } else {
            inform.debug('no op', op);
          }
        });
        chan_stream.write(`:${user.id} MODE ${chan} -${flags} ${params[0]}\n`);
      }
    }
    return reply.createReply('RPL_CHANNELMODEIS', user, `${chan} ${modeString(mode)}`);
  }
}
module.exports.ChannelTable = ChannelTable;
