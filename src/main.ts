// description: Pick tiles from a tileset, then draw them onto a grid
import {
  Application,
  Assets,
  Container,
  Sprite,
  Graphics,
  Texture,
  Rectangle,
  FederatedPointerEvent,
} from "pixi.js";

const TILE_SIZE = 16;
const SWATCH_SIZE = 32;

interface Tile {
  id: number;
  x: number;
  y: number;
  col: number;
  row: number;
}

// A tile that has been stamped onto the draw grid.
interface PlacedTile {
  id: number;
  col: number;
  row: number;
  x: number;
  y: number;
}

function generateTileGrid(
  cols: number,
  rows: number,
  tileSize: number = TILE_SIZE,
): Tile[][] {
  const grid: Tile[][] = [];
  let id = 0;

  for (let row = 0; row < rows; row++) {
    const rowArr: Tile[] = [];
    for (let col = 0; col < cols; col++) {
      rowArr.push({
        id: id++,
        x: col * tileSize,
        y: row * tileSize,
        col,
        row,
      });
    }
    grid.push(rowArr);
  }

  return grid;
}

function getTileAtPixel(
  grid: Tile[][],
  x: number,
  y: number,
  tileSize: number = TILE_SIZE,
): Tile | undefined {
  const col = Math.floor(x / tileSize);
  const row = Math.floor(y / tileSize);
  return grid[row]?.[col];
}

(async () => {
  const draw_canvas = document.getElementById(
    "draw_canvas",
  ) as HTMLCanvasElement;
  const picker_canvas = document.getElementById(
    "picker_canvas",
  ) as HTMLCanvasElement;
  const pickModeBtn = document.getElementById("pick-mode-btn")!;
  const drawModeBtn = document.getElementById("draw-mode-btn")!;
  const tileDictionaryList = document.getElementById("tile-dictionary-list")!;

  // Initialize apps with existing canvases
  const drawApp = new Application();
  await drawApp.init({
    canvas: draw_canvas,
    width: 400,
    height: 400,
    background: "salmon",
  });

  const pickerApp = new Application();
  await pickerApp.init({
    canvas: picker_canvas,
    width: 400,
    height: 400,
    background: "crimson",
  });

  // The mode is purely a visual reflection of whichever canvas was last
  // clicked - Pick Mode picking only ever happens on the picker canvas,
  // Draw Mode drawing only ever happens on the draw canvas.
  function setMode(mode: "pick" | "draw") {
    pickModeBtn.classList.toggle("active", mode === "pick");
    drawModeBtn.classList.toggle("active", mode === "draw");
  }
  setMode("pick");

  // ----- Tile picker (source tileset) -----
  const picker_container = new Container();
  const pickerTexture = await Assets.load(
    "./src/assets/autumn farm tilemap.png",
  );

  // A plain <img> of the same source, used to crop thumbnails onto <canvas>
  // elements for the Tile Dictionary panel.
  const tilesetImage = new Image();
  tilesetImage.src = "./src/assets/autumn farm tilemap.png";
  await tilesetImage.decode();

  pickerApp.stage.eventMode = "static";
  pickerApp.stage.hitArea = pickerApp.screen;

  const pickerCols = Math.floor(pickerTexture.width / TILE_SIZE);
  const pickerRows = Math.floor(pickerTexture.height / TILE_SIZE);
  const pickerGrid = generateTileGrid(pickerCols, pickerRows);

  const tilesetSprite = new Sprite(pickerTexture);
  const pickerHover = new Graphics();
  const pickerSelection = new Graphics();

  let pickerPointer: { x: number; y: number } | null = null;
  let selectedTileId: number | null = null;
  // The legend: tile id -> where that tile lives in the tileset.
  const keyDictionary = new Map<number, Tile>();
  const dictionarySwatches = new Map<number, HTMLCanvasElement>();

  pickerApp.stage.on("pointermove", (event: FederatedPointerEvent) => {
    pickerPointer = event.getLocalPosition(picker_container);
  });

  pickerApp.stage.on("pointerdown", () => {
    setMode("pick");
    if (!pickerPointer) return;
    const tile = getTileAtPixel(pickerGrid, pickerPointer.x, pickerPointer.y);
    if (tile) pickTile(tile);
  });

  pickerApp.ticker.add(() => {
    pickerHover.clear();
    if (!pickerPointer) return;
    const hovered = getTileAtPixel(
      pickerGrid,
      pickerPointer.x,
      pickerPointer.y,
    );
    if (!hovered) return;
    pickerHover.rect(hovered.x, hovered.y, TILE_SIZE, TILE_SIZE).stroke({
      color: "white",
      width: 1,
      alignment: 1,
    });
  });

  function selectTile(id: number) {
    selectedTileId = id;
    const tile = keyDictionary.get(id);
    if (tile) {
      pickerSelection.clear();
      pickerSelection.rect(tile.x, tile.y, TILE_SIZE, TILE_SIZE).stroke({
        color: "yellow",
        width: 2,
        alignment: 1,
      });
    }
    for (const [swatchId, swatch] of dictionarySwatches) {
      swatch.classList.toggle("selected", swatchId === id);
    }
  }

  function addToTileDictionary(tile: Tile) {
    if (dictionarySwatches.has(tile.id)) return;

    const swatch = document.createElement("canvas");
    swatch.width = SWATCH_SIZE;
    swatch.height = SWATCH_SIZE;
    swatch.className = "tile-swatch";
    swatch.title = `Tile ${tile.id}`;

    const ctx = swatch.getContext("2d")!;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(
      tilesetImage,
      tile.x,
      tile.y,
      TILE_SIZE,
      TILE_SIZE,
      0,
      0,
      SWATCH_SIZE,
      SWATCH_SIZE,
    );

    swatch.addEventListener("click", () => selectTile(tile.id));

    dictionarySwatches.set(tile.id, swatch);
    tileDictionaryList.appendChild(swatch);
  }

  function pickTile(tile: Tile) {
    keyDictionary.set(tile.id, tile);
    addToTileDictionary(tile);
    selectTile(tile.id);

    console.log("Picked tile", tile.id, keyDictionary.get(tile.id));
  }

  // ----- Draw grid (the map being painted) -----
  const drawGrid = generateTileGrid(25, 25);

  const drawContainer = new Container();
  const placedTilesContainer = new Container();
  const drawHover = new Graphics();

  drawApp.stage.eventMode = "static";
  drawApp.stage.hitArea = drawApp.screen;

  let drawerPointer: { x: number; y: number } | null = null;
  let isDrawing = false;
  let lastDrawnKey: string | null = null;
  // The id map: "col,row" -> the tile stamped there.
  const idMap = new Map<string, PlacedTile>();
  const placedSprites = new Map<string, Sprite>();

  drawApp.stage.on("pointermove", (event: FederatedPointerEvent) => {
    drawerPointer = event.getLocalPosition(drawContainer);
    if (!isDrawing || !drawerPointer) return;
    const tile = getTileAtPixel(drawGrid, drawerPointer.x, drawerPointer.y);
    if (tile) drawOnTile(tile);
  });

  drawApp.stage.on("pointerdown", () => {
    setMode("draw");
    isDrawing = true;
    lastDrawnKey = null;
    if (!drawerPointer) return;
    const tile = getTileAtPixel(drawGrid, drawerPointer.x, drawerPointer.y);
    if (tile) drawOnTile(tile);
  });

  const stopDrawing = () => {
    isDrawing = false;
    lastDrawnKey = null;
  };
  drawApp.stage.on("pointerup", stopDrawing);
  drawApp.stage.on("pointerupoutside", stopDrawing);

  drawApp.ticker.add(() => {
    drawHover.clear();
    if (!drawerPointer) return;
    const hovered = getTileAtPixel(drawGrid, drawerPointer.x, drawerPointer.y);
    if (!hovered) return;
    drawHover.rect(hovered.x, hovered.y, TILE_SIZE, TILE_SIZE).stroke({
      color: "white",
      width: 1,
      alignment: 1,
    });
  });

  function drawOnTile(tile: Tile) {
    if (selectedTileId === null) return; // nothing picked yet
    const source = keyDictionary.get(selectedTileId);
    if (!source) return;

    const key = `${tile.col},${tile.row}`;
    if (key === lastDrawnKey) return; // avoid redundant redraws while dragging
    lastDrawnKey = key;

    idMap.set(key, {
      id: selectedTileId,
      col: tile.col,
      row: tile.row,
      x: tile.x,
      y: tile.y,
    });

    const texture = new Texture({
      source: pickerTexture.source,
      frame: new Rectangle(source.x, source.y, TILE_SIZE, TILE_SIZE),
    });

    let sprite = placedSprites.get(key);
    if (!sprite) {
      sprite = new Sprite(texture);
      sprite.x = tile.x;
      sprite.y = tile.y;
      placedSprites.set(key, sprite);
      placedTilesContainer.addChild(sprite);
    } else {
      sprite.texture = texture;
    }

    console.log("Drew tile", selectedTileId, "at", tile.col, tile.row);
  }

  // ----- Assemble scenes -----
  drawContainer.addChild(placedTilesContainer);
  drawContainer.addChild(drawHover);
  drawApp.stage.addChild(drawContainer);

  pickerApp.stage.addChild(tilesetSprite);
  picker_container.addChild(pickerSelection);
  picker_container.addChild(pickerHover);
  pickerApp.stage.addChild(picker_container);
})();

/*

  Left Click Picker Area
  Set Key with 16x TimeTable Positioning and ID Number
  Left Click Draw Area and Keyyed Tile is Drawn and Assigned to a ID Map
  This ID Map can be exported to a 2D Array that should be drop and use in any language that supports it.
  Of Course ID's will have to be copy and pasted in as well; which will be written for pasting by the tm editor

*/
