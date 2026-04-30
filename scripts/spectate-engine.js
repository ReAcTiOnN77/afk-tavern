import { MODULE_ID, SOCKET_KEY, i18n, i18nFormat } from "./afk-tavern.js";
import { ApplicationV2, HandlebarsApplicationMixin } from "./generic-helpers.js";

const _configRegistry = new Map();
const _spectators = new Set();
let _activeGameApp = null;
let _broadcastInterval = null;
let _stateDirty = false;
let _onSpectateAccepted = null;
let _spectateApp = null;
let _cachedSpectateLoc = null;

export function registerSpectateConfig(gameType, config) {
  _configRegistry.set(gameType, config);
}

export function registerGameForSpectate(app) {
  _activeGameApp = app;
  _stateDirty = true;
  if (_spectators.size > 0) _startBroadcasting();
}

export function unregisterGameForSpectate(app) {
  if (_activeGameApp !== app) return;
  _activeGameApp = null;
  _stopBroadcasting();
  for (const specId of _spectators) {
    game.socket.emit(SOCKET_KEY, { action: "spectateEnded", targetUser: specId });
  }
  _spectators.clear();
}

export function notifySpectateUpdate({ immediate = false } = {}) {
  if (!_activeGameApp || _spectators.size === 0) return;
  if (immediate) _pushState();
  else _stateDirty = true;
}

export function broadcastToSpectators(payload) {
  for (const specId of _spectators) {
    game.socket.emit(SOCKET_KEY, { ...payload, targetUser: specId });
  }
}

export function broadcastCursorToSpectators(x, y) {
  for (const specId of _spectators) {
    game.socket.emit(SOCKET_KEY, { action: "spectateCursor", targetUser: specId, x, y });
  }
}

export function isSpectateEnabled() {
  try { return !!game.settings.get(MODULE_ID, "allowSpectating"); }
  catch { return true; }
}

export function requestSpectate(targetUserId) {
  game.socket.emit(SOCKET_KEY, {
    action: "spectateRequest",
    targetUser: targetUserId,
    spectatorId: game.user.id
  });
}

export function leaveSpectate(hostUserId) {
  game.socket.emit(SOCKET_KEY, {
    action: "spectateLeave",
    targetUser: hostUserId,
    spectatorId: game.user.id
  });
  _spectateApp = null;
}

export function setSpectateAcceptedHandler(handler) { _onSpectateAccepted = handler; }
export function setSpectateApp(app) { _spectateApp = app; }

function _pushState() {
  if (!_activeGameApp?.getSpectateState) return;
  const state = _activeGameApp.getSpectateState();
  if (!state) return;
  for (const specId of _spectators) {
    game.socket.emit(SOCKET_KEY, {
      action: "spectateUpdate",
      targetUser: specId,
      gameType: state.gameType,
      state: state.data
    });
  }
}

function _startBroadcasting() {
  _stopBroadcasting();
  _broadcastInterval = setInterval(() => {
    if (_spectators.size === 0 || !_activeGameApp) { _stopBroadcasting(); return; }
    if (_stateDirty) { _stateDirty = false; _pushState(); }
  }, 200);
}

function _stopBroadcasting() {
  if (_broadcastInterval) { clearInterval(_broadcastInterval); _broadcastInterval = null; }
}

export function setupSpectateListeners() {
  game.socket.on(SOCKET_KEY, (data) => {
    switch (data.action) {
      case "spectateRequest": _handleRequest(data); break;
      case "spectateLeave": _handleLeave(data); break;
      case "spectateAccepted": _handleAccepted(data); break;
      case "spectateUpdate": _handleUpdate(data); break;
      case "spectateSplat": _handleSplat(data); break;
      case "spectateEffect": _handleEffect(data); break;
      case "spectateCursor": _handleCursor(data); break;
      case "spectateEnded": _handleEnded(data); break;
    }
  });
}

function _handleRequest(data) {
  if (data.targetUser !== game.user.id) return;
  if (!isSpectateEnabled() || !_activeGameApp?.getSpectateState) return;
  _spectators.add(data.spectatorId);
  const state = _activeGameApp.getSpectateState();
  game.socket.emit(SOCKET_KEY, {
    action: "spectateAccepted",
    targetUser: data.spectatorId,
    hostId: game.user.id,
    hostName: game.user.name,
    gameType: state.gameType,
    isMultiplayer: state.isMultiplayer ?? false,
    playerNames: state.playerNames ?? [],
    gameWidth: _activeGameApp.element?.closest(".application")?.getBoundingClientRect()?.width
      ?? _activeGameApp.position?.width
      ?? _activeGameApp.constructor.DEFAULT_OPTIONS?.position?.width
      ?? 500,
    state: state.data
  });
  _stateDirty = true;
  if (_spectators.size === 1) _startBroadcasting();
}

function _handleLeave(data) {
  if (data.targetUser !== game.user.id) return;
  _spectators.delete(data.spectatorId);
  if (_spectators.size === 0) _stopBroadcasting();
}

function _handleAccepted(data) {
  if (data.targetUser !== game.user.id) return;
  if (_onSpectateAccepted) _onSpectateAccepted(data);
}

function _handleUpdate(data) {
  if (data.targetUser !== game.user.id) return;
  if (_spectateApp?.applySpectateState) _spectateApp.applySpectateState(data.gameType, data.state);
}

function _handleSplat(data) {
  if (data.targetUser !== game.user.id) return;
  _spectateApp?._onSplat?.(data.x, data.y);
}

function _handleEffect(data) {
  if (data.targetUser !== game.user.id) return;
  _spectateApp?._onEffect?.(data.effect, data.duration);
}

function _handleCursor(data) {
  if (data.targetUser !== game.user.id) return;
  _spectateApp?._onCursor?.(data.x, data.y);
}

function _handleEnded(data) {
  if (data.targetUser !== game.user.id) return;
  if (_spectateApp) {
    ui.notifications.info(i18n("AFK_TAVERN.spectate.ended"));
    _spectateApp.close();
    _spectateApp = null;
  }
}

function _renderPartial(name, ctx) {
  const fn = Handlebars.partials[`modules/${MODULE_ID}/templates/minigames/${name}`];
  return typeof fn === "function" ? fn(ctx) : "";
}

class SpectateRenderer {
  #container = null;
  #config = null;
  #built = false;
  #refs = {};
  #prevState = null;
  #syncCache = [];
  #cursorEl = null;
  #cursorRaf = null;
  #cursorTarget = { x: 0.5, y: 0.5 };
  #cursorCurrent = { x: 0.5, y: 0.5 };

  constructor(config) { this.#config = config; }

  init(container) {
    this.#container = container;
    if (this.#config.cursor) this.#startCursorLoop();
  }

  update(state) {
    if (!this.#container) return;
    if (this.#built && this.#config.shouldRebuild?.(state, this.#prevState)) {
      this.#built = false;
    }
    if (!this.#built) {
      this.#built = true;
      this.#build(state);
    }
    this.#runSync(state);
    this.#config.onSync?.(this.#container, state, this.#prevState, this.#refs);
    if (this.#config.multiplayer) this.#syncMultiplayer(state);
    this.#prevState = state;
  }

  #build(state) {
    const ctx = this.#config.mapContext(state);
    const boardHtml = _renderPartial(this.#config.template, ctx);
    if (this.#config.ownHeader) {
      this.#container.innerHTML = `<div class="minigame-content">${boardHtml}</div>`;
    } else {
      const headerHtml = _renderPartial("minigame-header.hbs", ctx);
      this.#container.innerHTML = `<div class="minigame-content">${headerHtml}${boardHtml}</div>`;
    }
    this.#refs = this.#config.onBuild?.(this.#container, state) ?? {};
    this.#syncCache = (this.#config.sync ?? []).map(rule => ({
      ...rule, _el: this.#container.querySelector(rule.sel)
    }));
    if (this.#config.cursor) this.#attachCursor();
  }

  #runSync(state) {
    for (const rule of this.#syncCache) {
      const el = rule._el;
      if (!el) continue;
      if (rule.text) el.textContent = rule.text(state);
      if (rule.html) el.innerHTML = rule.html(state);
      if (rule.show !== undefined) el.style.display = rule.show(state) ? "" : "none";
      if (rule.cls) {
        for (const [name, active] of Object.entries(rule.cls(state))) {
          el.classList.toggle(name, active);
        }
      }
    }
  }

  #syncMultiplayer(state) {
    const isGameOver = !!state.winner || state.isDraw;
    const leftScore = this.#container.querySelector(".mp-player-left .mp-player-score");
    const rightScore = this.#container.querySelector(".mp-player-right .mp-player-score");
    if (leftScore) leftScore.textContent = state.myScore ?? 0;
    if (rightScore) rightScore.textContent = state.oppScore ?? 0;

    const left = this.#container.querySelector(".mp-player-left");
    const right = this.#container.querySelector(".mp-player-right");
    left?.classList.toggle("mp-player-active", state.isMyTurn && !isGameOver);
    right?.classList.toggle("mp-player-active", !state.isMyTurn && !isGameOver);

    const status = this.#container.querySelector(".mp-status");
    if (status) {
      const isMyWin = state.winner === state.mySymbol;
      const isOppWin = !!state.winner && !isMyWin;
      if (isMyWin) {
        status.textContent = i18nFormat("AFK_TAVERN.spectate.playerWins", { name: state.myName });
        status.className = `mp-status ${this.#config.statusCls ?? ""} mp-status-win`;
      } else if (isOppWin) {
        status.textContent = i18nFormat("AFK_TAVERN.spectate.playerWins", { name: state.oppName });
        status.className = `mp-status ${this.#config.statusCls ?? ""} mp-status-win`;
      } else if (state.isDraw) {
        status.textContent = i18n("AFK_TAVERN.spectate.draw");
        status.className = `mp-status ${this.#config.statusCls ?? ""} mp-status-draw`;
      } else if (state.isMyTurn) {
        status.textContent = i18nFormat("AFK_TAVERN.spectate.playerTurn", { name: state.myName });
        status.className = `mp-status ${this.#config.statusCls ?? ""}`;
      } else {
        status.textContent = i18nFormat("AFK_TAVERN.spectate.playerTurn", { name: state.oppName });
        status.className = `mp-status ${this.#config.statusCls ?? ""}`;
      }
    }

    const wrapper = this.#config.wrapperSel ? this.#container.querySelector(this.#config.wrapperSel) : null;
    if (wrapper) {
      wrapper.classList.toggle("game-ended", isGameOver);
      wrapper.classList.toggle("game-won", state.winner === state.mySymbol);
      wrapper.classList.toggle("game-lost", !!state.winner && state.winner !== state.mySymbol);
    }
  }

  #attachCursor() {
    const board = this.#container.querySelector(this.#config.cursorTarget ?? ".game-board-frame") ?? this.#container;
    board.style.position = "relative";
    this.#cursorEl = document.createElement("div");
    this.#cursorEl.className = this.#config.cursorClass ?? "spectate-cursor";
    board.appendChild(this.#cursorEl);
  }

  #startCursorLoop() {
    const loop = () => {
      this.#cursorRaf = requestAnimationFrame(loop);
      if (!this.#cursorEl) return;
      this.#cursorCurrent.x += (this.#cursorTarget.x - this.#cursorCurrent.x) * 0.3;
      this.#cursorCurrent.y += (this.#cursorTarget.y - this.#cursorCurrent.y) * 0.3;
      this.#cursorEl.style.left = `${(this.#cursorCurrent.x * 100).toFixed(1)}%`;
      this.#cursorEl.style.top = `${(this.#cursorCurrent.y * 100).toFixed(1)}%`;
    };
    this.#cursorRaf = requestAnimationFrame(loop);
  }

  onCursor(x, y) { this.#cursorTarget.x = x; this.#cursorTarget.y = y; }

  tick(now) { this.#config.onTick?.(now, this.#refs); }

  onEffect(effect, duration) { this.#config.onEffect?.(effect, duration, this.#refs); }

  onSplat(x, y) { this.#config.onSplat?.(x, y, this.#refs); }

  destroy() {
    if (this.#cursorRaf) cancelAnimationFrame(this.#cursorRaf);
    this.#config.onDestroy?.(this.#refs);
    this.#container = null;
    this.#refs = {};
    this.#syncCache = [];
    this.#cursorEl = null;
    this.#prevState = null;
  }
}

export class SpectateViewApp extends HandlebarsApplicationMixin(ApplicationV2) {
  #hostId;
  #hostName;
  #gameType;
  #isMultiplayer;
  #playerNames;
  #gameWidth;
  #renderer = null;
  #rafId = null;

  constructor(options = {}) {
    super(options);
    this.#hostId = options.hostId;
    this.#hostName = options.hostName ?? i18n("AFK_TAVERN.spectate.spectating");
    this.#gameType = options.gameType ?? "unknown";
    this.#isMultiplayer = options.isMultiplayer ?? false;
    this.#playerNames = options.playerNames ?? [];
    this.#gameWidth = Math.max(320, Math.ceil((options.gameWidth ?? 400) * 1.05));
  }

  static DEFAULT_OPTIONS = {
    id: "afk-tavern-spectate-view",
    tag: "div",
    window: {
      title: "AFK_TAVERN.spectate.title",
      icon: "fa-solid fa-eye",
      resizable: false,
      minimizable: true
    },
    position: { width: 400, height: "auto" },
    classes: ["afk-tavern", "spectate-view"]
  };

  static PARTS = {
    main: { template: `modules/${MODULE_ID}/templates/spectate-view-app.hbs` }
  };

  _onFirstRender() { this.setPosition({ width: this.#gameWidth }); }

  async _prepareContext() {
    const bannerText = this.#isMultiplayer && this.#playerNames.length >= 2
      ? `${this.#playerNames[0]} vs ${this.#playerNames[1]}`
      : this.#hostName;
    return {
      hostName: this.#hostName,
      bannerText,
      isMultiplayer: this.#isMultiplayer,
      gameType: this.#gameType,
      loc: _cachedSpectateLoc ?? (_cachedSpectateLoc = {
        spectating: i18n("AFK_TAVERN.spectate.spectating"),
        watching: i18n("AFK_TAVERN.spectate.watching")
      })
    };
  }

  applySpectateState(gameType, state) {
    if (!this.rendered) return;
    const container = this.element?.querySelector(".spectate-content");
    if (!container) return;
    const config = _configRegistry.get(gameType);
    if (!config) return;

    if (this.#renderer && gameType !== this.#gameType) {
      this.#renderer.destroy();
      this.#renderer = null;
      this.#stopRaf();
      container.innerHTML = "";
    }

    if (!this.#renderer) {
      this.#gameType = gameType;
      this.#renderer = new SpectateRenderer(config);
      this.#renderer.init(container);
      if (config.tick || config.cursor) this.#startRaf();
    }
    this.#renderer.update(state);
  }

  _onCursor(x, y) { this.#renderer?.onCursor(x, y); }
  _onEffect(effect, duration) { this.#renderer?.onEffect(effect, duration); }
  _onSplat(x, y) { this.#renderer?.onSplat(x, y); }

  #startRaf() {
    const loop = () => {
      this.#renderer?.tick(performance.now());
      this.#rafId = requestAnimationFrame(loop);
    };
    this.#rafId = requestAnimationFrame(loop);
  }

  #stopRaf() {
    if (this.#rafId) { cancelAnimationFrame(this.#rafId); this.#rafId = null; }
  }

  close(options) {
    this.#stopRaf();
    this.#renderer?.destroy();
    this.#renderer = null;
    if (this.#hostId) leaveSpectate(this.#hostId);
    setSpectateApp(null);
    return super.close(options);
  }
}
