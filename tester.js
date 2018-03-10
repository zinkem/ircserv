'use strict';

const net = require('net');
const proc = require('process');
const { Transform } = require('stream');

const alphabet = '0123456789qwertyuiopasdfghjklzxcvbnm       ';

const names = [
  'protoman',
  'megaman',
  'rock',
  'roll',
  'cutman',
  'gutsman',  
  'iceman',
  'bombman',
  'fireman',
  'elecman',
  'timeman',
  'picard',
  'riker',
  'data',
  'laforge',
  'troi',
  'crusher',
  'worf'
];

var count = 0;
var name_idx = 0;
function nextName() {
  name_idx = (name_idx+7)%names.length;
  return names[ name_idx ]+count++;
}

var clients = [];

var remote_host = proc.argv[2] || 'localhost',
    remote_port = proc.argv[3] || 7000,
    local_agents = 80;

proc.stdout.setMaxListeners(4000);

console.log('testing', remote_host, remote_port);

var failed = 0;

//new connection

var active = 0;
var current_id = 0;

var create_connection = function(id) {
  active++;
  var latencies = []
  var client = net.createConnection(remote_port, remote_host, () => {

    console.log(id, 'connected');
    //clients.push(client);
    //client.pipe(proc.stdout);
    /*
    var rlen = 5 +
        Math.floor(Math.random()*10) + 
        Math.floor(Math.random()*50);
    
    var rword = new Array(rlen).fill(1);
    rword.forEach( (x, i, a) => {
      var letter = Math.floor(Math.random()*alphabet.length);
      
      a[i] = alphabet[letter];
    });
    rword = rword.join('');*/
    var rword = 'crazy '+active;
    var commands = [ 'join #cats',
                     'priVmsG #cats hello cat lovers!',
                     'join #public',
                     'priVmsG #public hello everyone!',
                     'join #public2',
                     'priVmsG #public2 hello again everyone!',
                     'part #public2 this place...',
                     'who',
                     'STATS',
                     'privMSG #cATS '+rword,
                     'quit done'];
    var last_send = proc.hrtime();
    var xform = new Transform({
      transform(data, encoding, callback) {
        //console.log(data.toString());
        latencies.push(proc.hrtime(last_send)[1]/1000000);
        //console.log(last_send, 'data', data.toString());
        var next = commands.shift();
        if( !next ) {
          setTimeout( () => {
            console.log('no next');
            client.end();
            console.log(latencies);
            create_connection(current_id++);
          }, 6000);
        } else {
          setTimeout( () => {
            last_send = proc.hrtime();
            //console.log(last_send, next);
            callback(null, next+'\n');
          }, 1000+5000*Math.random());
        }
      }
    });

    xform.on('error', (err) => {
      console.log(err);
    });
    
    client.pipe(xform, {end: true });
    xform.pipe(client);
    var name = nextName();
    client.write('NICK '+name+'\n');
    client.write('USER '+name+' 0 * :Agent '+id+'\n');
    last_send = proc.hrtime();
    client.on('end', () => {
      active--;
      console.log('closed', id, active);
      xform.end();
    });

    client.on('error', () => {
      console.log('error!!!!!', id, active);
    });

  });

  client.on('error', (err) => {
    console.log(failed, err);
    failed++;
  });



}

for( var i = 0 ; i < local_agents; i++){
  create_connection(current_id++);
}

/*
//send message from existing connection
setTimeout(() => {
        setInterval(() => {
                var r = Math.floor(Math.random()*clients.length);
                var rlen = Math.floor(Math.random()*20);
                
                var rword = new Array(rlen).fill(1);
                rword.forEach( (x, i, a) => {
                        var letter = Math.floor(Math.random()*alphabet.length);
    
                        a[i] = alphabet[letter];
                    });
                rword = rword.join('');
                console.log(r, rlen, rword);  
                if( clients[r] ) 
                    clients[r].write(':'+rword+'\n');
                
            }, 1);
    }, 1000);

*/
