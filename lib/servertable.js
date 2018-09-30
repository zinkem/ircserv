
class ServerTable {
  constructor() {
    this.remotes = {};
  }

  registerNewServer(servername, hopcount, info) {
    return [this, servername, hopcount, info];
  }
}

module.exports.ServerTable = ServerTable;
