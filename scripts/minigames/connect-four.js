import { registerGameForSpectate, unregisterGameForSpectate, notifySpectateUpdate, registerSpectateConfig } from "../spectate-engine.js";
import { ApplicationV2, HandlebarsApplicationMixin, setupMultiplayerInviteListener, showMultiplayerInviteDialog, buildLocCache, mpGameDefaults, soloGameParts } from "./minigame-helpers.js";
import { MODULE_ID, SOCKET_KEY, i18n, escapeHtml } from "../afk-tavern.js";
import { submitWin } from "../highscore-manager.js";

const getLoc = buildLocCache(() => ({
  vs: i18n("AFK_TAVERN.connectFour.vs"),
  rematch: i18n("AFK_TAVERN.connectFour.rematch")
}));

const ROWS = 6;
const COLS = 7;
const SYMBOLS = { R: "🔴", Y: "🟡" };

export class ConnectFourApp extends HandlebarsApplicationMixin(ApplicationV2) {

  #gameId;
  #board;
  #mySymbol;
  #opponentId;
  #opponentName;
  #turn;
  #winner = null;
  #winLine = null;
  #isDraw = false;
  #myScore = 0;
  #opponentScore = 0;
  #hoverCol = -1;
  #lastDrop = null;
  #listenerAbort = null;

  constructor(options = {}) {
    super(options);
    this.#gameId = options.gameId ?? foundry.utils.randomID();
    this.#mySymbol = options.mySymbol ?? "R";
    this.#opponentId = options.opponentId;
    this.#opponentName = options.opponentName ?? i18n("AFK_TAVERN.minigames.opponent");
    this.#turn = "R";
    this.#board = Array.from({ length: ROWS }, () => Array(COLS).fill(null));

    this._socketHandler = (data) => this.#onSocket(data);
    game.socket.on(SOCKET_KEY, this._socketHandler);

    this._disconnectHook = Hooks.on("userConnected", (user, connected) => {
      if (!connected && user.id === this.#opponentId && !this.#winner && !this.#isDraw) {
        ui.notifications.warn(`${this.#opponentName} ${i18n("AFK_TAVERN.connectFour.opponentLeft")}`);
        this.close();
      }
    });

    registerGameForSpectate(this);
  }

  static DEFAULT_OPTIONS = mpGameDefaults("connect-four", {
    title: "AFK_TAVERN.connectFour.title",
    icon: "fa-solid fa-circle-dot",
    width: 440,
    actions: {
      dropPiece: ConnectFourApp.#onDropPiece,
      rematch: ConnectFourApp.#onRematch
    }
  });

  static PARTS = soloGameParts("connect-four-board.hbs");

  get id() {
    return `afk-tavern-connect-four-${this.#gameId}`;
  }

  get isMyTurn() {
    return this.#turn === this.#mySymbol && !this.#winner && !this.#isDraw;
  }

  async _prepareContext(options) {
    const cells = [];
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const val = this.#board[r][c];
        const isWin = this.#winLine?.some(([wr, wc]) => wr === r && wc === c) ?? false;
        const isLastDrop = this.#lastDrop && this.#lastDrop[0] === r && this.#lastDrop[1] === c;
        cells.push({
          row: r, col: c,
          symbol: val ? SYMBOLS[val] : "",
          raw: val,
          isEmpty: val === null,
          isWinCell: isWin,
          isLastDrop
        });
      }
    }

    const colHeaders = Array.from({ length: COLS }, (_, c) => ({ col: c }));
    const isGameOver = !!this.#winner || this.#isDraw;
    let statusText;
    if (this.#winner) {
      statusText = this.#winner === this.#mySymbol
        ? i18n("AFK_TAVERN.connectFour.youWin")
        : i18n("AFK_TAVERN.connectFour.youLose");
    } else if (this.#isDraw) {
      statusText = i18n("AFK_TAVERN.connectFour.draw");
    } else if (this.isMyTurn) {
      statusText = i18n("AFK_TAVERN.connectFour.yourTurn");
    } else {
      statusText = i18n("AFK_TAVERN.connectFour.opponentTurn");
    }

    const oppSymbolRaw = this.#mySymbol === "R" ? "Y" : "R";
    const loc = getLoc();

    return {
      isMultiplayer: true,
      playerLeftPreview: `<div class="c4-piece-preview c4-piece-${this.#mySymbol}"></div>`,
      playerRightPreview: `<div class="c4-piece-preview c4-piece-${oppSymbolRaw}"></div>`,
      playerLeftCls: `c4-color-${this.#mySymbol}`,
      playerRightCls: `c4-color-${oppSymbolRaw}`,
      footerLabel: loc.rematch,
      cells, colHeaders,
      rows: ROWS, cols: COLS,
      myName: game.user.name,
      mySymbol: SYMBOLS[this.#mySymbol],
      mySymbolRaw: this.#mySymbol,
      opponentName: this.#opponentName,
      opponentSymbol: SYMBOLS[oppSymbolRaw],
      opponentSymbolRaw: oppSymbolRaw,
      statusText,
      isMyTurn: this.isMyTurn,
      isGameOver,
      isWin: this.#winner === this.#mySymbol,
      isLoss: this.#winner && this.#winner !== this.#mySymbol,
      isDraw: this.#isDraw,
      myScore: this.#myScore,
      opponentScore: this.#opponentScore,
      loc
    };
  }

  _onRender(context, options) {
    const el = this.element;
    if (!el) return;
    const grid = el.querySelector(".c4-grid");
    if (grid) grid.style.gridTemplateColumns = `repeat(${COLS}, 1fr)`;
    const ghostRow = el.querySelector(".c4-ghost-row");
    if (ghostRow) ghostRow.style.gridTemplateColumns = `repeat(${COLS}, 1fr)`;

    const droppedPiece = el.querySelector(".c4-piece-just-dropped");
    if (droppedPiece && this.#lastDrop) {
      const row = this.#lastDrop[0];
      const slot = droppedPiece.closest(".c4-slot");
      if (slot) {
        const slotHeight = slot.offsetHeight + 4;
        const dropDist = (row + 1) * slotHeight;
        droppedPiece.style.setProperty("--drop-distance", `-${dropDist}px`);
      }
    }

    const board = el.querySelector(".c4-board");
    if (!board) return;

    this.#listenerAbort?.abort();
    this.#listenerAbort = new AbortController();
    const { signal } = this.#listenerAbort;

    board.addEventListener("mousemove", (e) => {
      const slot = e.target.closest(".c4-slot");
      const col = slot ? Number(slot.dataset.col) : -1;
      if (col === this.#hoverCol) return;
      this.#hoverCol = col;

      el.querySelectorAll(".c4-slot").forEach(s => s.classList.remove("c4-col-highlight"));
      el.querySelectorAll(".c4-ghost-slot").forEach(g => {
        g.innerHTML = "";
        g.classList.remove("c4-ghost-active");
      });

      if (col >= 0 && this.isMyTurn) {
        el.querySelectorAll(`.c4-slot[data-col="${col}"]`).forEach(s => s.classList.add("c4-col-highlight"));
        const ghost = el.querySelector(`.c4-ghost-slot[data-col="${col}"]`);
        if (ghost) {
          ghost.innerHTML = `<div class="c4-piece c4-piece-${this.#mySymbol} c4-piece-ghost"></div>`;
          ghost.classList.add("c4-ghost-active");
        }
      }
    }, { signal });

    board.addEventListener("mouseleave", () => {
      this.#hoverCol = -1;
      el.querySelectorAll(".c4-slot").forEach(s => s.classList.remove("c4-col-highlight"));
      el.querySelectorAll(".c4-ghost-slot").forEach(g => {
        g.innerHTML = "";
        g.classList.remove("c4-ghost-active");
      });
    }, { signal });
  }

  #findRow(col) {
    for (let r = ROWS - 1; r >= 0; r--) {
      if (this.#board[r][col] === null) return r;
    }
    return -1;
  }

  #checkWinner() {
    const b = this.#board;
    const dirs = [[0,1],[1,0],[1,1],[1,-1]];
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (!b[r][c]) continue;
        for (const [dr, dc] of dirs) {
          const line = [[r, c]];
          for (let i = 1; i < 4; i++) {
            const nr = r + dr * i, nc = c + dc * i;
            if (nr < 0 || nr >= ROWS || nc < 0 || nc >= COLS) break;
            if (b[nr][nc] !== b[r][c]) break;
            line.push([nr, nc]);
          }
          if (line.length === 4) {
            this.#winLine = line;
            return b[r][c];
          }
        }
      }
    }
    return null;
  }

  #checkDraw() {
    return this.#board[0].every(c => c !== null);
  }

  #makeMove(col) {
    if (this.#winner || this.#isDraw) return;
    if (this.#turn !== this.#mySymbol) return;
    const row = this.#findRow(col);
    if (row === -1) return;

    this.#board[row][col] = this.#mySymbol;
    this.#lastDrop = [row, col];
    const winner = this.#checkWinner();
    const isDraw = !winner && this.#checkDraw();

    if (winner) {
      this.#winner = winner;
      if (winner === this.#mySymbol) {
        this.#myScore++;
        submitWin("connect-four");
      } else {
        this.#opponentScore++;
      }
    } else if (isDraw) {
      this.#isDraw = true;
    } else {
      this.#turn = this.#mySymbol === "R" ? "Y" : "R";
    }

    game.socket.emit(SOCKET_KEY, {
      action: "c4Move",
      gameId: this.#gameId,
      targetUser: this.#opponentId,
      board: this.#board.map(r => [...r]),
      lastDrop: this.#lastDrop,
      winner: this.#winner,
      winLine: this.#winLine,
      isDraw: this.#isDraw,
      turn: this.#turn,
      scores: { sender: this.#myScore, opponent: this.#opponentScore }
    });

    this.render(false);
    notifySpectateUpdate({ immediate: true });
  }

  #onSocket(data) {
    if (data.action === "c4Move" && data.gameId === this.#gameId && data.targetUser === game.user.id) {
      this.#board = data.board;
      this.#turn = data.turn;
      this.#winner = data.winner;
      this.#winLine = data.winLine;
      this.#isDraw = data.isDraw;
      this.#lastDrop = data.lastDrop;
      this.#opponentScore = data.scores.sender;
      this.#myScore = data.scores.opponent;
      this.render(false);
      notifySpectateUpdate({ immediate: true });
    }

    if (data.action === "c4Rematch" && data.gameId === this.#gameId && data.targetUser === game.user.id) {
      this.#board = Array.from({ length: ROWS }, () => Array(COLS).fill(null));
      this.#winner = null;
      this.#winLine = null;
      this.#isDraw = false;
      this.#lastDrop = null;
      this.#mySymbol = data.yourSymbol;
      this.#turn = "R";
      this.render(false);
      notifySpectateUpdate({ immediate: true });
    }

    if (data.action === "c4Quit" && data.gameId === this.#gameId && data.targetUser === game.user.id) {
      ui.notifications.info(`${escapeHtml(data.quitterName)} ${i18n("AFK_TAVERN.connectFour.opponentLeft")}`);
      this.close();
    }
  }

  static #onDropPiece(event, target) {
    const col = Number(target.dataset.col ?? target.closest("[data-col]")?.dataset.col);
    if (isNaN(col)) return;
    this.#makeMove(col);
  }

  static #onRematch() {
    const newMySymbol = this.#mySymbol === "R" ? "Y" : "R";
    this.#board = Array.from({ length: ROWS }, () => Array(COLS).fill(null));
    this.#winner = null;
    this.#winLine = null;
    this.#isDraw = false;
    this.#lastDrop = null;
    this.#mySymbol = newMySymbol;
    this.#turn = "R";

    game.socket.emit(SOCKET_KEY, {
      action: "c4Rematch",
      gameId: this.#gameId,
      targetUser: this.#opponentId,
      yourSymbol: this.#mySymbol === "R" ? "Y" : "R"
    });

    this.render(false);
    notifySpectateUpdate({ immediate: true });
  }

  getSpectateState() {
    return {
      gameType: "connect-four",
      isMultiplayer: true,
      playerNames: [game.user.name, this.#opponentName],
      data: {
        board: this.#board.map(row => [...row]),
        winLine: this.#winLine,
        lastDrop: this.#lastDrop,
        mySymbol: this.#mySymbol,
        myName: game.user.name,
        oppName: this.#opponentName,
        myScore: this.#myScore,
        oppScore: this.#opponentScore,
        turn: this.#turn,
        winner: this.#winner,
        isDraw: this.#isDraw,
        isMyTurn: this.isMyTurn
      }
    };
  }

  close(options) {
    this.#listenerAbort?.abort();
    game.socket.off(SOCKET_KEY, this._socketHandler);
    if (this._disconnectHook != null) Hooks.off("userConnected", this._disconnectHook);
    if (this.#opponentId) {
      game.socket.emit(SOCKET_KEY, {
        action: "c4Quit",
        gameId: this.#gameId,
        targetUser: this.#opponentId,
        quitterName: game.user.name
      });
    }
    unregisterGameForSpectate(this);
    return super.close(options);
  }
}

registerSpectateConfig("connect-four", {
  template: "connect-four-board.hbs",
  multiplayer: true,
  statusCls: "c4-sp-status",
  wrapperSel: ".c4-wrapper",
  mapContext(state) {
    const oppSymbol = state.mySymbol === "R" ? "Y" : "R";
    const cells = [];
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) cells.push({ col: c, raw: null, isWinCell: false, isLastDrop: false });
    }
    return {
      isMultiplayer: true,
      playerLeftPreview: `<div class="c4-piece-preview c4-piece-${state.mySymbol}"></div>`,
      playerRightPreview: `<div class="c4-piece-preview c4-piece-${oppSymbol}"></div>`,
      playerLeftCls: `c4-color-${state.mySymbol}`, playerRightCls: `c4-color-${oppSymbol}`,
      myName: state.myName, opponentName: state.oppName,
      myScore: state.myScore ?? 0, opponentScore: state.oppScore ?? 0,
      isMyTurn: state.isMyTurn, isGameOver: false, isWin: false, isLoss: false, isDraw: false,
      statusText: "",
      cells, colHeaders: Array.from({ length: COLS }, (_, c) => ({ col: c })),
      loc: { vs: i18n("AFK_TAVERN.spectate.vs") }
    };
  },
  onBuild(el) {
    const grid = el.querySelector(".c4-grid");
    if (grid) grid.style.gridTemplateColumns = `repeat(${COLS}, 1fr)`;
    return {
      cells: [...el.querySelectorAll(".c4-slot")],
      prevBoard: Array.from({ length: ROWS }, () => Array(COLS).fill(null))
    };
  },
  onSync(el, state, prev, refs) {
    const board = state.board ?? [];
    const winSet = new Set((state.winLine ?? []).map(([r, c]) => `${r},${c}`));
    const lastDrop = state.lastDrop;
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const idx = r * COLS + c;
        const slotEl = refs.cells[idx];
        if (!slotEl) continue;
        const hole = slotEl.querySelector(".c4-hole");
        if (!hole) continue;
        const val = board[r]?.[c] ?? null;
        const prevVal = refs.prevBoard[r]?.[c] ?? null;
        const isWin = winSet.has(`${r},${c}`);
        const isLast = lastDrop && lastDrop[0] === r && lastDrop[1] === c;
        slotEl.classList.toggle("c4-slot-win", isWin);
        slotEl.classList.toggle("c4-slot-just-dropped", isLast && val !== prevVal);
        if (val && !prevVal) {
          const piece = document.createElement("div");
          piece.className = `c4-piece c4-piece-${val}`;
          if (isWin) piece.classList.add("c4-piece-winner");
          if (isLast) {
            piece.classList.add("c4-piece-just-dropped");
            hole.style.overflow = "visible";
            hole.appendChild(piece);
            setTimeout(() => { hole.style.overflow = ""; }, 550);
          } else {
            hole.appendChild(piece);
          }
        } else if (val && isWin) {
          const piece = hole.querySelector(".c4-piece");
          if (piece) piece.classList.add("c4-piece-winner");
        } else if (!val && prevVal) {
          hole.innerHTML = "";
        }
      }
    }
    refs.prevBoard = board.map(row => [...row]);
  }
});

const C4_INVITE_CONFIG = {
  locPrefix: "AFK_TAVERN.connectFour",
  actions: { invite: "c4Invite", declined: "c4Declined", accepted: "c4Accepted", expired: "c4InviteExpired" },
  icon: "fa-solid fa-circle-dot"
};

export function setupConnectFourInvites() {
  setupMultiplayerInviteListener({
    ...C4_INVITE_CONFIG,
    createAcceptedApp: (data) => new ConnectFourApp({
      gameId: data.gameId,
      mySymbol: "Y",
      opponentId: data.senderId,
      opponentName: data.senderName
    })
  });
}

export async function inviteToConnectFour(ctx = {}) {
  showMultiplayerInviteDialog({
    ...C4_INVITE_CONFIG,
    gameWidth: 400,
    createHostApp: (gameId, data) => new ConnectFourApp({
      gameId,
      mySymbol: "R",
      opponentId: data.accepterId,
      opponentName: data.accepterName
    })
  }, ctx);
}
