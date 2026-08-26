// description: Pick tiles from a tileset, then draw them onto a grid
import {
  Application,
  Assets,
  Container,
  Sprite,
  Graphics,
  Texture,
  Rectangle,
  Point,
  FederatedPointerEvent,
  FederatedWheelEvent,
} from "pixi.js";

const TILE_SIZE = 16;
const SWATCH_SIZE = 32;
const EMPTY_TILE_ID = -1;
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 4;

interface PanZoomControls {
  zoomBy: (factor: number) => void;
  resetZoom: () => void;
}

// Mouse-wheel zoom (centered on the cursor) and middle-mouse-button drag to
// pan a canvas/container pair, plus the same zoom driven by buttons (centered
// on the canvas instead). Left-click stays free for picking/drawing.
function enablePanAndZoom(
  app: Application,
  container: Container,
): PanZoomControls {
  const home = { x: container.x, y: container.y, scale: container.scale.x };

  function zoomAt(factor: number, center: Point) {
    const pointer = container.toLocal(center);
    const newScale = Math.min(
      MAX_ZOOM,
      Math.max(MIN_ZOOM, container.scale.x * factor),
    );
    container.scale.set(newScale);
    container.x = center.x - pointer.x * newScale;
    container.y = center.y - pointer.y * newScale;
  }

  function zoomBy(factor: number) {
    zoomAt(factor, new Point(app.screen.width / 2, app.screen.height / 2));
  }

  function resetZoom() {
    container.scale.set(home.scale);
    container.x = home.x;
    container.y = home.y;
  }

  app.stage.on("wheel", (event: FederatedWheelEvent) => {
    const zoomFactor = Math.exp(-event.deltaY * 0.001);
    zoomAt(zoomFactor, event.global);
  });

  let isPanning = false;
  let panStart = { x: 0, y: 0 };
  let containerStart = { x: 0, y: 0 };

  app.stage.on("pointerdown", (event: FederatedPointerEvent) => {
    if (event.button !== 1) return; // middle-mouse drag to pan
    isPanning = true;
    panStart = { x: event.global.x, y: event.global.y };
    containerStart = { x: container.x, y: container.y };
  });

  app.stage.on("pointermove", (event: FederatedPointerEvent) => {
    if (!isPanning) return;
    container.x = containerStart.x + (event.global.x - panStart.x);
    container.y = containerStart.y + (event.global.y - panStart.y);
  });

  const stopPanning = () => {
    isPanning = false;
  };
  app.stage.on("pointerup", stopPanning);
  app.stage.on("pointerupoutside", stopPanning);

  return { zoomBy, resetZoom };
}

interface Tile {
  id: number;
  x: number;
  y: number;
  col: number;
  row: number;
}

// A rectangular block of tiles selected together in the picker, used as a
// single brush - drawing places the whole block at once.
interface TileStamp {
  cols: number;
  rows: number;
  tiles: (Tile | null)[][];
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

// Scales the whole editor uniformly so it always fits inside the window,
// however the window is sized. Pixi's own pointer-coordinate math already
// accounts for a CSS-scaled canvas, so nothing else needs to change.
function fitAppToWindow() {
  const app = document.querySelector<HTMLElement>(".app");
  if (!app) return;
  app.style.transform = "scale(1)";
  const rect = app.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return;

  const statusBarHeight =
    document.getElementById("status-bar")?.getBoundingClientRect().height ?? 0;
  // Extra clearance so the canvas's drop-shadow has room to render instead
  // of visually bleeding onto the status bar right at a flush 0px gap.
  const BOTTOM_CLEARANCE = 24;
  const availableHeight =
    window.innerHeight - statusBarHeight - BOTTOM_CLEARANCE;
  const scale = Math.min(
    window.innerWidth / rect.width,
    availableHeight / rect.height,
  );

  // body centers .app within the FULL window height via flexbox; shift it up
  // so it's actually centered in the space ABOVE the status bar instead,
  // guaranteeing no overlap regardless of window size.
  const naturalCenterY = window.innerHeight / 2;
  const desiredCenterY = availableHeight / 2;
  const shiftY = desiredCenterY - naturalCenterY;
  app.style.transform = `translateY(${shiftY}px) scale(${scale})`;

  // Park the sidebar just to the left of the canvas, vertically centered
  // alongside it, instead of pinned to the page's corner.
  const sidebar = document.querySelector<HTMLElement>(".sidebar");
  const canvasFrame = document.querySelector<HTMLElement>(".canvas-frame");
  if (sidebar && canvasFrame) {
    const canvasRect = canvasFrame.getBoundingClientRect();
    const sidebarRect = sidebar.getBoundingClientRect();
    const gap = 20;
    const left = Math.max(8, canvasRect.left - sidebarRect.width - gap);
    const top = Math.max(
      8,
      canvasRect.top + (canvasRect.height - sidebarRect.height) / 2,
    );
    sidebar.style.left = `${left}px`;
    sidebar.style.top = `${top}px`;
  }
}

let fitScheduled = false;
function scheduleFitAppToWindow() {
  if (fitScheduled) return;
  fitScheduled = true;
  requestAnimationFrame(() => {
    fitScheduled = false;
    fitAppToWindow();
  });
}
window.addEventListener("resize", scheduleFitAppToWindow);

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
    antialias: true,
  });

  const pickerApp = new Application();
  await pickerApp.init({
    canvas: picker_canvas,
    width: 400,
    height: 400,
    background: "crimson",
    antialias: true,
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
  // Nearest-neighbor filtering keeps pixel art crisp when zoomed in instead
  // of going soft/blurry - applies to every Texture sharing this source,
  // including the cropped tiles stamped onto the draw canvas.
  pickerTexture.source.scaleMode = "nearest";

  // A plain <img> of the same source, used to crop thumbnails onto <canvas>
  // elements for the Tile Dictionary panel.
  const tilesetImage = new Image();
  tilesetImage.src = "./src/assets/autumn farm tilemap.png";
  await tilesetImage.decode();

  // ----- Status bar -----
  const statusDictCount = document.getElementById("status-dict-count")!;
  const statusDrawnCount = document.getElementById("status-drawn-count")!;
  const statusSelected = document.getElementById("status-selected")!;
  const statusLastSelected = document.getElementById("status-last-selected")!;
  let lastSelectedTileId: number | null = null;
  const tileNameCache = new Map<number, string>();

  // Average color plus a "detail" score (stddev of pixel brightness) - a
  // flat single-color fill (e.g. plain water or dirt) has near-zero detail,
  // while a busy, textured sprite (e.g. a leaf/bush cluster with an outline)
  // has high detail. That distinction stands in for real shape recognition.
  function analyzeTile(tile: Tile): {
    r: number;
    g: number;
    b: number;
    detail: number;
  } {
    const sampleCanvas = document.createElement("canvas");
    sampleCanvas.width = TILE_SIZE;
    sampleCanvas.height = TILE_SIZE;
    const ctx = sampleCanvas.getContext("2d")!;
    ctx.drawImage(
      tilesetImage,
      tile.x,
      tile.y,
      TILE_SIZE,
      TILE_SIZE,
      0,
      0,
      TILE_SIZE,
      TILE_SIZE,
    );
    const { data } = ctx.getImageData(0, 0, TILE_SIZE, TILE_SIZE);
    let r = 0;
    let g = 0;
    let b = 0;
    let count = 0;
    const brightness: number[] = [];
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] < 16) continue; // skip near-transparent pixels
      r += data[i];
      g += data[i + 1];
      b += data[i + 2];
      brightness.push((data[i] + data[i + 1] + data[i + 2]) / 3);
      count++;
    }
    if (count === 0) return { r: 0, g: 0, b: 0, detail: 0 };
    r /= count;
    g /= count;
    b /= count;
    const mean = brightness.reduce((a, v) => a + v, 0) / count;
    const variance =
      brightness.reduce((a, v) => a + (v - mean) ** 2, 0) / count;
    return { r, g, b, detail: Math.sqrt(variance) };
  }

  function rgbToHsl(
    r: number,
    g: number,
    b: number,
  ): { h: number; s: number; l: number } {
    r /= 255;
    g /= 255;
    b /= 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const l = (max + min) / 2;
    const d = max - min;
    if (d === 0) return { h: 0, s: 0, l };

    const s = d / (1 - Math.abs(2 * l - 1));
    let h = 0;
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
    return { h, s, l };
  }

  // Guesses a friendly name for a tile from its average color and "detail"
  // (see analyzeTile) - a stand-in for real tileset metadata, which pixel
  // art tilesets rarely ship with. Detail lets a busy, textured sprite (say,
  // a leaf/bush cluster) read differently from a flat fill of the same hue.
  function nameTileByColor(tile: Tile): string {
    const { r, g, b, detail } = analyzeTile(tile);
    const { h, s, l } = rgbToHsl(r, g, b);
    const busy = detail > 20;

    if (s < 0.12) {
      if (l > 0.85) return "Snow";
      if (l < 0.3) return busy ? "Rubble" : "Stone";
      return busy ? "Gravel" : "Rock";
    }
    if (l > 0.9) return "Snow";
    if (h < 15 || h >= 345) {
      if (busy) return "Berry Bush";
      return s > 0.4 ? "Brick" : "Clay";
    }
    if (h < 45) {
      if (busy) return "Autumn Leaves";
      return l > 0.55 ? "Sand" : "Soil";
    }
    if (h < 70) return busy ? "Wheat Field" : "Wheat";
    if (h < 140) return busy ? "Leaves" : "Grass";
    if (h < 200) return busy ? "Reeds" : "Water";
    if (h < 250) return busy ? "Rapids" : "Water";
    if (h < 290) return "Stone";
    if (h < 345) return busy ? "Berries" : "Blossom";
    return "Tile";
  }

  function getTileName(tile: Tile): string {
    let name = tileNameCache.get(tile.id);
    if (!name) {
      name = nameTileByColor(tile);
      tileNameCache.set(tile.id, name);
    }
    return name;
  }

  function describeTile(id: number | null): string {
    if (id === null) return "none";
    const tile = keyDictionary.get(id);
    return tile ? `${getTileName(tile)} (#${id})` : `#${id}`;
  }

  function describeSelection(): string {
    if (!currentStamp) return "none";
    if (currentStamp.cols === 1 && currentStamp.rows === 1) {
      return describeTile(currentStamp.tiles[0][0]?.id ?? null);
    }
    return `${currentStamp.cols}×${currentStamp.rows} stamp`;
  }

  function updateStatusBar() {
    statusDictCount.textContent = `Dictionary: ${keyDictionary.size} tile${keyDictionary.size === 1 ? "" : "s"}`;
    statusDrawnCount.textContent = `Drawn: ${idMap.size} tile${idMap.size === 1 ? "" : "s"}`;
    statusSelected.textContent = `Selected: ${describeSelection()}`;
    statusLastSelected.textContent = `Last: ${describeTile(lastSelectedTileId)}`;
    // The status bar's height can change (e.g. text wrapping to a second
    // line), which affects how much room the canvas has to fit in.
    scheduleFitAppToWindow();
  }

  pickerApp.stage.eventMode = "static";
  pickerApp.stage.hitArea = pickerApp.screen;

  const pickerCols = Math.floor(pickerTexture.width / TILE_SIZE);
  const pickerRows = Math.floor(pickerTexture.height / TILE_SIZE);
  const pickerGrid = generateTileGrid(pickerCols, pickerRows);

  const tilesetSprite = new Sprite(pickerTexture);
  const pickerHover = new Graphics();
  const pickerSelection = new Graphics();

  // Center the tileset image in the picker viewport instead of pinning it
  // to the top-left corner. Tile lookups stay correct since they're done in
  // the container's own local space, unaffected by where it sits on stage.
  picker_container.x = (pickerApp.screen.width - pickerTexture.width) / 2;
  picker_container.y = (pickerApp.screen.height - pickerTexture.height) / 2;

  let pickerPointer: { x: number; y: number } | null = null;
  let selectedTileId: number | null = null;
  // The current brush - a rectangular block of tiles (1x1 for a plain click,
  // larger when dragged across the picker) stamped as a unit when drawing.
  let currentStamp: TileStamp | null = null;
  let isPickerSelecting = false;
  let pickerDragStart: Tile | null = null;
  // The legend: tile id -> where that tile lives in the tileset.
  const keyDictionary = new Map<number, Tile>();
  const dictionarySwatches = new Map<number, HTMLElement>();

  pickerApp.stage.on("pointermove", (event: FederatedPointerEvent) => {
    pickerPointer = event.getLocalPosition(picker_container);
  });

  pickerApp.stage.on("pointerdown", (event: FederatedPointerEvent) => {
    if (event.button !== 0) return; // left-click only; middle-click pans
    setMode("pick");
    if (!pickerPointer) return;
    const tile = getTileAtPixel(pickerGrid, pickerPointer.x, pickerPointer.y);
    if (!tile) return;
    isPickerSelecting = true;
    pickerDragStart = tile;
  });

  function registerTile(tile: Tile) {
    keyDictionary.set(tile.id, tile);
    addToTileDictionary(tile);
  }

  // Applies a stamp as the current brush: highlights its footprint in the
  // picker, marks its top-left tile as "selected" for the dictionary/status
  // bar, and remembers whatever was selected before as "last selected".
  function setCurrentStamp(
    stamp: TileStamp,
    rect: { x: number; y: number; w: number; h: number },
    primaryId: number | null,
  ) {
    currentStamp = stamp;
    if (
      primaryId !== null &&
      selectedTileId !== null &&
      selectedTileId !== primaryId
    ) {
      lastSelectedTileId = selectedTileId;
    }
    selectedTileId = primaryId;

    pickerSelection.clear();
    pickerSelection.rect(rect.x, rect.y, rect.w, rect.h).stroke({
      color: "yellow",
      width: 2,
      alignment: 1,
    });
    for (const [swatchId, swatch] of dictionarySwatches) {
      swatch.classList.toggle("selected", swatchId === primaryId);
    }
    updateStatusBar();
  }

  function finishPickerSelection() {
    if (!isPickerSelecting || !pickerDragStart) {
      isPickerSelecting = false;
      return;
    }
    isPickerSelecting = false;
    const end =
      (pickerPointer &&
        getTileAtPixel(pickerGrid, pickerPointer.x, pickerPointer.y)) ||
      pickerDragStart;

    const minCol = Math.min(pickerDragStart.col, end.col);
    const maxCol = Math.max(pickerDragStart.col, end.col);
    const minRow = Math.min(pickerDragStart.row, end.row);
    const maxRow = Math.max(pickerDragStart.row, end.row);
    const cols = maxCol - minCol + 1;
    const rows = maxRow - minRow + 1;

    const tiles: (Tile | null)[][] = [];
    for (let r = 0; r < rows; r++) {
      const rowTiles: (Tile | null)[] = [];
      for (let c = 0; c < cols; c++) {
        const tile = pickerGrid[minRow + r]?.[minCol + c] ?? null;
        rowTiles.push(tile);
        if (tile) registerTile(tile);
      }
      tiles.push(rowTiles);
    }

    setCurrentStamp(
      { cols, rows, tiles },
      {
        x: minCol * TILE_SIZE,
        y: minRow * TILE_SIZE,
        w: cols * TILE_SIZE,
        h: rows * TILE_SIZE,
      },
      tiles[0][0]?.id ?? null,
    );
    pickerDragStart = null;
  }
  pickerApp.stage.on("pointerup", finishPickerSelection);
  pickerApp.stage.on("pointerupoutside", finishPickerSelection);

  pickerApp.ticker.add(() => {
    pickerHover.clear();
    if (!pickerPointer) return;
    const hovered = getTileAtPixel(
      pickerGrid,
      pickerPointer.x,
      pickerPointer.y,
    );
    if (!hovered) return;

    if (isPickerSelecting && pickerDragStart) {
      const minCol = Math.min(pickerDragStart.col, hovered.col);
      const maxCol = Math.max(pickerDragStart.col, hovered.col);
      const minRow = Math.min(pickerDragStart.row, hovered.row);
      const maxRow = Math.max(pickerDragStart.row, hovered.row);
      pickerHover
        .rect(
          minCol * TILE_SIZE,
          minRow * TILE_SIZE,
          (maxCol - minCol + 1) * TILE_SIZE,
          (maxRow - minRow + 1) * TILE_SIZE,
        )
        .stroke({ color: "white", width: 1, alignment: 1 });
    } else {
      pickerHover.rect(hovered.x, hovered.y, TILE_SIZE, TILE_SIZE).stroke({
        color: "white",
        width: 1,
        alignment: 1,
      });
    }
  });

  // Selecting a single tile (dictionary click or a 1-4 hotkey) is just a 1x1
  // stamp - the same brush machinery as a picker drag, only smaller.
  function selectTile(id: number) {
    const tile = keyDictionary.get(id);
    if (!tile) return;
    setCurrentStamp(
      { cols: 1, rows: 1, tiles: [[tile]] },
      { x: tile.x, y: tile.y, w: TILE_SIZE, h: TILE_SIZE },
      id,
    );
  }

  function deselectTile() {
    if (selectedTileId !== null) lastSelectedTileId = selectedTileId;
    selectedTileId = null;
    currentStamp = null;
    pickerSelection.clear();
    for (const swatch of dictionarySwatches.values()) {
      swatch.classList.remove("selected");
    }
    updateStatusBar();
  }

  // Every picked tile stays visible in the (scrollable) dictionary - number
  // keys 1-4 always select the first four, matching their badges.
  function updateDictionaryBadges() {
    [...dictionarySwatches.entries()].forEach(([, swatch], index) => {
      if (index < 4) swatch.dataset.badge = String(index + 1);
      else delete swatch.dataset.badge;
    });
  }

  // Escape clears the current brush.
  window.addEventListener("keydown", (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      deselectTile();
      return;
    }
    if (event.key >= "1" && event.key <= "4") {
      const index = Number(event.key) - 1;
      const id = [...dictionarySwatches.keys()][index];
      if (id !== undefined) selectTile(id);
    }
  });

  function renderTileSwatch(
    tile: Tile,
    onSelect: (id: number) => void,
  ): HTMLElement {
    // A wrapper (rather than a bare <canvas>) so a number badge can be drawn
    // with ::after - canvas elements can't render pseudo-element content.
    const wrapper = document.createElement("div");
    wrapper.className = "tile-swatch";
    wrapper.title = `Tile ${tile.id}`;

    const canvas = document.createElement("canvas");
    canvas.width = SWATCH_SIZE;
    canvas.height = SWATCH_SIZE;

    const ctx = canvas.getContext("2d")!;
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

    wrapper.appendChild(canvas);
    wrapper.addEventListener("click", () => onSelect(tile.id));
    return wrapper;
  }

  function addToTileDictionary(tile: Tile) {
    if (dictionarySwatches.has(tile.id)) return;

    const swatch = renderTileSwatch(tile, selectTile);
    dictionarySwatches.set(tile.id, swatch);
    tileDictionaryList.appendChild(swatch);
    updateDictionaryBadges();
    scheduleFitAppToWindow(); // the panel may have grown, resettling layout
  }

  // ----- Draw grid (the map being painted) -----
  const drawGrid = generateTileGrid(25, 25);

  const drawContainer = new Container();
  const placedTilesContainer = new Container();
  const gridOverlay = new Graphics();
  const drawHover = new Graphics();

  drawApp.stage.eventMode = "static";
  drawApp.stage.hitArea = drawApp.screen;

  // ----- Grid-line overlay (purely visual, optional) -----
  type GridStyle = "off" | "solid" | "dashed" | "dotted" | "squares";
  const GRID_STYLES: GridStyle[] = [
    "off",
    "solid",
    "dashed",
    "dotted",
    "squares",
  ];
  let gridStyle: GridStyle = "off";
  const GRID_EXTENT = drawGrid.length * TILE_SIZE;

  function drawDashedSegment(
    g: Graphics,
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    dash: number,
    gap: number,
  ) {
    const length = Math.hypot(x2 - x1, y2 - y1);
    const dirX = (x2 - x1) / length;
    const dirY = (y2 - y1) / length;
    let traveled = 0;
    while (traveled < length) {
      const start = traveled;
      const end = Math.min(traveled + dash, length);
      g.moveTo(x1 + dirX * start, y1 + dirY * start);
      g.lineTo(x1 + dirX * end, y1 + dirY * end);
      traveled += dash + gap;
    }
  }

  function drawDottedSegment(
    g: Graphics,
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    spacing: number,
    round: boolean,
  ) {
    const length = Math.hypot(x2 - x1, y2 - y1);
    const dirX = (x2 - x1) / length;
    const dirY = (y2 - y1) / length;
    const dotSize = 1.4;
    for (let d = 0; d <= length; d += spacing) {
      const cx = x1 + dirX * d;
      const cy = y1 + dirY * d;
      if (round) {
        g.circle(cx, cy, dotSize / 2);
      } else {
        g.rect(cx - dotSize / 2, cy - dotSize / 2, dotSize, dotSize);
      }
    }
  }

  function drawGridOverlay() {
    gridOverlay.clear();
    if (gridStyle === "off") return;

    const lineCount = drawGrid.length + 1;
    if (gridStyle === "dotted" || gridStyle === "squares") {
      const round = gridStyle === "dotted";
      for (let i = 0; i < lineCount; i++) {
        const pos = i * TILE_SIZE;
        drawDottedSegment(gridOverlay, pos, 0, pos, GRID_EXTENT, 4, round);
        drawDottedSegment(gridOverlay, 0, pos, GRID_EXTENT, pos, 4, round);
      }
      gridOverlay.fill({ color: "white", alpha: 0.4 });
      return;
    }

    for (let i = 0; i < lineCount; i++) {
      const pos = i * TILE_SIZE;
      if (gridStyle === "dashed") {
        drawDashedSegment(gridOverlay, pos, 0, pos, GRID_EXTENT, 4, 3);
        drawDashedSegment(gridOverlay, 0, pos, GRID_EXTENT, pos, 4, 3);
      } else {
        gridOverlay.moveTo(pos, 0).lineTo(pos, GRID_EXTENT);
        gridOverlay.moveTo(0, pos).lineTo(GRID_EXTENT, pos);
      }
    }
    gridOverlay.stroke({ color: "white", width: 1, alpha: 0.4 });
  }

  const gridToggleBtn = document.getElementById("grid-toggle-btn")!;
  gridToggleBtn.addEventListener("click", () => {
    const nextIndex = (GRID_STYLES.indexOf(gridStyle) + 1) % GRID_STYLES.length;
    gridStyle = GRID_STYLES[nextIndex];
    const label = gridStyle[0].toUpperCase() + gridStyle.slice(1);
    gridToggleBtn.textContent = `Grid: ${label}`;
    gridToggleBtn.classList.toggle("grid-active", gridStyle !== "off");
    drawGridOverlay();
  });

  let drawerPointer: { x: number; y: number } | null = null;
  let isDrawing = false;
  let isErasing = false;
  let lastDrawnKey: string | null = null;
  let lastErasedKey: string | null = null;
  // The id map: "col,row" -> the tile stamped there.
  const idMap = new Map<string, PlacedTile>();
  const placedSprites = new Map<string, Sprite>();

  // Right-click erases instead of opening the browser's context menu.
  draw_canvas.addEventListener("contextmenu", (event) => {
    event.preventDefault();
  });

  drawApp.stage.on("pointermove", (event: FederatedPointerEvent) => {
    drawerPointer = event.getLocalPosition(drawContainer);
    if (!drawerPointer) return;
    const tile = getTileAtPixel(drawGrid, drawerPointer.x, drawerPointer.y);
    if (!tile) return;
    if (isDrawing) drawOnTile(tile);
    if (isErasing) eraseTile(tile);
  });

  drawApp.stage.on("pointerdown", (event: FederatedPointerEvent) => {
    if (event.button === 2) {
      setMode("draw");
      isErasing = true;
      lastErasedKey = null;
      if (!drawerPointer) return;
      const tile = getTileAtPixel(drawGrid, drawerPointer.x, drawerPointer.y);
      if (tile) eraseTile(tile);
      return;
    }
    if (event.button !== 0) return; // left-click only; middle-click pans
    setMode("draw");
    isDrawing = true;
    lastDrawnKey = null;
    if (!drawerPointer) return;
    const tile = getTileAtPixel(drawGrid, drawerPointer.x, drawerPointer.y);
    if (tile) drawOnTile(tile);
  });

  const stopDrawing = () => {
    isDrawing = false;
    isErasing = false;
    lastDrawnKey = null;
    lastErasedKey = null;
  };
  drawApp.stage.on("pointerup", stopDrawing);
  drawApp.stage.on("pointerupoutside", stopDrawing);

  drawApp.ticker.add(() => {
    drawHover.clear();
    if (!drawerPointer) return;
    const hovered = getTileAtPixel(drawGrid, drawerPointer.x, drawerPointer.y);
    if (!hovered) return;
    const cols = currentStamp?.cols ?? 1;
    const rows = currentStamp?.rows ?? 1;
    drawHover
      .rect(hovered.x, hovered.y, cols * TILE_SIZE, rows * TILE_SIZE)
      .stroke({
        color: "white",
        width: 1,
        alignment: 1,
      });
  });

  // Stamps the whole current-brush block onto the grid, anchored at
  // anchorTile's top-left corner - each sub-tile becomes its own idMap
  // entry, so the export/2D-array logic needs no special-casing for it.
  function drawOnTile(anchorTile: Tile) {
    if (!currentStamp) return; // nothing picked yet

    const key = `${anchorTile.col},${anchorTile.row}`;
    if (key === lastDrawnKey) return; // avoid redundant redraws while dragging
    lastDrawnKey = key;

    for (let r = 0; r < currentStamp.rows; r++) {
      for (let c = 0; c < currentStamp.cols; c++) {
        const source = currentStamp.tiles[r][c];
        if (!source) continue;

        const targetCol = anchorTile.col + c;
        const targetRow = anchorTile.row + r;
        const targetTile = drawGrid[targetRow]?.[targetCol];
        if (!targetTile) continue; // past the edge of the draw grid

        const cellKey = `${targetCol},${targetRow}`;
        idMap.set(cellKey, {
          id: source.id,
          col: targetCol,
          row: targetRow,
          x: targetTile.x,
          y: targetTile.y,
        });

        const texture = new Texture({
          source: pickerTexture.source,
          frame: new Rectangle(source.x, source.y, TILE_SIZE, TILE_SIZE),
        });

        let sprite = placedSprites.get(cellKey);
        if (!sprite) {
          sprite = new Sprite(texture);
          sprite.x = targetTile.x;
          sprite.y = targetTile.y;
          placedSprites.set(cellKey, sprite);
          placedTilesContainer.addChild(sprite);
        } else {
          sprite.texture = texture;
        }
      }
    }

    updateStatusBar();
    console.log(
      "Stamped",
      currentStamp.cols,
      "x",
      currentStamp.rows,
      "at",
      anchorTile.col,
      anchorTile.row,
    );
  }

  function eraseTile(tile: Tile) {
    const key = `${tile.col},${tile.row}`;
    if (key === lastErasedKey) return; // avoid redundant work while dragging
    lastErasedKey = key;
    if (!idMap.has(key)) return;

    idMap.delete(key);
    const sprite = placedSprites.get(key);
    if (sprite) {
      placedTilesContainer.removeChild(sprite);
      sprite.destroy();
      placedSprites.delete(key);
    }

    updateStatusBar();
    console.log("Erased tile at", tile.col, tile.row);
  }

  // ----- Export -----
  type ExportLanguage = "lua" | "c" | "ruby" | "csharp";

  function sortedDictionary(): Tile[] {
    return [...keyDictionary.values()].sort((a, b) => a.id - b.id);
  }

  function buildTilemapGrid(): number[][] {
    return drawGrid.map((row) =>
      row.map(
        (tile) => idMap.get(`${tile.col},${tile.row}`)?.id ?? EMPTY_TILE_ID,
      ),
    );
  }

  function generateLua(): string {
    const dictLines = sortedDictionary()
      .map(
        (t) =>
          `  [${t.id}] = { col = ${t.col}, row = ${t.row}, x = ${t.x}, y = ${t.y} },`,
      )
      .join("\n");
    const gridLines = buildTilemapGrid()
      .map((row) => `    { ${row.join(", ")} },`)
      .join("\n");

    return [
      "-- Tile dictionary: tile id -> position in the source tileset",
      "tileDictionary = {",
      dictLines,
      "}",
      "",
      `-- Tilemap: rows of tile ids, ${EMPTY_TILE_ID} = empty`,
      "tilemap = {",
      gridLines,
      "}",
    ].join("\n");
  }

  function generateC(): string {
    const dict = sortedDictionary();
    const grid = buildTilemapGrid();
    const rows = grid.length;
    const cols = grid[0]?.length ?? 0;

    const dictLines = dict
      .map((t) => `    { ${t.id}, ${t.col}, ${t.row}, ${t.x}, ${t.y} },`)
      .join("\n");
    const gridLines = grid
      .map((row) => `    { ${row.join(", ")} },`)
      .join("\n");

    return [
      "/* Tile dictionary: tile id -> position in the source tileset */",
      "typedef struct { int id; int col; int row; int x; int y; } TileInfo;",
      `TileInfo tileDictionary[${dict.length}] = {`,
      dictLines,
      "};",
      "",
      `/* Tilemap: rows of tile ids, ${EMPTY_TILE_ID} = empty */`,
      `#define TILEMAP_ROWS ${rows}`,
      `#define TILEMAP_COLS ${cols}`,
      "int tilemap[TILEMAP_ROWS][TILEMAP_COLS] = {",
      gridLines,
      "};",
    ].join("\n");
  }

  function generateRuby(): string {
    const dictLines = sortedDictionary()
      .map(
        (t) =>
          `  ${t.id} => { col: ${t.col}, row: ${t.row}, x: ${t.x}, y: ${t.y} },`,
      )
      .join("\n");
    const gridLines = buildTilemapGrid()
      .map((row) => `  [${row.join(", ")}],`)
      .join("\n");

    return [
      "# Tile dictionary: tile id -> position in the source tileset",
      "tile_dictionary = {",
      dictLines,
      "}",
      "",
      `# Tilemap: rows of tile ids, ${EMPTY_TILE_ID} = empty`,
      "tilemap = [",
      gridLines,
      "]",
    ].join("\n");
  }

  function generateCSharp(): string {
    const grid = buildTilemapGrid();
    const rows = grid.length;
    const cols = grid[0]?.length ?? 0;

    const dictLines = sortedDictionary()
      .map(
        (t) =>
          `        { ${t.id}, new TileInfo { Id = ${t.id}, Col = ${t.col}, Row = ${t.row}, X = ${t.x}, Y = ${t.y} } },`,
      )
      .join("\n");
    const gridLines = grid
      .map((row) => `        { ${row.join(", ")} },`)
      .join("\n");

    return [
      "// Tile dictionary: tile id -> position in the source tileset",
      "public class TileInfo { public int Id, Col, Row, X, Y; }",
      "",
      "public static readonly Dictionary<int, TileInfo> TileDictionary = new Dictionary<int, TileInfo> {",
      dictLines,
      "};",
      "",
      `// Tilemap: rows of tile ids, ${EMPTY_TILE_ID} = empty`,
      `public static readonly int[,] Tilemap = new int[${rows}, ${cols}] {`,
      gridLines,
      "};",
    ].join("\n");
  }

  const EXPORT_CONFIG: Record<
    ExportLanguage,
    { label: string; extension: string; generate: () => string }
  > = {
    lua: { label: "Lua", extension: "lua", generate: generateLua },
    c: { label: "C", extension: "c", generate: generateC },
    ruby: { label: "Ruby", extension: "rb", generate: generateRuby },
    csharp: { label: "C#", extension: "cs", generate: generateCSharp },
  };

  const exportBtn = document.getElementById("export-btn")!;
  const exportLanguageSelect = document.getElementById(
    "export-language",
  ) as HTMLSelectElement;
  const exportModal = document.getElementById("export-modal")!;
  const exportModalLang = document.getElementById("export-modal-lang")!;
  const exportOutput = document.getElementById(
    "export-output",
  ) as HTMLTextAreaElement;
  const exportCopyBtn = document.getElementById("export-copy-btn")!;
  const exportDownloadBtn = document.getElementById("export-download-btn")!;
  const exportCloseBtn = document.getElementById("export-modal-close")!;

  let currentExportLanguage: ExportLanguage = "lua";

  exportBtn.addEventListener("click", () => {
    currentExportLanguage = exportLanguageSelect.value as ExportLanguage;
    const config = EXPORT_CONFIG[currentExportLanguage];
    exportOutput.value = config.generate();
    exportModalLang.textContent = config.label;
    exportModal.classList.remove("hidden");
  });

  exportCloseBtn.addEventListener("click", () => {
    exportModal.classList.add("hidden");
  });

  exportModal.addEventListener("click", (event) => {
    if (event.target === exportModal) exportModal.classList.add("hidden");
  });

  exportCopyBtn.addEventListener("click", () => {
    void navigator.clipboard.writeText(exportOutput.value);
  });

  exportDownloadBtn.addEventListener("click", () => {
    const config = EXPORT_CONFIG[currentExportLanguage];
    const blob = new Blob([exportOutput.value], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `tilemap.${config.extension}`;
    link.click();
    URL.revokeObjectURL(url);
  });

  // ----- Assemble scenes -----
  drawContainer.addChild(placedTilesContainer);
  drawContainer.addChild(gridOverlay);
  drawContainer.addChild(drawHover);
  drawApp.stage.addChild(drawContainer);

  picker_container.addChild(tilesetSprite);
  picker_container.addChild(pickerSelection);
  picker_container.addChild(pickerHover);
  pickerApp.stage.addChild(picker_container);

  const drawZoom = enablePanAndZoom(drawApp, drawContainer);
  const pickerZoom = enablePanAndZoom(pickerApp, picker_container);

  const ZOOM_STEP = 1.25;
  document
    .getElementById("draw-zoom-in")!
    .addEventListener("click", () => drawZoom.zoomBy(ZOOM_STEP));
  document
    .getElementById("draw-zoom-out")!
    .addEventListener("click", () => drawZoom.zoomBy(1 / ZOOM_STEP));
  document
    .getElementById("draw-zoom-reset")!
    .addEventListener("click", () => drawZoom.resetZoom());
  document
    .getElementById("picker-zoom-in")!
    .addEventListener("click", () => pickerZoom.zoomBy(ZOOM_STEP));
  document
    .getElementById("picker-zoom-out")!
    .addEventListener("click", () => pickerZoom.zoomBy(1 / ZOOM_STEP));
  document
    .getElementById("picker-zoom-reset")!
    .addEventListener("click", () => pickerZoom.resetZoom());

  updateStatusBar();
  fitAppToWindow();
})();

/*

  Left Click Picker Area
  Set Key with 16x TimeTable Positioning and ID Number
  Left Click Draw Area and Keyyed Tile is Drawn and Assigned to a ID Map
  This ID Map can be exported to a 2D Array that should be drop and use in any language that supports it.
  Of Course ID's will have to be copy and pasted in as well; which will be written for pasting by the tm editor

*/
