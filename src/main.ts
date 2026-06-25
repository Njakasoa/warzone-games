// Must run before any PixiJS renderer is created: swaps Pixi's eval-based
// shader/uniform codegen for polyfills, so it works under a CSP without
// 'unsafe-eval'. Keep this the very first import.
import "pixi.js/unsafe-eval";
import "./style.css";
import { Game } from "./game.ts";

const game = new Game();
game.start().catch((e) => {
  console.error(e);
  document.getElementById("app")!.innerHTML =
    `<pre style="color:#ff3d77;font-family:monospace;padding:20px">${e}</pre>`;
});
