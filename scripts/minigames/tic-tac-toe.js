import { registerGameForSpectate, unregisterGameForSpectate, notifySpectateUpdate, registerSpectateConfig } from "../spectate-engine.js";
import { ApplicationV2, HandlebarsApplicationMixin, setupMultiplayerInviteListener, showMultiplayerInviteDialog, buildLocCache, mpGameDefaults, soloGameParts } from "./minigame-helpers.js";
import { MODULE_ID, SOCKET_KEY, i18n, escapeHtml } from "../afk-tavern.js";
import { submitWin } from "../highscore-manager.js";

const getLoc = buildLocCache(() => ({
  vs: i18n("AFK_TAVERN.ticTacToe.vs"),
  rematch: i18n("AFK_TAVERN.ticTacToe.rematch"),
  score: i18n("AFK_TAVERN.ticTacToe.score")
}));

const SYMBOLS = { X: "⚔️", O: "🛡️" };

export class TicTacToeApp extends HandlebarsApplicationMixin(ApplicationV2) {

  #gameId;
  #board = Array(9).fill(null);
  #mySymbol;
  #opponentId;
  #opponentName;
  #turn;
  #winner = null;
  #isDraw = false;
  #myScore = 0;
  #opponentScore = 0;

  constructor(options = {}) {
    super(options);
    this.#gameId = options.gameId ?? foundry.utils.randomID();
    this.#mySymbol = options.mySymbol ?? "X";
    this.#opponentId = options.opponentId;
    this.#opponentName = options.opponentName ?? i18n("AFK_TAVERN.minigames.opponent");
    this.#turn = "X";

    this._socketHandler = (data) => this.#onSocket(data);
    game.socket.on(SOCKET_KEY, this._socketHandler);

    this._disconnectHook = Hooks.on("userConnected", (user, connected) => {
      if (!connected && user.id === this.#opponentId && !this.#winner && !this.#isDraw) {
        ui.notifications.warn(`${this.#opponentName} ${i18n("AFK_TAVERN.ticTacToe.opponentLeft")}`);
        this.close();
      }
    });

    registerGameForSpectate(this);
  }

  static DEFAULT_OPTIONS = mpGameDefaults("tic-tac-toe", {
    title: "AFK_TAVERN.ticTacToe.title",
    icon: "fa-solid fa-xmarks-lines",
    width: 408,
    actions: {
      playCell: TicTacToeApp.#onPlayCell,
      rematch: TicTacToeApp.#onRematch
    }
  });

  static PARTS = soloGameParts("tic-tac-toe-board.hbs");

  get id() {
    return `afk-tavern-tic-tac-toe-${this.#gameId}`;
  }

  get isMyTurn() {
    return this.#turn === this.#mySymbol && !this.#winner && !this.#isDraw;
  }

  async _prepareContext(options) {
    const cells = this.#board.map((val, i) => ({
      index: i,
      symbol: val ? SYMBOLS[val] : "",
      raw: val,
      isEmpty: val === null,
      isX: val === "X",
      isO: val === "O",
      isWinCell: false
    }));

    const winLine = this.#getWinLine();
    if (winLine) {
      for (const idx of winLine) cells[idx].isWinCell = true;
    }

    const myName = game.user.name;
    const opponentSymbolRaw = this.#mySymbol === "X" ? "O" : "X";
    const isGameOver = !!this.#winner || this.#isDraw;

    let statusText;
    if (this.#winner) {
      statusText = this.#winner === this.#mySymbol
        ? i18n("AFK_TAVERN.ticTacToe.youWin")
        : i18n("AFK_TAVERN.ticTacToe.youLose");
    } else if (this.#isDraw) {
      statusText = i18n("AFK_TAVERN.ticTacToe.draw");
    } else if (this.isMyTurn) {
      statusText = i18n("AFK_TAVERN.ticTacToe.yourTurn");
    } else {
      statusText = i18n("AFK_TAVERN.ticTacToe.opponentTurn");
    }

    const loc = getLoc();

    return {
      isMultiplayer: true,
      playerLeftPreview: `<div class="ttt-piece-preview ttt-preview-${this.#mySymbol}"></div>`,
      playerRightPreview: `<div class="ttt-piece-preview ttt-preview-${opponentSymbolRaw}"></div>`,
      playerLeftCls: "",
      playerRightCls: "",
      footerLabel: loc.rematch,
      cells,
      myName,
      mySymbol: SYMBOLS[this.#mySymbol],
      mySymbolRaw: this.#mySymbol,
      opponentName: this.#opponentName,
      opponentSymbol: SYMBOLS[this.#mySymbol === "X" ? "O" : "X"],
      opponentSymbolRaw,
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

  #checkWinner() {
    const line = this.#getWinLine();
    return line ? this.#board[line[0]] : null;
  }

  #getWinLine() {
    const b = this.#board;
    const lines = [
      [0,1,2],[3,4,5],[6,7,8],
      [0,3,6],[1,4,7],[2,5,8],
      [0,4,8],[2,4,6]
    ];
    for (const line of lines) {
      const [a, bb, c] = line;
      if (b[a] && b[a] === b[bb] && b[a] === b[c]) return line;
    }
    return null;
  }

  #checkDraw() {
    return this.#board.every(c => c !== null);
  }

  #makeMove(index) {
    if (this.#board[index] !== null || this.#winner || this.#isDraw) return;
    if (this.#turn !== this.#mySymbol) return;

    this.#board[index] = this.#mySymbol;
    const winner = this.#checkWinner();
    const isDraw = !winner && this.#checkDraw();

    if (winner) {
      this.#winner = winner;
      if (winner === this.#mySymbol) {
        this.#myScore++;
        submitWin("tic-tac-toe");
      } else {
        this.#opponentScore++;
      }
    } else if (isDraw) {
      this.#isDraw = true;
    } else {
      this.#turn = this.#mySymbol === "X" ? "O" : "X";
    }

    game.socket.emit(SOCKET_KEY, {
      action: "tttMove",
      gameId: this.#gameId,
      targetUser: this.#opponentId,
      index,
      symbol: this.#mySymbol,
      board: [...this.#board],
      winner: this.#winner,
      isDraw: this.#isDraw,
      turn: this.#turn,
      scores: { sender: this.#myScore, opponent: this.#opponentScore }
    });

    this.render(false);
    notifySpectateUpdate({ immediate: true });
  }

  #onSocket(data) {
    if (data.action === "tttMove" && data.gameId === this.#gameId && data.targetUser === game.user.id) {
      this.#board = data.board;
      this.#turn = data.turn;
      this.#winner = data.winner;
      this.#isDraw = data.isDraw;
      this.#opponentScore = data.scores.sender;
      this.#myScore = data.scores.opponent;
      this.render(false);
      notifySpectateUpdate({ immediate: true });
    }

    if (data.action === "tttRematch" && data.gameId === this.#gameId && data.targetUser === game.user.id) {
      this.#board = Array(9).fill(null);
      this.#winner = null;
      this.#isDraw = false;
      this.#mySymbol = data.yourSymbol;
      this.#turn = "X";
      this.render(false);
      notifySpectateUpdate({ immediate: true });
    }

    if (data.action === "tttQuit" && data.gameId === this.#gameId && data.targetUser === game.user.id) {
      ui.notifications.info(`${escapeHtml(data.quitterName)} ${i18n("AFK_TAVERN.ticTacToe.opponentLeft")}`);
      this.#winner = null;
      this.#isDraw = false;
      this.close();
    }
  }

  static #onPlayCell(event, target) {
    const index = Number(target.dataset.index);
    if (isNaN(index)) return;
    this.#makeMove(index);
  }

  static #onRematch() {
    const newMySymbol = this.#mySymbol === "X" ? "O" : "X";
    const newOpponentSymbol = this.#mySymbol;

    this.#board = Array(9).fill(null);
    this.#winner = null;
    this.#isDraw = false;
    this.#mySymbol = newMySymbol;
    this.#turn = "X";

    game.socket.emit(SOCKET_KEY, {
      action: "tttRematch",
      gameId: this.#gameId,
      targetUser: this.#opponentId,
      yourSymbol: newOpponentSymbol
    });

    this.render(false);
    notifySpectateUpdate({ immediate: true });
  }

  getSpectateState() {
    return {
      gameType: "tic-tac-toe",
      isMultiplayer: true,
      playerNames: [game.user.name, this.#opponentName],
      data: {
        board: [...this.#board],
        winLine: this.#getWinLine(),
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
    game.socket.off(SOCKET_KEY, this._socketHandler);
    if (this._disconnectHook != null) Hooks.off("userConnected", this._disconnectHook);
    if (this.#opponentId) {
      game.socket.emit(SOCKET_KEY, {
        action: "tttQuit",
        gameId: this.#gameId,
        targetUser: this.#opponentId,
        quitterName: game.user.name
      });
    }
    unregisterGameForSpectate(this);
    return super.close(options);
  }
}

const TTT_X_HTML = `<div class="ttt-piece ttt-piece-X"><div class="ttt-x-mark"><div class="ttt-x-line ttt-x-line-1"></div><div class="ttt-x-line ttt-x-line-2"></div></div></div>`;
const TTT_O_HTML = `<div class="ttt-piece ttt-piece-O"><div class="ttt-o-mark"></div></div>`;

registerSpectateConfig("tic-tac-toe", {
  template: "tic-tac-toe-board.hbs",
  multiplayer: true,
  statusCls: "ttt-sp-status",
  wrapperSel: ".ttt-wrapper",
  mapContext(state) {
    const oppSymbol = state.mySymbol === "X" ? "O" : "X";
    return {
      isMultiplayer: true,
      playerLeftPreview: `<div class="ttt-piece-preview ttt-preview-${state.mySymbol}"></div>`,
      playerRightPreview: `<div class="ttt-piece-preview ttt-preview-${oppSymbol}"></div>`,
      playerLeftCls: "", playerRightCls: "",
      myName: state.myName, opponentName: state.oppName,
      myScore: state.myScore ?? 0, opponentScore: state.oppScore ?? 0,
      isMyTurn: state.isMyTurn, isGameOver: false, isWin: false, isLoss: false, isDraw: false,
      statusText: "",
      cells: Array.from({ length: 9 }, (_, i) => ({ index: i, raw: null, isEmpty: true, isX: false, isO: false, isWinCell: false })),
      loc: { vs: i18n("AFK_TAVERN.spectate.vs") }
    };
  },
  onBuild: (el) => ({ cells: [...el.querySelectorAll(".ttt-cell")] }),
  onSync(el, state, prev, refs) {
    const board = state.board ?? [];
    const winLine = new Set(state.winLine ?? []);
    for (let i = 0; i < refs.cells.length; i++) {
      const cellEl = refs.cells[i];
      const val = board[i];
      const hadPiece = cellEl.classList.contains("ttt-has-piece");
      const isWin = winLine.has(i);
      cellEl.classList.toggle("ttt-cell-empty", !val);
      cellEl.classList.toggle("ttt-has-piece", !!val);
      cellEl.classList.toggle("ttt-cell-win", isWin);
      if (val && !hadPiece) cellEl.innerHTML = val === "X" ? TTT_X_HTML : TTT_O_HTML;
      else if (!val && hadPiece) cellEl.innerHTML = "";
    }
  }
});

const TTT_INVITE_CONFIG = {
  locPrefix: "AFK_TAVERN.ticTacToe",
  actions: { invite: "tttInvite", declined: "tttDeclined", accepted: "tttAccepted", expired: "tttInviteExpired" },
  icon: "fa-solid fa-xmarks-lines"
};

export function setupTicTacToeInvites() {
  setupMultiplayerInviteListener({
    ...TTT_INVITE_CONFIG,
    createAcceptedApp: (data) => new TicTacToeApp({
      gameId: data.gameId,
      mySymbol: "O",
      opponentId: data.senderId,
      opponentName: data.senderName
    })
  });
}

export async function inviteToTicTacToe(ctx = {}) {
  showMultiplayerInviteDialog({
    ...TTT_INVITE_CONFIG,
    gameWidth: 340,
    createHostApp: (gameId, data) => new TicTacToeApp({
      gameId,
      mySymbol: "X",
      opponentId: data.accepterId,
      opponentName: data.accepterName
    })
  }, ctx);
}
