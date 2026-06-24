# warzone-games

Browser arena game for `warzone.njakasoa.xyz` — part of the `*.njakasoa.xyz`
constellation. Static front (HTML5 canvas + vanilla JS, zero build), deployed on
**Cloudflare Pages** (push to `main` → auto-deploy).

> **Status:** base import. This is a fork of [Orbhold](https://github.com/AgentRateLimit/Orbhold)
> (MIT) being adapted to the njakasoa stack. Real multiplayer (friends in a room)
> is the next step — see the roadmap.

## Play

- **Move:** WASD / arrow keys
- Collect slimes to grow your squad; collide with rivals to fight
- Win by having the most characters when the timer ends, or be the last standing

## Run locally

No build, no dependencies — serve the folder:

```bash
bunx serve .        # or: python3 -m http.server
```

## Deploy (Cloudflare Pages)

Connect this repo in the Cloudflare dashboard (one time), then every push to
`main` redeploys:

- **Build command:** *(none)*
- **Build output directory:** `/`
- **Production branch:** `main`
- **Custom domain:** `warzone.njakasoa.xyz`

`_headers` carries the security + cache headers (and pre-allows
`wss://api.njakasoa.xyz` for the upcoming multiplayer link).

## Roadmap — real multiplayer

The current build is single-player against bots. Multiplayer between friends
will run over **core-api**'s realtime gateway (already live):

```
warzone.njakasoa.xyz (this client)
        │  wss://api.njakasoa.xyz/rt?token=…
        ▼
core-api  ──  join/leave room  ·  broadcast game state
```

Each match = one room. The client sends inputs / state; the room broadcasts to
peers. For an authoritative server (anti-cheat, server-side simulation), the
game loop moves into a dedicated room handler in core-api.

## Credits & license

Code: MIT — forked from **Orbhold** by Agent247 / SlopGames
(`github.com/AgentRateLimit/Orbhold`). See [LICENSE](./LICENSE).

Art assets (their own licenses, attribution kept in-game):
- *16x16 Puny Characters* — Merchant Shade
- *Simple Wooden Bow and Arrows* — Arydian
- *Itemazing Tileset* — Seikio
