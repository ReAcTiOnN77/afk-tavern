import { registerGameForSpectate, notifySpectateUpdate, registerSpectateConfig } from "../spectate-engine.js";
import { ApplicationV2, HandlebarsApplicationMixin, formatTime, difficultyLevel, cleanupSoloGame, buildLocCache, soloGameDefaults, soloGameParts } from "./minigame-helpers.js";
import { MODULE_ID, i18n, i18nFormat } from "../afk-tavern.js";
import { submitHighscore } from "../highscore-manager.js";

const getLoc = buildLocCache(() => ({
  moves: i18n("AFK_TAVERN.memoryMatch.moves"),
  time: i18n("AFK_TAVERN.memoryMatch.time"),
  pairs: i18n("AFK_TAVERN.memoryMatch.pairs"),
  victory: i18n("AFK_TAVERN.memoryMatch.victory"),
  playAgain: i18n("AFK_TAVERN.memoryMatch.playAgain"),
  newGame: i18n("AFK_TAVERN.memoryMatch.newGame")
}));

const CARD_SETS = [
  { emoji: "🐉", name: "Dragon" },
  { emoji: "👹", name: "Goblin" },
  { emoji: "💀", name: "Skeleton" },
  { emoji: "🧙", name: "Wizard" },
  { emoji: "🗡️", name: "Sword" },
  { emoji: "🛡️", name: "Shield" },
  { emoji: "🧪", name: "Potion" },
  { emoji: "📜", name: "Scroll" },
  { emoji: "💎", name: "Gem" },
  { emoji: "🏰", name: "Castle" },
  { emoji: "🕷️", name: "Spider" },
  { emoji: "🦇", name: "Bat" },
  { emoji: "🐺", name: "Wolf" },
  { emoji: "🔮", name: "Orb" },
  { emoji: "⚔️", name: "Crossed Swords" },
  { emoji: "🏹", name: "Bow" },
  { emoji: "🪓", name: "Axe" },
  { emoji: "🐍", name: "Serpent" },
  { emoji: "🦅", name: "Eagle" },
  { emoji: "🔥", name: "Fire" }
];

const DIFFICULTY_MAP = {
  "Easy (3×4)":        { cols: 4, rows: 3, pairs: 6 },
  "Medium (4×4)":      { cols: 4, rows: 4, pairs: 8 },
  "Hard (4×5)":        { cols: 5, rows: 4, pairs: 10 },
  "Expert (4×6)":      { cols: 6, rows: 4, pairs: 12 },
  "Master (5×6)":      { cols: 6, rows: 5, pairs: 15 },
  "Legendary (5×8)":   { cols: 8, rows: 5, pairs: 20 }
};

export class MemoryMatchApp extends HandlebarsApplicationMixin(ApplicationV2) {

  #difficulty;
  #cards = [];
  #flipped = [];
  #matched = new Set();
  #moves = 0;
  #startTime = null;
  #elapsed = 0;
  #timerInterval = null;
  #lockBoard = false;
  #gameComplete = false;
  #gridConfig;
  #mismatchTimer = null;

  constructor(options = {}) {
    super(options);
    this.#difficulty = options.difficulty ?? "Medium (4×4)";
    this.#gridConfig = DIFFICULTY_MAP[this.#difficulty] ?? DIFFICULTY_MAP["Medium (4×4)"];
    this.#initCards();
    registerGameForSpectate(this);
  }

  static DEFAULT_OPTIONS = soloGameDefaults("memory-match", {
    title: "AFK_TAVERN.memoryMatch.title",
    icon: "fa-solid fa-clone",
    width: 520,
    actions: {
      flipCard: MemoryMatchApp.#onFlipCard,
      newGame: MemoryMatchApp.#onNewGame
    }
  });

  static PARTS = soloGameParts("memory-match-board.hbs");

  #initCards() {
    const shuffled = [...CARD_SETS].sort(() => Math.random() - 0.5);
    const selected = shuffled.slice(0, this.#gridConfig.pairs);
    const deck = [];
    for (const card of selected) {
      deck.push({ ...card, uid: foundry.utils.randomID() });
      deck.push({ ...card, uid: foundry.utils.randomID() });
    }
    this.#cards = deck.sort(() => Math.random() - 0.5);
    this.#flipped = [];
    this.#matched = new Set();
    this.#moves = 0;
    this.#startTime = null;
    this.#elapsed = 0;
    this.#lockBoard = false;
    this.#gameComplete = false;
    this.#stopTimer();
  }

  async _prepareContext(options) {
    const { mm, ss } = formatTime(this.#elapsed);
    const elapsedFormatted = `${mm}:${ss}`;
    const loc = getLoc();
    const cards = this.#cards.map((card, index) => ({
      index,
      uid: card.uid,
      emoji: card.emoji,
      name: card.name,
      isFlipped: this.#flipped.includes(index),
      isMatched: this.#matched.has(card.uid)
    }));

    return {
      stats: [
        { icon: "fa-solid fa-arrows-rotate", label: loc.moves, value: this.#moves },
        { icon: "fa-solid fa-stopwatch", label: loc.time, value: elapsedFormatted, valueCls: "mm-timer-value" },
        { icon: "fa-solid fa-check-double", label: loc.pairs, value: `${this.#matched.size / 2} / ${this.#gridConfig.pairs}` }
      ],
      showFooter: true,
      footerLabel: loc.newGame,
      cards,
      cols: this.#gridConfig.cols,
      rows: this.#gridConfig.rows,
      moves: this.#moves,
      elapsed: elapsedFormatted,
      matchedCount: this.#matched.size / 2,
      totalPairs: this.#gridConfig.pairs,
      gameComplete: this.#gameComplete,
      difficulty: this.#difficulty,
      difficultyLevel: difficultyLevel(this.#difficulty),
      victoryStats: i18nFormat("AFK_TAVERN.memoryMatch.victoryStats", { moves: this.#moves, time: elapsedFormatted }),
      loc
    };
  }

  _onRender(context, options) {
    const html = this.element;
    if (!html) return;

    const CARD_SIZE = 100;
    const GAP = 8;
    const PAD = 86;

    const grid = html.querySelector(".mm-grid");
    if (grid) {
      grid.style.gridTemplateColumns = `repeat(${this.#gridConfig.cols}, ${CARD_SIZE}px)`;
    }

    const dynWidth = (this.#gridConfig.cols * CARD_SIZE) + ((this.#gridConfig.cols - 1) * GAP) + PAD;
    this.setPosition({ width: Math.max(360, dynWidth) });
  }

  close(options) {
    this.#stopTimer();
    if (this.#mismatchTimer) clearTimeout(this.#mismatchTimer);
    cleanupSoloGame(this);
    return super.close(options);
  }

  #startTimer() {
    if (this.#timerInterval) return;
    this.#startTime = Date.now() - (this.#elapsed * 1000);
    this.#timerInterval = setInterval(() => {
      this.#elapsed = Math.floor((Date.now() - this.#startTime) / 1000);
      const timerEl = this.element?.querySelector(".mm-timer-value");
      if (timerEl) { const { mm, ss } = formatTime(this.#elapsed); timerEl.textContent = `${mm}:${ss}`; }
      notifySpectateUpdate();
    }, 1000);
  }

  #stopTimer() {
    if (this.#timerInterval) {
      clearInterval(this.#timerInterval);
      this.#timerInterval = null;
    }
  }

  static #onFlipCard(event, target) {
    if (this.#lockBoard || this.#gameComplete) return;
    const index = Number(target.dataset.index);
    if (isNaN(index)) return;
    const card = this.#cards[index];
    if (!card) return;
    if (this.#flipped.includes(index)) return;
    if (this.#matched.has(card.uid)) return;

    if (!this.#startTime && this.#moves === 0) this.#startTimer();

    this.#flipped.push(index);

    const cardEl = target.closest(".mm-card");
    if (cardEl) cardEl.classList.add("mm-flipped");
    notifySpectateUpdate({ immediate: true });

    if (this.#flipped.length === 2) {
      this.#moves++;
      const [i1, i2] = this.#flipped;
      const c1 = this.#cards[i1];
      const c2 = this.#cards[i2];

      if (c1.name === c2.name) {
        this.#matched.add(c1.uid);
        this.#matched.add(c2.uid);
        this.#flipped = [];
        this.render(false);
        notifySpectateUpdate({ immediate: true });

        if (this.#matched.size / 2 === this.#gridConfig.pairs) {
          this.#gameComplete = true;
          this.#stopTimer();
          submitHighscore("memory-match", this.#moves, this.#difficulty, true);
          this.render(false);
          notifySpectateUpdate({ immediate: true });
        }
      } else {
        this.#lockBoard = true;
        this.#mismatchTimer = setTimeout(() => {
          this.#mismatchTimer = null;
          this.#flipped = [];
          this.#lockBoard = false;
          this.render(false);
          notifySpectateUpdate({ immediate: true });
        }, 900);
      }
    }
  }

  static #onNewGame(event, target) {
    this.#initCards();
    this.render(false);
    notifySpectateUpdate();
  }

  getSpectateState() {
    return {
      gameType: "memory-match",
      data: {
        cards: this.#cards.map(c => ({ emoji: c.emoji, uid: c.uid })),
        flipped: [...this.#flipped],
        matched: [...this.#matched],
        moves: this.#moves,
        elapsed: this.#elapsed,
        pairs: this.#gridConfig.pairs,
        cols: this.#gridConfig.cols,
        rows: this.#gridConfig.rows,
        difficulty: this.#difficulty,
        gameComplete: this.#gameComplete
      }
    };
  }
}

registerSpectateConfig("memory-match", {
  template: "memory-match-board.hbs",
  mapContext(state) {
    const { mm, ss } = formatTime(state.elapsed ?? 0);
    return {
      stats: [
        { icon: "fa-solid fa-arrows-rotate", label: i18n("AFK_TAVERN.memoryMatch.moves"), value: state.moves ?? 0, valueCls: "sp-moves" },
        { icon: "fa-solid fa-stopwatch", label: i18n("AFK_TAVERN.memoryMatch.time"), value: `${mm}:${ss}`, valueCls: "sp-time" },
        { icon: "fa-solid fa-check-double", label: i18n("AFK_TAVERN.memoryMatch.pairs"), value: `0 / ${state.pairs ?? 0}`, valueCls: "sp-pairs" }
      ],
      difficulty: state.difficulty, difficultyLevel: difficultyLevel(state.difficulty),
      gameComplete: true, cards: (state.cards ?? []).map((c, i) => ({ index: i, emoji: c.emoji, isFlipped: false, isMatched: false })),
      moves: state.moves ?? 0, victoryStats: "",
      loc: { victory: i18n("AFK_TAVERN.spectate.allMatched"), playAgain: i18n("AFK_TAVERN.memoryMatch.playAgain"), moves: i18n("AFK_TAVERN.memoryMatch.moves") }
    };
  },
  sync: [
    { sel: ".sp-moves", text: s => s.moves ?? 0 },
    { sel: ".sp-time", text: s => { const t = formatTime(s.elapsed ?? 0); return `${t.mm}:${t.ss}`; } },
    { sel: ".sp-pairs", text: s => `${Math.floor((s.matched?.length ?? 0) / 2)} / ${s.pairs ?? 0}` },
    { sel: ".solo-results-overlay", show: s => s.gameComplete },
    { sel: ".solo-results-score", text: s => s.moves ?? 0 }
  ],
  onBuild(el, state) {
    const grid = el.querySelector(".mm-grid");
    if (grid) grid.style.gridTemplateColumns = `repeat(${state.cols ?? 4}, 100px)`;
    return { cards: [...el.querySelectorAll(".mm-card")] };
  },
  onSync(el, state, prev, refs) {
    const flippedSet = new Set(state.flipped ?? []);
    const matchedSet = new Set(state.matched ?? []);
    const cards = state.cards ?? [];
    for (let i = 0; i < refs.cards.length; i++) {
      const cardEl = refs.cards[i];
      const uid = cards[i]?.uid;
      const isFlipped = flippedSet.has(i);
      const isMatched = matchedSet.has(uid);
      const wasMatched = cardEl.classList.contains("mm-matched");
      cardEl.classList.toggle("mm-flipped", isFlipped || isMatched);
      cardEl.classList.toggle("mm-matched", isMatched);
      if (isMatched && !wasMatched) {
        const inner = cardEl.querySelector(".mm-card-inner");
        if (inner) { inner.style.animation = "none"; inner.offsetHeight; inner.style.animation = ""; }
      }
    }
  }
});
