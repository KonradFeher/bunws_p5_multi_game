const TILE_WIDTH = 50;
const TILE_HEIGHT = 50;
const PATTERN_SIZE = 15;
const ACTIVATION_DISTANCE = 150;

let tile_colors = [];
let tiles;

class Tile {
  constructor(i, j) {
    this.i = i;
    this.j = j;
    this.lift = 0;
    this.maxLift = 0;
  }

  draw() {
    let x = this.i * TILE_WIDTH;
    let y = this.j * TILE_HEIGHT;
    fill(tile_colors[this.i % PATTERN_SIZE][this.j % PATTERN_SIZE]);

    let distance = dist(mouseX, mouseY, x, y);
    if (distance < ACTIVATION_DISTANCE) {
      this.maxLift = 25 * cos(map(distance, 0, ACTIVATION_DISTANCE, 0, PI / 2));
      this.lift = max(
        map(distance, 0, ACTIVATION_DISTANCE, 1, 0),
        this.maxLift
      );
    } else {
      this.lift = max(0, this.lift - 0.4);
    }
    // push();
    // translate(x, y - this.lift);
    // rect(0, 0, TILE_WIDTH-.3, TILE_HEIGHT-.3);
    // pop();
    rect(x, y - this.lift, TILE_WIDTH-.3, TILE_HEIGHT-.3);
  }
}

function setup() {
  createCanvas(
    windowWidth,
    windowHeight,
    document.querySelector("#background")
  );

  // generateTileColors("#808", "#824");
  generateTileColors("#142", "#143");
  generateTiles();

  noStroke();
  rectMode(CENTER);
}

function generateTileColors(from, to) {
  for (let i = 0; i < PATTERN_SIZE; i++) {
    tile_colors.push([]);
    for (let j = 0; j < PATTERN_SIZE; j++) {
      tile_colors[i].push(lerpColor(color(from), color(to), random()));
    }
  }
}

function generateTiles() {
  let new_tiles = [];
  let i = 0;
  let j = 0;
  while ((i - 1) * TILE_WIDTH < width) {
    j = 0;
    while ((j - 1) * TILE_HEIGHT < height) {
      new_tiles.push(new Tile(i, j));
      j++;
    }
    i++;
  }
  tiles = new_tiles;
}

function setUpCanvas() {
  resizeCanvas(
    windowWidth,
    windowHeight,
    document.querySelector("#background")
  );
}

// fire canvas resize 100ms after window stops resizing
let fireResize;
window.addEventListener("resize", () => {
  clearTimeout(fireResize);
  fireResize = setTimeout(() => {
    setUpCanvas(), generateTiles();
  }, 50);
});

function draw() {
  background("#141");
  tiles.forEach((tile) => {
    tile.draw();
  });
}
