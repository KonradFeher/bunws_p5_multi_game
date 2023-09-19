let socket;

const SEND_TPS = 30;
const LOGIC_TPS = 60;
const SIZE = 720; //unchangable client-side
const WIDTH = SIZE;
const HEIGHT = SIZE;

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
}

function setup() {
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
      SIZE,
      localPlayers.reduce((acc, player) => acc + player.gHeight, 0),
      gameCanvas
    );
  else
    createCanvas(
      localPlayers.reduce((acc, player) => acc + player.gWidth, 0),
      SIZE,
      gameCanvas
    );

  socket = new WebSocket("wss://konidev.157451.xyz/ws");
  addSocketListeners();
  noStroke();
  logic();
  setInterval(logic, 1000 / LOGIC_TPS);
  setInterval(sendState, 1000 / SEND_TPS);
}

function draw() {
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
    score = undefined
  ) {
    super();
    this.id = name + new Date().getTime();

    this.name = name;
    this.color = color;

    if (local) {
      this.gWidth = SIZE * relSize[0];
      this.gHeight = SIZE * relSize[1];
      this.scale = 1;
      this.graphics = createGraphics(this.gWidth, this.gHeight);
      this.keys = keys;

      this.posX = SIZE / 2 + random(-SIZE / 3, SIZE / 3);
      this.posY = SIZE / 2 + random(-SIZE / 3, SIZE / 3);

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
    // IDEA: online players are 1 packet behind, always drifting to their next packet's location - not re-constructed every packet.
  }

  update() {
    // should only be run for local players (for now)
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
    this.posX = clamp(this.posX + this.speed * boosting_mult * cos(movementAngle), padding, WIDTH - padding);
    this.posY = clamp(this.posY + this.speed * boosting_mult * -sin(movementAngle), padding, HEIGHT - padding);
  }

  updateGraphics() {
    this.graphics.background(0);

    this.graphics.translate(this.gWidth / 2, this.gHeight / 2);
    this.graphics.rotate(this.rotation);
    this.graphics.scale(this.scale);

    this.graphics.fill(10, 0, waver(20, 10, cos));
    this.graphics.rect(0 - this.posX, 0 - this.posY, WIDTH, HEIGHT, 2 * this.radius);

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
    // this.posX = x ?? random(padding, WIDTH - padding);
    // this.posY = y ?? random(padding, HEIGHT - padding);
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
  // while (blobs.length < 10)
  //     blobs.push(new Blob());
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

// function blobIds(blobs) {
//   return blobs.map((blob) => blob.id);
// }

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

function addSocketListeners() {
  socket.addEventListener("open", (e) => {
    // alert("[open] Connection established");
    socket.send(
      JSON.stringify({
        type: "PDEC",
        localPlayerIds: localPlayers.map((p) => p.id),
      })
    );
  });

  socket.addEventListener("message", (event) => {
    let data = JSON.parse(event.data);
    switch (data.type) {
      case "INIT":
        // TODO: game is already initialized by this point... wait with setup until after...
        console.log(data.gameSize);
        break;

      case "BRDC":
        // filter to non-local
        // console.log(data)
        otherPlayers = data.players.filter((p) => !localPlayers.some((lp) => lp.id === p.id));
        // parse them into real Players
        onlinePlayers = otherPlayers.map(
          (player) =>
            new Player(
              player.name,
              player.color,
              undefined,
              undefined,
              false,
              player.posX,
              player.posY,
              player.fuel,
              player.radius,
              player.originalRadius,
              player.score
            )
        );

        // TODO delete missing blobs
        blobs = blobs.filter((lb) => data.blobs.some((b) => lb.id === b.id));
        newBlobs = data.blobs.filter((b) => !eatenBlobIds.includes(b.id) && !blobs.some((lb) => lb.id === b.id));
        newBlobs.forEach((blob) => {
          // console.log("adding new blob")s
          blobs.push(new Blob(blob.id, blob.maxRadius, blob.posX, blob.posY, blob.score, blob.fuel));
        });
        break;

      default:
        console.log("Unknown socket message type:", data.type);
    }
  });
}

/**
 * message types:
 * INIT - initializing message sent to clients
 * PDEC - player declarations received by server
 * BRDC - continuous updates going both ways
 */
