import { registerGameForSpectate, notifySpectateUpdate, registerSpectateConfig } from "../spectate-engine.js";
import { ApplicationV2, HandlebarsApplicationMixin, formatTime, difficultyLevel, cleanupSoloGame, buildLocCache, soloGameDefaults, soloGameParts } from "./minigame-helpers.js";
import { MODULE_ID, i18n } from "../afk-tavern.js";
import { submitHighscore } from "../highscore-manager.js";

const getLoc = buildLocCache(() => ({
  mines: i18n("AFK_TAVERN.minesweeper.mines"),
  flags: i18n("AFK_TAVERN.minesweeper.flags"),
  time: i18n("AFK_TAVERN.minesweeper.time"),
  victory: i18n("AFK_TAVERN.minesweeper.victory"),
  defeat: i18n("AFK_TAVERN.minesweeper.defeat"),
  newGame: i18n("AFK_TAVERN.minesweeper.newGame")
}));

const DIFFICULTY_MAP = {
  "Easy (8×8, 8 mines)":          { cols: 8,  rows: 8,  mines: 8 },
  "Medium (10×10, 14 mines)":     { cols: 10, rows: 10, mines: 14 },
  "Hard (12×12, 22 mines)":       { cols: 12, rows: 12, mines: 22 },
  "Expert (14×14, 32 mines)":     { cols: 14, rows: 14, mines: 32 },
  "Master (16×16, 45 mines)":     { cols: 16, rows: 16, mines: 45 },
  "Legendary (18×16, 56 mines)":  { cols: 18, rows: 16, mines: 56 }
};

const ICONS = {
  mine: "💣",
  flag: "🚩",
  numbers: ["", "1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣"]
};

export class MinesweeperApp extends HandlebarsApplicationMixin(ApplicationV2) {

  #difficulty;
  #gridConfig;
  #board = [];
  #revealed = [];
  #flagged = [];
  #gameOver = false;
  #gameWon = false;
  #firstClick = true;
  #startTime = null;
  #elapsed = 0;
  #timerInterval = null;
  #listenerAbort = null;

  constructor(options = {}) {
    super(options);
    this.#difficulty = options.difficulty ?? "Medium (10×10, 14 mines)";
    this.#gridConfig = DIFFICULTY_MAP[this.#difficulty] ?? DIFFICULTY_MAP["Medium (10×10, 14 mines)"];
    this.#initBoard();
    registerGameForSpectate(this);
  }

  static DEFAULT_OPTIONS = soloGameDefaults("minesweeper", {
    title: "AFK_TAVERN.minesweeper.title",
    icon: "fa-solid fa-bomb",
    width: 520,
    actions: {
      revealCell: MinesweeperApp.#onRevealCell,
      newGame: MinesweeperApp.#onNewGame
    }
  });

  static PARTS = soloGameParts("minesweeper-board.hbs");

  #initBoard() {
    const { cols, rows } = this.#gridConfig;
    this.#board = Array.from({ length: rows }, () => Array(cols).fill(0));
    this.#revealed = Array.from({ length: rows }, () => Array(cols).fill(false));
    this.#flagged = Array.from({ length: rows }, () => Array(cols).fill(false));
    this.#gameOver = false;
    this.#gameWon = false;
    this.#firstClick = true;
    this.#startTime = null;
    this.#elapsed = 0;
    this.#stopTimer();
  }

  #placeMines(safeR, safeC) {
    const { cols, rows, mines } = this.#gridConfig;
    let placed = 0;
    while (placed < mines) {
      const r = Math.floor(Math.random() * rows);
      const c = Math.floor(Math.random() * cols);
      if (this.#board[r][c] === -1) continue;
      if (Math.abs(r - safeR) <= 2 && Math.abs(c - safeC) <= 2) continue;
      this.#board[r][c] = -1;
      placed++;
    }
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (this.#board[r][c] === -1) continue;
        let count = 0;
        for (let dr = -1; dr <= 1; dr++) {
          for (let dc = -1; dc <= 1; dc++) {
            const nr = r + dr, nc = c + dc;
            if (nr >= 0 && nr < rows && nc >= 0 && nc < cols && this.#board[nr][nc] === -1) count++;
          }
        }
        this.#board[r][c] = count;
      }
    }
  }

  #reveal(r, c) {
    const { cols, rows } = this.#gridConfig;
    if (r < 0 || r >= rows || c < 0 || c >= cols) return;
    if (this.#revealed[r][c] || this.#flagged[r][c]) return;
    this.#revealed[r][c] = true;
    if (this.#board[r][c] === 0) {
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          this.#reveal(r + dr, c + dc);
        }
      }
    }
  }

  #checkWin() {
    const { cols, rows, mines } = this.#gridConfig;
    let revealedCount = 0;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (this.#revealed[r][c]) revealedCount++;
      }
    }
    return revealedCount === (rows * cols) - mines;
  }

  async _prepareContext(options) {
    const { cols, rows, mines } = this.#gridConfig;
    const loc = getLoc();
    const cells = [];
    let flagCount = 0;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const isRevealed = this.#revealed[r][c];
        const isFlagged = this.#flagged[r][c];
        if (isFlagged) flagCount++;
        const val = this.#board[r][c];
        let display = "";
        let cellClass = "ms-cell";
        if (isRevealed) {
          cellClass += " ms-revealed";
          if (val === -1) {
            display = ICONS.mine;
            cellClass += " ms-mine";
          } else if (val > 0) {
            display = val;
            cellClass += ` ms-num-${val}`;
          }
        } else if (isFlagged) {
          display = ICONS.flag;
          cellClass += " ms-flagged";
        }
        if (this.#gameOver && !isRevealed && val === -1) {
          display = ICONS.mine;
          cellClass += " ms-revealed ms-mine";
        }
        cells.push({ r, c, display, cellClass });
      }
    }
    const elapsedStr = (({ mm, ss }) => `${mm}:${ss}`)(formatTime(this.#elapsed));
    return {
      stats: [
        { icon: "fa-solid fa-bomb", label: loc.mines, value: mines - flagCount },
        { icon: "fa-solid fa-flag", label: loc.flags, value: flagCount, valueCls: "ms-flag-value" },
        { icon: "fa-solid fa-stopwatch", label: loc.time, value: elapsedStr, valueCls: "ms-timer-value" }
      ],
      showFooter: true,
      footerLabel: loc.newGame,
      cells, cols, rows,
      mines, flagCount,
      remaining: mines - flagCount,
      elapsed: elapsedStr,
      gameOver: this.#gameOver,
      gameWon: this.#gameWon,
      difficulty: this.#difficulty,
      difficultyLevel: difficultyLevel(this.#difficulty),
      loc
    };
  }

  _onRender(context, options) {
    const html = this.element;
    if (!html) return;
    const grid = html.querySelector(".ms-grid");
    if (grid) {
      grid.style.gridTemplateColumns = `repeat(${this.#gridConfig.cols}, 32px)`;
      this.#listenerAbort?.abort();
      this.#listenerAbort = new AbortController();
      const { signal } = this.#listenerAbort;
      grid.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        const cell = e.target.closest(".ms-cell");
        if (!cell || this.#gameOver || this.#gameWon) return;
        const r = Number(cell.dataset.r);
        const c = Number(cell.dataset.c);
        if (this.#revealed[r][c]) return;
        this.#flagged[r][c] = !this.#flagged[r][c];
        this.render(false);
        notifySpectateUpdate();
      }, { signal });
      grid.addEventListener("mouseup", (e) => {
        if (e.button !== 1) return;
        e.preventDefault();
        const cell = e.target.closest(".ms-cell");
        if (cell) this.#chordReveal(Number(cell.dataset.r), Number(cell.dataset.c));
      }, { signal });
      grid.addEventListener("auxclick", (e) => { if (e.button === 1) e.preventDefault(); }, { signal });
    }
    const CELL = 32;
    const GAP = 2;
    const PAD = 86;
    const w = (this.#gridConfig.cols * CELL) + ((this.#gridConfig.cols - 1) * GAP) + PAD;
    this.setPosition({ width: Math.max(320, w) });
  }

  close(options) {
    this.#listenerAbort?.abort();
    this.#stopTimer();
    cleanupSoloGame(this);
    return super.close(options);
  }

  #startTimer() {
    if (this.#timerInterval) return;
    this.#startTime = Date.now();
    this.#timerInterval = setInterval(() => {
      this.#elapsed = Math.floor((Date.now() - this.#startTime) / 1000);
      const el = this.element?.querySelector(".ms-timer-value");
      if (el) { const { mm, ss } = formatTime(this.#elapsed); el.textContent = `${mm}:${ss}`; }
      notifySpectateUpdate();
    }, 1000);
  }

  #stopTimer() {
    if (this.#timerInterval) { clearInterval(this.#timerInterval); this.#timerInterval = null; }
  }

  static #onRevealCell(event, target) {
    if (this.#gameOver || this.#gameWon) return;
    const r = Number(target.dataset.r);
    const c = Number(target.dataset.c);
    if (isNaN(r) || isNaN(c)) return;
    if (this.#flagged[r][c]) return;
    if (this.#revealed[r][c]) {
      this.#chordReveal(r, c);
      return;
    }
    if (this.#firstClick) {
      this.#firstClick = false;
      this.#placeMines(r, c);
      this.#startTimer();
    }
    if (this.#board[r][c] === -1) {
      this.#gameOver = true;
      this.#revealed[r][c] = true;
      this.#stopTimer();
    } else {
      this.#reveal(r, c);
      if (this.#checkWin()) {
        this.#gameWon = true;
        this.#stopTimer();
        submitHighscore("minesweeper", this.#elapsed, this.#difficulty, true);
      }
    }
    this.render(false);
    notifySpectateUpdate();
  }

  #chordReveal(r, c) {
    if (this.#gameOver || this.#gameWon) return;
    if (!this.#revealed[r][c]) return;
    const val = this.#board[r][c];
    if (val <= 0) return;
    const { cols, rows } = this.#gridConfig;
    let adjacentFlags = 0;
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        const nr = r + dr, nc = c + dc;
        if (nr >= 0 && nr < rows && nc >= 0 && nc < cols && this.#flagged[nr][nc]) adjacentFlags++;
      }
    }
    if (adjacentFlags !== val) return;
    let hitMine = false;
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        const nr = r + dr, nc = c + dc;
        if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
        if (this.#revealed[nr][nc] || this.#flagged[nr][nc]) continue;
        if (this.#board[nr][nc] === -1) {
          hitMine = true;
          this.#revealed[nr][nc] = true;
        } else {
          this.#reveal(nr, nc);
        }
      }
    }
    if (hitMine) {
      this.#gameOver = true;
      this.#stopTimer();
    } else if (this.#checkWin()) {
      this.#gameWon = true;
      this.#stopTimer();
      submitHighscore("minesweeper", this.#elapsed, this.#difficulty, true);
    }
    this.render(false);
    notifySpectateUpdate();
  }

  static #onNewGame() {
    this.#initBoard();
    this.render(false);
    notifySpectateUpdate();
  }

  getSpectateState() {
    const { cols, rows, mines } = this.#gridConfig;
    const cells = [];
    let flagCount = 0;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const rev = this.#revealed[r][c];
        const flag = this.#flagged[r][c];
        if (flag) flagCount++;
        const val = this.#board[r][c];
        let display = "";
        let cls = "ms-cell";
        if (rev) {
          cls += " ms-revealed";
          if (val === -1) { display = "💣"; cls += " ms-mine"; }
          else if (val > 0) { display = String(val); cls += ` ms-num-${val}`; }
        } else if (flag) {
          display = "🚩"; cls += " ms-flagged";
        }
        if (this.#gameOver && !rev && val === -1) {
          display = "💣"; cls += " ms-revealed ms-mine";
        }
        cells.push({ cls, display });
      }
    }
    return {
      gameType: "minesweeper",
      data: {
        cells, cols, rows, mines, flagCount,
        elapsed: this.#elapsed,
        gameOver: this.#gameOver,
        gameWon: this.#gameWon,
        difficulty: this.#difficulty
      }
    };
  }
}

registerSpectateConfig("minesweeper", {
  template: "minesweeper-board.hbs",
  mapContext(state) {
    const { mm, ss } = formatTime(state.elapsed ?? 0);
    const cols = state.cols ?? 10;
    return {
      stats: [
        { icon: "fa-solid fa-bomb", label: i18n("AFK_TAVERN.minesweeper.mines"), value: (state.mines ?? 0) - (state.flagCount ?? 0), valueCls: "sp-traps" },
        { icon: "fa-solid fa-flag", label: i18n("AFK_TAVERN.minesweeper.flags"), value: state.flagCount ?? 0, valueCls: "sp-flags" },
        { icon: "fa-solid fa-stopwatch", label: i18n("AFK_TAVERN.minesweeper.time"), value: `${mm}:${ss}`, valueCls: "sp-time" }
      ],
      difficulty: state.difficulty, difficultyLevel: difficultyLevel(state.difficulty),
      gameOver: true, gameWon: true,
      cells: (state.cells ?? []).map((c, i) => ({ cellClass: c.cls, display: c.display, r: Math.floor(i / cols), c: i % cols })),
      cols, elapsed: `${mm}:${ss}`,
      loc: { mines: i18n("AFK_TAVERN.minesweeper.mines"), flags: i18n("AFK_TAVERN.minesweeper.flags"), time: i18n("AFK_TAVERN.minesweeper.time"), victory: i18n("AFK_TAVERN.minesweeper.victory"), defeat: i18n("AFK_TAVERN.minesweeper.defeat"), newGame: i18n("AFK_TAVERN.minesweeper.newGame") }
    };
  },
  sync: [
    { sel: ".sp-traps", text: s => (s.mines ?? 0) - (s.flagCount ?? 0) },
    { sel: ".sp-flags", text: s => s.flagCount ?? 0 },
    { sel: ".sp-time", text: s => { const t = formatTime(s.elapsed ?? 0); return `${t.mm}:${t.ss}`; } }
  ],
  onBuild(el, state) {
    const grid = el.querySelector(".ms-grid");
    if (grid) grid.style.gridTemplateColumns = `repeat(${state.cols ?? 10}, 32px)`;
    return {
      cells: [...el.querySelectorAll(".ms-grid > div")],
      lossOverlay: el.querySelector(".solo-results-overlay.solo-results-loss"),
      winOverlay: el.querySelector(".solo-results-overlay:not(.solo-results-loss)")
    };
  },
  onSync(el, state, prev, refs) {
    const cells = state.cells ?? [];
    for (let i = 0; i < refs.cells.length; i++) {
      const cellEl = refs.cells[i];
      const data = cells[i];
      if (!data) continue;
      if (cellEl.className !== data.cls) cellEl.className = data.cls;
      const span = cellEl.firstElementChild;
      if (span && span.textContent !== data.display) span.textContent = data.display;
    }
    if (state.gameOver || state.gameWon) {
      if (state.gameWon) {
        if (refs.lossOverlay) refs.lossOverlay.style.display = "none";
        if (refs.winOverlay) { refs.winOverlay.style.display = ""; const t = refs.winOverlay.querySelector(".solo-results-score"); if (t) { const { mm, ss } = formatTime(state.elapsed ?? 0); t.textContent = `${mm}:${ss}`; } }
      } else {
        if (refs.winOverlay) refs.winOverlay.style.display = "none";
        if (refs.lossOverlay) refs.lossOverlay.style.display = "";
      }
    } else {
      if (refs.lossOverlay) refs.lossOverlay.style.display = "none";
      if (refs.winOverlay) refs.winOverlay.style.display = "none";
    }
  }
});
