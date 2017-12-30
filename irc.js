'use strict';

const { Writable,
        PassThrough } = require('stream');
const net = require('net');
const proc = require('process');

var users = {};
var channels = {};

function clientSubscribe(channel, client_socket) {
  channel = channel.toLowerCase();
  if( !channels[channel] ) {
    channels[channel] = new PassThrough();
    channels[channel].pipe(proc.stdout);
    channels[channel].name = channel;
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

//call this on incoming sockets to add listeners for cleanup
function prepareSocket(client_socket) {

  //send channel part message
  client_socket.on('unpipe', (src) => {

    if( src.name ){
      var channel = src.name;
      setTimeout(() => {
        var id = client_socket.username;
        if( id )
          channels[channel].write(':'+id + ' PART :' + channel + '\n');
      }, 0);
      console.log('channel unpipe', channel);
    } else if( src.username ) {
      var user = src.username;
      console.log('user unpipe', user);
    }
  });
  
  //send channel join message
  client_socket.on('pipe', (src) => {
    if( !src.name ) return;
    var channel = src.name;
    var id = client_socket.username || client_socket.remoteAddress;
    console.log('channel pipe', channel);
  });

  //
  client_socket.on('close', () => {
    consle.log('cilent sjjss');
    if( client_socket.username ){
      console.log(client_socket.username, 'exit');
    }
  });
}


class CommandParser extends Writable {
  constructor(sock, opts) {
    super(opts)
    this.socket = sock;
    this.user = null;
    
    this.command_list = {
      PASS: (args) => {
        /*
          RFC 1459

          4.1.1 Password message        STATUS no implementation


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
        return 'PASS not yet implemented';
      },
      NICK: (args) => {
        /*
          RFC 1459
          4.1.2 Nick message            STATUS incomplete

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

        if( args.length < 1 )
          return 'ERR_NONICKNAMEGIVEN';

        var new_name = args[0];

        if( users[new_name] ) {
          return 'ERR_NICKNAMEINUSE';
        }

        var old_name = new_name;
        if( this.user ){
          old_name = this.user.username;
          this.user.username = new_name;
          users[new_name] = this.user;
          delete users[old_name];
        }

        return [':'+old_name,'NICK',new_name].join(' ');
      },
      USER: (args) => {
        /* RFC 1459 
           4.1.3 User message           STATUS incomplete

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
        if( args.length < 4 )
          return 'ERR_NEEDMOREPARAMS'
        
        var username = args.shift();
        var mode = args.shift();
        var unused = args.shift();
        var real_name = args.join(' ').slice(1).trim();

        //does username exist?
        if( this.user || users[username] ){
          return 'ERR_ALREADYREGISTERED'
        }

        this.user = new PassThrough();
        this.user.username = username;
        users[username] = this.user

        prepareSocket(this.user);
        clientSubscribe('#public', this.user);

        this.user.pipe(this.socket);
        
        this.socket.on('close', () => {
          if( users[username] ) {
            users[username].end();
            delete users[username];
          }
        });

        var str_001 = [ ':localhost 001',
                        username,
                        ':Welcome to localhost irc server!'].join(' ');
        var str_002 = [ ':localhost 002',
                        username,
                        ':Your host is localhost' ].join(' ');
        var str_003 = [ ':localhost 003',
                        username,
                        ':This server was created a while back'].join(' ');

        return [str_001, str_002, str_003].join('\n');
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
        return 'SEVRER not yet implemented';
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
        return 'OPER not yet implemented';
      },
      QUIT: (args) => {
        /* RFC 1459
           4.1.6 Quit                   STATUS incomplete

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
        var username = 'unregistered'
        if( this.user )
          username = this.user.username;

        console.log(username, 'QUIT', args.join(' '));
        this.socket.end();
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
        return 'SQUIT not yet implemented';
      },
      JOIN: (args) => {
        /* RFC 1459
           4.2.1 Join message           STATUS incomplete error handling

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

        var chan = args[0];
        var user = this.user;
        if( !user ) return 'please register!';
        clientSubscribe(chan, user);

        var user_host = '~'+user.username+'@'+this.socket.remoteAddress;

        channels[chan].write(':'+user.username+'!'+user_host+' JOIN :'+chan+'\n');
        return [ this.command_list.TOPIC([ chan ]), this.command_list.NAMES([ chan ]) ].join('\n');
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
        var chan = args.shift();
        var user = this.user;
        clientUnSubscribe(chan, user);
        channels[chan].write(':'+user.username + ' PART ' + chan +
                             ' :' + args.join(' ') + '\n');
      },
      MODE: (args) => {
        /*
          4.2.3 Mode message            STATUS incomplete PRIORITY

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
        return ':localhost 324 '+this.user.username+' '+args[0]+' +t';
      },
      TOPIC: (args) => {
        /*RFC 1459 
          4.2.4 Topic message           STATUS incomplete

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
        var chan = args[0];
        var username = this.user.username;
        var RPL_TOPIC_string = [':localhost 332',username,chan,':Generic Topic'].join(' ');
        return RPL_TOPIC_string;
      },
      NAMES: (args) => {
        /* rfc 1459
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

        var chan = args[0];
        var user = this.user;
        var result = [];
        var users = channels[chan]._readableState.pipes;

        for( var k in users )
          if( users[k].username )
            result.push(users[k].username)

        var RPL_NAMREPLY_string = [':localhost 353',
                                   user.username,
                                   '=',
                                   chan,
                                   ':'+result.join(' ')].join(' ');
        var RPL_ENDOFNAMES_string = [':localhost 366',
                                     user.username,
                                     chan,
                                     ':End of /NAMES list'].join(' ');
        return [ RPL_NAMREPLY_string, RPL_ENDOFNAMES_string ].join('\n');

      },
      LIST: (args) => {
        /*
          4.2.6 List message            STATUS incomplete multiple channels, server

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
        var chanlist = Object.keys(channels).join('\n');
        return chanlist;
      },
      INVITE: (args) => {
        /* rfc 1459
           4.2.7 Invite message         STATUS not implemented

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
        return 'INVITE not yet implemented'
      },
      KICK: (args) => {
        /*

          rfc 1459
          4.2.8 Kick command            STATUS not implemented

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
        
        return 'KICK not yet implemented'
      },
      VERSION: (args) => {
        /* RFC 1459
           4.3.1 Version message        STATUS dummy implementation

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
        return 'RPL_VERSION node.js irc version 0.0.1 alpha';
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
        return 'STATS not yet implemented';
      },
      LINKS: (args) => {
        /*
          4.3.3 Links message           STATUS not implemented

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
        return 'LINKS not yet implemented';
      },
      TIME: (args) => {

        /*
          4.3.4 Time message            STATUS dummy implementation

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
        return new Date().toString();
      },
      CONNECT: (args) => {
        /* RFC 1459
           4.3.5 Connect message        STATUS not implemented

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
        return 'CONNECT not yet implemented'
      },
      TRACE: (args) => {

        /*
          4.3.6 Trace message           STATUS not implemented

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
        return 'TRACE not yet implemented'
      },
      ADMIN: (args) => {
        /*
          4.3.7 Admin command           STATUS not implemented

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
        return 'ADMIN not yet implemented'
      },
      INFO: (args) => {
        /* RFC 1459
           4.3.8 Info command           STATUS not implemented

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
        return 'INFO not yet implemented';
      },
      PRIVMSG: (args) => {
        /*
          4.4 Sending messages

          The main purpose of the IRC protocol is to provide a base for clients
          to communicate with each other.  PRIVMSG and NOTICE are the only
          messages available which actually perform delivery of a text message
          from one client to another - the rest just make it possible and try
          to ensure it happens in a reliable and structured manner.
        */
        /*
          4.4.1 Private messages        STATUS incomplete error handling

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
        var chan = args.shift();

        if( !this.user )
          return 'please register!';

        var destination = fetchChannel(chan);

        if( !destination ) destination = users[chan];
        
        if( destination ){
          var msg = [];
          msg.push(':'+this.user.username);
          msg.push('PRIVMSG');
          msg.push(chan);
          msg.push(':'+args.join(' ')+'\n');
          destination.write(msg.join(' '));
        } else {
          console.log(chan, args);
          return 'no such user or channel';
        }
      },
      NOTICE: (args) => {

        /*
          4.4.2 Notice                  STATUS incomplete error handling

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
        var chan = args.shift();

        if( !this.user )
          return 'please register!';

        var destination = fetchChannel(chan);

        if( !destination ) destination = users[chan];

        if( destination ){
          var msg = [];
          msg.push(':'+this.user.username);
          msg.push('NOTICE');
          msg.push(chan);
          msg.push(':'+args.join(' ')+'\n');
          destination.write(msg.join(' '));
        } else {
          console.log(chan, args);
          return 'no such user or channel';
        }
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
        var userlist = Object.keys(users).join(' ');
        return userlist;
      },
      WHOIS: (args) => {
        /*
          4.5.2 Whois query             STATUS no implementation

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
        return 'WHOIS not yet implemented'
      },
      WHOWAS: (args) => {
        /*
          4.5.3 Whowas                  STATUS not yet implemented

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

        return 'WHOWAS not yet implemented'
      },
      KILL: (args) => {
        /*

          4.6.1 Kill message            STATUS not implemented

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
        return 'KILL not yet implemented';
      },
      PING: (args) => {
        /*

          4.6.2 Ping message            STATUS dummy implementation

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
        console.log('PING', args);
        var dest = args[1];

        if( users[dest] ){
          users[dest].write(':'+this.user.username + ' PING ' + dest);
        }

        return ':localhost PONG';
      },
      PONG: (args) => {
        /*
          4.6.3 Pong message            STATUS dummy implementation

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
        console.log('PONG', args);
        return ':localhost NOTICE * PONG? PING!';
      },
      ERROR: (args) => {
        /*
          4.6.4 Error                   STATUS not implemented

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
        return 'ERROR not yet implemented';
      }
    }

  }

  parse_command(tokens) {
    //console.log(tokens);
    var result = null;
    var command_list = this.command_list;
    
    var command = tokens.shift().toUpperCase();

    if( command_list[command] )  {
      result = command_list[command](tokens)
    } else {
      result = 'list of commands: ' + Object.keys(command_list).join(', ');
      //console.log('bad command', command, tokens, Object.keys(command_list));
    }

    return result;
  }

  _write(data, encoding, callback) {
    var line = data.toString().trim();
    var res = this.parse_command(line.split(' '));
    var client_id = this.socket.remoteAddress + ' ' + this.socket.remotePort;
    if( this.user )
      client_id = this.user.username 

    if( res ) { 
      console.log(client_id, res);
      this.socket.write(res + '\n');
    }
    
    callback();
  }
  
}

var server = net.createServer((socket) => {
  var remoteAddr = socket.remoteAddress;
  var remotePort = socket.remotePort;

  var localAddr = socket.localAddress;
  var localPort = socket.localPort;

  console.log('new connection from', remoteAddr,
              'on port', localPort);

  var cp = new CommandParser(socket);
  cp.on('close', () => {
    console.log('CommandParser for', remoteAddr, 'closed');
  });
  cp.on('drain', () => {
    console.log('CommandParser for', remoteAddr, 'drained');
  });
  cp.on('finish', () => {
    console.log('CommandParser for', remoteAddr, 'drained');
  });
  cp.on('error', () => {
    console.log('CommandParser for', remoteAddr, 'drained');
  });
  cp.on('pipe', (src) => {
    console.log('CommandParser for', remoteAddr, 'pipe');
  });
  cp.on('unpipe', () => {
    console.log('CommandParser for', remoteAddr, 'unpipe');
  });
  
  socket.pipe(cp);

  socket.on('close', () => {
    console.log('Connection to', remoteAddr, 'closed');
    cp.end();
  });

  socket.on('error', (err) => {
    if( err.code === 'ECONNRESET' ){
      console.log(remoteAddr, 'client disconnected');
    } else {
      console.log('closed with error', err);
    }
  });

  //console.log(socket);
})

server.listen(7000);
