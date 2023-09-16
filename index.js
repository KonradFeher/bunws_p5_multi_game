import { ServerWebSocket } from "bun";

const BROADCAST_TPS = 30;
const MAX_BLOBS = 20;
const GAME_SIZE = 720; // TODO: send this value in the handshake
const PADDING = 10;

function colorLog(color, data) {
  console.log(color + data + END);
}

console.log("Initializing websocket server...");
let nowServing = [];

let players = new Map();
let blobs = new Map();
let blobIndex = 0;

Bun.serve({
  fetch(req, server) {
    // const sessionId = generateSessionId();
    server.upgrade(req, {
      // headers: {
      //   "Set-Cookie": `SessionId=${sessionId}`,
      // },
    });
    return new Response("Hehe");
  },

  websocket: {
    open: function (ws) {
      colorLog(RED, "New websocket opened.");
      nowServing.push(ws);
    },

    message: function (ws, message) {
      colorLog(BLUE, "New message recieved from" + ws.remoteAddress);
      colorLog(BLUE, message);
      let recievedState = JSON.parse(message);
      // handle recieved array of players
      recievedState.localPlayers.forEach((recievedPlayer) => {
        players.set(recievedPlayer.id, recievedPlayer);
      });
      // recievedState.blobIds.forEach((blobId) => blobs.delete(blobId)); // this is incorrect, these are the blobs we KEEp
      Array.from(blobs.keys()).forEach(id => {
        if (!recievedState.blobIds.includes(id))
          blobs.delete(id);
        });
    },

    close: function (ws, code, message) {
      colorLog(RED, "Websocket closed.");
      const index = nowServing.indexOf(ws);
      if (index !== -1) {
        nowServing.splice(index, 1);
      }
    },
  },
});

setInterval(broadcastGameState, 1000 / BROADCAST_TPS);

// function generateSessionId() {
//   let id = Math.random();
//   //   nowServing.push(id);
//   return id;
// }

function broadcastGameState() {
  console.log("blobs:" + blobs.size);
  if (blobs.size < MAX_BLOBS) blobs.set(blobIndex, {
    id: blobIndex++,
    maxRadius: 3 + Math.random() * 5,
    posX: PADDING + Math.random() * (GAME_SIZE - PADDING),
    posY: PADDING + Math.random() * (GAME_SIZE - PADDING),
    score: 1,
    fuel: 20
    // color init happens client-side //IDEA: color seed
  });

  let state = {
    players: Array.from(players.values()),
    blobs: Array.from(blobs.values()),
  };
  colorLog(RED, state.players, state.blobs)
  colorLog(BLUE, `Broadcasting game state to ${nowServing.length} sockets.`);
  nowServing.forEach((ws) => {
    ws.send(JSON.stringify(state));
  });
}

const RED = "\u001b[31m";
const BLUE = "\u001b[34m";
const END = "\u001b[0m";

//TODO: FIX PLAYER COLOR BUG THING, STORE IT AS HEX INSTEAD OF p5 COLOR
//TODO: BLOBS KEEP INCREASING CLIENT SIDE 
//      THIS HAS TO DO WITH PACKET LIFETIME AND RE-INITING BLOBS AFTER EATEN