import { ServerWebSocket } from "bun";
const jokes = require("jester-jokes");

const RED = "\u001b[31m";
const BLUE = "\u001b[34m";
const END = "\u001b[0m";

const BROADCAST_TPS = 30;

function colorLog(color, data) {
  console.log(color + data + END);
}

console.log("Initializing websocket server...");
let nowServing = [];

let players = [];
let blobs = [];

for (let i = 0; i < 20; i++) {
  blobs.push({
    x: Math.floor(Math.random() * 720),
    y: Math.floor(Math.random() * 720),
  });
  
}

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
      // ws.send("omg hi");
    },
    message: function (ws, message) {
      colorLog(BLUE, "New message recieved from" + ws.remoteAddress);
      colorLog(RED, message)
      let state = JSON.parse(message);
      state.players.forEach((player) => {
        const existingPlayerIndex = players.findIndex((p) => p.id === player.id);
        if (existingPlayerIndex !== -1) {
          players[existingPlayerIndex] = player;
        } else {
          players.push(player);
        }
      });
      blobs = state.blobs.filter(blob =>
        blobs.some(blob2 => blob.id === blob2.id)
      );
    },
    close: function (ws, code, message) {
      colorLog(RED, "Websocket closed.");
      const index = nowServing.indexOf(ws);
      if (index !== -1) {
        nowServing.splice(index, 1);
      }
      //   console.log(message);
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
  console.log(players);
  if (blobs.length < 10)
    blobs.push(new Blob());

  let state = {
    players: players,
    blobs: blobs,
  };
  colorLog(BLUE, `Broadcasting game state to ${nowServing.length} players.`);
  nowServing.forEach((ws) => {
    ws.send(JSON.stringify(state));
  });
}

class Drawable {
  constructor () {}
  draw(povPlayer) {
      povPlayer.graphics.fill(this.getColor());
      povPlayer.graphics.circle(this.posX - povPlayer.posX, this.posY - povPlayer.posY, 2 * this.radius);
  }
} 