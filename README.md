# ircserv (alpha)

A Node.js IRC Server

# Introduction

The ircserv project is a module to allow an IRC server to be embedded within a Node.js application. It currently supports all commands and functionality listed in RFC1459, aside from SERVER-SERVER connection functionality.

*This implementation is in an alpha state.* It still has a few quirks, but is almost entirely faithful to the client side interface described in RFC1459. 

# Usage

```javascript
const ircserv = require('ircserv');

const server_config = {
  "logs": "./logs",
  "version": "ircserv.0.8.0-alpha",
  "servername": "your-server-name.example.com",
  "debug": false,
  "operators": {
    "admin":"password"
  },
  "admin_info": {
    "info1" : "Hello! Welcome to our server!",
    "info2" : "http://example.com",
    "email" : "admin@example.com"
  }
}

const ircd = new ircserv.Server(server_config);
ircd.listen(6667);

```

The server takes a server configuration object as input, which will contain the location of your log directory, the OPER username and password, admin info lines, a custom version string and the name of your server.

The listen command will start the server listener. By default, it will listen on port 6667, but you can pass in a custom port number to listen on any avaiable port.

# Running Tests

Tests can be run with

`npm test`

# Implemented

* ✓ ADMIN
* ✓ VERSION
* ✓ INFO
* ✓ NICK
* ✓ WHO
* ✓ LIST
* ✓ JOIN
* ✓ PART
* ✓ PRIVMSG
* ✓ NOTICE
* ✓ MODE
* ✓ MODE <nick>
 * ✓ +i (invisible)
 * ✓ +s (server notices)
 * ✓ +w (wallops)
 * ✓ -o (remove server op)
* ✓ MODE <channel>
 * ✓ +i (invite)
 * ✓ +o (ops)
 * ✓ +s (secret)
 * ✓ +p (private)
 * ✓ +t (set topic)
 * ✓ +l (user limit)
 * ✓ +m (moderate)
 * ✓ +v (give voice)
 * ✓ +k (channel key)
* ✓ KICK with privs
* ✓ TOPIC
* ✓ WHOIS
* ✓ OPER
* ✓ KILL
* ✓ PING
* ✓ PONG
* ✓ QUIT

# Not Implemented

- WHOWAS
- SERVER
- SQUIT
- STATS
- LINKS
- ERROR

# References

- https://tools.ietf.org/html/rfc1459
- https://tools.ietf.org/html/rfc2810
- https://tools.ietf.org/html/rfc2811
- https://tools.ietf.org/html/rfc2812
- https://tools.ietf.org/html/rfc2813
- https://tools.ietf.org/html/rfc7194
- https://www.rfc-editor.org/errata/rfc2812