import { registerGameForSpectate, notifySpectateUpdate, broadcastCursorToSpectators, registerSpectateConfig } from "../spectate-engine.js";
import { ApplicationV2, HandlebarsApplicationMixin, difficultyLevel, cleanupSoloGame, buildLocCache, soloGameDefaults, soloGameParts } from "./minigame-helpers.js";
import { MODULE_ID, i18n, i18nFormat } from "../afk-tavern.js";
import { submitHighscore, getMyBest } from "../highscore-manager.js";

const getLoc = buildLocCache(() => ({
  score: i18n("AFK_TAVERN.whackAMole.score"),
  best: i18n("AFK_TAVERN.whackAMole.best"),
  time: i18n("AFK_TAVERN.whackAMole.time"),
  start: i18n("AFK_TAVERN.whackAMole.start"),
  gameOver: i18n("AFK_TAVERN.whackAMole.gameOver"),
  tryAgain: i18n("AFK_TAVERN.whackAMole.tryAgain"),
  mimicHint: i18n("AFK_TAVERN.whackAMole.mimicHint")
}));

const DIFFICULTY_MAP = {
  "Easy (30s, slow)":        { duration: 30, minShow: 1200, maxShow: 2000, slots: 6,  cols: 3 },
  "Medium (30s, normal)":    { duration: 30, minShow: 800,  maxShow: 1400, slots: 9,  cols: 3 },
  "Hard (30s, fast)":        { duration: 30, minShow: 500,  maxShow: 900,  slots: 9,  cols: 3 },
  "Expert (45s, 12 slots)":  { duration: 45, minShow: 500,  maxShow: 800,  slots: 12, cols: 4 },
  "Master (60s, 12 slots)":  { duration: 60, minShow: 400,  maxShow: 700,  slots: 12, cols: 4 },
  "Legendary (60s, 16 slots)": { duration: 60, minShow: 350, maxShow: 600, slots: 16, cols: 4 }
};

const MOLE_TYPES = [
  { type: "mimic", emoji: "👹", points: 1, chance: 0.65 },
  { type: "chest", emoji: "💰", points: 3, chance: 0.2 },
  { type: "cat", emoji: "🐱", points: -2, chance: 0.15 }
];

const ICONS = { mimic: "fa-solid fa-ghost", chest: "fa-solid fa-coins", cat: "fa-solid fa-cat" };

export class WhackAMoleApp extends HandlebarsApplicationMixin(ApplicationV2) {

  #difficulty;
  #config;
  #score = 0;
  #highScore = 0;
  #timeLeft = 0;
  #active = [];
  #isPlaying = false;
  #gameOver = false;
  #smashedSlots = [];
  #gameLoop = null;
  #timerLoop = null;
  #combo = 0;
  #lastCursorEmit = 0;
  #moveAbort = null;

  constructor(options = {}) {
    super(options);
    this.#difficulty = options.difficulty ?? "Medium (30s, normal)";
    this.#config = DIFFICULTY_MAP[this.#difficulty] ?? DIFFICULTY_MAP["Medium (30s, normal)"];
    this.#active = Array(this.#config.slots).fill(null);
    registerGameForSpectate(this);
    getMyBest("whack-a-mole", this.#difficulty).then(b => { if (b) { this.#highScore = b.score; this.render(false); } });
  }

  static DEFAULT_OPTIONS = soloGameDefaults("whack-a-mole", {
    title: "AFK_TAVERN.whackAMole.title",
    icon: "fa-solid fa-hammer",
    width: 360,
    actions: {
      whack: WhackAMoleApp.#onWhack,
      startGame: WhackAMoleApp.#onStartGame,
      newGame: WhackAMoleApp.#onNewGame
    }
  });

  static PARTS = soloGameParts("whack-a-mole-board.hbs", { footer: false });

  async _prepareContext(options) {
    const loc = getLoc();
    const timerCls = this.#timeLeft <= 5 ? "wam-timer-urgent" : (this.#timeLeft <= 10 ? "wam-timer-warning" : "");
    return {
      stats: [
        { icon: "fa-solid fa-star", label: loc.score, value: this.#score, valueCls: "wam-score-value" },
        { icon: "fa-solid fa-stopwatch", label: loc.time, value: this.#timeLeft, cls: timerCls, valueCls: "wam-time-value" },
        { icon: "fa-solid fa-trophy", label: loc.best, value: this.#highScore }
      ],
      barrels: this.#active.map((mole, i) => ({
        index: i,
        hasMole: mole !== null,
        emoji: mole?.emoji ?? "",
        type: mole?.type ?? "",
        isMimic: mole?.type === "mimic",
        isChest: mole?.type === "chest",
        isCat: mole?.type === "cat",
        isHit: false
      })),
      cols: this.#config.cols ?? 3,
      score: this.#score,
      highScore: this.#highScore,
      timeLeft: this.#timeLeft,
      isPlaying: this.#isPlaying,
      gameOver: this.#gameOver,
      notStarted: !this.#isPlaying && !this.#gameOver,
      combo: this.#combo,
      comboText: this.#combo >= 2 ? i18nFormat("AFK_TAVERN.whackAMole.streak", { count: this.#combo }) : "",
      difficulty: this.#difficulty,
      difficultyLevel: difficultyLevel(this.#difficulty),
      loc
    };
  }

  _onRender(context, options) {
    const cols = this.#config.cols ?? 3;
    const grid = this.element?.querySelector(".wam-grid");
    if (grid) grid.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
    if (cols >= 4) this.setPosition({ width: 460 });

    this.#moveAbort?.abort();
    this.#moveAbort = new AbortController();
    const frame = this.element?.querySelector(".wam-board-frame");
    if (frame) {
      frame.addEventListener("mousemove", (e) => {
        const now = performance.now();
        if (now - this.#lastCursorEmit < 33) return;
        this.#lastCursorEmit = now;
        const rect = frame.getBoundingClientRect();
        broadcastCursorToSpectators(
          (e.clientX - rect.left) / rect.width,
          (e.clientY - rect.top) / rect.height
        );
      }, { signal: this.#moveAbort.signal });
    }
  }

  #startGame() {
    this.#score = 0;
    this.#combo = 0;
    this.#timeLeft = this.#config.duration;
    this.#active = Array(this.#config.slots).fill(null);
    this.#smashedSlots = [];
    this.#isPlaying = true;
    this.#gameOver = false;
    this.render(false);
    notifySpectateUpdate({ immediate: true });
    this.#spawnLoop();
    this.#timerLoop = setInterval(() => {
      this.#timeLeft--;
      this.#updateDOM(".wam-time-value", this.#timeLeft);
      notifySpectateUpdate();
      if (this.#timeLeft <= 0) this.#endGame();
    }, 1000);
  }

  #spawnLoop() {
    if (!this.#isPlaying) return;
    const delay = this.#config.minShow + Math.random() * (this.#config.maxShow - this.#config.minShow);
    this.#gameLoop = setTimeout(() => {
      if (!this.#isPlaying) return;
      const emptySlots = this.#active.map((v, i) => {
        if (v !== null) return -1;
        const hole = this.element?.querySelector(`[data-index="${i}"]`);
        if (hole?.classList.contains("wam-smashed")) return -1;
        return i;
      }).filter(i => i >= 0);
      if (emptySlots.length > 0) {
        const slot = emptySlots[Math.floor(Math.random() * emptySlots.length)];
        const roll = Math.random();
        let cumulative = 0;
        let mole = MOLE_TYPES[0];
        for (const m of MOLE_TYPES) {
          cumulative += m.chance;
          if (roll <= cumulative) { mole = m; break; }
        }
        this.#active[slot] = { ...mole, token: Math.random() };
        const activeToken = this.#active[slot].token;
        this.#showMoleDOM(slot, mole);
        notifySpectateUpdate({ immediate: true });

        const showTime = this.#config.minShow + Math.random() * 500;
        setTimeout(() => {
          if (this.#active[slot]?.token === activeToken) {
            if (this.#active[slot].points > 0) {
              this.#combo = 0;
              this.#updateComboDOM();
            }
            this.#active[slot] = null;
            this.#hideMoleDOM(slot);
            notifySpectateUpdate({ immediate: true });
          }
        }, showTime);
      }
      this.#spawnLoop();
    }, delay);
  }

  #showMoleDOM(slot, mole) {
    const hole = this.element?.querySelector(`[data-index="${slot}"]`);
    if (!hole) return;
    hole.classList.remove("wam-smashed");
    hole.querySelectorAll(".wam-score-float").forEach(f => f.remove());
    hole.classList.add("wam-occupied");
    const inner = hole.querySelector(".wam-hole-inner");
    if (!inner) return;
    inner.innerHTML = `<div class="wam-creature wam-creature-${mole.type}"><i class="${ICONS[mole.type]}"></i></div>`;
  }

  #hideMoleDOM(slot) {
    const hole = this.element?.querySelector(`[data-index="${slot}"]`);
    if (!hole) return;
    hole.classList.remove("wam-occupied", "wam-smashed");
    const inner = hole.querySelector(".wam-hole-inner");
    if (inner) inner.innerHTML = "";
  }

  #updateDOM(selector, value) {
    const el = this.element?.querySelector(selector);
    if (el) el.textContent = value;
  }

  #updateScoreDOM() {
    this.#updateDOM(".wam-score-value", this.#score);
    const el = this.element?.querySelector(".wam-score-value");
    if (el) {
      el.style.transform = "scale(1.2)";
      setTimeout(() => { if (el) el.style.transform = "scale(1)"; }, 200);
    }
  }

  #updateComboDOM() {
    const bar = this.element?.querySelector(".wam-combo-bar");
    if (!bar) return;
    if (this.#combo >= 2) {
      bar.classList.remove("wam-combo-hidden");
      const text = bar.querySelector(".wam-combo-text");
      if (text) text.textContent = i18nFormat("AFK_TAVERN.whackAMole.streak", { count: this.#combo });
    } else {
      bar.classList.add("wam-combo-hidden");
    }
  }

  #showStreakBonus(bonus) {
    const bar = this.element?.querySelector(".wam-combo-bar");
    if (!bar) return;
    const float = document.createElement("div");
    float.className = "wam-streak-bonus";
    float.textContent = i18nFormat("AFK_TAVERN.whackAMole.streakBonus", { count: this.#combo, bonus });
    bar.appendChild(float);
    setTimeout(() => float.remove(), 1200);
  }

  #endGame() {
    this.#isPlaying = false;
    this.#gameOver = true;
    if (this.#score > this.#highScore) this.#highScore = this.#score;
    submitHighscore("whack-a-mole", this.#score, this.#difficulty);
    if (this.#gameLoop) { clearTimeout(this.#gameLoop); this.#gameLoop = null; }
    if (this.#timerLoop) { clearInterval(this.#timerLoop); this.#timerLoop = null; }
    this.#active = Array(this.#config.slots).fill(null);
    this.render(false);
    notifySpectateUpdate({ immediate: true });
  }

  close(options) {
    if (this.#gameLoop) clearTimeout(this.#gameLoop);
    if (this.#timerLoop) clearInterval(this.#timerLoop);
    this.#moveAbort?.abort();
    cleanupSoloGame(this);
    return super.close(options);
  }

  static #onWhack(event, target) {
    if (!this.#isPlaying) return;
    const i = Number(target.dataset.index ?? target.closest("[data-index]")?.dataset.index);
    if (isNaN(i)) return;
    const mole = this.#active[i];
    if (!mole) return;

    this.#score += mole.points;
    if (mole.points > 0) {
      this.#combo++;
      let bonus = 0;
      if (this.#combo > 0 && this.#combo % 10 === 0) bonus = 2;
      else if (this.#combo > 0 && this.#combo % 5 === 0) bonus = 1;
      if (bonus) {
        this.#score += bonus;
        this.#showStreakBonus(bonus);
      }
    } else {
      this.#combo = 0;
    }
    this.#score = Math.max(0, this.#score);

    this.#active[i] = null;
    this.#smashedSlots.push({ slot: i, points: mole.points });
    const hole = this.element?.querySelector(`[data-index="${i}"]`);
    if (hole) {
      hole.classList.add("wam-smashed");
      const float = document.createElement("div");
      float.className = `wam-score-float ${mole.points > 0 ? "wam-float-good" : "wam-float-bad"}`;
      float.textContent = mole.points > 0 ? `+${mole.points}` : `${mole.points}`;
      hole.appendChild(float);
      setTimeout(() => {
        float.remove();
        if (!this.#active[i]) this.#hideMoleDOM(i);
      }, 800);
    }

    this.#updateScoreDOM();
    this.#updateComboDOM();
    notifySpectateUpdate({ immediate: true });
  }

  static #onStartGame() { this.#startGame(); }
  static #onNewGame() { this.#startGame(); }

  getSpectateState() {
    const smashed = this.#smashedSlots;
    this.#smashedSlots = [];
    return {
      gameType: "whack-a-mole",
      data: {
        slots: this.#active.map(m => m ? { type: m.type } : null),
        smashed,
        cols: this.#config.cols ?? 3,
        score: this.#score,
        highScore: this.#highScore,
        timeLeft: this.#timeLeft,
        combo: this.#combo,
        isPlaying: this.#isPlaying,
        gameOver: this.#gameOver,
        difficulty: this.#difficulty
      }
    };
  }
}

registerSpectateConfig("whack-a-mole", {
  template: "whack-a-mole-board.hbs",
  cursor: true,
  cursorClass: "wam-spectate-cursor",
  cursorTarget: ".wam-board-frame",
  mapContext(state) {
    const totalSlots = state.slots?.length ?? 9;
    return {
      stats: [
        { icon: "fa-solid fa-star", label: i18n("AFK_TAVERN.whackAMole.score"), value: 0, valueCls: "sp-score" },
        { icon: "fa-solid fa-stopwatch", label: i18n("AFK_TAVERN.whackAMole.time"), value: 0, valueCls: "sp-time" },
        { icon: "fa-solid fa-trophy", label: i18n("AFK_TAVERN.whackAMole.best"), value: 0, valueCls: "sp-best" }
      ],
      difficulty: state.difficulty, difficultyLevel: difficultyLevel(state.difficulty),
      barrels: Array.from({ length: totalSlots }, (_, i) => ({ index: i, hasMole: false, type: "", isMimic: false, isChest: false, isCat: false, isHit: false })),
      combo: 0, comboText: "", gameOver: true, notStarted: false, score: 0,
      loc: { score: i18n("AFK_TAVERN.whackAMole.score"), gameOver: i18n("AFK_TAVERN.whackAMole.gameOver"), tryAgain: i18n("AFK_TAVERN.whackAMole.tryAgain"), start: i18n("AFK_TAVERN.whackAMole.start") }
    };
  },
  sync: [
    { sel: ".sp-score", text: s => s.score ?? 0 },
    { sel: ".sp-best", text: s => s.highScore ?? 0 },
    { sel: ".solo-results-overlay", show: s => s.gameOver },
    { sel: ".solo-results-score", text: s => s.score ?? 0 }
  ],
  onBuild(el) {
    return {
      grid: el.querySelector(".wam-grid"),
      comboBar: el.querySelector(".wam-combo-bar"),
      comboText: el.querySelector(".wam-combo-text"),
      timeEl: el.querySelector(".sp-time"),
      prevSlots: Array(el.querySelectorAll(".wam-hole").length).fill(null)
    };
  },
  onSync(el, state, prev, refs) {
    if (refs.timeEl) {
      refs.timeEl.textContent = state.timeLeft ?? 0;
      if (state.timeLeft <= 5) refs.timeEl.style.color = "#ee4444";
      else if (state.timeLeft <= 10) refs.timeEl.style.color = "#ddaa33";
      else refs.timeEl.style.color = "";
    }
    if (state.combo >= 2) {
      refs.comboBar?.classList.remove("wam-combo-hidden");
      if (refs.comboText) refs.comboText.textContent = i18nFormat("AFK_TAVERN.whackAMole.streak", { count: state.combo });
    } else {
      refs.comboBar?.classList.add("wam-combo-hidden");
    }
    const slots = state.slots ?? [];
    const smashedMap = new Map();
    for (const hit of (state.smashed ?? [])) smashedMap.set(hit.slot, hit.points);
    for (let i = 0; i < slots.length; i++) {
      const prevSlot = refs.prevSlots[i];
      const curr = slots[i];
      const hole = refs.grid?.children[i];
      if (!hole) continue;
      const inner = hole.querySelector(".wam-hole-inner");
      if (!inner) continue;
      const prevType = prevSlot?.type ?? null;
      const currType = curr?.type ?? null;
      if (prevType === currType && !smashedMap.has(i)) continue;
      if (currType) {
        hole.classList.remove("wam-smashed");
        hole.classList.add("wam-occupied");
        inner.innerHTML = `<div class="wam-creature wam-creature-${currType}"><i class="${ICONS[currType] ?? ""}"></i></div>`;
      } else if (smashedMap.has(i)) {
        const pts = smashedMap.get(i);
        hole.classList.add("wam-smashed");
        const float = document.createElement("div");
        float.className = `wam-score-float ${pts > 0 ? "wam-float-good" : "wam-float-bad"}`;
        float.textContent = pts > 0 ? `+${pts}` : `${pts}`;
        hole.appendChild(float);
        setTimeout(() => { float.remove(); hole.classList.remove("wam-occupied", "wam-smashed"); inner.innerHTML = ""; }, 800);
      } else {
        hole.classList.remove("wam-occupied", "wam-smashed");
        inner.innerHTML = "";
      }
    }
    refs.prevSlots = slots.map(s => s ? { ...s } : null);
  }
});
