const proc = require('process');

const ircserv = require('../');

const server_config = require('../config/default_server_config.json');

process.on('uncaughtException', (err) => {
  console.error(err);
  process.exit(1);
});

console.log(server_config);

const ircd = new ircserv.Server(server_config);
ircd.listen();

setInterval(() => {
  const mem_string = `${proc.memoryUsage().rss / 1000000}M`;
  console.log(`${Object.keys(ircd.users).length} ${mem_string}`);
}, 30000);
