const BROADCAST_TPS = 30;
const MAX_BLOBS = 20;
const GAME_SIZE = 720; // TODO: send this value in the handshake
const PADDING = 25;

console.log("Initializing websocket server...");
let nowServing = [];
let wsPlayerMap = new Map();

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
    return new Response("Upgrade failed :(", { status: 500 });
  },

  websocket: {
    open: function (ws) {
      colorLog(RED, "New websocket opened.");
      nowServing.push(ws);
      ws.send(
        JSON.stringify({
          type: "INIT",
          gameSize: GAME_SIZE,
          foo: "bar",
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
      wsPlayerMap.get(ws).forEach(playerId => {
        players.delete(playerId);
      });
      wsPlayerMap.delete(ws);
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
  // console.log("blobs:" + blobs.size);
  if (blobs.size < MAX_BLOBS)
    blobs.set(blobIndex, {
      id: blobIndex++,
      maxRadius: 3 + Math.random() * 5,
      posX: PADDING + Math.random() * (GAME_SIZE - PADDING),
      posY: PADDING + Math.random() * (GAME_SIZE - PADDING),
      score: 1,
      fuel: 20,
      // color init happens client-side //IDEA: color seed
    });

  let state = {
    type: "BRDC",
    players: Array.from(players.values()),
    blobs: Array.from(blobs.values()),
  };
  // colorLog(RED, state.players, state.blobs)
  process.stdout.write(BLUE + `Broadcasting game state to ${nowServing.length} socket(s). \r` + END);
  nowServing.forEach((ws) => {
    ws.send(JSON.stringify(state));
  });
}

const RED = "\u001b[31m";
const BLUE = "\u001b[34m";
const END = "\u001b[0m";

function colorLog(color, data) {
  console.log((color + data + END).padEnd(80, " "));
}

/**
 * message types:
 * INIT - initializing message sent to clients
 * PDEC - player declarations received by server
 * BRDC - continuous updates going both ways
 */
