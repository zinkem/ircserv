
const { Transform } = require('stream');

const { User } = require('./user.js');

class ProtocolShell extends Transform {
  constructor(parser, opts) {
    super(opts);
    this.parser = parser;
    this.client = new User();

    this.on('end', () => {
      this.client.end();
    });

    this.on('finish', () => {
      this.client.end();
    });
  }

  _transform(data, encoding, callback) {
    const line = data.toString().trim();
    const res = this.parser.parse_command(this, line.split(' '));
    if (res) callback(null, `${res}\n`);
    else callback();
  }
}

module.exports.ProtocolShell = ProtocolShell;
