const BROADCAST_TPS = 30;
const GAME_SIZE = 2000;
const MAX_BLOBS = GAME_SIZE * GAME_SIZE * 4e-5;
const MAX_SPIKEYS = GAME_SIZE * GAME_SIZE * 4e-6;
const PADDING = 25;

console.log("Initializing websocket server...");
let nowServing = [];
let wsPlayerMap = new Map();

let players = new Map();
let blobs = new Map();
let spikeys = new Map();
let blobIndex = 0;
let spikeyIndex = 0;

// WEBSOCKET SERVER

/**
 * message types:
 * INIT - initializing message sent to clients
 * PDEC - player declarations post-init
 * BRDC - continuous updates going both ways
 */

Bun.serve({
  fetch(req, server) {
    // const sessionId = generateSessionId();
    server.upgrade(req, {
      // headers: {
      //   "Set-Cookie": `SessionId=${sessionId}`,
      // },
    });
    return new Response("Upgrade failed :(", { status: 500 });
  },

  websocket: {
    open: function (ws) {
      colorLog(RED, "New websocket opened.");
      nowServing.push(ws);
      ws.send(
        JSON.stringify({
          type: "INIT",
          GAME_SIZE: GAME_SIZE,
          BROADCAST_TPS: BROADCAST_TPS,
        })
      );
    },

    message: function (ws, message) {
      let data = JSON.parse(message);
      switch (data.type) {
        case "PDEC":
          wsPlayerMap.set(ws, data.localPlayerIds);
          break;
        case "BRDC":
          data.localPlayers.forEach((recievedPlayer) => {
            players.set(recievedPlayer.id, recievedPlayer);
          });
          data.eatenBlobIds.forEach((id) => blobs.delete(id));
      }
    },

    close: function (ws, code, message) {
      colorLog(RED, "Websocket closed.");
      const index = nowServing.indexOf(ws);
      if (index !== -1) {
        nowServing.splice(index, 1);
      }
      if(!wsPlayerMap.has(ws)) return;
      wsPlayerMap.get(ws).forEach((playerId) => {
        players.delete(playerId);
      });
      wsPlayerMap.delete(ws);
    },
  },
});

// BROADCAST

setInterval(broadcastGameState, 1000 / BROADCAST_TPS);

// function generateSessionId() {
//   let id = Math.random();
//   //   nowServing.push(id);
//   return id;
// }

function broadcastGameState() {
  // console.log("blobs:" + blobs.size);
  if (blobs.size < MAX_BLOBS)
    blobs.set(blobIndex, {
      id: blobIndex++,
      seed: Math.random() * 1e10
    });

    if (spikeys.size < MAX_SPIKEYS)
    spikeys.set(spikeyIndex, {
      id: spikeyIndex++,
      seed: Math.random() * 1e10
    });

  let state = {
    type: "BRDC",
    players: Array.from(players.values()),
    blobs: Array.from(blobs.values()),
    spikeys: Array.from(spikeys.values())
  };

  // colorLog(RED, state.players, state.blobs)
  process.stdout.write(BLUE + `Broadcasting game state to ${nowServing.length} socket(s). \r` + END);
  nowServing.forEach((ws) => {
    ws.send(JSON.stringify(state));
  });
}

// VARIOUS HELPER FUNCTIONS

const RED = "\u001b[31m";
const BLUE = "\u001b[34m";
const END = "\u001b[0m";

function colorLog(color, data) {
  console.log((color + getCurrentTime() + data + END).padEnd(80, " "));
}

function getCurrentTime() {
  const now = new Date();
  const hours = String(now.getHours()).padStart(2, "0");
  const minutes = String(now.getMinutes()).padStart(2, "0");
  return `${hours}:${minutes} - `;
}

// TODOS
// TODO: remove websockets that haven't replied in a while
// TODO: put connections on "pause" and "resume" them  
