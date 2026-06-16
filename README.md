# A WILD MATCH?! 💘

A self-contained retro (GBA / Pokémon Gen-3 style) mini-game built as a
dating-app icebreaker. Pure HTML/CSS/JS — no build step, no dependencies,
no external or copyrighted assets (sprites are original CSS/SVG pixel-art;
music + SFX are generated chiptune via the Web Audio API).

## The dynamic name

The player's character is named from the URL (uppercased, sanitised, max 12
chars). Both forms work:

- `?name=Sophie`
- `/Sophie`   ← the "slash + name" form

No name → defaults to `TRAINER`. The opponent is always **Wild ROGIER (Lv.200)**.

> Tip: share links **without** a trailing slash (`/Sophie`, not `/Sophie/`).

## The game

- **MATCH** lands the first hit and evolves into **FLIRT**; 3 hits total
  (MATCH + FLIRT × 2) catch ROGIER → **LEVEL UP** → **NEW QUEST**.
- **GHOST / RUN / SWIPE LEFT** never advance the game. They only slowly drain
  the player's HP (and make the wrong buttons turn timid while MATCH glows).
- If her HP reaches 0 she faints → **GAME OVER**, where the `PASS` button flees
  the cursor/touch and only `RETRY` works.

## Run it locally

It's a static site — just serve the folder, e.g.:

```bash
python3 -m http.server 8080
# then open http://localhost:8080/?name=Sophie
```

## Deploy to Vercel

Import this repo into Vercel as a new project:

- **Framework Preset:** Other
- **Build Command:** (none)
- **Output Directory:** (leave default / `.`)

The included `vercel.json` rewrites everything to `index.html`, so pretty links
like `yourdomain.com/Sophie` work. Then add your custom domain in Vercel.

## Files
- `index.html` — markup + all five game states
- `style.css` — GBA aesthetic, animations, responsive (container-query units)
- `game.js` — state machine, dialogue, HP, chiptune music + SFX
- `rogier.png` / `trainer.png` — character sprites (ROGIER and the player)
- `vercel.json` — SPA-style rewrite for clean `/Name` URLs
