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
  let muted = localStorage.getItem("rs_muted") === "1";
  soundToggle.classList.toggle("is-muted", muted);

  function ensureAudio() {
    if (!actx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) actx = new AC();
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
    o.connect(g).connect(actx.destination);
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
    if (muted) { stopMusic(); }
    else { ensureAudio(); tone(880, 0.08); if (states.battle.classList.contains("is-active")) startMusic(); }
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
    btnMatch.textContent = "MATCH";
    actionBtns.forEach((b) => b.classList.remove("timid", "timid-2", "timid-3"));
    btnMatch.classList.remove("glow-2", "glow-3");
    btnMatch.classList.add("glow-1");
  }
  function applyPressure() {
    btnMatch.classList.toggle("glow-2", wrongCount >= 2);
    btnMatch.classList.toggle("glow-3", wrongCount >= 4);
    [".act-ghost", ".act-run", ".act-swipe"].forEach((sel) => {
      const b = $(sel);
      b.classList.toggle("timid", wrongCount >= 1);
      b.classList.toggle("timid-2", wrongCount >= 3);
      b.classList.toggle("timid-3", wrongCount >= 5);
    });
  }
  menu.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-action]");
    if (!btn || menuLocked) return;
    handleAction(btn.dataset.action);
  });

  /* ---------- Dialogue banks (cycle so repeats stay funny) ---------- */
  const ghostLines = [
    [NAME + " tried to walk away...", "But ROGIER sent a double text! It's super effective!"],
    [NAME + " tried to ghost again...", "ROGIER replied to your story with a 😍. Critical hit!"],
    [NAME + " committed to the ghosting...", "But ROGIER showed up with oat-milk coffee. You're cornered!"],
    [NAME + ", we both know you're stalling.", "ROGIER liked all six of your photos. Resistance is futile!"],
  ];
  const runLines = [
    [NAME + " looked for an exit...", "Error 404: Escape route not found. You can't run from destiny!"],
    [NAME + " sprinted toward the door...", "It was a wall painted like a door. Nice try!"],
    [NAME + " tried to RUN again...", "ROGIER is faster, funnier, and already saved you a seat."],
    [NAME + ", the RUN button is exhausted.", "Fast-travel disabled by destiny. Stay a while!"],
  ];
  const swipeLines = [
    [NAME + " used SWIPE LEFT.", "ROGIER's heart cracks... but he's built different. He bounces back!"],
    [NAME + " swiped left, harshly.", "Ouch. ROGIER took that one personally. (It's not over.)"],
    [NAME + " swiped left AGAIN?!", "ROGIER respects the consistency. Still here though."],
    [NAME + " keeps swiping left.", "Each swipe costs you energy. ROGIER costs you nothing."],
  ];
  // MATCH lands the first hit, then it becomes FLIRT for the finishers
  const flirtLines = [
    [NAME + " used MATCH!", "It's a vibe! ROGIER is intrigued... ♥"],
    [NAME + " used FLIRT!", "Smooth. ROGIER's cool-guy act is cracking! 💫"],
    [NAME + " used FLIRT!", "CRITICAL HIT! Sparks are flying everywhere! ✨"],
  ];
  const pick = (bank, i) => bank[Math.min(i, bank.length - 1)];

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
    if (wrongCount >= 3) {
      await say("Psst... the glowing PINK button is right there. Just saying. ♡");
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
    if (action === "ghost") await wrongMove(pick(ghostLines, wrongCount), rand(150, 180), false);
    if (action === "run")   await wrongMove(pick(runLines,   wrongCount), rand(110, 140), false);
    if (action === "swipe") await wrongMove(pick(swipeLines, wrongCount), rand(190, 230), true);
  }

  async function wrongMove(lines, dmg, hard) {
    await say(lines[0]);
    await say(lines[1]);
    hurtPlayer(dmg, hard);
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
    await say(NAME + " fainted!");
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
      jingle([659, 784, 988, 1319, 1568]);
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
  function teleportPass() {
    const pad = 16;
    const w = btnPass.offsetWidth || 120;
    const h = btnPass.offsetHeight || 50;
    const maxX = Math.max(pad, window.innerWidth - w - pad);
    const maxY = Math.max(pad, window.innerHeight - h - pad);
    btnPass.classList.add("is-roaming");
    btnPass.style.left = Math.random() * (maxX - pad) + pad + "px";
    btnPass.style.top  = Math.random() * (maxY - pad) + pad + "px";
    sfx("type");
  }
  function passProximity(e) {
    if (!passArmed) return;
    const r = btnPass.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const point = e.touches && e.touches[0] ? e.touches[0] : e;
    const dist = Math.hypot(point.clientX - cx, point.clientY - cy);
    if (dist < Math.max(r.width, r.height) * 1.1) teleportPass();
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
  btnPass.addEventListener("mouseenter", () => passArmed && teleportPass());
  btnPass.addEventListener("focus", () => passArmed && teleportPass());
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
    expFill.style.width = "100%";                 // EXP fills up
    for (let i = 0; i < 6; i++) { sfx("level"); await sleep(170); }
    await sleep(200);
    lvtext.classList.add("is-shown"); sfx("select");
    await sleep(500);

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
