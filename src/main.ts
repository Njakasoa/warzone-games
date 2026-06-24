import "./style.css";
import { Game } from "./game.ts";

const game = new Game();
game.start().catch((e) => {
  console.error(e);
  document.getElementById("app")!.innerHTML =
    `<pre style="color:#ff3d77;font-family:monospace;padding:20px">${e}</pre>`;
});
