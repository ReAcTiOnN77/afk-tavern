import { registerGameForSpectate, notifySpectateUpdate, broadcastToSpectators, broadcastCursorToSpectators, registerSpectateConfig } from "../spectate-engine.js";
import { MODULE_ID, i18n, escapeHtml } from "../afk-tavern.js";
import { submitHighscore } from "../highscore-manager.js";
import { ApplicationV2, HandlebarsApplicationMixin, difficultyLevel, cleanupSoloGame, buildLocCache, soloGameDefaults } from "./minigame-helpers.js";

const SPAWN_INTERVAL = 420;
const SPAWN_JITTER = 150;
const MAX_CONCURRENT = 7;
const ITEM_SIZE = 48;
const BOX_PADDING = 6;
const CATCH_COOLDOWN = 180;
const DRIFT_MAX = 35;
const FREEZE_DURATION = 1500;
const OBSCURE_DURATION = 2000;
const SPEED_RAMP = 0.012;

const DECOY_IMG = "icons/svg/skull.svg";
const BOMB_IMG = "icons/svg/explosion.svg";
const FREEZE_IMG = "icons/svg/ice-aura.svg";

const ITEM_POOL = [
  { name: "Dragon Scale", img: "icons/commodities/leather/scales-blue.webp" },
  { name: "Healing Herb", img: "icons/commodities/flowers/flower-green.webp" },
  { name: "Ruby", img: "icons/commodities/gems/gem-rough-rectangle-red.webp" },
  { name: "Gold Coin", img: "icons/commodities/currency/coin-inset-crown-gold.webp" },
  { name: "Mushroom", img: "icons/consumables/mushrooms/conical-bell-yellow.webp" },
  { name: "Feather", img: "icons/commodities/materials/feather-blue-grey.webp" },
  { name: "Bone", img: "icons/commodities/bones/bone-red.webp" },
  { name: "Crystal", img: "icons/commodities/gems/gem-faceted-radiant-blue.webp" },
  { name: "Eye of Newt", img: "icons/commodities/biological/eye-brown-red.webp" },
  { name: "Iron Ore", img: "icons/commodities/metal/ingot-iron.webp" },
  { name: "Spider Silk", img: "icons/creatures/webs/webthin-blue.webp" },
  { name: "Emerald", img: "icons/commodities/gems/gem-cut-table-green.webp" },
  { name: "Venom Sac", img: "icons/consumables/potions/bottle-conical-corked-green.webp" },
  { name: "Arcane Dust", img: "icons/commodities/materials/bowl-powder-pink.webp" },
  { name: "Troll Blood", img: "icons/consumables/potions/bottle-corked-red.webp" }
];

const getLoc = buildLocCache(() => ({
  instructions: i18n("AFK_TAVERN.monsterHarvester.instructions"),
  start: i18n("AFK_TAVERN.monsterHarvester.start"),
  hint: i18n("AFK_TAVERN.monsterHarvester.hint"),
  harvested: i18n("AFK_TAVERN.monsterHarvester.harvested"),
  remaining: i18n("AFK_TAVERN.monsterHarvester.remaining"),
  newGame: i18n("AFK_TAVERN.monsterHarvester.newGame")
}));

const DIFFICULTY_MAP = {
  "Easy (15 items, slow)": { itemCount: 15, baseSpeed: 150, hazardRatio: 0.5, maxStrikes: 5 },
  "Medium (25 items, normal)": { itemCount: 25, baseSpeed: 200, hazardRatio: 1, maxStrikes: 3 },
  "Hard (35 items, fast)": { itemCount: 35, baseSpeed: 280, hazardRatio: 1.5, maxStrikes: 2 }
};

function _renderSplat(boxEl, x, y) {
  if (!boxEl) return;
  const splat = document.createElement("div");
  splat.className = "mh-blood-splat";
  splat.style.cssText = `position:absolute;left:${x}px;top:${y}px;width:0;height:0;pointer-events:none;z-index:999;`;
  const drops = [
    { dx: 0,   dy: 0,   r: 10, o: 0.85 },
    { dx: -12, dy: -8,  r: 5,  o: 0.75 },
    { dx: 14,  dy: -6,  r: 4,  o: 0.7  },
    { dx: -7,  dy: 13,  r: 6,  o: 0.7  },
    { dx: 10,  dy: 10,  r: 3,  o: 0.65 },
    { dx: -16, dy: 4,   r: 3,  o: 0.6  },
    { dx: 6,   dy: -15, r: 3,  o: 0.6  },
  ];
  for (const d of drops) {
    const blob = document.createElement("div");
    blob.style.cssText = `
      position:absolute;
      left:${d.dx - d.r}px; top:${d.dy - d.r}px;
      width:${d.r * 2}px; height:${d.r * 2}px;
      background:radial-gradient(circle at 40% 35%, #ff2222, #8b0000);
      border-radius:${40 + Math.random() * 20}% ${60 - Math.random() * 20}% ${50 + Math.random() * 20}% ${40 - Math.random() * 10}%;
      opacity:${d.o};
      animation: mh-splat-fade 0.6s ease-out forwards;
    `;
    splat.appendChild(blob);
  }
  boxEl.appendChild(splat);
  setTimeout(() => { try { splat.remove(); } catch {} }, 650);
}


export class MonsterHarvesterApp extends HandlebarsApplicationMixin(ApplicationV2) {

  #difficulty;
  #config;
  #drops = [];
  #bound = false;
  #resolved = false;
  #animId = null;
  #spawnTimer = null;
  #started = false;
  #spawnIdx = 0;
  #active = [];
  #totalCaught = 0;
  #totalDrops = 0;
  #frozen = false;
  #strikes = 0;
  #maxStrikes = 3;
  #boxH = 0;
  #boxW = 0;
  #boxEl = null;
  #measured = false;
  #lastCatchTime = 0;
  #gameOver = false;
  #cursorAbort = null;
  #lastCursorEmit = 0;

  constructor(options = {}) {
    super(options);
    this.#difficulty = options.difficulty ?? "Medium (25 items, normal)";
    if (options.customConfig) {
      this.#config = {
        itemCount: Math.max(5, Math.min(50, options.customConfig.itemCount ?? 25)),
        baseSpeed: Math.max(50, Math.min(500, options.customConfig.baseSpeed ?? 200)),
        hazardRatio: Math.max(0, Math.min(5, options.customConfig.hazardRatio ?? 1)),
        maxStrikes: Math.max(0, Math.min(20, options.customConfig.maxStrikes ?? 3)),
        advancedHazards: !!options.customConfig.advancedHazards
      };
      this.#difficulty = "Custom";
    } else {
      this.#config = DIFFICULTY_MAP[this.#difficulty] ?? DIFFICULTY_MAP["Medium (25 items, normal)"];
    }
    this.#maxStrikes = this.#config.maxStrikes;
    this.#buildDrops();
    registerGameForSpectate(this);
  }

  static DEFAULT_OPTIONS = soloGameDefaults("monster-harvester", {
    title: "AFK_TAVERN.monsterHarvester.title",
    icon: "fa-solid fa-knife-kitchen",
    width: 500,
    actions: {
      startGame: MonsterHarvesterApp.#onStartGame,
      newGame: MonsterHarvesterApp.#onNewGame
    }
  });

  static PARTS = {
    main: { template: `modules/${MODULE_ID}/templates/minigames/monster-harvester-board.hbs` }
  };

  #buildDrops() {
    const shuffled = [...ITEM_POOL].sort(() => Math.random() - 0.5);
    const selectedItems = shuffled.slice(0, Math.min(8, ITEM_POOL.length));
    const drops = [];

    let remaining = this.#config.itemCount;
    while (remaining > 0) {
      const item = selectedItems[Math.floor(Math.random() * selectedItems.length)];
      const speed = this.#config.baseSpeed * (0.8 + Math.random() * 0.4);
      drops.push({
        uuid: item.name, name: item.name, img: item.img,
        speed, isDecoy: false
      });
      remaining--;
    }

    const hazardCount = Math.max(1, Math.round(drops.length * this.#config.hazardRatio));
    const useAdvanced = this.#config.advancedHazards ?? false;
    for (let i = 0; i < hazardCount; i++) {
      const roll = Math.random();
      const speed = this.#config.baseSpeed * (0.8 + Math.random() * 0.7);
      const shared = { speed, isDecoy: true };

      if (!useAdvanced || roll < 0.6) {
        drops.push({ ...shared, uuid: "__decoy__", name: i18n("AFK_TAVERN.monsterHarvester.hazardDecoy"), img: DECOY_IMG, hazardType: "decoy" });
      } else if (roll < 0.85) {
        drops.push({ ...shared, uuid: "__bomb__", name: i18n("AFK_TAVERN.monsterHarvester.hazardBomb"), img: BOMB_IMG, hazardType: "bomb" });
      } else {
        drops.push({ ...shared, uuid: "__freeze__", name: i18n("AFK_TAVERN.monsterHarvester.hazardFreeze"), img: FREEZE_IMG, hazardType: "freeze" });
      }
    }

    for (let i = drops.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [drops[i], drops[j]] = [drops[j], drops[i]];
    }

    this.#drops = drops;
    this.#totalDrops = drops.filter(d => !d.isDecoy).length;
  }

  async _prepareContext(options) {
    const seen = new Map();
    for (const d of this.#drops) {
      if (d.isDecoy) continue;
      if (!seen.has(d.uuid)) seen.set(d.uuid, { name: d.name, img: d.img, count: 0 });
      seen.get(d.uuid).count++;
    }

    return {
      totalDrops: this.#totalDrops,
      strikesDisplay: this.#maxStrikes > 0 ? `✕ 0 / ${this.#maxStrikes}` : "",
      itemSummary: [...seen.values()],
      gameOver: this.#gameOver,
      difficulty: this.#difficulty,
      difficultyLevel: difficultyLevel(this.#difficulty),
      loc: getLoc()
    };
  }

  _onRender(context, options) {
    if (this.#bound) return;
    this.#bound = true;

    const root = this.element;
    if (!root) return;

    this.#boxEl = root.querySelector(".mh-box");

    const knifeSVG = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><polygon points="1,1 6,20 10,16" fill="#d0d0d8" stroke="#666" stroke-width="0.4"/><line x1="1" y1="1" x2="7" y2="17" stroke="#eee" stroke-width="0.8" opacity="0.5"/><rect x="4" y="15" width="12" height="5" rx="2" transform="rotate(45 10 18)" fill="#7a4520" stroke="#5a3010" stroke-width="0.5"/></svg>`;
    const knifeUrl = `url("data:image/svg+xml,${encodeURIComponent(knifeSVG)}") 1 1, crosshair`;
    if (this.#boxEl) this.#boxEl.style.cursor = knifeUrl;
  }

  #beginGame(root) {
    if (this.#started) return;
    this.#started = true;

    const overlay = root.querySelector(".mh-start-overlay");
    if (overlay) overlay.style.display = "none";
    const results = root.querySelector(".mh-results");
    if (results) results.style.display = "none";

    requestAnimationFrame(() => {
      this.#measureBox();
      this.#boxEl?.addEventListener("pointerdown", (ev) => this.#onBoxClick(ev));
      this.#cursorAbort?.abort();
      this.#cursorAbort = new AbortController();
      if (this.#boxEl) {
        this.#boxEl.addEventListener("mousemove", (e) => {
          const now = performance.now();
          if (now - this.#lastCursorEmit < 33) return;
          this.#lastCursorEmit = now;
          const rect = this.#boxEl.getBoundingClientRect();
          broadcastCursorToSpectators(
            (e.clientX - rect.left) / rect.width,
            (e.clientY - rect.top) / rect.height
          );
        }, { signal: this.#cursorAbort.signal });
      }
      this.#startSpawning();
      this.#startAnimation();
    });
  }

  #resetGame() {
    if (this.#animId) cancelAnimationFrame(this.#animId);
    if (this.#spawnTimer) clearTimeout(this.#spawnTimer);

    this.#bound = false;
    this.#resolved = false;
    this.#started = false;
    this.#spawnIdx = 0;
    this.#active = [];
    this.#totalCaught = 0;
    this.#frozen = false;
    this.#strikes = 0;
    this.#measured = false;
    this.#lastCatchTime = 0;
    this.#gameOver = false;
    this.#buildDrops();
    this.render(false);
    notifySpectateUpdate();
  }

  #measureBox() {
    if (this.#measured || !this.#boxEl) return;
    this.#boxH = this.#boxEl.clientHeight;
    this.#boxW = this.#boxEl.clientWidth;
    this.#measured = true;
  }

  #onBoxClick(ev) {
    if (ev.target.closest(".mh-drop")) return;
    if (this.#resolved || !this.#started || this.#frozen) return;
    this.#spawnBloodSplat(ev);
    this.#addStrike();
    if (this.#boxEl) {
      this.#boxEl.classList.add("mh-box-penalty");
      setTimeout(() => this.#boxEl?.classList.remove("mh-box-penalty"), 350);
    }
  }

  #addStrike() {
    if (this.#maxStrikes <= 0) return;
    this.#strikes++;
    this.#flashPenalty();
    this.#updateUI();
    if (this.#strikes >= this.#maxStrikes) {
      setTimeout(() => this.#finish(), 350);
    }
  }

  #startSpawning() {
    const scheduleNext = () => {
      if (this.#resolved) return;
      if (this.#spawnIdx >= this.#drops.length && this.#active.filter(a => !a.caught && !a.missed).length === 0) {
        setTimeout(() => this.#finish(), 350);
        return;
      }
      const jitter = (Math.random() - 0.5) * 2 * SPAWN_JITTER;
      const interval = Math.max(150, SPAWN_INTERVAL + jitter);
      this.#spawnTimer = setTimeout(() => {
        this.#spawnBatch();
        scheduleNext();
      }, interval);
    };
    this.#spawnBatch();
    scheduleNext();
  }

  #spawnBatch() {
    if (this.#resolved) return;
    const liveCount = this.#active.filter(a => !a.caught && !a.missed).length;
    const toSpawn = Math.min(
      Math.random() < 0.3 ? 3 : 2,
      this.#drops.length - this.#spawnIdx,
      MAX_CONCURRENT - liveCount
    );
    for (let i = 0; i < toSpawn; i++) this.#spawnOne();
  }

  #spawnOne() {
    if (this.#spawnIdx >= this.#drops.length) return;
    if (!this.#boxEl || !this.#boxW) return;

    const drop = this.#drops[this.#spawnIdx++];
    const ramp = 1 + (this.#spawnIdx * SPEED_RAMP);
    const speed = drop.speed * ramp;

    const usableW = this.#boxW - ITEM_SIZE - BOX_PADDING * 2;
    let x = BOX_PADDING + Math.random() * usableW;
    for (let attempt = 0; attempt < 3; attempt++) {
      let tooClose = false;
      for (const a of this.#active) {
        if (!a.caught && !a.missed && a.y >= 0 && a.y < ITEM_SIZE * 1.5 && Math.abs(a.x - x) < ITEM_SIZE) {
          tooClose = true; break;
        }
      }
      if (!tooClose) break;
      x = BOX_PADDING + Math.random() * usableW;
    }

    const driftSpeed = (Math.random() - 0.5) * 2 * DRIFT_MAX;
    const driftPhase = Math.random() * Math.PI * 2;

    const el = document.createElement("div");
    const hazardClass = drop.isDecoy ? `mh-hazard mh-hazard-${drop.hazardType || "decoy"}` : "";
    el.className = drop.isDecoy ? `mh-drop ${hazardClass}` : "mh-drop";
    el.innerHTML = `<img src="${escapeHtml(drop.img)}" class="mh-drop-icon" alt=""><span class="mh-drop-name">${escapeHtml(drop.name)}</span>`;
    el.style.left = `${x}px`;
    el.style.top = `-${ITEM_SIZE}px`;

    this.#boxEl.appendChild(el);

    const entry = {
      id: foundry.utils.randomID(),
      el, drop, y: -ITEM_SIZE, x, speed, driftSpeed, driftPhase,
      baseX: x, caught: false, missed: false, spawnTime: performance.now()
    };
    this.#active.push(entry);
    notifySpectateUpdate();

    el.addEventListener("pointerdown", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      this.#onItemClick(entry, ev);
    });
  }

  #startAnimation() {
    let lastTime = performance.now();
    const step = (now) => {
      if (this.#resolved) return;
      const dt = (now - lastTime) / 1000;
      lastTime = now;

      for (const a of this.#active) {
        if (a.caught || a.missed) continue;
        a.y += a.speed * dt;
        const elapsed = (now - a.spawnTime) / 1000;
        const drift = Math.sin(elapsed * 2.5 + a.driftPhase) * a.driftSpeed * 0.5;
        const newX = Math.max(BOX_PADDING, Math.min(this.#boxW - ITEM_SIZE - BOX_PADDING, a.baseX + drift));
        a.x = newX;
        a.el.style.top = `${a.y}px`;
        a.el.style.left = `${a.x}px`;

        if (a.y > this.#boxH + 5) {
          a.missed = true;
          a.el.classList.add("mh-drop-missed");
          setTimeout(() => { try { a.el.remove(); } catch {} }, 300);
          if (!a.drop.isDecoy) this.#addStrike();
        }
      }

      this.#active = this.#active.filter(a => {
        if ((a.caught || a.missed) && !a.el.isConnected) return false;
        return true;
      });

      this.#updateUI();

      const liveCount = this.#active.filter(a => !a.caught && !a.missed).length;
      if (this.#spawnIdx >= this.#drops.length && liveCount === 0) {
        setTimeout(() => this.#finish(), 350);
        return;
      }

      this.#animId = requestAnimationFrame(step);
    };
    this.#animId = requestAnimationFrame(step);
  }

  #spawnBloodSplat(ev) {
    if (!this.#boxEl) return;
    const rect = this.#boxEl.getBoundingClientRect();
    const x = ev.clientX - rect.left;
    const y = ev.clientY - rect.top;
    broadcastToSpectators({ action: "spectateSplat", x, y });
    _renderSplat(this.#boxEl, x, y);
  }

  #onItemClick(entry, ev) {
    if (entry.caught || entry.missed || this.#resolved || this.#frozen) return;
    const now = performance.now();
    if (now - this.#lastCatchTime < CATCH_COOLDOWN) return;
    this.#lastCatchTime = now;

    if (ev) this.#spawnBloodSplat(ev);

    if (entry.drop.isDecoy) {
      const htype = entry.drop.hazardType || "decoy";
      if (htype === "bomb") this.#applyBomb(entry);
      else if (htype === "freeze") this.#applyFreeze(entry);
      else this.#applyDecoy(entry);
      return;
    }

    entry.caught = true;
    this.#totalCaught++;
    entry.el.classList.add("mh-drop-caught");
    setTimeout(() => { try { entry.el.remove(); } catch {} }, 350);
    this.#updateUI();
  }

  #applyDecoy(entry) {
    entry.caught = true;
    entry.el.classList.add("mh-drop-decoy-hit");
    setTimeout(() => { try { entry.el.remove(); } catch {} }, 400);
    this.#totalCaught = Math.max(0, this.#totalCaught - 1);
    this.#flashPenalty();
    this.#updateUI();
    broadcastToSpectators({ action: "spectateEffect", effect: "penalty", duration: 350 });
  }

  #applyBomb(entry) {
    entry.caught = true;
    entry.el.classList.add("mh-drop-bomb-hit");
    setTimeout(() => { try { entry.el.remove(); } catch {} }, 500);
    this.#addStrike();
    if (this.#boxEl) {
      this.#boxEl.classList.add("mh-obscured");
      setTimeout(() => this.#boxEl?.classList.remove("mh-obscured"), OBSCURE_DURATION);
    }
    broadcastToSpectators({ action: "spectateEffect", effect: "bomb", duration: OBSCURE_DURATION });
    broadcastToSpectators({ action: "spectateEffect", effect: "penalty", duration: 350 });
  }

  #applyFreeze(entry) {
    entry.caught = true;
    entry.el.classList.add("mh-drop-freeze-hit");
    setTimeout(() => { try { entry.el.remove(); } catch {} }, 400);
    this.#addStrike();
    this.#frozen = true;
    if (this.#boxEl) this.#boxEl.classList.add("mh-frozen");
    setTimeout(() => {
      this.#frozen = false;
      if (this.#boxEl) this.#boxEl.classList.remove("mh-frozen");
    }, FREEZE_DURATION);
    broadcastToSpectators({ action: "spectateEffect", effect: "freeze", duration: FREEZE_DURATION });
    broadcastToSpectators({ action: "spectateEffect", effect: "penalty", duration: 350 });
  }

  #flashPenalty() {
    const counter = this.element?.querySelector(".mh-strikes");
    if (counter) {
      counter.classList.add("mh-penalty-flash");
      setTimeout(() => counter.classList.remove("mh-penalty-flash"), 500);
    }
  }

  #updateUI() {
    const root = this.element;
    if (!root) return;
    const counter = root.querySelector(".mh-counter");
    if (counter) counter.textContent = this.#totalCaught;
    const progress = root.querySelector(".mh-progress");
    if (progress) {
      const unspawnedReal = this.#drops.slice(this.#spawnIdx).filter(d => !d.isDecoy).length;
      const liveReal = this.#active.filter(a => !a.caught && !a.missed && !a.drop.isDecoy).length;
      progress.textContent = unspawnedReal + liveReal;
    }
    const strikes = root.querySelector(".mh-strikes");
    if (strikes && this.#maxStrikes > 0) {
      strikes.textContent = `✕ ${this.#strikes} / ${this.#maxStrikes}`;
    }
  }

  #calcGrade() {
    const pct = this.#totalDrops > 0 ? Math.round((this.#totalCaught / this.#totalDrops) * 100) : 0;
    if (pct >= 90) return i18n("AFK_TAVERN.monsterHarvester.gradePerfect");
    if (pct >= 70) return i18n("AFK_TAVERN.monsterHarvester.gradeGreat");
    if (pct >= 50) return i18n("AFK_TAVERN.monsterHarvester.gradeNotBad");
    return i18n("AFK_TAVERN.monsterHarvester.gradeTryAgain");
  }

  #finish() {
    if (this.#resolved) return;
    this.#resolved = true;
    this.#gameOver = true;

    if (this.#animId) cancelAnimationFrame(this.#animId);
    if (this.#spawnTimer) clearTimeout(this.#spawnTimer);

    for (const a of this.#active) {
      try { a.el.remove(); } catch {}
    }
    this.#active.length = 0;

    if (this.#boxEl) {
      this.#boxEl.querySelectorAll(".mh-drop").forEach(el => el.remove());
    }

    const root = this.element;
    if (!root) return;

    const overlay = root.querySelector(".mh-start-overlay");
    if (overlay) overlay.style.display = "none";

    const results = root.querySelector(".mh-results");
    if (results) {
      const scoreText = results.querySelector(".mh-results-score");
      if (scoreText) scoreText.textContent = `${this.#totalCaught} / ${this.#totalDrops}`;
      const grade = results.querySelector(".mh-results-grade");
      if (grade) grade.textContent = this.#calcGrade();
      results.style.display = "";
    }

    submitHighscore("monster-harvester", this.#totalCaught, this.#difficulty);
    notifySpectateUpdate();
  }

  static #onStartGame() { this.#beginGame(this.element); }
  static #onNewGame() { this.#resetGame(); }

  close(options) {
    if (this.#animId) cancelAnimationFrame(this.#animId);
    if (this.#spawnTimer) clearTimeout(this.#spawnTimer);
    this.#cursorAbort?.abort();
    cleanupSoloGame(this);
    return super.close(options);
  }

  getSpectateState() {
    const seen = new Map();
    for (const d of this.#drops) {
      if (d.isDecoy) continue;
      if (!seen.has(d.uuid)) seen.set(d.uuid, { name: d.name, img: d.img, count: 0 });
      seen.get(d.uuid).count++;
    }
    return {
      gameType: "monster-harvester",
      data: {
        difficulty: this.#difficulty,
        difficultyLevel: difficultyLevel(this.#difficulty),
        totalDrops: this.#totalDrops,
        strikesDisplay: this.#maxStrikes > 0 ? `✕ 0 / ${this.#maxStrikes}` : "",
        itemSummary: [...seen.values()],
        hostNow: performance.now(),
        items: this.#active
          .filter(a => !a.caught && !a.missed)
          .map(a => ({
            id: a.id, speed: a.speed, driftSpeed: a.driftSpeed,
            driftPhase: a.driftPhase, baseX: a.baseX, spawnTime: a.spawnTime,
            img: a.drop.img, name: a.drop.name,
            isDecoy: a.drop.isDecoy ?? false, hazardType: a.drop.hazardType ?? null
          })),
        boxW: this.#boxW,
        boxH: this.#boxH,
        totalCaught: this.#totalCaught,
        strikes: this.#strikes,
        maxStrikes: this.#maxStrikes,
        frozen: this.#frozen,
        remaining: (() => {
          const unspawnedReal = this.#drops.slice(this.#spawnIdx).filter(d => !d.isDecoy).length;
          const liveReal = this.#active.filter(a => !a.caught && !a.missed && !a.drop.isDecoy).length;
          return unspawnedReal + liveReal;
        })(),
        resolved: this.#resolved,
        started: this.#started,
        resultsGrade: this.#calcGrade(),
        resultsScore: `${this.#totalCaught} / ${this.#totalDrops}`
      }
    };
  }
}

const MH_PADDING = 6;
const MH_ITEM_SIZE = 48;

registerSpectateConfig("monster-harvester", {
  template: "monster-harvester-board.hbs",
  ownHeader: true,
  tick: true,
  cursor: true,
  cursorClass: "mh-spectate-cursor",
  cursorTarget: ".mh-box",
  mapContext(state) {
    return {
      totalDrops: state.totalDrops ?? 0,
      strikesDisplay: state.strikesDisplay ?? "",
      itemSummary: state.itemSummary ?? [],
      difficulty: state.difficulty,
      difficultyLevel: state.difficultyLevel,
      loc: getLoc()
    };
  },
  onBuild(el) {
    const box = el.querySelector(".mh-box");
    if (box) box.style.pointerEvents = "none";
    const overlay = el.querySelector(".mh-start-overlay");
    if (overlay) overlay.style.display = "none";
    const results = el.querySelector(".mh-results");
    if (results) results.style.display = "none";
    return {
      box, counter: el.querySelector(".mh-counter"),
      strikes: el.querySelector(".mh-strikes"),
      progress: el.querySelector(".mh-progress"),
      itemEls: new Map(), itemPhysics: new Map(),
      clockDelta: null, boxW: 0, resolved: false
    };
  },
  shouldRebuild(state, prev) {
    return prev?.resolved && !state.resolved;
  },
  onSync(el, state, prev, refs) {
    if (refs.clockDelta === null && state.hostNow != null) {
      refs.clockDelta = performance.now() - state.hostNow;
    }
    if (!refs.box) return;

    refs.box.classList.toggle("mh-frozen", !!state.frozen);
    if (refs.counter) refs.counter.textContent = state.totalCaught;
    if (refs.strikes && state.maxStrikes > 0) refs.strikes.textContent = `✕ ${state.strikes} / ${state.maxStrikes}`;
    if (refs.progress && state.remaining != null) refs.progress.textContent = state.remaining;

    if (state.resolved) {
      refs.resolved = true;
      for (const [id, itemEl] of refs.itemEls) {
        itemEl.remove();
        refs.itemEls.delete(id);
        refs.itemPhysics.delete(id);
      }
      const results = el.querySelector(".mh-results");
      if (results) {
        const scoreEl = results.querySelector(".mh-results-score");
        if (scoreEl && state.resultsScore) scoreEl.textContent = state.resultsScore;
        const gradeEl = results.querySelector(".mh-results-grade");
        if (gradeEl && state.resultsGrade) gradeEl.textContent = state.resultsGrade;
        results.style.display = "";
      }
    } else {
      refs.resolved = false;
    }

    const currentIds = new Set(state.items.map(i => i.id));
    for (const [id, itemEl] of refs.itemEls) {
      if (!currentIds.has(id)) {
        itemEl.remove();
        refs.itemEls.delete(id);
        refs.itemPhysics.delete(id);
      }
    }
    for (const item of state.items) {
      if (!refs.itemEls.has(item.id)) {
        const itemEl = document.createElement("div");
        const hazardClass = item.isDecoy ? ` mh-hazard mh-hazard-${item.hazardType || "decoy"}` : "";
        itemEl.className = `mh-drop${hazardClass}`;
        itemEl.style.pointerEvents = "none";
        itemEl.innerHTML = `<img src="${item.img}" class="mh-drop-icon" alt=""><span class="mh-drop-name">${item.name}</span>`;
        refs.box.appendChild(itemEl);
        refs.itemEls.set(item.id, itemEl);
        refs.itemPhysics.set(item.id, {
          speed: item.speed, driftSpeed: item.driftSpeed,
          driftPhase: item.driftPhase, baseX: item.baseX, spawnTime: item.spawnTime
        });
      }
    }
    if (state.boxW) refs.boxW = state.boxW;
  },
  onTick(now, refs) {
    if (!refs.box || refs.clockDelta === null || refs.resolved) return;
    const hostNow = now - refs.clockDelta;
    const boxW = refs.boxW || refs.box.clientWidth;
    for (const [id, itemEl] of refs.itemEls) {
      const p = refs.itemPhysics.get(id);
      if (!p) continue;
      const age = (hostNow - p.spawnTime) / 1000;
      if (age < 0) continue;
      const y = -MH_ITEM_SIZE + p.speed * age;
      const drift = Math.sin(age * 2.5 + p.driftPhase) * p.driftSpeed * 0.5;
      const x = Math.max(MH_PADDING, Math.min(boxW - MH_ITEM_SIZE - MH_PADDING, p.baseX + drift));
      itemEl.style.left = `${x}px`;
      itemEl.style.top = `${y}px`;
    }
  },
  onEffect(effect, duration, refs) {
    if (!refs.box) return;
    const cls = effect === "freeze" ? "mh-frozen" : effect === "bomb" ? "mh-obscured" : "mh-box-penalty";
    refs.box.classList.add(cls);
    setTimeout(() => refs.box?.classList.remove(cls), duration);
  },
  onSplat(x, y, refs) { _renderSplat(refs.box, x, y); },
  onDestroy(refs) {
    refs.itemEls?.clear();
    refs.itemPhysics?.clear();
  }
});
