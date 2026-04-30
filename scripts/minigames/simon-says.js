import { registerGameForSpectate, notifySpectateUpdate, registerSpectateConfig } from "../spectate-engine.js";
import { ApplicationV2, HandlebarsApplicationMixin, difficultyLevel, cleanupSoloGame, buildLocCache, soloGameDefaults, soloGameParts } from "./minigame-helpers.js";
import { MODULE_ID, i18n } from "../afk-tavern.js";
import { submitHighscore, getMyBest } from "../highscore-manager.js";

const getLoc = buildLocCache(() => ({
  round:    i18n("AFK_TAVERN.simonSays.round"),
  best:     i18n("AFK_TAVERN.simonSays.best"),
  watch:    i18n("AFK_TAVERN.simonSays.watch"),
  yourTurn: i18n("AFK_TAVERN.simonSays.yourTurn"),
  start:    i18n("AFK_TAVERN.simonSays.start"),
  gameOver: i18n("AFK_TAVERN.simonSays.gameOver"),
  tryAgain: i18n("AFK_TAVERN.simonSays.tryAgain")
}));

const COLOURS = [
  { id: "red",    color: "#cc3333", glow: "#ff6644" },
  { id: "blue",   color: "#3366cc", glow: "#55aaff" },
  { id: "green",  color: "#33aa44", glow: "#55ee66" },
  { id: "yellow", color: "#ccaa22", glow: "#ffdd44" },
  { id: "purple", color: "#8844aa", glow: "#bb66ee" },
  { id: "orange", color: "#cc6622", glow: "#ff8844" },
  { id: "silver", color: "#aaaacc", glow: "#ddddf8" },
  { id: "pink",   color: "#991144", glow: "#dd3366" },
  { id: "teal",   color: "#228888", glow: "#44cccc" }
];

const DIFFICULTY_MAP = {
  "Easy (4 colours)":      { startLen: 4, speedMs: 600, colours: 4 },
  "Medium (5 colours)":    { startLen: 4, speedMs: 500, colours: 5 },
  "Hard (6 colours)":      { startLen: 4, speedMs: 400, colours: 6 },
  "Expert (7 colours)":    { startLen: 4, speedMs: 350, colours: 7 },
  "Master (8 colours)":    { startLen: 4, speedMs: 350, colours: 8 },
  "Legendary (9 colours)": { startLen: 4, speedMs: 350, colours: 9 }
};

export class SimonSaysApp extends HandlebarsApplicationMixin(ApplicationV2) {

  #difficulty;
  #config;
  #sequence = [];
  #playerInput = [];
  #round = 0;
  #highScore = 0;
  #isShowingSequence = false;
  #gameOver = false;
  #activeColour = null;
  #pendingTimers = new Set();

  constructor(options = {}) {
    super(options);
    this.#difficulty = options.difficulty ?? "Medium (5 colours)";
    this.#config = DIFFICULTY_MAP[this.#difficulty] ?? DIFFICULTY_MAP["Medium (5 colours)"];
    registerGameForSpectate(this);
    getMyBest("simon-says", this.#difficulty).then(b => { if (b) { this.#highScore = b.score; this.render(false); } });
  }

  get #activeColours() {
    return COLOURS.slice(0, this.#config.colours ?? 4);
  }

  static DEFAULT_OPTIONS = soloGameDefaults("simon-says", {
    title: "AFK_TAVERN.simonSays.title",
    icon: "fa-solid fa-wand-magic-sparkles",
    width: 340,
    actions: {
      clickColour: SimonSaysApp.#onClickColour,
      startGame:    SimonSaysApp.#onStartGame,
      newGame:      SimonSaysApp.#onNewGame
    }
  });

  static PARTS = soloGameParts("simon-says-board.hbs", { footer: false });

  _onFirstRender(context, options) {
    if ((this.#config.colours ?? 4) >= 7) {
      this.setPosition({ width: 500 });
    }
  }

  async _prepareContext(options) {
    const loc = getLoc();
    return {
      stats: [
        { icon: "fa-solid fa-layer-group", label: loc.round, value: this.#round },
        { icon: "fa-solid fa-trophy", label: loc.best, value: this.#highScore }
      ],
      colours: this.#activeColours.map(e => ({
        ...e,
        isActive: this.#activeColour === e.id
      })),
      gridCols: 2,
      gridLayout: (() => {
        const count = this.#activeColours.length;
        if (count === 5) return "ss-layout-5";
        if (count === 7) return "ss-layout-7";
        if (count === 8) return "ss-layout-8";
        if (count >= 9) return "ss-layout-9";
        return "";
      })(),
      round: this.#round,
      seqLen: this.#sequence.length,
      highScore: this.#highScore,
      isPlaying: this.#sequence.length > 0 && !this.#gameOver,
      isShowingSequence: this.#isShowingSequence,
      gameOver: this.#gameOver,
      notStarted: this.#sequence.length === 0 && !this.#gameOver,
      inputProgress: this.#playerInput.length,
      difficulty: this.#difficulty,
      difficultyLevel: difficultyLevel(this.#difficulty),
      loc
    };
  }

  #startNewRound() {
    this.#round++;
    const addCount = this.#round === 1 ? this.#config.startLen : 1;
    for (let i = 0; i < addCount; i++) {
      this.#sequence.push(this.#activeColours[Math.floor(Math.random() * this.#activeColours.length)].id);
    }
    this.#playerInput = [];
    this.render(false);
    notifySpectateUpdate();
    this.#safeTimeout(() => this.#showSequence(), 500);
  }

  async #showSequence() {
    this.#isShowingSequence = true;
    this.render(false);
    notifySpectateUpdate();
    for (let i = 0; i < this.#sequence.length; i++) {
      await this.#flashColour(this.#sequence[i]);
      await this.#wait(150);
    }
    this.#isShowingSequence = false;
    this.render(false);
    notifySpectateUpdate();
  }

  #flashColour(id) {
    return new Promise(resolve => {
      this.#activeColour = id;
      this.render(false);
      notifySpectateUpdate({ immediate: true });
      this.#safeTimeout(() => {
        this.#activeColour = null;
        this.render(false);
        notifySpectateUpdate({ immediate: true });
        resolve();
      }, this.#config.speedMs);
    });
  }

  #wait(ms) {
    return new Promise(r => this.#safeTimeout(r, ms));
  }

  #handleInput(id) {
    if (this.#isShowingSequence || this.#gameOver) return;
    if (this.#playerInput.length >= this.#sequence.length) return;
    const expected = this.#sequence[this.#playerInput.length];
    this.#playerInput.push(id);

    this.#flashInputDOM(id);
    this.#updateProgressDOM();

    if (id !== expected) {
      this.#gameOver = true;
      if (this.#round > this.#highScore) this.#highScore = this.#round;
      submitHighscore("simon-says", this.#round, this.#difficulty);
      this.render(false);
      notifySpectateUpdate();
      return;
    }
    if (this.#playerInput.length === this.#sequence.length) {
      notifySpectateUpdate();
      this.#safeTimeout(() => this.#startNewRound(), 800);
    }
  }

  #flashInputDOM(id) {
    const btn = this.element?.querySelector(`[data-element-id="${id}"]`);
    if (!btn) return;
    btn.classList.remove("ss-orb-active");
    void btn.offsetWidth;
    btn.classList.add("ss-orb-active");
    this.#activeColour = id;
    notifySpectateUpdate({ immediate: true });
    this.#safeTimeout(() => {
      btn.classList.remove("ss-orb-active");
      this.#activeColour = null;
      notifySpectateUpdate({ immediate: true });
    }, 150);
  }

  #updateProgressDOM() {
    const statusEl = this.element?.querySelector(".ss-your-turn");
    if (!statusEl) return;
    const icon = statusEl.querySelector("i")?.outerHTML ?? "";
    const loc = getLoc();
    statusEl.innerHTML = `${icon} ${loc.yourTurn} (${this.#playerInput.length} / ${this.#sequence.length})`;
  }

  static #onClickColour(event, target) {
    const id = target.dataset.elementId ?? target.closest("[data-element-id]")?.dataset.elementId;
    if (id) this.#handleInput(id);
  }

  static #onStartGame() {
    this.#sequence = [];
    this.#playerInput = [];
    this.#round = 0;
    this.#gameOver = false;
    this.#startNewRound();
  }

  static #onNewGame() { SimonSaysApp.#onStartGame.call(this); }

  #safeTimeout(fn, ms) {
    const id = setTimeout(() => { this.#pendingTimers.delete(id); fn(); }, ms);
    this.#pendingTimers.add(id);
    return id;
  }

  close(options) {
    for (const id of this.#pendingTimers) clearTimeout(id);
    this.#pendingTimers.clear();
    cleanupSoloGame(this);
    return super.close(options);
  }

  getSpectateState() {
    const count = this.#activeColours.length;
    let gridLayout = "";
    if (count === 5) gridLayout = "ss-layout-5";
    else if (count === 7) gridLayout = "ss-layout-7";
    else if (count === 8) gridLayout = "ss-layout-8";
    else if (count >= 9) gridLayout = "ss-layout-9";
    return {
      gameType: "simon-says",
      data: {
        colours: this.#activeColours,
        activeColour: this.#activeColour,
        gridLayout,
        round: this.#round,
        highScore: this.#highScore,
        seqLen: this.#sequence.length,
        inputProgress: this.#playerInput.length,
        isShowingSequence: this.#isShowingSequence,
        isPlaying: this.#sequence.length > 0 && !this.#gameOver,
        gameOver: this.#gameOver,
        notStarted: this.#sequence.length === 0 && !this.#gameOver,
        difficulty: this.#difficulty
      }
    };
  }
}

const getSpLoc = buildLocCache(() => ({
  watch: i18n("AFK_TAVERN.simonSays.watch"),
  yourTurn: i18n("AFK_TAVERN.simonSays.yourTurn"),
  start: i18n("AFK_TAVERN.simonSays.start"),
  gameOver: i18n("AFK_TAVERN.simonSays.gameOver"),
  tryAgain: i18n("AFK_TAVERN.simonSays.tryAgain"),
  round: i18n("AFK_TAVERN.simonSays.round")
}));

registerSpectateConfig("simon-says", {
  template: "simon-says-board.hbs",
  mapContext(state) {
    const loc = getSpLoc();
    return {
      stats: [
        { icon: "fa-solid fa-layer-group", label: loc.round, value: state.round ?? 0, valueCls: "sp-round" },
        { icon: "fa-solid fa-trophy", label: i18n("AFK_TAVERN.simonSays.best"), value: state.highScore ?? 0, valueCls: "sp-best" }
      ],
      difficulty: state.difficulty, difficultyLevel: difficultyLevel(state.difficulty),
      colours: (state.colours ?? []).map(c => ({ ...c, isActive: false })),
      gridCols: 2, gridLayout: state.gridLayout ?? "",
      notStarted: false, gameOver: true, isPlaying: true, isShowingSequence: false,
      round: state.round ?? 0, seqLen: state.seqLen ?? 0, inputProgress: 0, loc
    };
  },
  sync: [
    { sel: ".sp-round", text: s => s.round ?? 0 },
    { sel: ".sp-best", text: s => s.highScore ?? 0 },
    { sel: ".solo-results-overlay", show: s => s.gameOver },
    { sel: ".solo-results-score", text: s => s.round ?? 0 }
  ],
  onBuild: (el) => ({
    orbs: [...el.querySelectorAll(".ss-orb")],
    status: el.querySelector(".ss-status")
  }),
  onSync(el, state, prev, refs) {
    for (const orb of refs.orbs) {
      orb.classList.toggle("ss-orb-active", orb.dataset.elementId === state.activeColour);
    }
    if (refs.status) {
      const loc = getSpLoc();
      if (state.isShowingSequence) refs.status.innerHTML = `<span class="ss-status-text ss-watching"><i class="fa-solid fa-eye"></i> ${loc.watch}</span>`;
      else if (state.isPlaying) refs.status.innerHTML = `<span class="ss-status-text ss-your-turn"><i class="fa-solid fa-hand-pointer"></i> ${loc.yourTurn} (${state.inputProgress ?? 0} / ${state.seqLen ?? 0})</span>`;
      else refs.status.textContent = "";
    }
  }
});
