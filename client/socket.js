let socket;

const SEND_TPS = 30;
const LOGIC_TPS = 60;
const CANVAS_SIZE = 720;
let BROADCAST_TPS;
let LAST_PKG;
let GAME_WIDTH;
let GAME_HEIGHT;

const BOOST_STRENGTH = 4;
const BOOST_SHRINK = 0.99; // ~0.99

let show_scores = true;

let localPlayers = [];
let onlinePlayers = [];
let blobs = [];
let eatenBlobIds = [];

let useVerticalLayout = false;
let searchParams;
let controlScheme;

function preload() {
  searchParams = new URLSearchParams(window.location.search);
  useVerticalLayout = searchParams.has("vertical");
  loadJSON(
    "controlScheme.json",
    (data) => {
      controlScheme = data;
    },
    (error) => {
      console.error(error);
    }
  );
  socket = new WebSocket("wss://konidev.157451.xyz/ws");
  addSocketListeners();
}

// P5 SETUP HAPPENS AFTER INIT RECIEVED

function runSetup() {
  frameRate(60);
  pcount = (searchParams.get("WASD") !== "") + (searchParams.get("IJKL") !== "") + (searchParams.get("NUMP") !== ""); //temp
  let relSize = useVerticalLayout ? [1, 1 - (pcount - 1) * 0.2] : [1 - (pcount - 1) * 0.2, 1];

  if (searchParams.get("WASD"))
    localPlayers.push(new Player(searchParams.get("WASD"), searchParams.get("WASDcolor"), controlScheme.WASD, relSize));
  if (searchParams.get("IJKL"))
    localPlayers.push(new Player(searchParams.get("IJKL"), searchParams.get("IJKLcolor"), controlScheme.IJKL, relSize));
  if (searchParams.get("NUMP"))
    localPlayers.push(new Player(searchParams.get("NUMP"), searchParams.get("NUMPcolor"), controlScheme.NUMP, relSize));

  if (localPlayers.length === 0)
    select("body").html('<img src="https://i.imgflip.com/7q0o8b.jpg" alt="No players? 💀">');

  let gameCanvas = document.querySelector("#game");
  if (useVerticalLayout)
    createCanvas(
      CANVAS_SIZE,
      localPlayers.reduce((acc, player) => acc + player.gHeight, 0),
      gameCanvas
    );
  else
    createCanvas(
      localPlayers.reduce((acc, player) => acc + player.gWidth, 0),
      CANVAS_SIZE,
      gameCanvas
    );

  noStroke();
  logic();
  setInterval(logic, 1000 / LOGIC_TPS);
  setInterval(sendState, 1000 / SEND_TPS);
}

function draw() {
  noStroke();
  let x = 0;
  let y = 0;
  localPlayers.forEach((player) => {
    player.updateGraphics();
    image(player.graphics, x, y);
    push();
    noFill();
    stroke("#551071");
    strokeWeight(2);
    rect(x, y, player.gWidth, player.gHeight);
    pop();
    if (useVerticalLayout) y += player.gHeight;
    else x += player.gWidth;
  });

  // show scores
  if (show_scores) {
    push();
    textAlign(LEFT, CENTER);
    textSize(24);
    textFont("Fredoka");
    fill(255);

    leaderboard = [...localPlayers, ...onlinePlayers].sort((p1, p2) => p2.score - p1.score);
    for (let i = 0; i < leaderboard.length; i++) {
      push();
      fill(leaderboard[i].getColor());
      circle(30, 30 + i * 50, map(leaderboard[i].originalRadius, 0, leaderboard[0].originalRadius, 0, 35));
      pop();
      text(leaderboard[i].name, 60, 32 + i * 50);
    }
    pop();
  }
}

// GAME LOGIC

class Drawable {
  constructor() {}
  draw(povPlayer) {
    povPlayer.graphics.fill(this.getColor());
    povPlayer.graphics.circle(this.posX - povPlayer.posX, this.posY - povPlayer.posY, 2 * this.radius);
  }
}

class Player extends Drawable {
  constructor(
    name,
    color,
    keys,
    relSize,
    local = true,
    posX = undefined,
    posY = undefined,
    fuel = undefined,
    radius = undefined,
    originalRadius = undefined,
    score = undefined,
    id = undefined
  ) {
    super();
    this.id = id ?? name + new Date().getTime();

    this.name = name;
    this.color = color;

    this.local = local;
    if (this.local) {
      this.gWidth = CANVAS_SIZE * relSize[0];
      this.gHeight = CANVAS_SIZE * relSize[1];
      this.scale = 1;
      this.graphics = createGraphics(this.gWidth, this.gHeight);
      this.graphics.noStroke();
      this.keys = keys;

      this.posX = GAME_WIDTH / 2 + random(-GAME_WIDTH / 3, GAME_WIDTH / 3);
      this.posY = GAME_HEIGHT / 2 + random(-GAME_HEIGHT / 3, GAME_HEIGHT / 3);

      this.fuel = 100;
      this.boosting = false;
      this.originalRadius = this.radius = 20;
      this.speed = 3;
      this.rotation = 0;
      this.score = 0;
    } else {
      this.posX = posX;
      this.posY = posY;
      this.fuel = fuel;
      this.radius = radius;
      this.originalRadius = originalRadius;
      this.score = score;
    }
  }

  setNextState(x, y, radius, fuel, score) {
    if (this.posX && this.posY) {
      this.prevX = this.posX;
      this.nextX = x;
      this.prevY = this.posY;
      this.nextY = y;

      this.fuel = fuel;
      this.radius = radius;
      this.score = score;
      // this.prevRadius = this.radius;
      // this.nextRadius = radius;
      // this.nextFuel = fuel;
      // this.prevFuel = this.radius;
    }
  }

  update() {
    if (this.local) {
      this.rotation += (keysDown.has(this.keys["ROT_LEFT"]) - keysDown.has(this.keys["ROT_RIGHT"])) * 0.05;

      let horizontal = keysDown.has(this.keys["RIGHT"]) - keysDown.has(this.keys["LEFT"]); // -1 0 1
      let useVerticalLayout = keysDown.has(this.keys["DOWN"]) - keysDown.has(this.keys["UP"]); // -1 0 1

      let boosting_mult = 1;
      if (keysDown.has(this.keys["BOOST"]) && this.fuel > 0) {
        this.fuel -= 1;
        this.boosting = true;
        this.radius = clamp(this.radius * BOOST_SHRINK, this.originalRadius / 4, this.originalRadius);
        boosting_mult = BOOST_STRENGTH;
      } else {
        this.boosting = false;
        this.radius = clamp(this.radius * (1 / BOOST_SHRINK), this.originalRadius / 4, this.originalRadius);
      }

      if (horizontal == 0 && useVerticalLayout == 0) return;

      let angles = [];

      if (horizontal === -1) angles.push(PI);
      else if (horizontal === 1) angles.push(0);
      if (useVerticalLayout === -1) angles.push(PI / 2);
      else if (useVerticalLayout === 1) angles.push((3 * PI) / 2);

      let movementAngle = this.rotation;
      if (horizontal === 1 && useVerticalLayout === 1) movementAngle += -PI / 4;
      else movementAngle += angles.reduce((acc, angle) => acc + angle, 0) / angles.length;

      let padding = this.radius + 5;
      this.posX = clamp(this.posX + this.speed * boosting_mult * cos(movementAngle), padding, GAME_WIDTH - padding);
      this.posY = clamp(this.posY + this.speed * boosting_mult * -sin(movementAngle), padding, GAME_HEIGHT - padding);
    } else {
      if (this.nextX || this.nextY) {
        // smooth linear sliding to new position (until next expected pkg arrival)
        let elapsed = map(new Date().getTime(), LAST_PKG, LAST_PKG + 1000 / BROADCAST_TPS, 0, 1);
        this.posX = this.prevX + (this.nextX - this.prevX) * elapsed;
        this.posY = this.prevY + (this.nextY - this.prevY) * elapsed;
        // this.radius = this.prevRadius + (this.nextRadius - this.prevRadius) * elapsed;
        // this.fuel = this.prevFuel + (this.nextFuel - this.prevFuel) * elapsed;
      }
    }
  }

  updateGraphics() {
    this.graphics.background(0);

    this.graphics.translate(this.gWidth / 2, this.gHeight / 2);
    this.graphics.rotate(this.rotation);
    this.graphics.scale(this.scale);

    this.graphics.fill(10, 0, waver(20, 10, cos));
    this.graphics.rect(0 - this.posX, 0 - this.posY, GAME_WIDTH, GAME_HEIGHT, 2 * this.radius);

    blobs.forEach((blob) => blob.draw(this));

    // SELF ALWAYS ON TOP
    // players.filter(player => player !== this).forEach(player => player.draw(this));
    // this.draw(this);

    // LARGER PLAYER ON TOP
    [...localPlayers, ...onlinePlayers]
      .sort((a, b) => (a.radius > b.radius || (a.radius === b.radius && a === this) ? 1 : -1))
      .forEach((player) => player.draw(this));
    this.graphics.resetMatrix();
  }

  eat(whomst) {
    this.score += whomst.score;
    this.gainFuel(whomst.fuel);
    this.originalRadius += log(1 + whomst.radius) / 10;
    eatenBlobIds.push(whomst.id);
  }

  getColor() {
    // return lerpColor(color(255), this.color, this.fuel / 100);
    return lerpColor(color(0, 0, 0, 0), color(this.color), 0.2 + (this.fuel / 100) * 0.8); // less fuel -> less alpha, capped at 10%
  }

  gainFuel(amount) {
    this.fuel = clamp(this.fuel + amount, 0, 100);
  }
}

class Blob extends Drawable {
  constructor(id, maxRadius, posX, posY, score, fuel) {
    super();
    this.id = id;
    this.radius = 0.001;
    this.score = score; // 1
    this.fuel = fuel; // 20
    this.maxRadius = maxRadius;
    // let padding = this.maxRadius + 6;
    // this.posX = x ?? random(padding, GAME_WIDTH - padding);
    // this.posY = y ?? random(padding, GAME_HEIGHT - padding);
    this.posX = posX;
    this.posY = posY;

    push();
    colorMode(HSB);
    this.color = color(random(0, 255), 125, 125);
    pop();
  }

  update(player) {
    if (this.radius < this.maxRadius) this.radius += log(1 + this.radius / 5);
    if (dist(this.posX, this.posY, player.posX, player.posY) > player.radius - this.radius) return true;
    else {
      player.eat(this);
      return false;
    }
  }

  getColor() {
    return this.color;
  }
}

function logic() {
  localPlayers.forEach((player) => {
    player.update();
    blobs = blobs.filter((blob) => blob.update(player));
  });
  onlinePlayers.forEach((player) => player.update());
}

// WEBSOCKET PAYLOADS

/**
 * message types:
 * INIT - initializing message sent to clients
 * PDEC - player declarations received by server
 * BRDC - continuous updates going both ways
 */

function addSocketListeners() {
  socket.addEventListener("message", (event) => {
    let data = JSON.parse(event.data);
    switch (data.type) {
      case "INIT":
        LAST_PKG = new Date().getTime();
        GAME_WIDTH = GAME_HEIGHT = data.GAME_SIZE;
        BROADCAST_TPS = data.BROADCAST_TPS;
        runSetup();
        socket.send(
          JSON.stringify({
            type: "PDEC",
            localPlayerIds: localPlayers.map((p) => p.id),
          })
        );
        break;

      case "BRDC":
        LAST_PKG = new Date().getTime();
        // filter to non-local
        // console.log(data)
        otherPlayers = data.players.filter((p) => !localPlayers.some((lp) => lp.id === p.id));
        // parse them into real Players
        otherPlayers.forEach((recievedPlayer) => {
          let found = false;
          onlinePlayers.forEach((existingPlayer) => {
            if (existingPlayer.id === recievedPlayer.id) {
              existingPlayer.setNextState(
                recievedPlayer.posX,
                recievedPlayer.posY,
                recievedPlayer.radius,
                recievedPlayer.fuel,
                recievedPlayer.score
              );
              found = true;
            }
          });
          if (!found) {

            onlinePlayers.push(
              new Player(
                recievedPlayer.name,
                recievedPlayer.color,
                undefined,
                undefined,
                false,
                recievedPlayer.posX,
                recievedPlayer.posY,
                recievedPlayer.fuel,
                recievedPlayer.radius,
                recievedPlayer.originalRadius,
                recievedPlayer.score,
                recievedPlayer.id
              )
            );
          }
        });
        for (let i = 0; i < onlinePlayers.length; i++) {
          if (!data.players.some(recievedPlayer => recievedPlayer.id === onlinePlayers[i].id)) {
            onlinePlayers.splice(i--);
          }
        }

        blobs = blobs.filter((lb) => data.blobs.some((b) => lb.id === b.id));
        newBlobs = data.blobs.filter((b) => !eatenBlobIds.includes(b.id) && !blobs.some((lb) => lb.id === b.id));
        newBlobs.forEach((blob) => {
          blobs.push(new Blob(blob.id, blob.maxRadius, blob.posX, blob.posY, blob.score, blob.fuel));
        });
        break;

      default:
        console.log("Unknown socket message type:", data.type);
    }
  });
}

function sendState() {
  // console.log("sending state to server");
  // console.log({ localPlayers: localPlayers, blobs: blobs });
  let payload = {
    type: "BRDC",
    localPlayers: serializePlayers(localPlayers), //send local player array serialized
    eatenBlobIds: eatenBlobIds, //send eaten blob id array
  };
  // console.log(payload);
  try {
    socket.send(JSON.stringify(payload));
  } catch (e) {}
}

// HANDLING INPUTS

let keysDown = new Set();

function cleanKey(keyEvent) {
  return keyEvent.code.replace(/^Key([A-Z])/, "$1").toUpperCase();
}

function keyPressed(e) {
  e.preventDefault();
  if (e.key === "-") return localPlayers.forEach((player) => (player.scale *= 0.9));
  if (e.key === "+") return localPlayers.forEach((player) => (player.scale *= 1 / 0.9));
  // console.log(cleanKey(e))
  keysDown.add(cleanKey(e));
}

function keyReleased(e) {
  keysDown.delete(cleanKey(e));
}

// VARIOUS HELPER FUNCTIONS

function clamp(x, lower, higher) {
  if (x < lower) return lower;
  if (x > higher) return higher;
  return x;
}

function waver(base, mult, fun, speed = 400) {
  return base + mult * fun(millis() / speed);
}

function getRandomBrightColor() {
  // Generate random values for R, G, and B components
  const r = Math.floor(Math.random() * 256); // Random value between 0 and 255
  const g = Math.floor(Math.random() * 256); // Random value between 0 and 255
  const b = Math.floor(Math.random() * 256); // Random value between 0 and 255

  // Convert the values to a hexadecimal string and format it as "#RRGGBB"
  const colorString = `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b
    .toString(16)
    .padStart(2, "0")}`;

  return colorString;
}

function serializePlayers(players) {
  return players.map((player) => {
    return {
      id: player.id,
      name: player.name,
      color: player.color,
      posX: player.posX,
      posY: player.posY,
      fuel: player.fuel,
      radius: player.radius,
      originalRadius: player.originalRadius,
      score: player.score,
    };
  });
}
