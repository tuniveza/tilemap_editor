// description: This example demonstrates how to use a Container to group and manipulate multiple sprites
import {
  Application,
  Assets,
  Container,
  Sprite,
  Graphics,
  FederatedPointerEvent,
} from "pixi.js";

(async () => {
  const draw_canvas = document.getElementById(
    "draw_canvas",
  ) as HTMLCanvasElement;
  const picker_canvas = document.getElementById(
    "picker_canvas",
  ) as HTMLCanvasElement;

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

  // Create and add a container to the draw stage
  const container = new Container();

  drawApp.stage.eventMode = "static";
  drawApp.stage.hitArea = drawApp.screen;

  /*   // Move the container to the center
  container.x = drawApp.screen.width / 2;
  container.y = drawApp.screen.height / 2; */

  const dgraphics = new Graphics();

  let drawerPointer: { x: number; y: number } | null = null;
  drawApp.stage.on("pointermove", (event: FederatedPointerEvent) => {
    drawerPointer = event.getLocalPosition(container);
  });
  // Listen for animate update on drawApp
  drawApp.ticker.add(() => {
    dgraphics.clear();
    if (!drawerPointer) return;

    const dsnappedX = Math.floor(drawerPointer.x / 16) * 16;
    const dsnappedY = Math.floor(drawerPointer.y / 16) * 16;
    dgraphics.rect(dsnappedX, dsnappedY, 16, 16).stroke({
      color: "white",
      width: 1,
      alignment: 1,
    });

    const hoveredTile = getTileAtPixel(
      tileGrid,
      drawerPointer.x,
      drawerPointer.y,
      16,
    );
    if (hoveredTile) drawOnTile(hoveredTile);
  });

  const picker_container = new Container();
  // Simple tile picker
  const pickerTexture = await Assets.load(
    "./src/assets/autumn farm tilemap.png",
  );

  pickerApp.stage.eventMode = "static";
  pickerApp.stage.hitArea = pickerApp.screen;

  const tile = new Sprite(pickerTexture);

  const pgraphics = new Graphics();
  let pickerPointer: { x: number; y: number } | null = null;
  pickerApp.stage.on("pointermove", (event: FederatedPointerEvent) => {
    pickerPointer = event.getLocalPosition(picker_container);
  });

  pickerApp.ticker.add(() => {
    pgraphics.clear();
    if (!pickerPointer) return;
    const snappedX = Math.floor(pickerPointer.x / 16) * 16;
    const snappedY = Math.floor(pickerPointer.y / 16) * 16;
    //console.log("This is snapped x = " + snappedX);
    //console.log("This is snapepd Y = " + snappedY);
    pgraphics.rect(snappedX, snappedY, 16, 16).stroke({
      color: "white",
      width: 1,
      alignment: 1,
    });

    const hoveredTile = getTileAtPixel(
      tileGrid,
      pickerPointer.x,
      pickerPointer.y,
      16,
    );
    if (hoveredTile) pickTile(hoveredTile);
  });
  interface Tile {
    id: number;
    x: number;
    y: number;
    col: number;
    row: number;
  }

  function generateTileGrid(
    cols: number,
    rows: number,
    tileSize: number = 16,
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

  const tileGrid = generateTileGrid(25, 25, 16);

  function getTileAtPixel(
    grid: Tile[][],
    x: number,
    y: number,
    tileSize: number,
  ): Tile | undefined {
    const col = Math.floor(x / tileSize);
    const row = Math.floor(y / tileSize);
    return grid[row]?.[col];
  }

  let toggleMode = false;
  window.addEventListener("keydown", (e: KeyboardEvent) => {
    if (e.code === "Space" && !e.repeat) {
      e.preventDefault();
      toggleMode = !toggleMode;
      console.log("toggle Mode = " + toggleMode);
    }
  });

  function pickTile(tile: Tile) {
    if (toggleMode) return; // only runs in pick mode
    //pickedTiles.push(tile);

    console.log("Picked Tile", tile.id);
  }

  function drawOnTile(tile: Tile) {
    if (!toggleMode) return; // only runs in draw mode
    // ...
    console.log("Draw Tile", tile.id);
  }

  container.addChild(dgraphics);
  drawApp.stage.addChild(container);
  pickerApp.stage.addChild(tile);
  picker_container.addChild(pgraphics);
  pickerApp.stage.addChild(picker_container);
  /*  tile.width = 16;
  tile.height = 16;
  tile.x = 68;
  tile.y = 268; */
})();

/* 

  Left Click Picker Area
  Set Key with 16x TimeTable Positioning and ID Number
  Left Click Draw Area and Keyyed Tile is Drawn and Assigned to a ID Map
  This ID Map can be exported to a 2D Array that should be drop and use in any language that supports it.
  Of Course ID's will have to be copy and pasted in as well; which will be written for pasting by the tm editor

*/
