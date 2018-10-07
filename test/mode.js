
const { serverConfigOpts,
        IRCAgent,
        waitFor,
        startServer,
        tryAssert
      } = require('./util/testutil.js');

const { Server } = require('..');

describe('Mode Tests', function() {
  let ircserver = null;
  let connectionListener = null;
  let agent = null;

  beforeEach((done) => {
    ircserver = new Server(serverConfigOpts);
    connectionListener = ircserver.createConnectionListener();
    agent = new IRCAgent('agent');
    agent.setEncoding('utf8');
    agent.connect(connectionListener, done);
  });

  afterEach(() => {
    ircserver = null;
    connectionListener = null;
    agent = null;
  });

  describe('User Mode Tests', function() {
    it('MODE bad flags', function(done) {
      const badmodes = 'abcdefghjklmnpqrtuvxyz'.split('');
      agent.on('response', waitFor('501', () => {
        setImmediate(() => {
          if (badmodes.length <= 0)
            done();
          else
            agent.send(`mode agent +${badmodes.pop()}`);
        });
      }));
      agent.send(`mode agent +${badmodes.pop()}`);
    });

    it('MODE get user mode', function(done) {
      agent.on('response', waitFor('221', done));
      agent.send('mode agent +iow')
      agent.send('mode agent');
    });

    it('MODE set another user mode fails', function(done) {
      agent.on('response', waitFor('502', done));
      agent.send('mode basic +iow')
    });

    it('MODE user +i (invisible)', function(done) {
      agent.on('response', waitFor('agent :+i', done));
      agent.send('mode agent +i');
    });

    it('MODE user -i (invisible)', function(done) {
      agent.on('response', waitFor(':-i', done));
      agent.send('mode agent -i');
    });

    it('MODE user +s (server notices)', function(done) {
      agent.on('response', waitFor('agent :+s', done));
      agent.send('mode agent +s');
    });

    it('MODE user -s (server notices)', function(done) {
      agent.on('response', waitFor('-s', done));
      agent.send('mode agent -s');
    });

    it('MODE user +w (wallops)', function(done) {
      agent.on('response', waitFor('agent :+w', done));
      agent.send('mode agent +w');
    });

    it('MODE user -w (wallops)', function(done) {
      agent.on('response', waitFor('-w', done));
      agent.send('mode agent -w');
    });

    it('MODE user +o (server op - not allowed)', function(done) {
      let err = false;
      agent.on('response', waitFor('agent +o', () => {
        err = true;
        done('MODE +o should be ignored');
      }));
      agent.send('mode agent +o');
      setTimeout(() => {
        if (!err)
          done();
      }, 100);
    });

    it('MODE user -o (remove server op)', function(done) {
      agent.on('response', waitFor('-o', done));
      agent.send('oper admin admin');
      agent.send('mode agent -o');
    });
  });

  describe('Channel Mode Tests', function() {

    beforeEach((done) => {
      agent.on('response', waitFor('366', done));
      agent.send('join #cats');
    });

    it('MODE chan +i (invite) no privs', function(done) {
      agent.send('mode #cats -o agent');
      agent.on('response', waitFor('482', () => {
        tryAssert.equal(ircserver.getChannel('#cats').mode.i,
                        false,
                        'mode flag not set',
                        done);
      }));
      agent.send('mode #cats +i');
    });

    it('MODE chan +i (invite) with privs', function(done) {
      agent.on('response', waitFor('+i', () => {
        tryAssert.equal(ircserver.getChannel('#cats').mode.i,
                        true,
                        'mode flag not set',
                        done);
      }));
      agent.send('mode #cats +i');
    });

    it('MODE chan +o no privs', function(done) {
      agent.on('response', waitFor('482', () => {
        tryAssert.equal(ircserver.getChannel('#cats').mode.o['other'],
                        undefined,
                        'op set without permissions',
                        done);
      }));
      agent.send('mode #cats -o agent');
      agent.send('mode #cats +o other');
    });

    it('MODE chan +o with privs', function(done) {
      agent.on('response', waitFor('MODE #cats +o other', () => {
        tryAssert.equal(ircserver.getChannel('#cats').mode.o['other'],
                        true,
                        'op unsuccessful',
                        done);
      }));
      agent.send('mode #cats +o other');
    });

    it('MODE chan -o with privs', function(done) {
      agent.on('response', waitFor('MODE #cats -o other', () => {
        tryAssert.equal(ircserver.getChannel('#cats').mode.o['other'],
                        false,
                        'de-op unsuccessful',
                        done);
      }));
      agent.send('mode #cats -o other');
    });

    it('MODE chan +p with privs', function(done) {
      agent.on('response', waitFor('MODE #cats +p', () => {
        tryAssert.equal(ircserver.getChannel('#cats').mode.p,
                        true,
                        'set private unsuccessful',
                        done);
      }));
      agent.send('mode #cats +p');
    });

    it('MODE chan +s with privs', function(done) {
      agent.on('response', waitFor('MODE #cats +s', () => {
        tryAssert.equal(ircserver.getChannel('#cats').mode.s,
                        true,
                        'secret mode unsuccessful',
                        done);
      }));
      agent.send('mode #cats +s other');
    });

    it('MODE chan +m with privs', function(done) {
      agent.on('response', waitFor('MODE #cats +m', () => {
        tryAssert.equal(ircserver.getChannel('#cats').mode.m,
                        true,
                        'moderate unsuccessful',
                        done);
      }));
      agent.send('mode #cats +m');
    });

    it('MODE chan +l with privs', function(done) {
      agent.on('response', waitFor('MODE #cats +l', () => {
        tryAssert.equal(ircserver.getChannel('#cats').mode.l,
                        30,
                        'limit not set',
                        done);
      }));
      agent.send('mode #cats +l 30');
    });

    it('MODE chan +v with privs', function(done) {
      agent.on('response', waitFor('MODE #cats +v', () => {
        tryAssert.equal(ircserver.getChannel('#cats').mode.v['other'],
                        true,
                        'voice unsuccessful',
                        done);
      }));
      agent.send('mode #cats +v other');
    });

    it('MODE chan +k with privs', function(done) {
      agent.on('response', waitFor('MODE #cats +k', () => {
        tryAssert.equal(ircserver.getChannel('#cats').mode.k,
                        'fookey',
                        'set key unsuccessful',
                        done);
      }));
      agent.send('mode #cats +k fookey');
    });
  });
});
