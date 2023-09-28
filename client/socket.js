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
let useJoystickMode = false;
let searchParams;
let controlScheme;
let fireResize;

function preload() {
  searchParams = new URLSearchParams(window.location.search);
  useVerticalLayout = searchParams.has("vertical");
  useJoystickMode = searchParams.has("joystick");
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

  let playerCount =
    (searchParams.get("WASD") !== "") +
    (searchParams.get("IJKL") !== "") +
    (searchParams.get("NUMP") !== "") +
    (searchParams.get("MOUS") !== "");
  let relSize = [1, 1];

  if (playerCount === 4) relSize = [0.5, 0.5];
  else relSize = useVerticalLayout ? [1, 1 / playerCount] : [1 / playerCount, 1];

  if (searchParams.get("WASD"))
    localPlayers.push(new Player(searchParams.get("WASD"), searchParams.get("WASDcolor"), controlScheme.WASD, relSize));
  if (searchParams.get("IJKL"))
    localPlayers.push(new Player(searchParams.get("IJKL"), searchParams.get("IJKLcolor"), controlScheme.IJKL, relSize));
  if (searchParams.get("NUMP"))
    localPlayers.push(new Player(searchParams.get("NUMP"), searchParams.get("NUMPcolor"), controlScheme.NUMP, relSize));
  if (searchParams.get("MOUS"))
    localPlayers.push(new Player(searchParams.get("MOUS"), searchParams.get("MOUScolor"), "MOUS", relSize));

  if (localPlayers.length === 0)
    select("body").html('<img src="https://i.imgflip.com/7q0o8b.jpg" alt="No players? 💀">');

  let gameCanvas = document.querySelector("#game");
  createCanvas(windowWidth, windowHeight, gameCanvas);

  document.querySelector("body").addEventListener("contextmenu", function (e) {
    e.preventDefault();
    return false;
  });

  window.addEventListener("resize", () => {
    clearTimeout(fireResize);
    fireResize = setTimeout(() => {
      resizeCanvas(windowWidth, windowHeight);
      console.log("reinit");
      localPlayers.forEach((p) => p.initGraphics());

      initCanvasPositions();
    }, 25);
  });

  initCanvasPositions();

  noStroke();
  logic();
  setInterval(logic, 1000 / LOGIC_TPS);
  setInterval(sendState, 1000 / SEND_TPS);
}

function draw() {
  background("#222");

  localPlayers.forEach((player) => {
    player.updateGraphics();
    image(player.graphics, player.canvasX, player.canvasY);
    push();
    noFill();
    stroke("#551071");
    strokeWeight(2);
    rect(player.canvasX, player.canvasY, player.gWidth, player.gHeight);
    pop();
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
      circle(30, 30 + i * 50, map(leaderboard[i].originalRadius, 5, leaderboard[0].originalRadius, 0, 35, true));
      pop();
      text(leaderboard[i].name, 60, 32 + i * 50);
    }
    pop();
  }

  if (useJoystickMode && lmbIsPressed) {
    drawJoystick(50, 60);
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
    this.relSize = relSize;

    this.local = local;
    if (this.local) {
      this.initGraphics();
      this.scale = 1;
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

  initGraphics() {
    this.gWidth = windowWidth * this.relSize[0];
    this.gHeight = windowHeight * this.relSize[1];
    this.graphics = createGraphics(this.gWidth, this.gHeight);
    this.graphics.noStroke();
  }

  setNextState(x, y, radius, fuel, score, originalRadius) {
    if (this.posX && this.posY) {
      this.prevX = this.posX;
      this.nextX = x;
      this.prevY = this.posY;
      this.nextY = y;

      this.fuel = fuel;
      this.radius = radius;
      this.score = score;
      this.originalRadius = originalRadius;

      // feels JANK
      // this.prevRadius = this.radius;
      // this.nextRadius = radius;
      // this.nextFuel = fuel;
      // this.prevFuel = this.radius;
    }
  }

  update() {
    if (this.local) {
      if (this.keys === "MOUS") {
        let boostMult = this.boost(rmbIsPressed || touchCount >= 2);
        let angle = 0;
        if (lmbIsPressed) {
          if (useJoystickMode && joystick.angle) angle = joystick.angle;
          else angle = angleOf(mouseY, this.canvasY + this.gHeight / 2, mouseX, this.canvasX + this.gWidth / 2);
          this.move(angle, boostMult);
        }
        return;
      }
      
      this.rotation += (keysDown.has(this.keys["ROT_LEFT"]) - keysDown.has(this.keys["ROT_RIGHT"])) * 0.05;

      let horizontal = keysDown.has(this.keys["RIGHT"]) - keysDown.has(this.keys["LEFT"]); // -1 0 1
      let vertical = keysDown.has(this.keys["DOWN"]) - keysDown.has(this.keys["UP"]); // -1 0 1

      let boostMult = this.boost(keysDown.has(this.keys["BOOST"]));

      if (horizontal == 0 && vertical == 0) return;

      let angles = [];

      if (horizontal === -1) angles.push(PI);
      else if (horizontal === 1) angles.push(0);
      if (vertical === -1) angles.push(PI / 2);
      else if (vertical === 1) angles.push((3 * PI) / 2);

      let movementAngle = this.rotation;
      if (horizontal === 1 && vertical === 1) movementAngle += -PI / 4;
      else movementAngle += angles.reduce((acc, angle) => acc + angle, 0) / angles.length;

      this.move(movementAngle, boostMult);

      return;
    }

    if (this.nextX || this.nextY) {
      // smooth linear sliding to new position (until next expected pkg arrival)
      let elapsed = map(new Date().getTime(), LAST_PKG, LAST_PKG + 1000 / BROADCAST_TPS, 0, 1, true);
      this.posX = this.prevX + (this.nextX - this.prevX) * elapsed;
      this.posY = this.prevY + (this.nextY - this.prevY) * elapsed;
      // this.radius = this.prevRadius + (this.nextRadius - this.prevRadius) * elapsed;
      // this.fuel = this.prevFuel + (this.nextFuel - this.prevFuel) * elapsed;
    }
  }

  move(angle, multiplier) {
    let padding = this.radius + 3;
    this.posX = clamp(this.posX + this.speed * multiplier * cos(angle), padding, GAME_WIDTH - padding);
    this.posY = clamp(this.posY + this.speed * multiplier * -sin(angle), padding, GAME_HEIGHT - padding);
  }

  grow() {
    this.radius = clamp(this.radius * (1 / BOOST_SHRINK), this.originalRadius / 4, this.originalRadius);
  }

  shrink() {
    this.radius = clamp(this.radius * BOOST_SHRINK, this.originalRadius / 4, this.originalRadius);
  }

  boost(condition) {
    if (this.fuel < 1 || !condition) {
      this.boosting = false;
      this.grow();
      return 1;
    }
    this.fuel -= 1;
    this.boosting = true;
    this.shrink();
    return BOOST_STRENGTH;
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
  updateJoystickAngle();
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
                recievedPlayer.score,
                recievedPlayer.originalRadius
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
          if (!data.players.some((recievedPlayer) => recievedPlayer.id === onlinePlayers[i].id)) {
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
  let payload = {
    type: "BRDC",
    localPlayers: serializePlayers(localPlayers), //send local player array serialized
    eatenBlobIds: eatenBlobIds, //send eaten blob id array
  };
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
  keysDown.add(cleanKey(e));
}

function keyReleased(e) {
  keysDown.delete(cleanKey(e));
}

// MOUSE INPUTS

let joystick = {
  originX: undefined,
  originY: undefined,
  angle: undefined,
};

let rmbIsPressed = false;
let lmbIsPressed = false;
let touches;
let touchCount = 0;

function touchStarted(e) {
  e.preventDefault();
  if (e.touches) {
    touches = e.touches;
    touchCount++;
  }

  if (e.button === 2) {
    rmbIsPressed = true;
    return false;
  } else if (e.button === 0 || touchCount === 1) {
    lmbIsPressed = true;
    joystick.originX = mouseX;
    joystick.originY = mouseY;
    return false;
  }
  return false;
}

function touchMoved(e) {
  if (e.touches) touches = e.touches;
}

function touchEnded(e) {
  e.preventDefault();
  if (e.touches)
    if (e.touches) {
      touches = undefined;
      touchCount--;
    }
  if (e.button === 2) {
    rmbIsPressed = false;
    return false;
  }
  if (e.button === 0 || touchCount === 0) {
    lmbIsPressed = false;
    joystick = {
      originX: undefined,
      originY: undefined,
      angle: undefined,
    };
    return false;
  }
  return false;
}

function updateJoystickAngle() {
  if (touches && touches.length >= 2) {
    let closestIndex = 0;
    let minimumDist = dist(joystick.originX, joystick.originY, touches[0].clientX, touches[0].clientY);
    for (let i = 1; i < touches.length; ++i) {
      let d = dist(joystick.originX, joystick.originY, touches[i].clientX, touches[i].clientY);
      if (d < minimumDist) {
        minimumDist = d;
        closestIndex = i;
      }
    }
    joystick.angle = angleOf(
      touches[closestIndex].clientY,
      joystick.originY,
      touches[closestIndex].clientX,
      joystick.originX
    );
  } else joystick.angle = angleOf(mouseY, joystick.originY, mouseX, joystick.originX);
}

// VARIOUS HELPER FUNCTIONS

function angleOf(y1, y2, x1, x2) {
  return -Math.atan2(y1 - y2, x1 - x2);
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

function drawJoystick(circleRadius, ringRadius) {
  push();
  fill("#BB4444");

  if (ringRadius / 2 < dist(joystick.originX, joystick.originY, mouseX, mouseY)) {
    let cappedX = joystick.originX + (ringRadius / 3) * cos(joystick.angle);
    let cappedY = joystick.originY - (ringRadius / 3) * sin(joystick.angle);
    circle(cappedX, cappedY, circleRadius);
    noFill();
    strokeWeight(5);
    stroke("#BB4444");
    // line(cappedX, cappedY, joystick.originX, joystick.originY);
  } else {
    circle(mouseX, mouseY, circleRadius);
    noFill();

    strokeWeight(5);
    stroke("#BB4444");
    // line(mouseX, mouseY, joystick.originX, joystick.originY);
  }
  circle(joystick.originX, joystick.originY, ringRadius);

  pop();
}

function initCanvasPositions() {
  let x = 0;
  let y = 0;
  if (localPlayers.length === 4) {
    localPlayers[0].canvasX = 0;
    localPlayers[0].canvasY = 0;

    localPlayers[1].canvasX = localPlayers[0].gWidth;
    localPlayers[1].canvasY = 0;

    localPlayers[2].canvasX = 0;
    localPlayers[2].canvasY = localPlayers[0].gHeight;

    localPlayers[3].canvasX = localPlayers[0].gWidth;
    localPlayers[3].canvasY = localPlayers[0].gHeight;
  } else
    localPlayers.forEach((player) => {
      player.canvasX = x;
      player.canvasY = y;
      if (useVerticalLayout) y += player.gHeight;
      else x += player.gWidth;
    });
}
