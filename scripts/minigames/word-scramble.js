import { registerGameForSpectate, notifySpectateUpdate, registerSpectateConfig } from "../spectate-engine.js";
import { ApplicationV2, HandlebarsApplicationMixin, difficultyLevel, cleanupSoloGame, buildLocCache, soloGameDefaults, soloGameParts } from "./minigame-helpers.js";
import { MODULE_ID, i18n } from "../afk-tavern.js";
import { submitHighscore, getMyBest } from "../highscore-manager.js";

const getLoc = buildLocCache(() => ({
  score: i18n("AFK_TAVERN.wordScramble.score"),
  best: i18n("AFK_TAVERN.wordScramble.best"),
  solved: i18n("AFK_TAVERN.wordScramble.solved"),
  hint: i18n("AFK_TAVERN.wordScramble.hint"),
  skip: i18n("AFK_TAVERN.wordScramble.skip"),
  submit: i18n("AFK_TAVERN.wordScramble.submit"),
  placeholder: i18n("AFK_TAVERN.wordScramble.placeholder")
}));

let _wordLists = null;

async function getWordLists(moduleId) {
  if (_wordLists) return _wordLists;
  try {
    const response = await fetch(`modules/${moduleId}/assets/word-scramble-words.json`);
    if (response.ok) _wordLists = await response.json();
  } catch (e) {
    console.warn("AFK Tavern | Failed to load word scramble words", e);
  }
  _wordLists ??= { easy: [], medium: [], hard: [] };
  _wordLists.random = [...(_wordLists.easy ?? []), ...(_wordLists.medium ?? []), ...(_wordLists.hard ?? [])];
  return _wordLists;
}

const DIFFICULTY_MAP = {
  "Easy (3 letters)": "easy",
  "Medium (4-7 letters)": "medium",
  "Hard (7+ letters)": "hard",
  "Random (3-7+ letters)": "random"
};

export class WordScrambleApp extends HandlebarsApplicationMixin(ApplicationV2) {

  #difficulty;
  #wordPool;
  #currentWord = "";
  #scrambled = "";
  #guess = "";
  #score = 0;
  #solved = 0;
  #revealed = [];
  #hintedPositions = new Set();
  #scrambledMapping = [];
  #wordSolved = false;
  #gameMessage = "";
  #messageType = "";
  #listenerAbort = null;
  #personalBest = null;

  constructor(options = {}) {
    super(options);
    this.#difficulty = options.difficulty ?? "Medium (4-7 letters)";
    registerGameForSpectate(this);
    getWordLists(MODULE_ID).then(lists => {
      const key = DIFFICULTY_MAP[this.#difficulty] ?? "medium";
      this.#wordPool = [...(lists[key] ?? [])];
      this.#nextWord();
      this.render(false);
    });
    getMyBest("word-scramble", this.#difficulty).then(b => { if (b) { this.#personalBest = b.score; this.render(false); } });
  }

  static DEFAULT_OPTIONS = soloGameDefaults("word-scramble", {
    title: "AFK_TAVERN.wordScramble.title",
    icon: "fa-solid fa-font",
    width: 420,
    actions: {
      submitGuess: WordScrambleApp.#onSubmitGuess,
      hint: WordScrambleApp.#onHint,
      skip: WordScrambleApp.#onSkip,
      newGame: WordScrambleApp.#onNewGame
    }
  });

  static PARTS = soloGameParts("word-scramble-board.hbs", { footer: false });

  #nextWord() {
    if (this.#wordPool.length === 0) {
      const key = DIFFICULTY_MAP[this.#difficulty] ?? "medium";
      this.#wordPool = [...(_wordLists?.[key] ?? [])];
    }
    if (this.#wordPool.length === 0) {
      this.#currentWord = "TAVERN";
      this.#scrambled = "RNTAVE";
      this.#guess = "";
      this.#revealed = Array(6).fill(false);
      this.#hintedPositions = new Set();
      this.#scrambledMapping = [2, 4, 5, 0, 3, 1];
      this.#wordSolved = false;
      this.#gameMessage = "";
      this.#messageType = "";
      return;
    }
    const idx = Math.floor(Math.random() * this.#wordPool.length);
    this.#currentWord = this.#wordPool.splice(idx, 1)[0];
    this.#scrambled = this.#scrambleWord(this.#currentWord);
    this.#guess = "";
    this.#revealed = Array(this.#currentWord.length).fill(false);
    this.#hintedPositions = new Set();
    this.#wordSolved = false;
    this.#gameMessage = "";
    this.#messageType = "";
  }

  #scrambleWord(word) {
    const clean = word.replace(/\s/g, "");
    let arr = clean.split("").map((ch, i) => ({ ch, wordIdx: i }));
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    const scrambled = arr.map(a => a.ch).join("");
    if (scrambled === clean) {
      [arr[0], arr[arr.length - 1]] = [arr[arr.length - 1], arr[0]];
    }
    this.#scrambledMapping = arr.map(a => a.wordIdx);
    return arr.map(a => a.ch).join("");
  }

  async _prepareContext(options) {
    const letters = this.#scrambled.split("").map((ch, i) => ({
      char: ch,
      index: i,
      isHint: this.#hintedPositions.has(this.#scrambledMapping[i])
    }));

    const wordLetters = this.#currentWord.replace(/\s/g, "").split("").map((ch, i) => ({
      char: this.#revealed[i] ? ch : "_",
      isRevealed: this.#revealed[i],
      isSolved: this.#wordSolved && !this.#hintedPositions.has(i),
      isHinted: this.#hintedPositions.has(i)
    }));

    const wordLen = this.#currentWord.replace(/\s/g, "").length;
    const tileSize = wordLen <= 7 ? 34 : wordLen <= 9 ? 30 : 26;
    const loc = getLoc();

    return {
      stats: [
        { icon: "fa-solid fa-check", label: loc.solved, value: this.#solved },
        { icon: "fa-solid fa-star", label: loc.score, value: this.#score },
        { icon: "fa-solid fa-trophy", label: loc.best, value: this.#personalBest ?? 0 }
      ],
      letters,
      wordLetters,
      tileSize,
      score: this.#score,
      solved: this.#solved,
      guess: this.#guess,
      gameMessage: this.#gameMessage,
      messageType: this.#messageType,
      wordLength: this.#currentWord.replace(/\s/g, "").length,
      hasSpaces: this.#currentWord.includes(" "),
      difficulty: this.#difficulty,
      difficultyLevel: difficultyLevel(this.#difficulty),
      personalBest: this.#personalBest ?? 0,
      loc
    };
  }

  _onRender(context, options) {
    const html = this.element;
    if (!html) return;
    const input = html.querySelector(".ws-input");
    if (input) {
      if (document.activeElement !== input) input.focus();
      this.#listenerAbort?.abort();
      this.#listenerAbort = new AbortController();
      const { signal } = this.#listenerAbort;
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          this.#guess = input.value.trim().toUpperCase();
          this.#checkGuess();
        }
      }, { signal });
      input.addEventListener("input", (e) => {
        this.#guess = e.target.value;
        e.target.setAttribute("value", e.target.value);
        notifySpectateUpdate({ immediate: true });
      }, { signal });
    }
  }

  #checkGuess() {
    const clean = this.#currentWord.replace(/\s/g, "").toUpperCase();
    if (this.#guess.toUpperCase() === clean) {
      const points = clean.length - this.#hintedPositions.size;
      this.#score += points;
      this.#solved++;
      if (this.#score > (this.#personalBest ?? 0)) this.#personalBest = this.#score;
      this.#revealed = Array(clean.length).fill(true);
      this.#wordSolved = true;
      this.#guess = "";
      this.#gameMessage = `+${points}`;
      this.#messageType = "success";
      this.render(false);
      notifySpectateUpdate();
      setTimeout(() => {
        this.#nextWord();
        this.render(false);
        notifySpectateUpdate();
      }, 1200);
    } else {
      this.#score = Math.max(0, this.#score - 1);
      this.#gameMessage = i18n("AFK_TAVERN.wordScramble.wrong");
      this.#messageType = "error";
      this.render(false);
      notifySpectateUpdate();
    }
  }

  static #onSubmitGuess(event, target) {
    const input = this.element?.querySelector(".ws-input");
    if (input) this.#guess = input.value.trim().toUpperCase();
    this.#checkGuess();
  }

  static #onHint() {
    const unrevealed = [];
    const clean = this.#currentWord.replace(/\s/g, "");
    for (let i = 0; i < clean.length; i++) {
      if (!this.#revealed[i]) unrevealed.push(i);
    }
    if (unrevealed.length > 1) {
      const idx = unrevealed[Math.floor(Math.random() * unrevealed.length)];
      this.#revealed[idx] = true;
      this.#hintedPositions.add(idx);
    }
    this.render(false);
    notifySpectateUpdate();
  }

  static #onSkip() {
    this.#gameMessage = `→ ${this.#currentWord}`;
    this.#messageType = "skip";
    this.render(false);
    notifySpectateUpdate();
    setTimeout(() => {
      this.#nextWord();
      this.render(false);
    }, 1500);
  }

  static #onNewGame() {
    this.#score = 0;
    this.#solved = 0;
    const key = DIFFICULTY_MAP[this.#difficulty] ?? "medium";
    this.#wordPool = [...(_wordLists?.[key] ?? [])];
    this.#nextWord();
    this.render(false);
  }

  close(options) {
    if (this.#score > 0) submitHighscore("word-scramble", this.#score, this.#difficulty);
    this.#listenerAbort?.abort();
    cleanupSoloGame(this);
    return super.close(options);
  }

  getSpectateState() {
    const wordLen = this.#currentWord.replace(/\s/g, "").length;
    const tileSize = wordLen <= 7 ? 34 : wordLen <= 9 ? 30 : 26;
    return {
      gameType: "word-scramble",
      data: {
        scrambled: this.#scrambled,
        wordLetters: this.#currentWord.replace(/\s/g, "").split("").map((ch, i) => ({
          char: this.#revealed[i] ? ch : "_",
          isRevealed: this.#revealed[i],
          isHinted: this.#hintedPositions.has(i)
        })),
        hintedScrambled: this.#scrambled.split("").map((ch, i) => this.#hintedPositions.has(this.#scrambledMapping[i])),
        tileSize,
        score: this.#score,
        solved: this.#solved,
        guess: this.#guess,
        gameMessage: this.#gameMessage,
        messageType: this.#messageType,
        difficulty: this.#difficulty,
        personalBest: this.#personalBest ?? 0
      }
    };
  }
}

registerSpectateConfig("word-scramble", {
  template: "word-scramble-board.hbs",
  shouldRebuild: (state, prev) => prev && (state.wordLetters?.length ?? 0) !== (prev.wordLetters?.length ?? 0),
  mapContext(state) {
    const ts = state.tileSize ?? 34;
    return {
      stats: [
        { icon: "fa-solid fa-check", label: i18n("AFK_TAVERN.wordScramble.solved"), value: state.solved ?? 0, valueCls: "sp-solved" },
        { icon: "fa-solid fa-star", label: i18n("AFK_TAVERN.wordScramble.score"), value: state.score ?? 0, valueCls: "sp-score" },
        { icon: "fa-solid fa-trophy", label: i18n("AFK_TAVERN.wordScramble.best"), value: state.personalBest ?? 0, valueCls: "sp-best" }
      ],
      difficulty: state.difficulty, difficultyLevel: difficultyLevel(state.difficulty),
      letters: (state.scrambled ?? "").split("").map((ch, i) => ({ char: ch, isHint: !!(state.hintedScrambled ?? [])[i] })),
      wordLetters: state.wordLetters ?? [], tileSize: ts,
      guess: state.guess ?? "", wordLength: state.wordLetters?.length ?? 20,
      gameMessage: " ", messageType: "",
      loc: { placeholder: i18n("AFK_TAVERN.wordScramble.placeholder"), hint: i18n("AFK_TAVERN.wordScramble.hint"), skip: i18n("AFK_TAVERN.wordScramble.skip") }
    };
  },
  sync: [
    { sel: ".sp-solved", text: s => s.solved ?? 0 },
    { sel: ".sp-score", text: s => s.score ?? 0 },
    { sel: ".sp-best", text: s => s.personalBest ?? 0 }
  ],
  onBuild(el) {
    const guessEl = el.querySelector(".ws-input");
    if (guessEl) guessEl.readOnly = true;
    const msgEl = el.querySelector(".ws-message");
    if (msgEl) msgEl.style.display = "none";
    return {
      letters: [...el.querySelectorAll(".ws-scrambled .ws-letter")],
      slots: [...el.querySelectorAll(".ws-word-display .ws-slot")],
      message: msgEl,
      guess: guessEl
    };
  },
  onSync(el, state, prev, refs) {
    const scrambled = state.scrambled ?? "";
    const hinted = state.hintedScrambled ?? [];
    for (let i = 0; i < refs.letters.length; i++) {
      refs.letters[i].textContent = scrambled[i] ?? "";
      refs.letters[i].classList.toggle("ws-hint", !!hinted[i]);
    }
    const wordLetters = state.wordLetters ?? [];
    for (let i = 0; i < refs.slots.length; i++) {
      const wl = wordLetters[i];
      refs.slots[i].textContent = wl?.char ?? "_";
      refs.slots[i].classList.toggle("ws-revealed", !!wl?.isRevealed);
      refs.slots[i].classList.toggle("ws-hinted", !!wl?.isHinted);
    }
    if (refs.message) {
      if (state.gameMessage) {
        refs.message.style.display = "";
        refs.message.textContent = state.gameMessage;
        refs.message.className = `ws-message ws-message-${state.messageType ?? ""}`;
      } else {
        refs.message.style.display = "none";
      }
    }
    if (refs.guess) refs.guess.value = state.guess ?? "";
  }
});
