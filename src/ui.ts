import { CFG } from "./config.ts";
import { ranking, radiusOf, xpToNext } from "./core/sim.ts";
import type { GameState } from "./core/types.ts";
import type { Upgrade } from "./core/upgrades.ts";
import { sfx } from "./audio.ts";

type El = HTMLElement;
function h(tag: string, props: Record<string, unknown> = {}, ...kids: (El | string)[]): El {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "class") e.className = String(v);
    else if (k.startsWith("on") && typeof v === "function") e.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
    else if (k === "html") e.innerHTML = String(v);
    else e.setAttribute(k, String(v));
  }
  for (const c of kids) e.append(c);
  return e;
}

export interface MenuHandlers {
  onSolo: (name: string, bots: number) => void;
  onOnline: (name: string) => void;
}

export class UI {
  private screen?: El;
  constructor(private root: El) {}

  private clear() { this.screen?.remove(); this.screen = undefined; }
  private mount(el: El) { this.clear(); this.screen = el; this.root.append(el); }

  private name(): string {
    return (localStorage.getItem("wz_name") || "").trim();
  }
  private saveName(n: string) { localStorage.setItem("wz_name", n); }

  showMenu(hx: MenuHandlers) {
    let bots: number = CFG.bots.default;
    const nameInput = h("input", { class: "name", placeholder: "callsign", maxlength: "12", value: this.name() }) as HTMLInputElement;
    const enemyRow = h("div", { class: "row" });
    [4, 5, 6, 7, 8, 9].forEach((n) => {
      const c = h("button", { class: "chip" + (n === bots ? " on" : ""), onclick: () => {
        bots = n; sfx.click();
        enemyRow.querySelectorAll(".chip").forEach((x) => x.classList.remove("on"));
        c.classList.add("on");
      } }, String(n));
      enemyRow.append(c);
    });

    const play = (online: boolean) => {
      const n = nameInput.value.trim() || "Rookie";
      this.saveName(n); sfx.click();
      if (online) hx.onOnline(n); else hx.onSolo(n, bots);
    };

    this.mount(h("div", { class: "screen" },
      h("div", { class: "veil" }),
      h("div", { class: "card" },
        h("div", { class: "brand", html: "WAR<b>ZONE</b>" }),
        h("div", { class: "tag" }, "Grow your swarm. Devour the arena. Be the last orb."),
        h("div", { class: "label" }, "Callsign"),
        nameInput,
        h("div", { class: "label" }, "Enemies"),
        enemyRow,
        h("div", { class: "row", style: "margin-top:22px" },
          h("button", { class: "btn", onclick: () => play(false) }, "PLAY SOLO"),
          h("button", { class: "btn cyan", onclick: () => play(true) }, "PLAY ONLINE"),
        ),
        h("div", { class: "controls-hint", html: "<b>WASD</b> / arrows / drag to move · <b>Space</b> to dash" }),
        h("div", { class: "credits", html: 'Forked from <a href="https://github.com/AgentRateLimit/Orbhold" target="_blank">Orbhold</a> (MIT) · art by Merchant Shade, Arydian, Seikio' }),
      ),
    ));
  }

  // ── HUD ──
  private hud?: {
    timer: El; lb: El; xp: El; stat: El; fx: El; dash: El;
  };
  enterHud(onQuit: () => void) {
    const timer = h("div", { class: "timer" }, "2:00");
    const lb = h("div", { class: "leaderboard" });
    const xp = h("div", { class: "xp-fill" });
    const stat = h("div", { class: "statline" });
    const fx = h("div", { class: "fx-row" });
    const dash = h("div", { class: "dash" }, "DASH");
    const quit = h("div", { class: "iconbtn", onclick: onQuit }, "✕ QUIT");
    this.mount(h("div", { class: "screen hud" },
      h("div", { class: "hud-top" }, timer),
      lb,
      h("div", { class: "statbar" }, h("div", { class: "xp-track" }, xp), stat),
      fx, dash, quit,
    ));
    this.hud = { timer, lb, xp, stat, fx, dash };
  }

  updateHud(state: GameState, selfId: string) {
    if (!this.hud) return;
    const left = Math.max(0, CFG.matchSeconds - state.time);
    const mm = Math.floor(left / 60), ss = Math.floor(left % 60);
    this.hud.timer.textContent = `${mm}:${String(ss).padStart(2, "0")}`;
    this.hud.timer.classList.toggle("low", left <= 15);

    const rank = ranking(state).filter((p) => p.alive || p.id === selfId);
    const me = state.players.get(selfId);
    const myRank = rank.findIndex((p) => p.id === selfId) + 1;
    this.hud.lb.innerHTML = "";
    this.hud.lb.append(h("div", { class: "lb-h" }, `RANK ${myRank || "-"} / ${rank.length}`));
    rank.slice(0, 5).forEach((p, i) => {
      this.hud!.lb.append(h("div", { class: "lb-row" + (p.id === selfId ? " me" : "") },
        h("span", {}, `${i + 1}. ${p.name}`),
        h("span", { class: "sz" }, String(Math.round(p.size))),
      ));
    });

    if (me) {
      const need = xpToNext(me.level);
      this.hud.xp.style.width = `${Math.min(100, (me.xp / need) * 100)}%`;
      this.hud.stat.innerHTML = "";
      this.hud.stat.append(h("span", {}, `LVL ${me.level}`), h("span", {}, `SIZE ${Math.round(me.size)} · R${radiusOf(me.size) | 0}`));
      this.hud.fx.innerHTML = "";
      for (const k of Object.keys(me.fx)) {
        if (["boost", "shield", "frenzy", "magnet"].includes(k)) this.hud.fx.append(h("div", { class: "fx" }, k.toUpperCase()));
      }
      this.hud.dash.classList.toggle("ready", me.dashCd <= 0);
      this.hud.dash.textContent = me.dashCd <= 0 ? "DASH ✓" : `DASH ${me.dashCd.toFixed(1)}`;
    }
  }

  // ── upgrade chooser ──
  private upEl?: El;
  showUpgrades(cards: Upgrade[], onPick: (u: Upgrade) => void) {
    if (this.upEl) return; // one at a time
    const el = h("div", { class: "screen" },
      h("div", { class: "veil" }),
      h("div", { style: "z-index:1;text-align:center" },
        h("div", { class: "brand", style: "font-size:1.4rem", html: "LEVEL <b>UP</b>" }),
        h("div", { class: "tag", style: "margin-bottom:22px" }, "Choose an upgrade"),
        h("div", { class: "upgrades" },
          ...cards.map((u) => h("div", { class: "up", onclick: () => { sfx.click(); el.remove(); this.upEl = undefined; onPick(u); } },
            h("div", { class: "ico" }, u.icon),
            h("div", { class: "nm" }, u.name),
            h("div", { class: "ds" }, u.desc),
          )),
        ),
      ),
    );
    this.upEl = el;
    this.root.append(el);
  }
  get upgradeOpen() { return !!this.upEl; }

  // ── game over ──
  showGameOver(state: GameState, selfId: string, opts: {
    primaryLabel?: string;       // e.g. "PLAY AGAIN" / "REMATCH"
    onPrimary?: () => void;
    waiting?: string;            // shown instead of a primary button (online clients)
    onLeave?: () => void;
  }) {
    const rank = ranking(state);
    const me = state.players.get(selfId);
    const myRank = rank.findIndex((p) => p.id === selfId) + 1;
    const won = myRank === 1;
    const actions: El[] = [];
    if (opts.waiting) actions.push(h("div", { class: "muted" }, opts.waiting));
    else if (opts.onPrimary) actions.push(h("button", { class: "btn", onclick: () => { sfx.click(); opts.onPrimary!(); } }, opts.primaryLabel ?? "PLAY AGAIN"));
    if (opts.onLeave) actions.push(h("button", { class: "btn ghost", onclick: () => { sfx.click(); opts.onLeave!(); } }, "LEAVE"));
    this.mount(h("div", { class: "screen" },
      h("div", { class: "veil" }),
      h("div", { class: "card" },
        h("div", { class: "brand", style: "font-size:2rem", html: won ? "VIC<b>TORY</b>" : "DE<b>FEAT</b>" }),
        h("div", { class: "tag" }, won ? "You ruled the arena." : `You placed #${myRank}.`),
        h("div", { class: "big-num", style: "margin:18px 0" }, `${Math.round(me?.size ?? 0)} mass · ${me?.kills ?? 0} KO`),
        h("div", { style: "margin:10px 0 18px" },
          ...rank.slice(0, 5).map((p, i) => h("div", { class: "result-row" + (p.id === selfId ? " win" : "") },
            h("span", {}, `#${i + 1}  ${p.name}`),
            h("span", { class: "muted" }, `${Math.round(p.size)} · ${p.kills} KO`),
          )),
        ),
        h("div", { class: "row" }, ...actions),
      ),
    ));
  }

  // ── online lobby ──
  showLobby(o: { code: string; isHost: boolean; onStart: () => void; onLeave: () => void }) {
    const count = h("div", { class: "tag" }, "Connecting…");
    const err = h("div", { class: "tag", style: "margin-top:8px;color:#ff6b6b;display:none" });
    this.mount(h("div", { class: "screen" },
      h("div", { class: "veil" }),
      h("div", { class: "card" },
        h("div", { class: "brand", style: "font-size:1.6rem", html: "LOB<b>BY</b>" }),
        h("div", { class: "tag", style: "margin:12px 0" }, "Share this room code with friends"),
        h("div", { class: "code" }, o.code),
        count,
        err,
        h("div", { class: "row", style: "margin-top:22px" },
          o.isHost ? h("button", { class: "btn", onclick: o.onStart }, "START MATCH") : h("div", { class: "muted" }, "Waiting for host to start…"),
          h("button", { class: "btn ghost", onclick: o.onLeave }, "LEAVE"),
        ),
      ),
    ));
    return {
      setCount: (n: number) => (count.textContent = `${n} online`),
      setStatus: (s: string) => (count.textContent = s),
      setError: (s: string) => { err.textContent = s; err.style.display = "block"; },
    };
  }

  toast(msg: string) {
    const t = h("div", { style: "position:absolute;top:64px;left:50%;transform:translateX(-50%);background:var(--panel);border:1px solid var(--line);padding:10px 16px;border-radius:8px;pointer-events:none;font-size:.8rem" }, msg);
    this.root.append(t);
    setTimeout(() => t.remove(), 2200);
  }
}
