/* ============================================================
   A WILD MATCH?!  ·  ROGIER Studios 2026
   GBA-style state machine. Vanilla JS, zero dependencies.

   Design / joke: the only moves with any real effect are the
   ones that lead to ROGIER. GHOST, RUN and SWIPE LEFT never
   advance the game — they just slowly drain HER HP (she's "losing"
   by running from love). If her HP ever hits 0 she faints and the
   GAME OVER screen appears, where the PASS button flees the cursor
   and only RETRY works. MATCH is the one true path to victory.
   ============================================================ */
(() => {
  "use strict";

  /* ---------- 1. DYNAMIC NAME (parsed at the very top) ----------
     Works at any mount point:
       ?name=Sophie  ·  /Sophie  ·  /pokemon/Sophie               */
  function resolveName() {
    const params = new URLSearchParams(location.search);
    let raw = params.get("name") || params.get("n") || "";
    if (!raw) {
      const seg = decodeURIComponent(location.pathname.split("/").filter(Boolean).pop() || "");
      if (seg && !/^(index\.html?|pokemon|game)$/i.test(seg)) raw = seg;
    }
    const clean = raw.replace(/[^a-zA-Z0-9 ]/g, "").trim().slice(0, 12).toUpperCase();
    return clean || "TRAINER";
  }
  const NAME = resolveName();

  /* ---------- DOM ---------- */
  const $ = (s) => document.querySelector(s);
  const screen       = $("#screen");
  const states = {
    title: $("#state-title"), battle: $("#state-battle"), over: $("#state-over"),
    levelup: $("#state-levelup"), quest: $("#state-quest"),
  };
  const dialogue     = $("#dialogue");
  const dialogueText = $("#dialogue-text");
  const cursor       = $("#dialogue-cursor");
  const menu         = $("#menu");
  const flash        = $("#flash");
  const fade         = $("#fade");
  const sparkles     = $("#sparkles");
  const hpPlayer     = $("#hp-player");
  const hpPlayerNum  = $("#hp-player-num");
  const hpFoe        = $("#hp-foe");
  const spriteFoe    = $("#sprite-foe");
  const spritePlayer = $("#sprite-player");
  const btnStart     = $("#btn-start");
  const btnRetry     = $("#btn-retry");
  const btnPass      = $("#btn-pass");
  const btnAgain     = $("#btn-again");
  const soundToggle  = $("#sound-toggle");
  const actionBtns   = [...document.querySelectorAll(".btn--action")];
  const btnMatch     = $(".act-match");

  // inject the dynamic name
  $("#player-name-box").textContent = NAME;
  $("#title-name").textContent = NAME === "TRAINER" ? "you" : NAME;
  $("#lvl-header").textContent = NAME + " leveled up!";

  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const sleep = (ms) => new Promise((r) => setTimeout(r, reduced ? Math.min(ms, 60) : ms));
  const rand = (a, b) => Math.round(a + Math.random() * (b - a));

  /* ---------- 2. AUDIO (chiptune, generated, never autoplay) ---------- */
  let actx = null;
  let master = null;            // master gain — lets us kill ALL scheduled sound at once
  let muted = localStorage.getItem("rs_muted") === "1";
  soundToggle.classList.toggle("is-muted", muted);

  function ensureAudio() {
    if (!actx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) {
        actx = new AC();
        master = actx.createGain();
        master.gain.value = muted ? 0 : 1;
        master.connect(actx.destination);
      }
    }
    if (actx && actx.state === "suspended") actx.resume();
  }
  // schedule one note at an absolute AudioContext time
  function noteAt(freq, dur, type, vol, at) {
    if (!actx) return;
    const o = actx.createOscillator();
    const g = actx.createGain();
    o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(vol, at + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    o.connect(g).connect(master || actx.destination);
    o.start(at); o.stop(at + dur + 0.02);
  }
  function tone(freq, dur, type = "square", vol = 0.04, when = 0) {
    if (muted || !actx) return;
    noteAt(freq, dur, type, vol, actx.currentTime + when);
  }
  function sfx(kind) {
    if (muted) return;
    ensureAudio();
    switch (kind) {
      case "type":   tone(640, 0.02, "square", 0.010); break;
      case "select": tone(880, 0.07, "square", 0.05); break;
      case "deny":   tone(220, 0.10, "square", 0.05); tone(165, 0.12, "square", 0.04, 0.05); break;
      case "hit":    tone(150, 0.18, "sawtooth", 0.06); tone(90, 0.2, "square", 0.04); break;
      case "drain":  tone(420, 0.06, "square", 0.03); break;
      case "level":  tone(700, 0.10, "square", 0.05); break;
    }
  }
  function jingle(notes) {
    if (muted) return;
    ensureAudio();
    (notes || [523, 659, 784, 1047, 1319]).forEach((f, i) => tone(f, 0.16, "square", 0.05, i * 0.11));
  }
  // Cheerful original victory fanfare (C-major) — plays when she wins.
  function playVictory() {
    if (muted) return;
    ensureAudio();
    if (!actx) return;
    const t = actx.currentTime + 0.05;
    const s = 0.15;                       // beat length
    // [freq, startBeat, lengthBeats]
    const song = [
      [784, 0, 0.5], [784, 0.5, 0.5], [784, 1, 0.5],   // G G G  pickup
      [1047, 1.5, 1.5],                                // C
      [1319, 3, 1],                                    // E
      [1568, 4, 1.5],                                  // G  (peak)
      [1319, 5.5, 0.5], [1568, 6, 0.5],                // E G
      [2093, 6.5, 2],                                  // high C finish
    ];
    song.forEach(([f, b, d]) => {
      noteAt(f, s * d * 1.5, "square", 0.05, t + b * s);          // lead
      noteAt(f / 2, s * d * 1.5, "triangle", 0.045, t + b * s);   // octave-down warmth
    });
    // sparkly arpeggio tail
    [1047, 1319, 1568, 2093].forEach((f, i) =>
      noteAt(f, 0.11, "square", 0.035, t + (8.5 + i * 0.45) * s));
  }

  /* ----- looping chiptune battle theme (original composition) ----- */
  const BPM = 150;
  const SPB = 60 / BPM;            // seconds per beat
  const LOOP_BEATS = 16;
  const LOOP_LEN = LOOP_BEATS * SPB;
  // quarter-note lead melody  [beat, freq]
  const LEAD = [
    [0, 659], [1, 880], [2, 784], [3, 659],
    [4, 587], [5, 784], [6, 698], [7, 587],
    [8, 523], [9, 698], [10, 659], [11, 523],
    [12, 494], [13, 659], [14, 587], [15, 494],
  ];
  // driving eighth-note bass; root changes per bar (Am · G · F · E)
  const BASS_ROOTS = [110, 98, 87, 82];
  let musicOn = false, musicTimer = null, nextLoopAt = 0;

  function scheduleLoop(at) {
    LEAD.forEach(([b, f]) => noteAt(f, SPB * 0.85, "square", 0.030, at + b * SPB));
    for (let i = 0; i < LOOP_BEATS * 2; i++) {
      const root = BASS_ROOTS[Math.floor((i / 2) / 4)];
      noteAt(root, SPB * 0.45, "triangle", 0.045, at + i * 0.5 * SPB);
    }
  }
  function startMusic() {
    if (musicOn || muted) return;
    ensureAudio();
    if (!actx) return;
    musicOn = true;
    nextLoopAt = actx.currentTime + 0.12;
    const tick = () => {
      if (!musicOn) return;
      scheduleLoop(nextLoopAt);
      nextLoopAt += LOOP_LEN;
      musicTimer = setTimeout(tick, LOOP_LEN * 1000 - 60);
    };
    tick();
  }
  function stopMusic() {
    musicOn = false;
    clearTimeout(musicTimer);
  }

  soundToggle.addEventListener("click", () => {
    muted = !muted;
    localStorage.setItem("rs_muted", muted ? "1" : "0");
    soundToggle.classList.toggle("is-muted", muted);
    if (muted) {
      stopMusic();
      if (actx && master) {                 // silence everything already scheduled, instantly
        const now = actx.currentTime;
        master.gain.cancelScheduledValues(now);
        master.gain.setValueAtTime(master.gain.value, now);
        master.gain.linearRampToValueAtTime(0.0001, now + 0.02);
      }
    } else {
      ensureAudio();
      if (actx && master) {
        const now = actx.currentTime;
        master.gain.cancelScheduledValues(now);
        master.gain.setValueAtTime(1, now);
      }
      tone(880, 0.08);
      if (states.battle.classList.contains("is-active")) startMusic();
    }
  });

  /* ---------- State switching ---------- */
  function gotoState(name) {
    Object.entries(states).forEach(([key, el]) => {
      const active = key === name;
      el.classList.toggle("is-active", active);
      el.setAttribute("aria-hidden", active ? "false" : "true");
    });
  }

  /* ---------- FX helpers ---------- */
  function shake() {
    screen.classList.remove("is-shaking");
    void screen.offsetWidth;
    screen.classList.add("is-shaking");
    setTimeout(() => screen.classList.remove("is-shaking"), 450);
  }
  function doFlash(red = false) {
    flash.classList.toggle("is-red", red);
    flash.classList.remove("is-on");
    void flash.offsetWidth;
    flash.classList.add("is-on");
    setTimeout(() => flash.classList.remove("is-on"), 320);
  }
  const fadeOut = () => { fade.classList.add("is-on"); return sleep(580); };
  const fadeIn  = () => { fade.classList.remove("is-on"); return sleep(580); };

  function burstSparkles(n = 18, hearts = false) {
    for (let i = 0; i < n; i++) {
      const s = document.createElement("span");
      s.className = "spark" + (hearts && i % 2 ? " heart" : "");
      s.style.left = Math.random() * 90 + 5 + "%";
      s.style.bottom = Math.random() * 30 + "%";
      s.style.animationDelay = Math.random() * 0.5 + "s";
      sparkles.appendChild(s);
      setTimeout(() => s.remove(), 1600);
    }
  }

  /* ---------- HP ---------- */
  const PLAYER_MAX = 999;     // she's Lv100 — strong, but ROGIER (Lv200) wears her down
  const FOE_MAX = 200;
  let playerHP = PLAYER_MAX;
  let foeHP = FOE_MAX;

  function renderHP(fillEl, hp, max, numEl) {
    const pct = Math.max(0, (hp / max) * 100);
    fillEl.style.width = pct + "%";
    fillEl.classList.toggle("is-mid", pct <= 50 && pct > 20);
    fillEl.classList.toggle("is-low", pct <= 20);
    if (numEl) numEl.textContent = Math.max(0, Math.round(hp));
  }
  function renderAllHP() {
    renderHP(hpPlayer, playerHP, PLAYER_MAX, hpPlayerNum);
    renderHP(hpFoe, foeHP, FOE_MAX, null);
  }
  function hurtPlayer(amount, hard = false) {
    playerHP = Math.max(0, playerHP - amount);
    renderHP(hpPlayer, playerHP, PLAYER_MAX, hpPlayerNum);
    spritePlayer.classList.add("is-hit");
    setTimeout(() => spritePlayer.classList.remove("is-hit"), 800);
    doFlash(true);
    if (hard) shake();
    sfx("hit");
  }
  // ROGIER lunges forward when he lands one of his dating "moves"
  function foeAttack() {
    spriteFoe.classList.remove("is-attacking");
    void spriteFoe.offsetWidth;
    spriteFoe.classList.add("is-attacking");
    setTimeout(() => spriteFoe.classList.remove("is-attacking"), 480);
  }

  /* ---------- Typewriter + tap-to-advance ---------- */
  let typing = false, skip = false, tapResolver = null;
  function onDialogueTap() {
    if (typing) skip = true;
    else if (tapResolver) { const r = tapResolver; tapResolver = null; r(); }
  }
  dialogue.addEventListener("click", onDialogueTap);
  const waitTap = () => new Promise((res) => { tapResolver = res; });

  async function typeText(text) {
    typing = true; skip = false;
    dialogueText.textContent = "";
    cursor.classList.remove("is-shown");
    for (let i = 0; i < text.length; i++) {
      if (skip) { dialogueText.textContent = text; break; }
      dialogueText.textContent += text[i];
      if (i % 2 === 0 && text[i] !== " ") sfx("type");
      await sleep(16);
    }
    typing = false;
    cursor.classList.add("is-shown");
  }
  async function say(text) { await typeText(text); await waitTap(); }

  /* ---------- Menu + escalating "pressure" ---------- */
  let menuLocked = true;
  let wrongCount = 0;
  let matchHits = 0;             // MATCH lands the 1st hit, then FLIRT x2 to win
  const MATCH_TOTAL = 3;
  const usedWrong = new Set();   // which of GHOST / RUN / SWIPE LEFT she has tried
  let nudgeIdx = 0;              // cycles the "pick the pink button" hints

  // The wrong buttons only turn timid (and MATCH ramps up) once she's clearly
  // stalling: after all three wrong moves have been tried, OR after 3 moves.
  function pressureActive() {
    return wrongCount >= 3 ||
      (usedWrong.has("ghost") && usedWrong.has("run") && usedWrong.has("swipe"));
  }

  function showMenu() {
    menu.classList.add("is-shown");
    menu.setAttribute("aria-hidden", "false");
  }
  function enableMenu() { menuLocked = false; showMenu(); }
  function disableMenu() {
    menuLocked = true;
    menu.classList.remove("is-shown");
    menu.setAttribute("aria-hidden", "true");
  }
  function resetPressure() {
    wrongCount = 0;
    matchHits = 0;
    nudgeIdx = 0;
    usedWrong.clear();
    btnMatch.textContent = "MATCH";
    actionBtns.forEach((b) => b.classList.remove("timid", "timid-2", "timid-3"));
    btnMatch.classList.remove("glow-2", "glow-3");
    btnMatch.classList.add("glow-1");
  }
  function applyPressure() {
    const active = pressureActive();
    btnMatch.classList.toggle("glow-2", active);
    btnMatch.classList.toggle("glow-3", active && wrongCount >= 5);
    [".act-ghost", ".act-run", ".act-swipe"].forEach((sel) => {
      const b = $(sel);
      b.classList.toggle("timid", active);
      b.classList.toggle("timid-2", active && wrongCount >= 5);
      b.classList.toggle("timid-3", active && wrongCount >= 7);
    });
  }
  menu.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-action]");
    if (!btn || menuLocked) return;
    handleAction(btn.dataset.action);
  });

  /* ---------- Dialogue banks ----------
     Turn-based, Pokémon-style. Her GHOST / RUN / SWIPE LEFT do NOTHING to
     ROGIER (his HP never moves); then ROGIER answers with a dating "move"
     that chips away at HER HP. Banks cycle so repeats stay funny.        */
  const ghostLines = [
    [NAME + " tried to GHOST... but it had no effect on Wild ROGIER!",
     "Wild ROGIER used DOUBLE TEXT! It's super effective! 💬"],
    [NAME + " went quiet on read... ROGIER stayed unbothered!",
     "Wild ROGIER used STORY REPLY! He left a 😍 on your story. Critical hit!"],
    [NAME + " ghosted even harder... ROGIER's vibe is unshakeable!",
     "Wild ROGIER used OAT-MILK COFFEE! Hand-delivered. It's super effective!"],
    [NAME + " tried the slow fade... it failed against Wild ROGIER!",
     "Wild ROGIER used GOODNIGHT TEXT! It hit " + NAME + " right in the feels. 💘"],
  ];
  const runLines = [
    [NAME + " tried to RUN... but there's no escaping destiny!",
     "Wild ROGIER used CHARM! He saved you a seat and a smile. 💫"],
    [NAME + " sprinted for the door... it was a wall painted like one!",
     "Wild ROGIER used DAD JOKE! So bad it's super effective!"],
    [NAME + " looked for an exit... Error 404, no effect on ROGIER!",
     "Wild ROGIER used GENUINE COMPLIMENT! " + NAME + " is flustered. 💗"],
    [NAME + " tried to fast-travel away... destiny disabled it!",
     "Wild ROGIER used WALK YOU HOME! It's super effective!"],
  ];
  const swipeLines = [
    [NAME + " used SWIPE LEFT! ...ROGIER is built different. It bounced off!",
     "Wild ROGIER used REMEMBERED YOUR ORDER! Massive emotional damage. 💞"],
    [NAME + " swiped left, harshly... ROGIER didn't take it personally!",
     "Wild ROGIER used HANDWRITTEN NOTE! A direct hit to the heart!"],
    [NAME + " swiped left AGAIN?! ...no effect. ROGIER respects the grind.",
     "Wild ROGIER used COOKED YOU DINNER! It's super effective! 🍝"],
    [NAME + " keeps swiping left... but it can't land on Wild ROGIER!",
     "Wild ROGIER used MORNING TEXT! 'thinking of you ☕'. Critical hit!"],
  ];
  // Cycled so the player never sees the exact same nudge twice in a row
  // {btn} is swapped for the pink button's CURRENT label (MATCH, then FLIRT)
  // so the hint never tells her to press a button that no longer exists.
  const nudgeLines = [
    "Psst... that glowing PINK button is right there. ♡",
    "Hint: nothing else lands on him. {btn} is the move. 💘",
    "You already know. The pink one, {btn}. He's right there. 😉",
    "GHOST, RUN, SWIPE... none of it works. Try {btn}. ✨",
    "Destiny is tapping its foot. Hit {btn}. Let's go. ♥",
    "Spoiler: this only ends one way, and it's pink. 💕",
  ];
  // MATCH lands the first hit, then it becomes FLIRT for the finishers
  const flirtLines = [
    [NAME + " used MATCH!", "It's a vibe! ROGIER is intrigued... ♥"],
    [NAME + " used FLIRT!", "Smooth. ROGIER's cool-guy act is cracking! 💫"],
    [NAME + " used FLIRT!", "CRITICAL HIT! Sparks are flying everywhere! ✨"],
  ];
  const pick = (bank, i) => bank[Math.min(i, bank.length - 1)];
  const cyc  = (bank, i) => bank[((i % bank.length) + bank.length) % bank.length];

  /* ---------- 3. Battle start + intro ---------- */
  async function enterBattle(introText) {
    playerHP = PLAYER_MAX;
    foeHP = FOE_MAX;
    spriteFoe.className = "sprite sprite--foe is-entering";
    spritePlayer.className = "sprite sprite--player is-entering";
    resetPressure();
    renderAllHP();
    gotoState("battle");
    await fadeIn();
    startMusic();
    setTimeout(() => {
      spriteFoe.classList.remove("is-entering");
      spritePlayer.classList.remove("is-entering");
    }, 750);
    for (const line of introText) await say(line);
    await promptAction();
  }
  function startBattle() {
    return enterBattle([
      "An anomaly occurred in the Hinge matrix...!",
      "Wild ROGIER (Lv.200) appeared! He blocks your path to a boring single life.",
    ]);
  }
  async function promptAction() {
    if (pressureActive()) {
      await say(cyc(nudgeLines, nudgeIdx++).replace("{btn}", btnMatch.textContent));
    }
    await say("What will " + NAME + " do?");
    enableMenu();
  }

  /* ---------- 4. Branches ----------
     GHOST / RUN / SWIPE LEFT never win: they only drain HER HP and
     loop back to the menu. Game over happens ONLY when HP hits 0.   */
  async function handleAction(action) {
    disableMenu();
    if (action === "match") { sfx("select"); await branchFlirt(); return; }
    sfx("deny");
    usedWrong.add(action);
    // Balanced so ~6 of ROGIER's counter-moves finish her (999 HP / ~170 ≈ 6).
    if (action === "ghost") await wrongMove(cyc(ghostLines, wrongCount), rand(160, 185), false);
    if (action === "run")   await wrongMove(cyc(runLines,   wrongCount), rand(160, 185), false);
    if (action === "swipe") await wrongMove(cyc(swipeLines, wrongCount), rand(180, 205), true);
  }

  async function wrongMove(lines, dmg, hard) {
    await say(lines[0]);          // her move bounces off ROGIER (his HP never drops)
    foeAttack();                  // ROGIER answers with a dating move...
    await say(lines[1]);
    hurtPlayer(dmg, hard);        // ...and it's HER HP that takes the hit
    await sleep(650);
    if (playerHP <= 0) { await faintSequence(); return; }
    wrongCount++;
    applyPressure();
    await promptAction();
  }

  // Player runs out of HP -> faint -> GAME OVER (gradual, never sudden)
  async function faintSequence() {
    await say(NAME + " is running on empty from dodging love...");
    spritePlayer.classList.add("is-faint");
    sfx("hit");
    await say(NAME + " tapped out!");
    await say("Oh no... you almost let a good one slip away.");
    stopMusic();
    await fadeOut();
    gotoState("over");
    armPass();
    await fadeIn();
  }

  // BRANCH MATCH/FLIRT — the one true path (3 hits: MATCH, then FLIRT x2)
  async function branchFlirt() {
    matchHits++;
    const final = matchHits >= MATCH_TOTAL;
    const lines = pick(flirtLines, matchHits - 1);

    await say(lines[0]);
    // drain ROGIER's HP one third per hit
    foeHP = final ? 0 : Math.round(FOE_MAX * (1 - matchHits / MATCH_TOTAL));
    renderHP(hpFoe, foeHP, FOE_MAX, null);
    sfx("drain");
    spriteFoe.classList.remove("is-happy");
    void spriteFoe.offsetWidth;
    spriteFoe.classList.add("is-happy");
    burstSparkles(final ? 22 : 9, true);
    await say(lines[1]);

    if (final) {
      stopMusic();
      playVictory();
      await sleep(900);
      await say("Wild ROGIER was successfully caught! ♥");
      await fadeOut();
      gotoState("levelup");
      await fadeIn();
      runLevelUp();
    } else {
      btnMatch.textContent = "FLIRT";   // the move evolves
      await promptAction();
    }
  }

  /* ---------- 5a. GAME OVER — the fleeing PASS button ---------- */
  let passArmed = false;
  // She can get VERY close before PASS dodges, and it only scoots a little —
  // just out of reach, never flying across the screen. Mouse + touch.
  const PASS_TRIGGER = 24;   // px from the button's edge before it dodges
  function dodgePass(px, py) {
    const pad = 12;
    const r = btnPass.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    let dx = cx - px, dy = cy - py, len = Math.hypot(dx, dy);
    if (len < 0.01) { dx = Math.random() - 0.5; dy = Math.random() - 0.5; len = Math.hypot(dx, dy) || 1; }
    const step = Math.min(130, Math.max(60, r.width * 0.8));   // small hop
    btnPass.classList.add("is-roaming");
    let left = parseFloat(btnPass.style.left); if (Number.isNaN(left)) left = r.left;
    let top  = parseFloat(btnPass.style.top);  if (Number.isNaN(top))  top  = r.top;
    left += (dx / len) * step;
    top  += (dy / len) * step;
    const maxX = window.innerWidth  - r.width  - pad;
    const maxY = window.innerHeight - r.height - pad;
    // if a hop would leave the screen, bounce off that wall instead
    if (left < pad)  left = Math.min(maxX, r.left + step);
    if (left > maxX) left = Math.max(pad,  r.left - step);
    if (top  < pad)  top  = Math.min(maxY, r.top  + step);
    if (top  > maxY) top  = Math.max(pad,  r.top  - step);
    left = Math.min(Math.max(pad, left), maxX);
    top  = Math.min(Math.max(pad, top),  maxY);
    // PASS may never land on RETRY, otherwise a tap meant for RETRY hits PASS
    [left, top] = keepOffRetry(left, top, r.width, r.height, maxX, maxY);
    btnPass.style.left = left + "px";
    btnPass.style.top  = top + "px";
    sfx("type");
  }
  // nudge a candidate PASS position so its box never overlaps the RETRY button
  function keepOffRetry(left, top, w, h, maxX, maxY) {
    const rr = btnRetry.getBoundingClientRect();
    const m = 14; // minimum gap to keep from RETRY
    const hits = (l, t) =>
      l < rr.right + m && l + w > rr.left - m && t < rr.bottom + m && t + h > rr.top - m;
    if (!hits(left, top)) return [left, top];
    const clamp = (l, t) => [Math.min(Math.max(12, l), maxX), Math.min(Math.max(12, t), maxY)];
    for (const [l, t] of [
      [rr.right + m, top],        // right of RETRY
      [rr.left - m - w, top],     // left of RETRY
      [left, rr.bottom + m],      // below RETRY
      [left, rr.top - m - h],     // above RETRY
    ]) {
      const [cl, ct] = clamp(l, t);
      if (!hits(cl, ct)) return [cl, ct];
    }
    // last resort: a corner on the opposite side of the screen from RETRY
    const farX = (rr.left + rr.width / 2) < window.innerWidth / 2 ? maxX : 12;
    const farY = (rr.top + rr.height / 2) < window.innerHeight / 2 ? maxY : 12;
    return [farX, farY];
  }
  function passProximity(e) {
    if (!passArmed) return;
    const r = btnPass.getBoundingClientRect();
    const point = e.touches && e.touches[0] ? e.touches[0] : e;
    const px = point.clientX, py = point.clientY;
    const dx = Math.max(r.left - px, 0, px - r.right);
    const dy = Math.max(r.top - py, 0, py - r.bottom);
    if (Math.hypot(dx, dy) < PASS_TRIGGER) dodgePass(px, py);
  }
  function armPass() {
    passArmed = true;
    btnPass.classList.remove("is-roaming");
    btnPass.style.left = btnPass.style.top = "";
  }
  function disarmPass() {
    passArmed = false;
    btnPass.classList.remove("is-roaming");
    btnPass.style.left = btnPass.style.top = "";
  }
  btnPass.addEventListener("mouseenter", (e) => { if (passArmed) dodgePass(e.clientX, e.clientY); });
  btnPass.addEventListener("focus", () => { if (passArmed) { const r = btnPass.getBoundingClientRect(); dodgePass(r.left + r.width / 2, r.top + r.height / 2); } });
  document.addEventListener("mousemove", passProximity);
  document.addEventListener("touchstart", passProximity, { passive: true });
  document.addEventListener("touchmove", passProximity, { passive: true });
  btnPass.addEventListener("click", (e) => e.preventDefault());

  btnRetry.addEventListener("click", async () => {
    if (!passArmed) return;
    disarmPass();
    sfx("select");
    await fadeOut();
    await enterBattle(["Rewinding time to give love a second chance..."]);
  });

  /* ---------- 5b. LEVEL UP (EXP bar + counting stats) ---------- */
  let levelupTapBound = false;
  // [name, from, to, isMax]
  const STATS = [
    ["CHARM", 84, 99, false],
    ["LUCK", 71, 96, false],
    ["CHEMISTRY", 90, 100, true],
    ["HAPPY LIFE", 7, 9, false],
    ["ADVENTURE", 5, 10, false],
  ];
  function countUp(el, from, to, dur, max) {
    return new Promise((res) => {
      if (reduced) { el.textContent = max ? "MAX" : String(to); return res(); }
      const start = performance.now();
      const frame = (now) => {
        const t = Math.min(1, (now - start) / dur);
        const val = Math.round(from + (to - from) * t);
        el.textContent = (max && t >= 1) ? "MAX" : String(val);
        if (t < 1) requestAnimationFrame(frame); else res();
      };
      requestAnimationFrame(frame);
    });
  }
  async function runLevelUp() {
    const expFill = $("#exp-fill");
    const lvtext  = $("#lvl-lvtext");
    const statsEl = $("#lvl-stats");
    const skillbox = $("#skillbox");
    const cont = $("#lvl-continue");

    // reset
    expFill.style.transition = "none"; expFill.style.width = "0%"; void expFill.offsetWidth; expFill.style.transition = "";
    lvtext.classList.remove("is-shown");
    statsEl.innerHTML = "";
    skillbox.classList.remove("is-shown");
    cont.classList.remove("is-shown");

    jingle([523, 659, 784, 1047, 1319, 1047, 1319]);
    await sleep(300);

    // She just beat someone DOUBLE her level, so she rockets up many levels.
    const LV_FROM = 100, LV_TO = 200;
    lvtext.innerHTML = 'Lv.' + LV_FROM + ' &nbsp;▸&nbsp; Lv.<b id="lvl-newnum">' + LV_FROM + '</b>';
    lvtext.classList.add("is-shown"); sfx("select");
    const newNum = $("#lvl-newnum");
    let lv = LV_FROM;
    while (lv < LV_TO) {
      // each sweep: refill the EXP bar + tick several levels at once
      expFill.style.transition = "none"; expFill.style.width = "0%"; void expFill.offsetWidth;
      expFill.style.transition = "width .16s linear"; expFill.style.width = "100%";
      lv = Math.min(LV_TO, lv + (reduced ? LV_TO : 10));
      newNum.textContent = lv;
      sfx("level");
      await sleep(reduced ? 20 : 150);
    }
    expFill.style.transition = "";
    await sleep(450);

    for (const [name, from, to, max] of STATS) {
      const li = document.createElement("li");
      li.dataset.stat = "";
      li.innerHTML =
        '<span class="lvl__name">' + name + '</span>' +
        '<span class="lvl__from">' + from + '</span>' +
        '<span class="lvl__arrow">▸</span>' +
        '<span class="lvl__to' + (max ? " max" : "") + '">' + from + '</span>';
      statsEl.appendChild(li);
      requestAnimationFrame(() => li.classList.add("is-shown"));
      await countUp(li.querySelector(".lvl__to"), from, to, 450, max);
      sfx("level");
      await sleep(160);
    }
    await sleep(300); skillbox.classList.add("is-shown"); sfx("select");
    await sleep(560); cont.classList.add("is-shown");

    if (!levelupTapBound) {
      states.levelup.addEventListener("click", goToQuest);
      levelupTapBound = true;
    }
  }
  const contIsShown = () => $("#lvl-continue").classList.contains("is-shown");
  async function goToQuest() {
    if (!contIsShown()) return;
    sfx("select");
    await fadeOut();
    gotoState("quest");
    burstSparkles(10, true);
    await fadeIn();
  }

  btnAgain.addEventListener("click", async (e) => {
    e.stopPropagation();
    sfx("select");
    await fadeOut();
    gotoState("title");
    await fadeIn();
  });

  /* ---------- 1 (UI). TITLE -> battle ---------- */
  btnStart.addEventListener("click", () => {
    ensureAudio();
    sfx("select");
    shake();
    doFlash(false);
    setTimeout(startBattle, 320);
  });

  /* ---------- init ---------- */
  renderAllHP();
  gotoState("title");
})();
