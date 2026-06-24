# warzone-games

Neon arena `.io` game for **warzone.njakasoa.xyz** — part of the
`*.njakasoa.xyz` constellation. Grow your orb by devouring slimes, eat rivals,
grab power-ups, level up and stack roguelite upgrades. Last orb standing — or
biggest when the timer ends — wins.

Built with **Vite + TypeScript + PixiJS** (WebGL). Modernized fork of
[Orbhold](https://github.com/AgentRateLimit/Orbhold) (MIT).

## Features

- **Modern stack** — PixiJS v8 renderer, neon glow + particles + camera, Vite/TS.
- **Upgrades** — level up → pick 1 of 3 cards (speed, magnet, greed, armor…).
- **Power-ups** — map pickups: boost, shield, frenzy, magnet.
- **Procedural audio** — WebAudio SFX, zero audio assets to ship.
- **Multiplayer-ready** — a `NetGame` transport abstraction. Solo runs locally;
  online is a host-authoritative swap over **core-api**'s realtime gateway
  (`wss://api.njakasoa.xyz/rt`). See [src/net](./src/net).

## Controls

**WASD** / arrows / drag to move · **Space** to dash.

## Develop

```bash
bun install
bun run dev       # http://localhost:5173
bun run build     # type-check + bundle → dist/
```

## Deploy (Cloudflare Pages)

Connect this repo in the dashboard once, then every push to `main` redeploys:

- **Framework preset:** Vite
- **Build command:** `bun run build` (or `npm run build`)
- **Build output directory:** `dist`
- **Custom domain:** `warzone.njakasoa.xyz`

`public/_headers` ships the security/cache headers and pre-allows
`https://api.njakasoa.xyz` + `wss://api.njakasoa.xyz` for online play.

## Multiplayer

Online play needs a guest token from core-api (`POST /v1/auth/guest`, shipped in
the companion core-api PR) so the browser can open `/rt` without an account.
Each match is one room (host-authoritative): the host simulates and broadcasts
snapshots ~15 Hz; clients send inputs ~30 Hz and render the authoritative state.
`src/net/transport.ts` (`LocalTransport` / `RealtimeTransport`) holds it all;
the game loop never knows which is running.

## Layout

```
src/
  core/      framework-agnostic simulation (sim, rng, types, upgrades)
  net/       transport abstraction (local + realtime) + online connect
  render/    PixiJS world renderer (orbs, particles, camera)
  ui.ts      DOM overlay (menu, HUD, upgrade cards, lobby, game over)
  input.ts   keyboard + pointer steering
  audio.ts   procedural WebAudio SFX
  game.ts    orchestrator (loop, events → sfx/fx, level-ups)
legacy/      the original vanilla Orbhold (reference)
```

## Credits & license

MIT — forked from **Orbhold** by Agent247 / SlopGames. See [LICENSE](./LICENSE).
Art assets (own licenses, attribution kept in-game): *16x16 Puny Characters* by
Merchant Shade, *Simple Wooden Bow and Arrows* by Arydian, *Itemazing Tileset*
by Seikio.
