'use strict';

const { Writable,
        Transform,
        PassThrough } = require('stream');
const net = require('net');
const proc = require('process');
const dns = require('dns')

const DEBUG_MODE = false;
var inform = new Transform({
  transform(data, encoding, callback) {
    var xdata = [ Date.now(), '[SERVER]', data, '\n' ] .join(' ');
    callback(null, xdata);
  }
});
inform.log = inform.write;
inform.debug = function() { if(DEBUG_MODE) console.log.apply(null, arguments); };
inform.error = function() { var err = Array.prototype.concat.apply(['ERROR!!!'],arguments);
                            console.log.apply(null, err); };
inform.pipe(proc.stdout);

const PORT = proc.argv[2] || 6667;
const VERSION_STRING = 'wirc.0.0.1-alpha';
const CREATION_TIME = new Date().toString();
inform.log([VERSION_STRING, 'started at', CREATION_TIME].join(' '));

const err_codes = require('./err_list.json');
const rpl_codes = require('./rpl_list.json');
const lookup = {}

for( var k in rpl_codes ){
  var name = rpl_codes[k].name
  lookup[name] = k;
}

for( var k in err_codes ){
  var name = err_codes[k].name
  lookup[name] = k;
}
inform.log('Loaded response codes.');

var users = {};
var channels = {};

function modeString(mode) {
  var result = '+';

  var modes = Object.keys(mode);
  for( var k in mode ){
    if( mode[k] === true )
      result += k;
  }

  return result;
}

const AVAIL_USER_MODES = '-';
const AVAIL_CHAN_MODES = 'opsitnmlvk';

function clientSubscribe(channel, client_socket) {
  channel = channel.toLowerCase();
  if( !channels[channel] ) {
    channels[channel] = new PassThrough();
    channels[channel].pipe(proc.stdout);
    channels[channel].name = channel;
    channels[channel].topic = ':Welcome to '+channel;
    channels[channel].created = Math.floor(Date.now()/1000);
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
      o : {},
      p : false,
      s : false,
      i : false,
      t : true,
      n : true,
      m : false,
      l : 100,
      b : '',
      v : {},
      k : '',
      invited : {}
    }

    //grant ops to first channel member
    channels[channel].mode.o[client_socket.cp.nick] = true;
  }

  channels[channel].pipe(client_socket);
}

function clientUnSubscribe(channel, client_socket) {
  channel = channel.toLowerCase();
  if( channels[channel] )
    channels[channel].unpipe(client_socket);
}

function fetchChannel(channel) {
  channel = channel.toLowerCase();
  return channels[channel];
}

function validNick(nick) {
  return nick.length < 16 &&
    nick.match(/^[a-zA-Z]+[a-zA-Z0-9_]*$/);
}

var server_string = 'fibonaut.com'
inform.log(server_string);

class CommandParser extends Writable {
  constructor(sock, opts) {
    super(opts)
    this.socket = sock;
    this.user = null;
    this.id = null;
    this.con_pass = null;
    this.hostname = sock.remoteAddress;
    this.nick = null;
    this.real_name = null;

    var lookup_addr = sock.remoteAddress;

    if( sock.remoteFamily === 'IPv6' &&
        sock.remoteAddress.indexOf('::ffff:') >= 0)
      lookup_addr = lookup_addr.split('::ffff:')[1];

    sock.write('NOTICE AUTH :*** Looking up hostname...\n')
    dns.reverse(lookup_addr, (err, hostnames) => {
      if(err) {
        if( err.code !== 'ENOTFOUND')
          inform.error(err);
        sock.write('NOTICE AUTH :*** Could not find hostname, using '+this.hostname+'\n');
      } else {
        this.hostname = hostnames[0];
        sock.write('NOTICE AUTH :*** Found hostname '+this.hostname+'\n')
      }
      inform.log(['Found hostname', this.hostname, 'for address', lookup_addr].join(' '));
    });

    this.command_list = {
      PASS: (args) => {
        /* RFC 1459
           4.1.1 Password message       STATUS incomplete :always responds error

           Command: PASS
           Parameters: <password>

           The PASS command is used to set a 'connection password'.  The
           password can and must be set before any attempt to register the
           connection is made.  Currently this requires that clients send a PASS
           command before sending the NICK/USER combination and servers *must*
           send a PASS command before any SERVER command.  The password supplied
           must match the one contained in the C/N lines (for servers) or I
           lines (for clients).  It is possible to send multiple PASS commands
           before registering but only the last one sent is used for
           verification and it may not be changed once registered.  Numeric
           Replies:

           ERR_NEEDMOREPARAMS              ERR_ALREADYREGISTRED

           Example:

           PASS secretpasswordhere

        */
        if( args.length < 1 )
          return this.createError('ERR_NEEDMOREPARAMS').replace('<command>', 'PASS');;

        if( this.user )
          return this.createError('ERR_ALREADYREGISTRED');

        this.con_pass = args[0];

      },
      NICK: (args) => {
        /* RFC 1459
           4.1.2 Nick message           STATUS finished until SERVER

           Command: NICK
           Parameters: <nickname> [ <hopcount> ]

           NICK message is used to give user a nickname or change the previous
           one.  The <hopcount> parameter is only used by servers to indicate
           how far away a nick is from its home server.  A local connection has
           a hopcount of 0.  If supplied by a client, it must be ignored.

           If a NICK message arrives at a server which already knows about an
           identical nickname for another client, a nickname collision occurs.
           As a result of a nickname collision, all instances of the nickname
           are removed from the server's database, and a KILL command is issued
           to remove the nickname from all other server's database. If the NICK
           message causing the collision was a nickname change, then the
           original (old) nick must be removed as well.

           If the server recieves an identical NICK from a client which is
           directly connected, it may issue an ERR_NICKCOLLISION to the local
           client, drop the NICK command, and not generate any kills.

           Numeric Replies:

           ERR_NONICKNAMEGIVEN             ERR_ERRONEUSNICKNAME
           ERR_NICKNAMEINUSE               ERR_NICKCOLLISION

           Example:

           NICK Wiz                        ; Introducing new nick "Wiz".

           :WiZ NICK Kilroy                ; WiZ changed his nickname to Kilroy.

        */

        //enough params?
        if( args.length < 1 )
          return this.createError('ERR_NONICKNAMEGIVEN',null,true);

        var new_nick = args[0];

        //is this a valid nickname?
        if( !validNick(new_nick) ) {
          return this.createError('ERR_ERRONEUSNICKNAME',null,true)
            .replace('<nick>', new_nick);
        }

        //is someone using this name already?
        if( users[new_nick] ) {
          return this.createError('ERR_NICKNAMEINUSE',null,true)
            .replace('<nick>', new_nick);
        }

        var old_nick = this.nick;
        this.nick = new_nick;
        inform.debug('NICK', old_nick, new_nick, this.id);

        if( !this.user ){
          //first nick, not ready for registration needs no response
          //registration will complete in USER, case 1
          return;
        }

        //registration success, case 2 (first nick rejected, user succeeded)
        if( !old_nick && this.user ){
          this.socket.write(this.welcomeMessage()+'\n');
        }

        //assign new id and add new_nick to users map
        this.id = new_nick+'!~'+this.user.username+'@'+this.hostname;
        users[new_nick] = this.user;

        //remove user entry for old nick
        if( old_nick ){
          delete users[old_nick];
        }

        if( this.registered() ) {

          var mchan = this.user.channels;
          for( var key in mchan ){
            inform.debug('NICK', key, args);

            if( mchan[key] ) {
              var mode = channels[key].mode;

              //change mode keys
              if( mode.o[old_nick] ){
                mode.o[new_nick] = true;
                delete mode.o[old_nick];
              }

              if( mode.v[old_nick] ){
                mode.v[new_nick] = true;
                delete mode.v[old_nick];
              }

              if( mode.invited[old_nick] ){
                delete mode.o[old_nick];
              }

              //broadcast nick change to channel
              channels[key].write([':'+old_nick,'NICK',new_nick].join(' ')+'\n');
            }
          }
        }
      },
      USER: (args) => {
        /* RFC 1459 
           4.1.3 User message           STATUS compliant

           Command: USER
           Parameters: <username> <hostname> <servername> <realname>

           The USER message is used at the beginning of connection to specify
           the username, hostname, servername and realname of s new user.  It is
           also used in communication between servers to indicate new user
           arriving on IRC, since only after both USER and NICK have been
           received from a client does a user become registered.

           Between servers USER must to be prefixed with client's NICKname.
           Note that hostname and servername are normally ignored by the IRC
           server when the USER command comes from a directly connected client
           (for security reasons), but they are used in server to server
           communication.  This means that a NICK must always be sent to a
           remote server when a new user is being introduced to the rest of the
           network before the accompanying USER is sent.

           It must be noted that realname parameter must be the last parameter,
           because it may contain space characters and must be prefixed with a
           colon (':') to make sure this is recognised as such.

           Since it is easy for a client to lie about its username by relying
           solely on the USER message, the use of an "Identity Server" is
           recommended.  If the host which a user connects from has such a
           server enabled the username is set to that as in the reply from the
           "Identity Server".

           Numeric Replies:

           ERR_NEEDMOREPARAMS              ERR_ALREADYREGISTRED

           Examples:


           USER guest tolmoon tolsun :Ronnie Reagan
           ; User registering themselves with a
           username of "guest" and real name
           "Ronnie Reagan".


           :testnick USER guest tolmoon tolsun :Ronnie Reagan
           ; message between servers with the
           nickname for which the USER command
           belongs to

        */
        if( args.length < 4 ) {
          return this.createError('ERR_NEEDMOREPARAMS',null,true)
            .replace('<command>', 'USER');
        }

        var username = args.shift();
        var mode = args.shift();
        var unused = args.shift();
        var real_name = args.join(' ').slice(1).trim();

        //is this connection already registered?
        if( this.registered() )
          return this.createError('ERR_ALREADYREGISTRED');

        this.real_name = real_name;
        this.user = new Transform({
          transform(data, encoding, callback) {
            //filter out privmsgs to self (from channels)
            if( data.toString().startsWith(':'+this.cp.nick) &&
                data.toString().includes('PRIVMSG')){
              callback();
            } else {
              callback(null, data);
            }
          }
        });
        this.user.channels = {};
        this.user.cp = this; //a better way would be to encapsulate nick, real name etc

        this.user.on('pipe', (src) => {
          //src.name, src assumed to be a channel...
          inform.debug('UserPassThrough', username, 'pipe', src.name);
          this.user.channels[src.name] = true;
        });
        this.user.on('unpipe', (src) => {
          inform.debug('UserPassThrough', username, 'unpipe', src.name);
          if( this.user)
            this.user.channels[src.name] = false;
        });
        this.user.on('error', (err) => {
          inform.error('UserPassThrough', username, err);
        });
        this.user.on('close', () => {
          inform.debug('UserPassThrough', username, 'removing user on UPT close');
          if( users[this.nick] ) {
            delete users[this.nick];
          }

          if( this.user )
            this.user = null;
        });
        this.user.on('end', () => {
          inform.debug('UserPassThrough', username, 'end');
          if( users[this.nick] ) {
            delete users[this.nick];
          }

          if( this.user )
            this.user = null;
        });

        this.user.username = username;

        //registration success, case 1, first nick successful
        if( this.nick && !users[this.nick] ) {
          this.id = this.nick+'!~'+username+'@'+this.hostname;
          this.socket.write(this.welcomeMessage() + '\n');
          users[this.nick] = this.user;
        }

        this.user.pipe(this.socket, { end: false });
      },
      SERVER: (args) => {
        /* RFC 1459 
           4.1.4 Server message         STATUS no implementation

           Command: SERVER
           Parameters: <servername> <hopcount> <info>

           The server message is used to tell a server that the other end of a
           new connection is a server. This message is also used to pass server
           data over whole net.  When a new server is connected to net,
           information about it be broadcast to the whole network.  <hopcount>
           is used to give all servers some internal information on how far away
           all servers are.  With a full server list, it would be possible to
           construct a map of the entire server tree, but hostmasks prevent this
           from being done.

           The SERVER message must only be accepted from either (a) a connection
           which is yet to be registered and is attempting to register as a
           server, or (b) an existing connection to another server, in  which
           case the SERVER message is introducing a new server behind that
           server.

           Most errors that occur with the receipt of a SERVER command result in
           the connection being terminated by the destination host (target
           SERVER).  Error replies are usually sent using the "ERROR" command
           rather than the numeric since the ERROR command has several useful
           properties which make it useful here.

           If a SERVER message is parsed and attempts to introduce a server
           which is already known to the receiving server, the connection from
           which that message must be closed (following the correct procedures),
           since a duplicate route to a server has formed and the acyclic nature
           of the IRC tree broken.

           Numeric Replies:

           ERR_ALREADYREGISTRED

           Example:

           SERVER test.oulu.fi 1 :[tolsun.oulu.fi] Experimental server
           ; New server test.oulu.fi introducing
           itself and attempting to register.  The
           name in []'s is the hostname for the
           host running test.oulu.fi.


           :tolsun.oulu.fi SERVER csd.bu.edu 5 :BU Central Server
           ; Server tolsun.oulu.fi is our uplink
           for csd.bu.edu which is 5 hops away.

        */
        return this.createError(400, 'SEVRER not yet implemented');
      },
      OPER: (args) => {
        /* RFC 1459 
           4.1.5 Oper                   STATUS no implementation

           Command: OPER
           Parameters: <user> <password>

           OPER message is used by a normal user to obtain operator privileges.
           The combination of <user> and <password> are required to gain
           Operator privileges.

           If the client sending the OPER command supplies the correct password
           for the given user, the server then informs the rest of the network
           of the new operator by issuing a "MODE +o" for the clients nickname.

           The OPER message is client-server only.

           Numeric Replies:

           ERR_NEEDMOREPARAMS              RPL_YOUREOPER
           ERR_NOOPERHOST                  ERR_PASSWDMISMATCH

           Example:

           OPER foo bar                    ; Attempt to register as an operator
           using a username of "foo" and "bar" as
           the password.
        */
        return this.createError(400, 'OPER not yet implemented');
      },
      QUIT: (args) => {
        /* RFC 1459
           4.1.6 Quit                   STATUS finished

           Command: QUIT
           Parameters: [<Quit message>]

           A client session is ended with a quit message.  The server must close
           the connection to a client which sends a QUIT message. If a "Quit
           Message" is given, this will be sent instead of the default message,
           the nickname.

           When netsplits (disconnecting of two servers) occur, the quit message
           is composed of the names of two servers involved, separated by a
           space.  The first name is that of the server which is still connected
           and the second name is that of the server that has become
           disconnected.

           If, for some other reason, a client connection is closed without  the
           client  issuing  a  QUIT  command  (e.g.  client  dies and EOF occurs
           on socket), the server is required to fill in the quit  message  with
           some sort  of  message  reflecting the nature of the event which
           caused it to happen.

           Numeric Replies:

           None.

           Examples:

           QUIT :Gone to have lunch        ; Preferred message format.
        */
        var username = this.id
        //duct tape to prevent multiple quit calls
        if( !this.user )
          return;

        var mchan = this.user.channels;
        for( var key in mchan ){
          inform.debug(key);
          if( mchan[key] )
            channels[key].write(':'+username + ' QUIT ' +
                             ' :' + args.join(' ') + '\n');
        }
        this.user.end();
        this.user.emit('end');
        this.end();
      },
      SQUIT: (args) => {
        /* RFC 1459
           4.1.7 Server quit message    STATUS no implemenation

           Command: SQUIT
           Parameters: <server> <comment>

           The SQUIT message is needed to tell about quitting or dead servers.
           If a server wishes to break the connection to another server it must
           send a SQUIT message to the other server, using the the name of the
           other server as the server parameter, which then closes its
           connection to the quitting server.

           This command is also available operators to help keep a network of
           IRC servers connected in an orderly fashion.  Operators may also
           issue an SQUIT message for a remote server connection.  In this case,
           the SQUIT must be parsed by each server inbetween the operator and
           the remote server, updating the view of the network held by each
           server as explained below.

           The <comment> should be supplied by all operators who execute a SQUIT
           for a remote server (that is not connected to the server they are
           currently on) so that other operators are aware for the reason of
           this action.  The <comment> is also filled in by servers which may
           place an error or similar message here.

           Both of the servers which are on either side of the connection being
           closed are required to to send out a SQUIT message (to all its other
           server connections) for all other servers which are considered to be
           behind that link.

           Similarly, a QUIT message must be sent to the other connected servers
           rest of the network on behalf of all clients behind that link.  In
           addition to this, all channel members of a channel which lost a
           member due to the split must be sent a QUIT message.

           If a server connection is terminated prematurely (e.g. the server  on
           the  other  end  of  the  link  died),  the  server  which  detects
           this disconnection is required to inform the rest of  the  network
           that  the connection  has  closed  and  fill  in  the comment field
           with something appropriate.

           Numeric replies:

           ERR_NOPRIVILEGES                ERR_NOSUCHSERVER

           Example:

           SQUIT tolsun.oulu.fi :Bad Link ? ; the server link tolson.oulu.fi has
           been terminated because of "Bad Link".

           :Trillian SQUIT cm22.eng.umd.edu :Server out of control
           ; message from Trillian to disconnect
           "cm22.eng.umd.edu" from the net
           because "Server out of control".
        */
        return this.createError(400, 'SQUIT not yet implemented');
      },
      JOIN: (args) => {
        /* RFC 1459
           4.2.1 Join message           STATUS 90% complete, todo: lists and bans

           Command: JOIN
           Parameters: <channel>{,<channel>} [<key>{,<key>}]

           The JOIN command is used by client to start listening a specific
           channel. Whether or not a client is allowed to join a channel is
           checked only by the server the client is connected to; all other
           servers automatically add the user to the channel when it is received
           from other servers.  The conditions which affect this are as follows:

           1.  the user must be invited if the channel is invite-only;

           2.  the user's nick/username/hostname must not match any
           active bans;

           3.  the correct key (password) must be given if it is set.

           These are discussed in more detail under the MODE command (see
           section 4.2.3 for more details).

           Once a user has joined a channel, they receive notice about all
           commands their server receives which affect the channel.  This
           includes MODE, KICK, PART, QUIT and of course PRIVMSG/NOTICE.  The
           JOIN command needs to be broadcast to all servers so that each server
           knows where to find the users who are on the channel.  This allows
           optimal delivery of PRIVMSG/NOTICE messages to the channel.

           If a JOIN is successful, the user is then sent the channel's topic
           (using RPL_TOPIC) and the list of users who are on the channel (using
           RPL_NAMREPLY), which must include the user joining.

           Numeric Replies:

           ERR_NEEDMOREPARAMS              ERR_BANNEDFROMCHAN
           ERR_INVITEONLYCHAN              ERR_BADCHANNELKEY
           ERR_CHANNELISFULL               ERR_BADCHANMASK
           ERR_NOSUCHCHANNEL               ERR_TOOMANYCHANNELS
           RPL_TOPIC
           RPL_NAMREPLY

           Examples:

           JOIN #foobar                    ; join channel #foobar.

           JOIN &foo fubar                 ; join channel &foo using key "fubar".

           JOIN #foo,&bar fubar            ; join channel #foo using key "fubar"
           and &bar using no key.

           JOIN #foo,#bar fubar,foobar     ; join channel #foo using key "fubar".
           and channel #bar using key "foobar".

           JOIN #foo,#bar                  ; join channels #foo and #bar.

           :WiZ JOIN #Twilight_zone        ; JOIN message from WiZ

        */

        if( args.length < 1 ){
          return this.createError('ERR_NEEDMOREPARAMS').replace('<command>', 'JOIN');;
        }

        var user = this.user;
        var chans_csv = args[0];
        chans_csv = chans_csv.replace(':','');

        var chan_list = chans_csv.split(',');

        console.log(chan_list);

        for( var k in chan_list ) {
          var chan = chan_list[k].toLowerCase();

          //user banned from channel?

          //invite only channel?
          if( channels[chan] &&
              channels[chan].mode.i === true &&
              !channels[chan].mode.invited[user.username] ) {
            return this.createError('ERR_INVITEONLYCHAN').replace('<channel>', chan);
          }

          //channel key?
          if( channels[chan] &&
              channels[chan].mode.k.length > 0 ) {
            var pass = args[1];

            if( channels[chan].mode.k !== pass )
              return this.createError('ERR_BADCHANNELKEY').replace('<channel>', chan);
          }

          //is channel full?
          if( channels[chan] &&
              channels[chan]._readableState.pipes.length > channels[chan].mode.l &&
              channels[chan].mode.l > 0 ) {
            return this.createError('ERR_CHANNELISFULL');
          }

          clientSubscribe(chan, user);
          channels[chan].write(':'+this.id+' JOIN :'+chan+'\n');

          this.socket.write(this.command_list.TOPIC([ chan ])+'\n');
          this.command_list.NAMES([ chan ]);
        }
      },
      PART: (args) => {
        /* RFC 1459 
           4.2.2 Part message           STATUS incomplete multiple channels, error handling

           Command: PART
           Parameters: <channel>{,<channel>}

           The PART message causes the client sending the message to be removed
           from the list of active users for all given channels listed in the
           parameter string.

           Numeric Replies:

           ERR_NEEDMOREPARAMS              ERR_NOSUCHCHANNEL
           ERR_NOTONCHANNEL

           Examples:

           PART #twilight_zone             ; leave channel "#twilight_zone"

           PART #oz-ops,&group5            ; leave both channels "&group5" and
           "#oz-ops".
        */
        if( args < 1 ){
          return this.createError('ERR_NEEDMOREPARAMS').replace('<command>', 'PART');
        }

        var chan = args.shift();
        var user = this.user;
        channels[chan].write(':'+this.id + ' PART ' + chan +
                             ' :' + args.join(' ') + '\n');
        clientUnSubscribe(chan, user);
      },
      MODE: (args) => {
        /* RFC 1459
           4.2.3 Mode message           STATUS 49% complete, channel only, no user modes

           Command: MODE

           The MODE command is a dual-purpose command in IRC.  It allows both
           usernames and channels to have their mode changed.  The rationale for
           this choice is that one day nicknames will be obsolete and the
           equivalent property will be the channel.

           When parsing MODE messages, it is recommended that the entire message
           be parsed first and then the changes which resulted then passed on.

           4.2.3.1 Channel modes

           Parameters: <channel> {[+|-]|o|p|s|i|t|n|b|v} [<limit>] [<user>]
           [<ban mask>]

           The MODE command is provided so that channel operators may change the
           characteristics of `their' channel.  It is also required that servers
           be able to change channel modes so that channel operators may be
           created.

           The various modes available for channels are as follows:

           o - give/take channel operator privileges;
           p - private channel flag;
           s - secret channel flag;
           i - invite-only channel flag;
           t - topic settable by channel operator only flag;
           n - no messages to channel from clients on the outside;
           m - moderated channel;
           l - set the user limit to channel;
           b - set a ban mask to keep users out;
           v - give/take the ability to speak on a moderated channel;
           k - set a channel key (password).

           When using the 'o' and 'b' options, a restriction on a total of three
           per mode command has been imposed.  That is, any combination of 'o'
           and

           4.2.3.2 User modes

           Parameters: <nickname> {[+|-]|i|w|s|o}

           The user MODEs are typically changes which affect either how the
           client is seen by others or what 'extra' messages the client is sent.
           A user MODE command may only be accepted if both the sender of the
           message and the nickname given as a parameter are both the same.

           The available modes are as follows:

           i - marks a users as invisible;
           s - marks a user for receipt of server notices;
           w - user receives wallops;
           o - operator flag.

           Additional modes may be available later on.

           If a user attempts to make themselves an operator using the "+o"
           flag, the attempt should be ignored.  There is no restriction,
           however, on anyone `deopping' themselves (using "-o").  Numeric
           Replies:

           ERR_NEEDMOREPARAMS              RPL_CHANNELMODEIS
           ERR_CHANOPRIVSNEEDED            ERR_NOSUCHNICK
           ERR_NOTONCHANNEL                ERR_KEYSET
           RPL_BANLIST                     RPL_ENDOFBANLIST
           ERR_UNKNOWNMODE                 ERR_NOSUCHCHANNEL

           ERR_USERSDONTMATCH              RPL_UMODEIS
           ERR_UMODEUNKNOWNFLAG

           Examples:

           Use of Channel Modes:

           MODE #Finnish +im               ; Makes #Finnish channel moderated and
           'invite-only'.

           MODE #Finnish +o Kilroy         ; Gives 'chanop' privileges to Kilroy on
           channel #Finnish.

           MODE #Finnish +v Wiz            ; Allow WiZ to speak on #Finnish.

           MODE #Fins -s                   ; Removes 'secret' flag from channel
           #Fins.

           MODE #42 +k oulu                ; Set the channel key to "oulu".

           MODE #eu-opers +l 10            ; Set the limit for the number of users
           on channel to 10.

           MODE &oulu +b                   ; list ban masks set for channel.

           MODE &oulu +b *!*@*             ; prevent all users from joining.

           MODE &oulu +b *!*@*.edu         ; prevent any user from a hostname
           matching *.edu from joining.

           Use of user Modes:

           :MODE WiZ -w                    ; turns reception of WALLOPS messages
           off for WiZ.

           :Angel MODE Angel +i            ; Message from Angel to make themselves
           invisible.

           MODE WiZ -o                     ; WiZ 'deopping' (removing operator
           status).  The plain reverse of this
           command ("MODE WiZ +o") must not be
           allowed from users since would bypass
           the OPER command.
        */

        //channel mode args[0] = channel (4.2.3.1)
        //user mode args[0] = nickname (4.2.3.2)

        if( args.length < 1)
          return this.createError('ERR_NEEDMOREPARAMS').replace('<command>', 'MODE');

        var chan = args[0];
        var flags = args[1];
        var params = args.slice(2);

        var chan_stream = channels[chan];
        if( !chan_stream ){
          return this.createError('ERR_NOTONCHANNEL').replace('<channel>', chan);
        }

        var mode = chan_stream.mode;

        if( flags ){
          if( !mode.o[this.nick] )
            return this.createError('ERR_CHANOPRIVSNEEDED').replace('<channel>', chan)

          inform.debug(params);
          inform.debug(flags);
          if( flags[0] === '+' ) {
            //+
            flags = flags.substring(1);
            for( var i in flags ){
              var op = flags[i];
              inform.debug('set', op, mode[op]);

              if( mode[op] === false) {
                mode[op] = true;
              } else {
                if( op === 'o' || op === 'v') {
                  var u = params.shift();
                  mode[op][u] = true;
                  inform.debug('set',op, u);
                } else if( op === 'l' || op === 'k' ) {
                  var u = params.shift();
                  mode[op] = u;
                  inform.debug('set',op, u);
                } else {
                  inform.debug('no op', op);
                }
              }
            }
          } else if( flags[0] === '-' ) {
            //-
            flags = flags.substring(1);
            for( var i in flags ){
              var op = flags[i];
              inform.debug('unset', op, mode[op]);

              if( mode[op] && mode[op] === true) {
                mode[op] = false;
              } else {
                if( op === 'o' || op === 'v') {
                  var u = params.shift();
                  mode[op][u] = false;
                  inform.debug('unset',op, u);
                } else if( op === 'l' ) {
                  mode.l = -1;
                  inform.debug('unset',op,'-1');
                } else if( op === 'k' ) {
                  mode.k = '';
                  inform.debug('unset',op,'');
                } else {
                  inform.debug('no op', op);
                }
              }
            }
          }
          chan_stream.write( [ ':'+this.id , 'MODE', args.join(' ') ].join(' ')+'\n' );
        }

        return [ this.createReply('RPL_CHANNELMODEIS', chan+' '+modeString(mode)),
                 this.createReply('RPL_CREATIONTIME', chan+' '+chan_stream.created)
               ].join('\n');
      },
      TOPIC: (args) => {
        /* RFC 1459 
           4.2.4 Topic message          STATUS finished

           Command: TOPIC
           Parameters: <channel> [<topic>]

           The TOPIC message is used to change or view the topic of a channel.
           The topic for channel <channel> is returned if there is no <topic>
           given.  If the <topic> parameter is present, the topic for that
           channel will be changed, if the channel modes permit this action.

           Numeric Replies:

           ERR_NEEDMOREPARAMS              ERR_NOTONCHANNEL
           RPL_NOTOPIC                     RPL_TOPIC
           ERR_CHANOPRIVSNEEDED

           Examples:

           :Wiz TOPIC #test :New topic     ;User Wiz setting the topic.

           TOPIC #test :another topic      ;set the topic on #test to "another
           topic".

           TOPIC #test                     ; check the topic for #test.
        */
        if( args.length < 1 )
          return this.createError('ERR_NEEDMOREPARAMS').replace('<command>', 'TOPIC');

        var chan = args[0];
        var nick = this.nick;

        if( !this.user.channels[chan] )
          return this.createError('ERR_NOTONCHANNEL').replace('<channel>', chan);

        if( args[1] && channels[chan].mode.t && !channels[chan].mode.o[nick]){
          //check for user op privileges
          return this.createError('ERR_CHANOPRIVSNEEDED').replace('<channel>', chan);
        }

        //duct tape
        if( args[2] ) {
          var new_topic = args.slice(1).join(' ').slice(1);
          channels[chan].topic = ':'+new_topic;
          channels[chan].write(this.createReply('RPL_TOPIC', [chan, channels[chan].topic].join(' '))+'\n');

        } else if( args[1] ){
          var new_topic = args.slice(1);
          channels[chan].topic = ':'+new_topic;
          channels[chan].write(this.createReply('RPL_TOPIC', [chan, channels[chan].topic].join(' '))+'\n');

        } else {
          return this.createReply('RPL_TOPIC', [chan, channels[chan].topic].join(' '));
        }
      },
      NAMES: (args) => {
        /* RFC 1459
           4.2.5 Names message          STATUS incomplete multiple channels

           Command: NAMES
           Parameters: [<channel>{,<channel>}]

           By using the NAMES command, a user can list all nicknames that are
           visible to them on any channel that they can see.  Channel names
           which they can see are those which aren't private (+p) or secret (+s)
           or those which they are actually on.  The <channel> parameter
           specifies which channel(s) to return information about if valid.
           There is no error reply for bad channel names.

           If no <channel> parameter is given, a list of all channels and their
           occupants is returned.  At the end of this list, a list of users who
           are visible but either not on any channel or not on a visible channel
           are listed as being on `channel' "*".

           Numerics:

           RPL_NAMREPLY                    RPL_ENDOFNAMES

           Examples:

           NAMES #twilight_zone,#42        ; list visible users on #twilight_zone
           and #42 if the channels are visible to
           you.

           NAMES                           ; list all visible channels and users

        */

        if( args.length < 1 )
          return this.createError('ERR_NEEDMOREPARAMS').replace('<command>', 'NAMES');

        var chanlist = args[0].split(',');
        var user = this.user;

        for( var i in chanlist ){

          var chan = chanlist[i];

          if( !channels[chan] ) {
            this.socket.write(this.createError('ERR_NOSUCHCHANNEL')
                              .replace('<channel name>', chan)+'\n');
            continue;
          }

          var result = [];
          var chan_users = channels[chan]._readableState.pipes;

          for( var k in chan_users ){
            if( chan_users[k] ) {
              if( chan_users[k].cp )
                result.push( chan_users[k].cp.nick )
            } else {
              inform.error('chan_users', chan, k, chan_users[k]);
            }
          }

          result = result.map( x => (channels[chan].mode.o[x] ? '@'
                                     : channels[chan].mode.v[x] ? '+' : '') + x );
          inform.debug(result);
          inform.debug(channels[chan].mode.o);
          this.socket.write(this.createReply('RPL_NAMREPLY', '@ '+chan +' :'+ result.join(' '))+'\n');
          this.socket.write(this.createReply('RPL_ENDOFNAMES').replace('<channel>', chan)+'\n');
        }
      },
      LIST: (args) => {
        /* RFC 1459
           4.2.6 List message           STATUS incomplete multiple channels, server

           Command: LIST
           Parameters: [<channel>{,<channel>} [<server>]]

           The list message is used to list channels and their topics.  If  the
           <channel>  parameter  is  used,  only  the  status  of  that  channel
           is displayed.  Private  channels  are  listed  (without  their
           topics)  as channel "Prv" unless the client generating the query is
           actually on that channel.  Likewise, secret channels are not listed
           at  all  unless  the client is a member of the channel in question.

           Numeric Replies:

           ERR_NOSUCHSERVER                RPL_LISTSTART
           RPL_LIST                        RPL_LISTEND

           Examples:

           LIST                            ; List all channels.

           LIST #twilight_zone,#42         ; List channels #twilight_zone and #42
        */
        var chanlist = Object.keys(channels)
            .filter(k => !channels[k].mode.p &&
                    !channels[k].mode.s)
        this.socket.write(this.createReply('RPL_LISTSTART')+'\n');

        for( var k in chanlist ) {
          this.socket.write(this.createReply('RPL_LIST')
                            .replace(/<channel>/g, chanlist[k])
                            .replace(/:<topic>/g, channels[chanlist[k]].topic)
                            .replace(/<# visible>/g, channels[chanlist[k]]._readableState.pipes.length)+'\n')
        }

        return this.createReply('RPL_LISTEND');
      },
      INVITE: (args) => {
        /* RFC 1459
           4.2.7 Invite message         STATUS finished (compliance ~)

           Command: INVITE
           Parameters: <nickname> <channel>

           The INVITE message is used to invite users to a channel.  The
           parameter <nickname> is the nickname of the person to be invited to
           the target channel <channel>.  There is no requirement that the
           channel the target user is being invited to must exist or be a valid
           channel.  To invite a user to a channel which is invite only (MODE
           +i), the client sending the invite must be recognised as being a
           channel operator on the given channel.

           Numeric Replies:

           ERR_NEEDMOREPARAMS              ERR_NOSUCHNICK
           ERR_NOTONCHANNEL                ERR_USERONCHANNEL
           ERR_CHANOPRIVSNEEDED
           RPL_INVITING                    RPL_AWAY

           Examples:

           :Angel INVITE Wiz #Dust         ; User Angel inviting WiZ to channel
           #Dust

           INVITE Wiz #Twilight_Zone       ; Command to invite WiZ to
           #Twilight_zone

        */
        if( args.length < 2 )
          return this.createError('ERR_NEEDMOREPARAMS').replace('<command>', 'INVITE');

        var user = this.nick;
        var nick = args[0];
        var chan = args[1];
        var chan_stream = channels[chan];

        //does nick exist?
        if( !users[nick] ){
          return this.createError('ERR_NOSUCHNICK').replace('<nickname>', nick);
        }

        //does channel exist? is current user on target channel?
        if( !chan_stream && this.users.channels[chan] ){
          return this.createError('ERR_NOTONCHANNEL').replace('<channel>', chan);
        }

        //is nick already on channel?
        if( users[nick].channels[chan] ) {
          return this.createError('ERR_USERONCHANNEL')
            .replace('<user>', nick)
            .replace('<channel>', chan);
        }

        //is current user a channel operator?
        if( !chan_stream.mode.o[user] ){
          return this.createError('ERR_CHANOPRIVSNEEDED').replace('<channel>', chan);
        }

        chan_stream.mode.invited[nick] = true;
        users[nick].write(':'+user+' INVITE '+args.join(' '));

        return this.createReply('RPL_INVITING')
          .replace('<nick>', nick)
          .replace('<channel>', chan);
      },
      KICK: (args) => {
        /* RFC 1459
           4.2.8 Kick command           STATUS finished

           Command: KICK
           Parameters: <channel> <user> [<comment>]

           The KICK command can be  used  to  forcibly  remove  a  user  from  a
           channel.   It  'kicks  them  out'  of the channel (forced PART).

           Only a channel operator may kick another user out of a  channel.
           Each  server that  receives  a KICK message checks that it is valid
           (ie the sender is actually a  channel  operator)  before  removing
           the  victim  from  the channel.

           Numeric Replies:

           ERR_NEEDMOREPARAMS              ERR_NOSUCHCHANNEL
           ERR_BADCHANMASK                 ERR_CHANOPRIVSNEEDED
           ERR_NOTONCHANNEL

           Examples:

           KICK &Melbourne Matthew         ; Kick Matthew from &Melbourne

           KICK #Finnish John :Speaking English
           ; Kick John from #Finnish using
           "Speaking English" as the reason
           (comment).

           :WiZ KICK #Finnish John         ; KICK message from WiZ to remove John
           from channel #Finnish

           NOTE:
           It is possible to extend the KICK command parameters to the
           following:

           <channel>{,<channel>} <user>{,<user>} [<comment>]

        */

        //enough params?
        if( args.length < 2 )
          return this.createError('ERR_NEEDMOREPARAMS').replace('<command>', 'KICK');

        var chan = args[0];
        var nick = args[1];
        var chan_stream = channels[chan];

        //does channel exist?
        if( !chan_stream )
          return this.createError('ERR_NOSUCHCHANNEL').replace('<channel name', chan);

        //nick on channel?
        if( !users[nick].channels[chan] ){
          return this.createError('ERR_NOTONCHANNEL').reaplce('<channel>', chan);
        }

        //channel operator?
        if( !chan_stream.mode.o[this.nick] ){
          return this.createError('ERR_CHANOPRIVSNEEDED').replace('<channel>', chan);
        }

        clientUnSubscribe(chan, users[nick]);

        chan_stream.write([':'+this.nick,
                           'KICK',
                           args.join(' ')].join(' ') + '\n');
      },
      VERSION: (args) => {
        /* RFC 1459
           4.3.1 Version message        STATUS finished until SERVER

           Command: VERSION
           Parameters: [<server>]

           The VERSION message is used  to  query  the  version  of  the  server
           program.  An optional parameter <server> is used to query the version
           of the server program which a client is not directly connected to.

           Numeric Replies:

           ERR_NOSUCHSERVER                RPL_VERSION

           Examples:

           :Wiz VERSION *.se               ; message from Wiz to check the version
           of a server matching "*.se"

           VERSION tolsun.oulu.fi          ; check the version of server
           "tolsun.oulu.fi".
        */
        return this.createReply('RPL_VERSION', VERSION_STRING);

      },
      STATS: (args) => {
        /* RFC 1459
           4.3.2 Stats message          STATUS not implemented

           Command: STATS
           Parameters: [<query> [<server>]]

           The stats message is used to query statistics of certain server.  If
           <server> parameter is omitted, only the end of stats reply is sent
           back.  The implementation of this command is highly dependent on the
           server which replies, although the server must be able to supply
           information as described by the queries below (or similar).

           A query may be given by any single letter which is only checked by
           the destination server (if given as the <server> parameter) and is
           otherwise passed on by intermediate servers, ignored and unaltered.
           The following queries are those found in the current IRC
           implementation and provide a large portion of the setup information
           for that server.  Although these may not be supported in the same way
           by other versions, all servers should be able to supply a valid reply
           to a STATS query which is consistent with the reply formats currently
           used and the purpose of the query.

           The currently supported queries are:

           c - returns a list of servers which the server may connect
           to or allow connections from;
           h - returns a list of servers which are either forced to be
           treated as leaves or allowed to act as hubs;
           i - returns a list of hosts which the server allows a client
           to connect from;
           k - returns a list of banned username/hostname combinations
           for that server;
           l - returns a list of the server's connections, showing how
           long each connection has been established and the traffic
           over that connection in bytes and messages for each
           direction;
           m - returns a list of commands supported by the server and
           the usage count for each if the usage count is non zero;
           o - returns a list of hosts from which normal clients may
           become operators;
           y - show Y (Class) lines from server's configuration file;
           u - returns a string showing how long the server has been up.

           Numeric Replies:

           ERR_NOSUCHSERVER
           RPL_STATSCLINE                  RPL_STATSNLINE
           RPL_STATSILINE                  RPL_STATSKLINE
           RPL_STATSQLINE                  RPL_STATSLLINE
           RPL_STATSLINKINFO               RPL_STATSUPTIME
           RPL_STATSCOMMANDS               RPL_STATSOLINE
           RPL_STATSHLINE                  RPL_ENDOFSTATS

           Examples:

           STATS m                         ; check the command usage for the server
           you are connected to

           :Wiz STATS c eff.org            ; request by WiZ for C/N line
           information from server eff.org
        */
        var res = JSON.stringify(proc.memoryUsage());
        return this.createError(400, res);
      },
      LINKS: (args) => {
        /* RFC 1459
           4.3.3 Links message          STATUS not implemented

           Command: LINKS
           Parameters: [[<remote server>] <server mask>]

           With LINKS, a user can list all servers which are known by the server
           answering the query.  The returned list of servers must match the
           mask, or if no mask is given, the full list is returned.

           If <remote server> is given in addition to <server mask>, the LINKS
           command is forwarded to the first server found that matches that name
           (if any), and that server is then required to answer the query.

           Numeric Replies:

           ERR_NOSUCHSERVER
           RPL_LINKS                       RPL_ENDOFLINKS

           Examples:

           LINKS *.au                      ; list all servers which have a name
           that matches *.au;

           :WiZ LINKS *.bu.edu *.edu       ; LINKS message from WiZ to the first
           server matching *.edu for a list of
           servers matching *.bu.edu.
        */
        return this.createError(400, 'LINKS not yet implemented');
      },
      TIME: (args) => {
        /* RFC 1459
           4.3.4 Time message           STATUS finished until SERVER

           Command: TIME
           Parameters: [<server>]

           The time message is used to query local time from the specified
           server. If the server parameter is not given, the server handling the
           command must reply to the query.

           Numeric Replies:

           ERR_NOSUCHSERVER                RPL_TIME

           Examples:

           TIME tolsun.oulu.fi             ; check the time on the server
           "tolson.oulu.fi"

           Angel TIME *.au                 ; user angel checking the time on a
           server matching "*.au"

        */
        return this.createReply('RPL_TIME', new Date().toString());
      },
      CONNECT: (args) => {
        /* RFC 1459
           4.3.5 Connect message        STATUS finished until SERVER (no imp)

           Command: CONNECT
           Parameters: <target server> [<port> [<remote server>]]

           The CONNECT command can be used to force a server to try to establish
           a new connection to another server immediately.  CONNECT is a
           privileged command and is to be available only to IRC Operators.  If
           a remote server is given then the CONNECT attempt is made by that
           server to <target server> and <port>.

           Numeric Replies:

           ERR_NOSUCHSERVER                ERR_NOPRIVILEGES
           ERR_NEEDMOREPARAMS

           Examples:

           CONNECT tolsun.oulu.fi          ; Attempt to connect a server to
           tolsun.oulu.fi

           :WiZ CONNECT eff.org 6667 csd.bu.edu
           ; CONNECT attempt by WiZ to get servers
           eff.org and csd.bu.edu connected on port
           6667.
        */
        return this.createError(400, 'CONNECT not yet implemented');
      },
      TRACE: (args) => {
        /* RFC 1459
           4.3.6 Trace message          STATUS finished until SERVER (no imp)

           Command: TRACE
           Parameters: [<server>]

           TRACE command is used to find the route to specific server.  Each
           server that processes this message must tell the sender about it by
           sending a reply indicating it is a pass-through link, forming a chain
           of replies similar to that gained from using "traceroute".  After
           sending this reply back, it must then send the TRACE message to the
           next server until given server is reached.  If the <server> parameter
           is omitted, it is recommended that TRACE command send a message to
           the sender telling which servers the current server has direct
           connection to.

           If the destination given by "<server>" is an actual server, then the
           destination server is required to report all servers and users which
           are connected to it, although only operators are permitted to see
           users present.  If the destination given by <server> is a nickname,
           they only a reply for that nickname is given.

           Numeric Replies:

           ERR_NOSUCHSERVER

           If the TRACE message is destined for another server, all intermediate
           servers must return a RPL_TRACELINK reply to indicate that the TRACE
           passed through it and where its going next.

           RPL_TRACELINK
           A TRACE reply may be composed of any number of the following numeric
           replies.

           RPL_TRACECONNECTING             RPL_TRACEHANDSHAKE
           RPL_TRACEUNKNOWN                RPL_TRACEOPERATOR
           RPL_TRACEUSER                   RPL_TRACESERVER
           RPL_TRACESERVICE                RPL_TRACENEWTYPE
           RPL_TRACECLASS

           Examples:

           TRACE *.oulu.fi                 ; TRACE to a server matching *.oulu.fi

           :WiZ TRACE AngelDust            ; TRACE issued by WiZ to nick AngelDust
        */
        return this.createError(400, 'TRACE not yet implemented');
      },
      ADMIN: (args) => {
        /* RFC 1459
           4.3.7 Admin command          STATUS more info

           Command: ADMIN
           Parameters: [<server>]

           The admin message is used to find the name of the administrator of
           the given server, or current server if <server> parameter is omitted.
           Each server must have the ability to forward ADMIN messages to other
           servers.

           Numeric Replies:

           ERR_NOSUCHSERVER
           RPL_ADMINME                     RPL_ADMINLOC1
           RPL_ADMINLOC2                   RPL_ADMINEMAIL

           Examples:

           ADMIN tolsun.oulu.fi            ; request an ADMIN reply from
           tolsun.oulu.fi

           :WiZ ADMIN *.edu                ; ADMIN request from WiZ for first
           server found to match *.edu.
        */
        return this.createError(400, 'ADMIN not yet implemented');
      },
      INFO: (args) => {
        /* RFC 1459
           4.3.8 Info command           STATUS more info

           Command: INFO
           Parameters: [<server>]

           The INFO command is required to return information which describes
           the server: its version, when it was compiled, the patchlevel, when
           it was started, and any other miscellaneous information which may be
           considered to be relevant.

           Numeric Replies:

           ERR_NOSUCHSERVER
           RPL_INFO                        RPL_ENDOFINFO

           Examples:

           INFO csd.bu.edu                 ; request an INFO reply from
           csd.bu.edu

           :Avalon INFO *.fi               ; INFO request from Avalon for first
           server found to match *.fi.
           INFO Angel                      ; request info from the server that
           Angel is connected to.
        */
        return this.createError(400, 'INFO not yet implemented');
      },
      PRIVMSG: (args) => {
        /* RFC 1459
           4.4 Sending messages

           The main purpose of the IRC protocol is to provide a base for clients
           to communicate with each other.  PRIVMSG and NOTICE are the only
           messages available which actually perform delivery of a text message
           from one client to another - the rest just make it possible and try
           to ensure it happens in a reliable and structured manner.
        */
        /* RFC 1459
           4.4.1 Private messages       STATUS finished

           Command: PRIVMSG
           Parameters: <receiver>{,<receiver>} <text to be sent>

           PRIVMSG is used to send private messages between users.  <receiver>
           is the nickname of the receiver of the message.  <receiver> can also
           be a list of names or channels separated with commas.

           The <receiver> parameter may also me a host mask  (#mask)  or  server
           mask  ($mask).   In  both cases the server will only send the PRIVMSG
           to those who have a server or host matching the mask.  The mask  must
           have at  least  1  (one)  "."  in it and no wildcards following the
           last ".".  This requirement exists to prevent people sending messages
           to  "#*"  or "$*",  which  would  broadcast  to  all  users; from
           experience, this is abused more than used responsibly and properly.
           Wildcards are  the  '*' and  '?'   characters.   This  extension  to
           the PRIVMSG command is only available to Operators.

           Numeric Replies:

           ERR_NORECIPIENT                 ERR_NOTEXTTOSEND
           ERR_CANNOTSENDTOCHAN            ERR_NOTOPLEVEL
           ERR_WILDTOPLEVEL                ERR_TOOMANYTARGETS
           ERR_NOSUCHNICK
           RPL_AWAY

           Examples:

           :Angel PRIVMSG Wiz :Hello are you receiving this message ?
           ; Message from Angel to Wiz.

           PRIVMSG Angel :yes I'm receiving it !receiving it !'u>(768u+1n) .br ;
           Message to Angel.

           PRIVMSG jto@tolsun.oulu.fi :Hello !
           ; Message to a client on server
           tolsun.oulu.fi with username of "jto".

           PRIVMSG $*.fi :Server tolsun.oulu.fi rebooting.
           ; Message to everyone on a server which
           has a name matching *.fi.

           PRIVMSG #*.edu :NSFNet is undergoing work, expect interruptions
           ; Message to all users who come from a
           host which has a name matching *.edu.
        */
        if( !this.user )
          return this.createError(400, 'please register!');

        return this.sendMessage(args, false);
      },
      NOTICE: (args) => {

        /* RFC 1459
           4.4.2 Notice                 STATUS finished

           Command: NOTICE
           Parameters: <nickname> <text>

           The NOTICE message is used similarly to PRIVMSG.  The difference
           between NOTICE and PRIVMSG is that automatic replies must never be
           sent in response to a NOTICE message.  This rule applies to servers
           too - they must not send any error reply back to the client on
           receipt of a notice.  The object of this rule is to avoid loops
           between a client automatically sending something in response to
           something it received.  This is typically used by automatons (clients
           with either an AI or other interactive program controlling their
           actions) which are always seen to be replying lest they end up in a
           loop with another automaton.

           See PRIVMSG for more details on replies and examples.


        */
        if( !this.user )
          return this.createError(400, 'please register!');

        return this.sendMessage(args, true);
      },
      WHO: (args) => {
        /* RFC 1459 
           4.5.1 Who query              STATUS dummy implementation

           Command: WHO
           Parameters: [<name> [<o>]]

           The WHO message is used by a client to generate a query which returns
           a list of information which 'matches' the <name> parameter given by
           the client.  In the absence of the <name> parameter, all visible
           (users who aren't invisible (user mode +i) and who don't have a
           common channel with the requesting client) are listed.  The same
           result can be achieved by using a <name> of "0" or any wildcard which
           will end up matching every entry possible.

           The <name> passed to WHO is matched against users' host, server, real
           name and nickname if the channel <name> cannot be found.

           If the "o" parameter is passed only operators are returned according
           to the name mask supplied.

           Numeric Replies:

           ERR_NOSUCHSERVER
           RPL_WHOREPLY                    RPL_ENDOFWHO

           Examples:

           WHO *.fi                        ; List all users who match against
           "*.fi".

           WHO jto* o                      ; List all users with a match against
           "jto*" if they are an operator.

        */

        //ignoring args...
        for( var i in users ) {
          var cuser = users[i];
          var u = cuser.username,
              h = cuser.cp.hostname,
              s = server_string,
              n = cuser.cp.nick,
              hc = '*',
              r = cuser.cp.real_name;

          for( var c in cuser.channels ){
            var ch = c;
            this.socket.write(this.createReply('RPL_WHOREPLY')
                              .replace('<channel>', ch)
                              .replace('<user>', u)
                              .replace('<host>', h)
                              .replace('<server>', s)
                              .replace('<nick>', n)
                              .replace('<H|G>[*][@|+]', 'G')
                              .replace('<hopcount>', '*')
                              .replace('<real name>', r)+'\n');
          }
        }
        return this.createReply('RPL_ENDOFWHO').replace('<name>', '*');
      },
      WHOIS: (args) => {
        /* RFC 1459
           4.5.2 Whois query            STATUS no implementation

           Command: WHOIS
           Parameters: [<server>] <nickmask>[,<nickmask>[,...]]

           This message is used to query information about particular user.  The
           server will answer this message with several numeric messages
           indicating different statuses of each user which matches the nickmask
           (if you are entitled to see them).  If no wildcard is present in the
           <nickmask>, any information about that nick which you are allowed to
           see is presented.  A comma (',') separated list of nicknames may be
           given.

           The latter version sends the query to a specific server.  It is
           useful if you want to know how long the user in question has been
           idle as only local server (ie. the server the user is directly
           connected to) knows that information, while everything else is
           globally known.

           Numeric Replies:

           ERR_NOSUCHSERVER                ERR_NONICKNAMEGIVEN
           RPL_WHOISUSER                   RPL_WHOISCHANNELS
           RPL_WHOISCHANNELS               RPL_WHOISSERVER
           RPL_AWAY                        RPL_WHOISOPERATOR
           RPL_WHOISIDLE                   ERR_NOSUCHNICK
           RPL_ENDOFWHOIS

           Examples:

           WHOIS wiz                       ; return available user information
           about nick WiZ

           WHOIS eff.org trillian          ; ask server eff.org for user
           information about trillian
        */
        return this.createError(400, 'WHOIS not yet implemented');
      },
      WHOWAS: (args) => {
        /* RFC 1459
           4.5.3 Whowas                 STATUS not yet implemented

           Command: WHOWAS
           Parameters: <nickname> [<count> [<server>]]

           Whowas asks for information about a nickname which no longer exists.
           This may either be due to a nickname change or the user leaving IRC.
           In response to this query, the server searches through its nickname
           history, looking for any nicks which are lexically the same (no wild
           card matching here).  The history is searched backward, returning the
           most recent entry first.  If there are multiple entries, up to
           <count> replies will be returned (or all of them if no <count>
           parameter is given).  If a non-positive number is passed as being
           <count>, then a full search is done.

           Numeric Replies:

           ERR_NONICKNAMEGIVEN             ERR_WASNOSUCHNICK
           RPL_WHOWASUSER                  RPL_WHOISSERVER
           RPL_ENDOFWHOWAS

           Examples:

           WHOWAS Wiz                      ; return all information in the nick
           history about nick "WiZ";

           WHOWAS Mermaid 9                ; return at most, the 9 most recent
           entries in the nick history for
           "Mermaid";

           WHOWAS Trillian 1 *.edu         ; return the most recent history for
           "Trillian" from the first server found
           to match "*.edu".
        */

        return this.createError(400, 'WHOWAS not yet implemented');
      },
      KILL: (args) => {
        /* RFC 1459
           4.6.1 Kill message           STATUS not implemented

           Command: KILL
           Parameters: <nickname> <comment>

           The KILL message is used to cause a client-server connection to be
           closed by the server which has the actual connection.  KILL is used
           by servers when they encounter a duplicate entry in the list of valid
           nicknames and is used to remove both entries.  It is also available
           to operators.

           Clients which have automatic reconnect algorithms effectively make
           this command useless since the disconnection is only brief.  It does
           however break the flow of data and can be used to stop large amounts
           of being abused, any user may elect to receive KILL messages
           generated for others to keep an 'eye' on would be trouble spots.

           In an arena where nicknames are required to be globally unique at all
           times, KILL messages are sent whenever 'duplicates' are detected
           (that is an attempt to register two users with the same nickname) in
           the hope that both of them will disappear and only 1 reappear.

           The comment given must reflect the actual reason for the KILL.  For
           server-generated KILLs it usually is made up of details concerning
           the origins of the two conflicting nicknames.  For users it is left
           up to them to provide an adequate reason to satisfy others who see
           it.  To prevent/discourage fake KILLs from being generated to hide
           the identify of the KILLer, the comment also shows a 'kill-path'
           which is updated by each server it passes through, each prepending
           its name to the path.

           Numeric Replies:

           ERR_NOPRIVILEGES                ERR_NEEDMOREPARAMS
           ERR_NOSUCHNICK                  ERR_CANTKILLSERVER


           KILL David (csd.bu.edu <- tolsun.oulu.fi)
           ; Nickname collision between csd.bu.edu
           and tolson.oulu.fi


           NOTE:
           It is recommended that only Operators be allowed to kill other users
           with KILL message.  In an ideal world not even operators would need
           to do this and it would be left to servers to deal with.
        */
        return this.createError(400, 'KILL not yet implemented');
      },
      PING: (args) => {
        /* RFC 1459
           4.6.2 Ping message           STATUS dummy implementation

           Command: PING
           Parameters: <server1> [<server2>]

           The PING message is used to test the presence of an active client at
           the other end of the connection.  A PING message is sent at regular
           intervals if no other activity detected coming from a connection.  If
           a connection fails to respond to a PING command within a set amount
           of time, that connection is closed.

           Any client which receives a PING message must respond to <server1>
           (server which sent the PING message out) as quickly as possible with
           an appropriate PONG message to indicate it is still there and alive.
           Servers should not respond to PING commands but rely on PINGs from
           the other end of the connection to indicate the connection is alive.
           If the <server2> parameter is specified, the PING message gets
           forwarded there.

           Numeric Replies:

           ERR_NOORIGIN                    ERR_NOSUCHSERVER

           Examples:

           PING tolsun.oulu.fi             ; server sending a PING message to
           another server to indicate it is still
           alive.

           PING WiZ                        ; PING message being sent to nick WiZ
        */
        inform.debug('PING', args);
        var dest = args[1];

        if( users[dest] ){
          users[dest].write(':'+this.id + ' PING ' + dest);
        }

        return ':'+server_string+' PONG';
      },
      PONG: (args) => {
        /* RFC 1459
           4.6.3 Pong message           STATUS dummy implementation

           Command: PONG
           Parameters: <daemon> [<daemon2>]

           PONG message is a reply to ping message.  If parameter <daemon2> is
           given this message must be forwarded to given daemon.  The <daemon>
           parameter is the name of the daemon who has responded to PING message
           and generated this message.

           Numeric Replies:

           ERR_NOORIGIN                    ERR_NOSUCHSERVER

           Examples:

           PONG csd.bu.edu tolsun.oulu.fi  ; PONG message from csd.bu.edu to
           tolsun.oulu.fi
        */
        inform.debug('PONG', args);
        return 'NOTICE AUTH :PONG? PING!';
      },
      ERROR: (args) => {
        /* RFC 1459
           4.6.4 Error                  STATUS not implemented

           Command: ERROR
           Parameters: <error message>

           The ERROR command is for use by servers when reporting a serious or
           fatal error to its operators.  It may also be sent from one server to
           another but must not be accepted from any normal unknown clients.

           An ERROR message is for use for reporting errors which occur with a
           server-to-server link only.  An ERROR message is sent to the server
           at the other end (which sends it to all of its connected operators)
           and to all operators currently connected.  It is not to be passed
           onto any other servers by a server if it is received from a server.

           When a server sends a received ERROR message to its operators, the
           message should be encapsulated inside a NOTICE message, indicating
           that the client was not responsible for the error.

           Numerics:

           None.

           Examples:

           ERROR :Server *.fi already exists; ERROR message to the other server
           which caused this error.

           NOTICE WiZ :ERROR from csd.bu.edu -- Server *.fi already exists
           ; Same ERROR message as above but sent
           to user WiZ on the other server.
        */
        return this.createError(400, 'ERROR not yet implemented');
      }
    }

  }

  registered() {
    return this.id !== null;
  }

  welcomeMessage() {
    //RFC2812
    var welcome = this.createReply('RPL_WELCOME').replace('<nick>!<user>@<host>', this.id);
    var yourhost = this.createReply('RPL_YOURHOST').replace('<servername>', server_string)
        .replace('<ver>', VERSION_STRING);
    var created = this.createReply('RPL_CREATED').replace('<date>', CREATION_TIME);
    var myinfo = this.createReply('RPL_MYINFO').replace('<servername>', server_string)
        .replace('<version>', VERSION_STRING)
        .replace('<available user modes>', AVAIL_USER_MODES)
        .replace('<available channel modes>', AVAIL_CHAN_MODES);
    return [ welcome, yourhost, created, myinfo ].join('\n');
  }

  sendMessage(args, notice){
    var type = notice ? 'NOTICE' : 'PRIVMSG';
    var chan = args.shift();
    inform.debug(type, chan, args);

    var destination = fetchChannel(chan);
    if( destination ){
      if( destination.mode.n && !this.user.channels[chan] )
        return this.createError('ERR_CANNOTSENDTOCHAN').replace('<channel name>', chan);

      if( destination.mode.m === true &&
          !(destination.mode.v[this.nick] ||
            destination.mode.o[this.nick]) ){
        return this.createError('ERR_CANNOTSENDTOCHAN').replace('<channel name>', chan);
      }
      //destination set to privmsg channel
    } else {
      destination = users[chan];
      if( !destination )
        return this.createError('ERR_NOSUCHNICK').replace('<nickname>', chan);
      //destination set to privmsg user
    }

    //prepare message
    var msg = [];
    msg.push(':'+this.id);
    msg.push(type);
    msg.push(chan);
    msg.push(args.join(' ')+'\n');
    //write message
    destination.write(msg.join(' '));
  }

  createError(err_name, message, bypass) {
    var err_code = lookup[err_name] || 400;
    var err_message = message ||
        ( err_codes[err_code] ?
          err_codes[err_code].message :
          'Error unknown');

    var err_uname = '*';
    if( this.registered() )
      err_uname = this.nick;
    else if( !bypass )
      return ':'+server_string+' 400 * :Please Register'

    return [ ':'+server_string,
             err_code,
             err_uname,
             err_message ].join(' ');
  }

  createReply(rpl_name, message) {
    var rpl_code = lookup[rpl_name] || 300;
    var rpl_message = message ||
        ( rpl_codes[rpl_code] ?
          rpl_codes[rpl_code].message :
          '');

    var rpl_uname = '*';

    if( this.registered() )
      rpl_uname = this.nick;
    else
      return ':'+server_string+' 400 * :Please Register'

    return [ ':'+server_string,
             rpl_code,
             rpl_uname,
             rpl_message ].join(' ');
  }

  parse_command(tokens) {
    inform.debug(tokens);
    var command_list = this.command_list;
    
    var command = tokens.shift().toUpperCase();
    var result = null;
    inform.debug(command);
    if( command_list[command]) {
      if( this.registered() ||
          command === 'NICK' ||
          command === 'USER' ||
          command === 'PASS' ) {
        result = command_list[command](tokens)
      } else {
        result = this.createError(400);
      }
    } else {
      result = this.createError('ERR_UNKNOWNCOMMAND', command+' :Unknown command');
    }

    return result;
  }

  _write(data, encoding, callback) {
    var line = data.toString().trim();
    var res = this.parse_command(line.split(' '));

    if( res ) { 
      this.socket.write(res + '\n');
    }
    
    callback();
  }
  
}

var slc = 0;
class StreamLines extends Transform {
  /**
     Ensures data recieved at next stream is broken by newline
   */
  constructor(opts, linebreak) {
    super(opts)
    this.linebreak = linebreak || '\n';
    this.buffer = '';
    this.id = slc++;
  }

  _transform(data, encoding, callback) {
    var input = this.buffer + data.toString('utf8');
    var lines = input.split('\n');
    this.buffer = lines.pop();
    while( lines.length > 0 ) {
      var line = lines.shift();
      this.push(line);
    }

    callback();
  }

  _flush(callback) {
    this.push(this.buffer+'\n');
    callback()
  }
}


var server = net.createServer((socket) => {
  var remoteAddr = socket.remoteAddress;
  var remotePort = socket.remotePort;

  var localAddr = socket.localAddress;
  var localPort = socket.localPort;

  inform.log(['New connection from', remoteAddr,
              'on port', localPort].join(' '));

  var line_filter = new StreamLines({}, '\n');
  var cp = new CommandParser(socket);
  cp.on('drain', () => {
    inform.debug('CommandParser', remoteAddr, 'drained');
  });
  cp.on('finish', () => {
    inform.debug('CommandParser', remoteAddr, 'finished');
  });
  cp.on('pipe', (src) => {
    inform.debug('CommandParser', remoteAddr, 'pipe', typeof src);
  });
  cp.on('unpipe', () => {
    inform.debug('CommandParser', remoteAddr, 'unpipe');
    socket.end();
  });
  cp.on('error', (err) => {
    inform.error('CommandParser', remoteAddr, 'error', err);
  });
  cp.on('close', () => {
    inform.debug('CommandParser', remoteAddr, 'closed');
    socket.end();
  });
  cp.on('end', () => {
    inform.debug('CommandParser', remoteAddr, 'ended');
    socket.end();
  });
  socket.pipe(line_filter).pipe(cp);

  socket.on('drain', () => {
    inform.debug('Socket', remoteAddr, 'drain');
  });

  socket.on('error', (err) => {
    inform.error('Socket', remoteAddr, 'error', err);
  });
  socket.on('close', () => {
    inform.debug('Connection to', remoteAddr, 'closed');
    cp.command_list.QUIT(['connection reset by peer']);
  });
  socket.on('end', () => {
    inform.debug('Socket', remoteAddr, 'end');
  });

  socket.on('timeout', () => {
    inform.debug('Socket', remoteAddr, 'timeout');
  });
  socket.on('connect', () => {
    inform.debug('Socket', remoteAddr, 'connect');
  });

  socket.on('pipe', (src) => {
    //src assumed to be a userpassthrough object
    inform.debug('Socket', remoteAddr, 'pipe', src.username);
  });
  socket.on('unpipe', () => {
    inform.debug('Socket', remoteAddr, 'unpipe');
  });
});

server.listen(PORT);
inform.log('Listening on '+PORT);

inform.log(proc.memoryUsage().rss/1000000+'M');
setInterval( () => {
  var mem_string = proc.memoryUsage().rss/1000000+'M';
  inform.log(Object.keys(users).length + ' ' + mem_string);
}, 30000);
