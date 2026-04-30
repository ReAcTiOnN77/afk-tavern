import { getPlayerDisplay, getBadgeText } from "./generic-helpers.js";

const MODULE_ID = "afk-tavern";
const SOCKET_KEY = `module.${MODULE_ID}`;

const MinigameRegistry = new Map();

export function i18n(key) {
  return game.i18n.localize(key);
}

export function i18nFormat(key, data = {}) {
  return game.i18n.format(key, data);
}

export function escapeHtml(str) {
  return (str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const SOUND_SETTING_MAP = {
  "break-start.ogg":     "soundBreakStart",
  "break-end.ogg":       "soundBreakEnd",
  "break-countdown.ogg": "soundBreakCountdown",
  "break-notify.ogg":    "soundBreakNotify"
};

function playSound(filename, volume = 0.8) {
  let src = `modules/${MODULE_ID}/assets/sounds/${filename}`;
  const settingKey = SOUND_SETTING_MAP[filename];
  if (settingKey) {
    try {
      const custom = game.settings.get(MODULE_ID, settingKey);
      if (custom) src = custom;
    } catch {}
  }
  foundry.audio.AudioHelper.play({
    src, volume, autoplay: true, loop: false, channel: "interface"
  });
}

function registerMinigame(id, config) {
  MinigameRegistry.set(id, {
    id,
    label: config.label,
    icon: config.icon ?? "fa-solid fa-dice",
    description: config.description ?? "",
    appClass: config.appClass,
    difficulties: config.difficulties ?? ["Easy", "Medium", "Hard"],
    defaultDifficulty: config.defaultDifficulty ?? "Medium",
    options: config.options ?? {},
    category: config.category ?? "classic"
  });
}

let breakState = {
  active: false,
  duration: 600,
  remaining: 0,
  startedAt: null,
  players: {},
  playingGame: {}
};

let breakTimerInterval = null;
let _breakTimerTimeout = null;
let breakRoomApp = null;
let _BreakRoomApp = null;
let _MiniBar = null;
let _breakRoomOriginalPos = null;
let _syncResolved = false;
let _tavernQuotes = [];
let _previouslyPlaying = [];
let _didPauseGame = false;
let _breakEndSoundPlayed = false;
let _pendingInvite = null;
let _inviteDialogOpen = false;
const INVITE_TIMEOUT = 30000;

let _tabChannel = null;
let _tabActive = false;
try {
  _tabChannel = new BroadcastChannel("afk-tavern-tab");
  _tabChannel.onmessage = (e) => {
    if (e.data?.userId !== game?.user?.id) return;
    if (e.data.type === "ping" && _tabActive) {
      _tabChannel.postMessage({ type: "pong", userId: game.user.id });
    }
    if (e.data.type === "pong" && _tabActive) {
      ui.notifications?.warn(i18n("AFK_TAVERN.notifications.duplicateTab"));
    }
  };
} catch {}

async function loadTavernQuotes() {
  try {
    const response = await fetch(`modules/${MODULE_ID}/assets/tavern-quotes.json`);
    if (response.ok) _tavernQuotes = await response.json();
  } catch (e) {
    console.warn("AFK Tavern | Failed to load tavern quotes", e);
  }
}

function getRandomQuote() {
  if (_tavernQuotes.length === 0) return i18n("AFK_TAVERN.banner.subtitle");
  return _tavernQuotes[Math.floor(Math.random() * _tavernQuotes.length)];
}

function getBreakState() {
  return breakState;
}

function isBreakActive() {
  return breakState.active;
}

function isPlayerHidden(userId) {
  try {
    const hidden = game.settings.get(MODULE_ID, "hiddenPlayers");
    return Array.isArray(hidden) && hidden.includes(userId);
  } catch { return false; }
}

function moveBreakRoomAside(gameApp) {
  if (!breakRoomApp || !breakRoomApp.rendered) return;
  _breakRoomOriginalPos = { left: breakRoomApp.position.left, top: breakRoomApp.position.top };
  const gap = 8;
  const doMove = () => {
    const gameLeft = gameApp?.position?.left ?? 0;
    const gameWidth = gameApp?.position?.width ?? gameApp?.constructor?.DEFAULT_OPTIONS?.position?.width ?? 520;
    const gameRight = gameLeft + gameWidth;
    const targetLeft = Math.min(window.innerWidth - breakRoomApp.position.width - 10, gameRight + gap);
    const targetTop = Math.max(10, (window.innerHeight - breakRoomApp.position.height) / 2);
    breakRoomApp.setPosition({ left: targetLeft, top: targetTop });
  };
  requestAnimationFrame(doMove);
}

function moveBreakRoomCenter() {
  if (!breakRoomApp || !breakRoomApp.rendered) return;
  if (_breakRoomOriginalPos) {
    breakRoomApp.setPosition({ left: _breakRoomOriginalPos.left, top: _breakRoomOriginalPos.top });
    _breakRoomOriginalPos = null;
  } else {
    const targetLeft = Math.max(10, (window.innerWidth - breakRoomApp.position.width) / 2);
    const targetTop = Math.max(10, (window.innerHeight - breakRoomApp.position.height) / 2);
    breakRoomApp.setPosition({ left: targetLeft, top: targetTop });
  }
}

Hooks.once("init", async () => {
  const { registerSettings } = await import("./config.js");
  registerSettings();
});

Hooks.once("ready", async () => {
  await foundry.applications.handlebars.loadTemplates([
    `modules/${MODULE_ID}/templates/break-room-app.hbs`,
    `modules/${MODULE_ID}/templates/spectate-view-app.hbs`,
    `modules/${MODULE_ID}/templates/settings-app.hbs`,
    `modules/${MODULE_ID}/templates/player-settings-app.hbs`,
    `modules/${MODULE_ID}/templates/game-settings-app.hbs`,
    `modules/${MODULE_ID}/templates/minigames/minigame-header.hbs`,
    `modules/${MODULE_ID}/templates/minigames/minigame-footer.hbs`,
    `modules/${MODULE_ID}/templates/minigames/memory-match-board.hbs`,
    `modules/${MODULE_ID}/templates/minigames/minesweeper-board.hbs`,
    `modules/${MODULE_ID}/templates/minigames/simon-says-board.hbs`,
    `modules/${MODULE_ID}/templates/minigames/whack-a-mole-board.hbs`,
    `modules/${MODULE_ID}/templates/minigames/word-scramble-board.hbs`,
    `modules/${MODULE_ID}/templates/minigames/monster-harvester-board.hbs`,
    `modules/${MODULE_ID}/templates/minigames/tic-tac-toe-board.hbs`,
    `modules/${MODULE_ID}/templates/minigames/connect-four-board.hbs`
  ]);

  await loadTavernQuotes();

  const { BreakRoomApp } = await import("./break-room.js");
  const { MemoryMatchApp } = await import("./minigames/memory-match.js");
  const { MinesweeperApp } = await import("./minigames/minesweeper.js");
  const { SimonSaysApp } = await import("./minigames/simon-says.js");
  const { WhackAMoleApp } = await import("./minigames/whack-a-mole.js");
  const { WordScrambleApp } = await import("./minigames/word-scramble.js");
  const { MonsterHarvesterApp } = await import("./minigames/monster-harvester.js");
  const { TicTacToeApp, setupTicTacToeInvites, inviteToTicTacToe } = await import("./minigames/tic-tac-toe.js");
  const { ConnectFourApp, setupConnectFourInvites, inviteToConnectFour } = await import("./minigames/connect-four.js");
  const { setupSpectateListeners } = await import("./spectate-engine.js");
  const MiniBarModule = await import("./mini-bar.js");
  _MiniBar = MiniBarModule;

  setupTicTacToeInvites();
  setupConnectFourInvites();
  setupSpectateListeners();

  _BreakRoomApp = BreakRoomApp;

  registerMinigame("memory-match", {
    label: i18n("AFK_TAVERN.memoryMatch.title"),
    icon: "fa-solid fa-clone",
    description: i18n("AFK_TAVERN.memoryMatch.description"),
    appClass: MemoryMatchApp,
    difficulties: ["Easy (3×4)", "Medium (4×4)", "Hard (4×5)", "Expert (4×6)", "Master (5×6)", "Legendary (5×8)"],
    defaultDifficulty: "Medium (4×4)",
    category: "classic"
  });

  registerMinigame("minesweeper", {
    label: i18n("AFK_TAVERN.minesweeper.title"),
    icon: "fa-solid fa-bomb",
    description: i18n("AFK_TAVERN.minesweeper.description"),
    appClass: MinesweeperApp,
    difficulties: ["Easy (8×8, 8 mines)", "Medium (10×10, 14 mines)", "Hard (12×12, 22 mines)", "Expert (14×14, 32 mines)", "Master (16×16, 45 mines)", "Legendary (18×16, 56 mines)"],
    defaultDifficulty: "Medium (10×10, 14 mines)",
    category: "classic"
  });

  registerMinigame("simon-says", {
    label: i18n("AFK_TAVERN.simonSays.title"),
    icon: "fa-solid fa-wand-magic-sparkles",
    description: i18n("AFK_TAVERN.simonSays.description"),
    appClass: SimonSaysApp,
    difficulties: ["Easy (4 colours)", "Medium (5 colours)", "Hard (6 colours)", "Expert (7 colours)", "Master (8 colours)", "Legendary (9 colours)"],
    defaultDifficulty: "Medium (5 colours)",
    category: "classic"
  });

  registerMinigame("whack-a-mole", {
    label: i18n("AFK_TAVERN.whackAMole.title"),
    icon: "fa-solid fa-hammer",
    description: i18n("AFK_TAVERN.whackAMole.description"),
    appClass: WhackAMoleApp,
    difficulties: ["Easy (30s, slow)", "Medium (30s, normal)", "Hard (30s, fast)", "Expert (45s, 12 slots)", "Master (60s, 12 slots)", "Legendary (60s, 16 slots)"],
    defaultDifficulty: "Medium (30s, normal)",
    category: "classic"
  });

  registerMinigame("word-scramble", {
    label: i18n("AFK_TAVERN.wordScramble.title"),
    icon: "fa-solid fa-font",
    description: i18n("AFK_TAVERN.wordScramble.description"),
    appClass: WordScrambleApp,
    difficulties: ["Easy (3 letters)", "Medium (4-7 letters)", "Hard (7+ letters)", "Random (3-7+ letters)"],
    defaultDifficulty: "Medium (4-7 letters)",
    category: "classic"
  });

  registerMinigame("monster-harvester", {
    label: i18n("AFK_TAVERN.monsterHarvester.title"),
    icon: "fa-solid fa-knife-kitchen",
    description: i18n("AFK_TAVERN.monsterHarvester.description"),
    appClass: MonsterHarvesterApp,
    difficulties: ["Easy (15 items, slow)", "Medium (25 items, normal)", "Hard (35 items, fast)"],
    defaultDifficulty: "Medium (25 items, normal)",
    category: "premium",
    options: {
      customConfig: true,
      importFrom: {
        moduleId: "monster-harvester",
        settingsMap: {
          baseSpeed: "minigameBaseSpeed",
          hazardRatio: "minigameDecoyRatio",
          maxStrikes: "minigameMaxStrikes",
          advancedHazards: "minigameAdvancedHazards"
        }
      },
      customFields: [
        { name: "itemCount", label: "AFK_TAVERN.monsterHarvester.config.itemCount", type: "number", min: 5, max: 50, step: 1, default: 25 },
        { name: "baseSpeed", label: "AFK_TAVERN.monsterHarvester.config.baseSpeed", type: "number", min: 50, max: 500, step: 10, default: 200 },
        { name: "hazardRatio", label: "AFK_TAVERN.monsterHarvester.config.hazardRatio", type: "number", min: 0, max: 5, step: 0.5, default: 1 },
        { name: "maxStrikes", label: "AFK_TAVERN.monsterHarvester.config.maxStrikes", type: "number", min: 0, max: 20, step: 1, default: 3 },
        { name: "advancedHazards", label: "AFK_TAVERN.monsterHarvester.config.advancedHazards", type: "checkbox", default: false }
      ],
      presets: {
        "Easy (15 items, slow)": { itemCount: 15, baseSpeed: 150, hazardRatio: 0.5, maxStrikes: 5, advancedHazards: false },
        "Medium (25 items, normal)": { itemCount: 25, baseSpeed: 200, hazardRatio: 1, maxStrikes: 3, advancedHazards: false },
        "Hard (35 items, fast)": { itemCount: 35, baseSpeed: 280, hazardRatio: 1.5, maxStrikes: 2, advancedHazards: true }
      }
    }
  });

  registerMinigame("tic-tac-toe", {
    label: i18n("AFK_TAVERN.ticTacToe.title"),
    icon: "fa-solid fa-xmarks-lines",
    description: i18n("AFK_TAVERN.ticTacToe.description"),
    appClass: TicTacToeApp,
    difficulties: [],
    category: "multiplayer",
    options: {
      customLaunch: inviteToTicTacToe
    }
  });

  registerMinigame("connect-four", {
    label: i18n("AFK_TAVERN.connectFour.title"),
    icon: "fa-solid fa-circle-dot",
    description: i18n("AFK_TAVERN.connectFour.description"),
    appClass: ConnectFourApp,
    difficulties: [],
    category: "multiplayer",
    options: {
      customLaunch: inviteToConnectFour
    }
  });

  const mod = game.modules.get(MODULE_ID);
  if (mod) {
    mod.api = {
      registerMinigame,
      getRegistry: () => MinigameRegistry,
      getBreakState,
      isBreakActive,
      openBreakRoom,
      startBreak,
      endBreak
    };
  }

  game.socket.on(SOCKET_KEY, _onSocketMessage);

  const onlinePeers = game.users.filter(u => u.active && u.id !== game.user.id);
  if (onlinePeers.length > 0) {
    game.socket.emit(SOCKET_KEY, { action: "syncPing", userId: game.user.id, t0: Date.now() });
  }

  _updatePlayerListButton();
});

Hooks.on("getSceneControlButtons", (controls) => {
  const tokens = controls.tokens;
  if (!tokens) return;
  tokens.tools["afk-tavern-break"] = {
    name: "afk-tavern-break",
    title: "AFK_TAVERN.controls.startBreak",
    icon: "fa-solid fa-beer-mug-empty",
    button: true,
    visible: game.user.isGM,
    order: Object.keys(tokens.tools).length,
    onChange: () => openBreakRoom()
  };
});

let _playerListBtnRaf = null;
function _updatePlayerListButton() {
  if (_playerListBtnRaf) return;
  _playerListBtnRaf = requestAnimationFrame(() => {
    _playerListBtnRaf = null;
    _doUpdatePlayerListButton();
  });
}
function _doUpdatePlayerListButton() {
  const playerListEl = document.querySelector("#players");
  if (!playerListEl || !game.user) return;

  const shouldShow = game.user.isGM;
  const isLobby = !!breakState.lobbyMode;
  const displayLabel = breakState.active
    ? i18n(isLobby ? "AFK_TAVERN.playerList.startSession" : "AFK_TAVERN.playerList.endBreak")
    : i18n("AFK_TAVERN.playerList.startBreak");

  if (!shouldShow) {
    playerListEl.querySelector(".afk-tavern-break-btn")?.remove();
    return;
  }

  const existing = playerListEl.querySelector(".afk-tavern-break-btn");
  if (existing) {
    existing.innerHTML = `<i class="fa-solid fa-beer-mug-empty"></i> ${displayLabel}`;
    return;
  }

  const btn = document.createElement("button");
  btn.setAttribute("type", "button");
  btn.className = "afk-tavern-break-btn";
  btn.innerHTML = `<i class="fa-solid fa-beer-mug-empty"></i> ${displayLabel}`;
  btn.addEventListener("click", async () => {
    if (breakState.active) {
      const isLobby = !!breakState.lobbyMode;
      const result = await foundry.applications.api.DialogV2.wait({
        classes: ["afk-tavern-config-dialog"],
        window: {
          title: i18n(isLobby ? "AFK_TAVERN.dialog.lobbyCloseTitle" : "AFK_TAVERN.dialog.closeTitle"),
          icon: "fa-solid fa-beer-mug-empty"
        },
        position: { width: 300 },
        content: `<div class="afk-tavern-config"><p class="config-desc">${i18n(isLobby ? "AFK_TAVERN.dialog.lobbyConfirmContent" : "AFK_TAVERN.dialog.confirmContent")}</p></div>`,
        buttons: [
          { action: "end", label: i18n(isLobby ? "AFK_TAVERN.dialog.lobbyCloseEnd" : "AFK_TAVERN.dialog.closeEnd") },
          { action: "cancel", label: i18n("AFK_TAVERN.minigames.cancel"), default: true }
        ],
        rejectClose: false
      });
      if (result === "end") endBreak();
    } else {
      openBreakRoom({ skipMinimized: true });
    }
  });

  const otherBtns = playerListEl.querySelectorAll(".rest-recovery-prompt-rest-button, [class*='item-piles-player-list']");
  const lastOther = otherBtns.length > 0 ? otherBtns[otherBtns.length - 1] : null;
  const wrapper = lastOther?.closest(".rest-recovery-button-parent") ?? lastOther;
  if (wrapper) {
    wrapper.after(btn);
  } else {
    const targetEl = playerListEl.querySelector("#players-active .players-list")
      ?? playerListEl.querySelector(".players-list")
      ?? playerListEl.querySelector("ol");
    if (targetEl) targetEl.after(btn);
  }
}

Hooks.on("renderPlayers", () => {
  _updatePlayerListButton();
});

Hooks.on("userConnected", (user, connected) => {
  if (connected && breakState.active && !isPlayerHidden(user.id)) {
    if (!breakState.players[user.id]) {
      const defaultStatus = breakState.lobbyMode ? "back" : "away";
      breakState.players[user.id] = defaultStatus;
    }
    if (game.user.isGM) {
      const action = breakState.lobbyMode ? "playerBack" : "playerAway";
      game.socket.emit(SOCKET_KEY, { action, userId: user.id });
      setTimeout(() => {
        game.socket.emit(SOCKET_KEY, {
          action: "syncPong",
          state: { ...breakState, players: { ...breakState.players } },
          elapsedMs: Date.now() - breakState.startedAt,
          t0: Date.now(),
          targetUser: user.id
        });
      }, 1000);
    }
  }
  _refreshBreakRoom({ full: true });
});

function openBreakRoom(opts = {}) {
  if (!_BreakRoomApp) return;
  _MiniBar?.hideMiniBar();

  let startMinimized = false;
  try { startMinimized = !opts.skipMinimized && !!game.settings.get(MODULE_ID, "startMinimized"); } catch {}

  if (startMinimized && breakState.active) {
    _MiniBar?.showMiniBar();
    return;
  }

  if (breakRoomApp && breakRoomApp.rendered) {
    breakRoomApp.bringToFront();
    return;
  }

  _tabActive = true;
  try { _tabChannel?.postMessage({ type: "ping", userId: game.user.id }); } catch {}

  breakRoomApp = new _BreakRoomApp();
  breakRoomApp.render(true);
}

function startBreak(durationSeconds, lobbyMode = false) {
  if (!game.user.isGM) return;
  if (breakState.active) return;
  _breakEndSoundPlayed = false;
  _syncResolved = false;
  _allReadyNotified = false;
  const defaultStatus = lobbyMode ? "back" : "away";
  const players = {};
  for (const user of game.users) {
    if (user.active && !isPlayerHidden(user.id)) {
      players[user.id] = defaultStatus;
    }
  }
  breakState = {
    active: true,
    lobbyMode,
    duration: durationSeconds,
    remaining: durationSeconds,
    startedAt: Date.now(),
    players,
    playingGame: {}
  };
  _startTimer();
  game.socket.emit(SOCKET_KEY, { action: "breakStarted", state: breakState });
  _notifyAll();
  _startBreakPlaylist();
  if (!game.paused) {
    _didPauseGame = true;
    game.togglePause(true, { broadcast: true });
  } else {
    _didPauseGame = false;
  }
  ui.notifications.info(i18n(lobbyMode ? "AFK_TAVERN.notifications.lobbyStarted" : "AFK_TAVERN.notifications.breakStarted"));
  playSound("break-start.ogg");
  _refreshBreakRoom();
  setTimeout(() => {
    if (breakRoomApp && breakRoomApp.rendered) {
      const w = breakRoomApp.position.width ?? 480;
      const h = breakRoomApp.element?.getBoundingClientRect()?.height ?? 400;
      breakRoomApp.setPosition({
        left: Math.max(10, (window.innerWidth - w) / 2),
        top: Math.max(10, (window.innerHeight - h) / 2)
      });
    }
  }, 100);
}

function endBreak() {
  if (!game.user.isGM) return;
  const wasLobby = !!breakState.lobbyMode;
  breakState.active = false;
  breakState.remaining = 0;
  breakState.playingGame = {};
  _syncResolved = false;
  _stopTimer();
  _stopBreakPlaylist();
  if (_didPauseGame && game.paused) {
    game.togglePause(false, { broadcast: true });
  }
  _didPauseGame = false;
  game.socket.emit(SOCKET_KEY, { action: "breakEnded", wasLobby });
  ui.notifications.info(i18n(wasLobby ? "AFK_TAVERN.notifications.sessionStarted" : "AFK_TAVERN.notifications.breakEnded"));
  if (!_breakEndSoundPlayed) {
    _breakEndSoundPlayed = true;
    playSound("break-end.ogg");
  }
  _closeBreakRoom();
}

function markPlayerBack(userId) {
  if (!breakState.active) return;
  breakState.players[userId] = "back";
  game.socket.emit(SOCKET_KEY, { action: "playerBack", userId });
  _refreshBreakRoom();
  if (game.user.isGM) _checkAllBack();
}

function markPlayerAway(userId) {
  if (!breakState.active) return;
  breakState.players[userId] = "away";
  _allReadyNotified = false;
  game.socket.emit(SOCKET_KEY, { action: "playerAway", userId });
  _refreshBreakRoom();
}

function setPlayerGame(userId, gameLabel) {
  if (!breakState.active) return;
  breakState.playingGame[userId] = gameLabel;
  game.socket.emit(SOCKET_KEY, { action: "playerGame", userId, gameLabel });
  _refreshBreakRoom({ full: true });
}

function clearPlayerGame(userId) {
  if (!breakState.active) return;
  delete breakState.playingGame[userId];
  game.socket.emit(SOCKET_KEY, { action: "playerGame", userId, gameLabel: null });
  _refreshBreakRoom({ full: true });
}

function _startTimer() {
  _stopTimer();
  const tick = () => {
    if (!breakState.active) return _stopTimer();
    const elapsed = Math.floor((Date.now() - breakState.startedAt) / 1000);
    breakState.remaining = Math.max(0, breakState.duration - elapsed);
    _updateTimerDOM();
    if (breakState.remaining === 10) {
      playSound("break-countdown.ogg");
    }
    if (breakState.remaining <= 0) {
      ui.notifications.warn(i18n("AFK_TAVERN.notifications.timerExpired"));
      if (!_breakEndSoundPlayed) {
        _breakEndSoundPlayed = true;
        playSound("break-end.ogg");
      }
      _stopTimer();
    }
  };
  tick();
  const msIntoSecond = (Date.now() - breakState.startedAt) % 1000;
  const msUntilNext = msIntoSecond === 0 ? 1000 : (1000 - msIntoSecond);
  _breakTimerTimeout = setTimeout(() => {
    tick();
    breakTimerInterval = setInterval(tick, 1000);
  }, msUntilNext);
}

function _stopTimer() {
  if (_breakTimerTimeout) {
    clearTimeout(_breakTimerTimeout);
    _breakTimerTimeout = null;
  }
  if (breakTimerInterval) {
    clearInterval(breakTimerInterval);
    breakTimerInterval = null;
  }
}

function _updateTimerDOM() {
  if (!breakRoomApp || !breakRoomApp.rendered) return;
  const el = breakRoomApp.element;
  if (!el) return;
  const minutes = String(Math.floor(breakState.remaining / 60)).padStart(2, "0");
  const seconds = String(breakState.remaining % 60).padStart(2, "0");
  const mmEl = el.querySelector(".timer-mm");
  const ssEl = el.querySelector(".timer-ss");
  if (mmEl) mmEl.textContent = minutes;
  if (ssEl) ssEl.textContent = seconds;
  const progressFill = el.querySelector(".timer-progress-fill");
  if (progressFill && breakState.duration > 0) {
    progressFill.style.width = `${Math.max(0, (breakState.remaining / breakState.duration) * 100)}%`;
  }
  const timerDisplay = el.querySelector(".timer-display");
  if (timerDisplay) {
    timerDisplay.classList.toggle("timer-urgent", breakState.remaining <= 60);
    timerDisplay.classList.toggle("timer-warning", breakState.remaining <= 180 && breakState.remaining > 60);
  }
}

let _allReadyNotified = false;

function _checkAllBack() {
  if (!breakState.active) return;
  const isLobby = !!breakState.lobbyMode;

  if (isLobby) {
    for (const user of game.users) {
      if (isPlayerHidden(user.id)) continue;
      if (!user.active) return;
      if (breakState.players[user.id] !== "back") return;
    }
    if (_allReadyNotified) return;
    _allReadyNotified = true;
    ui.notifications.info(i18n("AFK_TAVERN.notifications.allReady"));
  } else {
    const nonGMOnline = [...game.users].filter(u => !u.isGM && u.active && !isPlayerHidden(u.id));
    if (nonGMOnline.length === 0) return;
    if (!nonGMOnline.every(u => breakState.players[u.id] === "back")) return;
    ui.notifications.info(i18n("AFK_TAVERN.notifications.allBack"));
  }
}

function _notifyAll() {
  for (const user of game.users) {
    if (!user.isGM && user.active) {
      game.socket.emit(SOCKET_KEY, { action: "openBreakRoom", targetUser: user.id });
    }
  }
}

function _refreshBreakRoom(opts = {}) {
  _updatePlayerListButton();
  _MiniBar?.refreshMiniBarRoster();
  if (!breakRoomApp || !breakRoomApp.rendered) return;

  if (opts.full) {
    breakRoomApp.render(false);
    return;
  }

  const el = breakRoomApp.element;
  if (!el) return;

  const state = breakState;
  const loc = _cachedBreakRoomLoc?.();

  // Update all-back badge + GM button
  const isLobby = !!state.lobbyMode;
  const heading = el.querySelector(".player-status-section .section-heading");
  if (heading) {
    const users = [...game.users];
    const nonGMOnline = users.filter(u => u.active && !u.isGM && !isPlayerHidden(u.id));
    const allPlayersBack = nonGMOnline.length > 0 && nonGMOnline.every(u => state.players[u.id] === "back");
    const gmOnline = users.filter(u => u.active && u.isGM && !isPlayerHidden(u.id));
    const everyoneBack = allPlayersBack && gmOnline.every(u => state.players[u.id] === "back");
    const hasOffline = users.some(u => !u.active && !u.isGM && !isPlayerHidden(u.id));
    const allReady = isLobby && everyoneBack && !hasOffline;

    let badge = heading.querySelector(".all-back-badge");
    const badgeText = getBadgeText(isLobby, allReady, everyoneBack, allPlayersBack, loc);
    if (badgeText) {
      if (!badge) { badge = document.createElement("span"); badge.className = "all-back-badge"; heading.appendChild(badge); }
      badge.textContent = badgeText;
    } else {
      badge?.remove();
    }

    const endBtn = el.querySelector("[data-action='endBreak']");
    if (endBtn) endBtn.classList.toggle("btn-all-ready", allReady);
  }

  // Update each player card
  for (const [userId, status] of Object.entries(state.players)) {
    const card = el.querySelector(`.player-card[data-user-id="${userId}"]`);
    if (!card) { breakRoomApp.render(false); return; }

    const isOnline = game.users.get(userId)?.active ?? false;
    const playingGame = state.playingGame?.[userId] ?? null;
    const pd = getPlayerDisplay(status, playingGame, isOnline, isLobby, loc);

    card.classList.toggle("player-back", pd.isBack);
    card.classList.toggle("player-away", !pd.isBack);

    const badge = card.querySelector(".player-status-badge");
    if (badge) badge.innerHTML = `<i class="${pd.statusIcon}"></i> ${pd.statusText}`;

    if (userId === game.user.id) {
      const btn = card.querySelector(".tavern-btn");
      if (btn) {
        btn.className = pd.btnCls;
        btn.dataset.action = pd.btnAction;
        btn.innerHTML = `<i class="${pd.btnIcon}"></i> ${pd.btnLabel}`;
      }
    }

    // Show/hide spectate button for others
    if (userId !== game.user.id) {
      const canSpectate = !!playingGame && !playingGame.startsWith("👁");
      const spectateBtn = card.querySelector(".btn-spectate");
      if (canSpectate && !spectateBtn) {
        const newBtn = document.createElement("button");
        newBtn.type = "button";
        newBtn.dataset.action = "spectatePlayer";
        newBtn.dataset.userId = userId;
        newBtn.className = "tavern-btn btn-spectate";
        newBtn.innerHTML = `<i class="fa-solid fa-eye"></i>`;
        card.appendChild(newBtn);
      } else if (!canSpectate && spectateBtn) {
        spectateBtn.remove();
      }
    }
  }
}

// Expose loc accessor for targeted refresh — set by break-room.js after first render
let _cachedBreakRoomLoc = null;
export function _setBreakRoomLocAccessor(fn) { _cachedBreakRoomLoc = fn; }

function _closeBreakRoom() {
  cancelPendingInvite();

  for (const app of foundry.applications.instances.values()) {
    if (app === breakRoomApp) continue;
    const cls = app.options?.classes;
    if (cls?.includes("afk-tavern") || cls?.includes("afk-tavern-config-dialog")) {
      if (app.rendered) try { app.close(); } catch {}
    }
  }
  _inviteDialogOpen = false;

  if (breakRoomApp && breakRoomApp.rendered) {
    breakRoomApp.close({ _afkConfirmed: true });
    breakRoomApp = null;
  }
  _MiniBar?.hideMiniBar();
  _tabActive = false;
  document.querySelectorAll(".drawer-tab, .games-drawer, .afk-mini-bar").forEach(el => el.remove());
  _updatePlayerListButton();
}

async function _startBreakPlaylist() {
  if (!game.user.isGM) return;
  try {
    const playlistId = game.settings.get(MODULE_ID, "breakPlaylist");
    if (!playlistId) return;

    _previouslyPlaying = [];
    for (const pl of game.playlists) {
      for (const sound of pl.sounds) {
        if (sound.playing) {
          _previouslyPlaying.push(sound.uuid);
          await sound.update({ playing: false, pausedTime: sound.sound?.currentTime ?? 0 });
        }
      }
    }

    const breakPlaylist = game.playlists.get(playlistId);
    if (breakPlaylist) await breakPlaylist.playAll();
  } catch (e) {
    console.warn("AFK Tavern | Failed to start break playlist", e);
  }
}

async function _stopBreakPlaylist() {
  if (!game.user.isGM) return;
  try {
    const playlistId = game.settings.get(MODULE_ID, "breakPlaylist");
    if (playlistId) {
      const breakPlaylist = game.playlists.get(playlistId);
      if (breakPlaylist) await breakPlaylist.stopAll();
    }

    for (const uuid of _previouslyPlaying) {
      try {
        const sound = await foundry.utils.fromUuid(uuid);
        if (sound) await sound.parent?.playSound(sound);
      } catch (e) {
        console.warn("AFK Tavern | Could not resume sound", uuid, e);
      }
    }
    _previouslyPlaying = [];
  } catch (e) {
    console.warn("AFK Tavern | Failed to stop break playlist", e);
  }
}

function _onSocketMessage(data) {
  switch (data.action) {
    case "breakStarted":
      breakState = data.state;
      _breakEndSoundPlayed = false;
      _startTimer();
      if (!game.user.isGM) playSound("break-start.ogg");
      openBreakRoom();
      break;

    case "breakEnded":
      breakState.active = false;
      breakState.remaining = 0;
      breakState.playingGame = {};
      _syncResolved = false;
      _stopTimer();
      _closeBreakRoom();
      if (!_breakEndSoundPlayed) {
        _breakEndSoundPlayed = true;
        playSound("break-end.ogg");
      }
      ui.notifications.info(i18n(data.wasLobby ? "AFK_TAVERN.notifications.sessionStarted" : "AFK_TAVERN.notifications.breakEnded"));
      break;

    case "playerBack":
      breakState.players[data.userId] = "back";
      _refreshBreakRoom();
      if (game.user.isGM) {
        _checkAllBack();
      }
      break;

    case "playerAway":
      breakState.players[data.userId] = "away";
      _allReadyNotified = false;
      _refreshBreakRoom();
      break;

    case "playerGame":
      if (data.gameLabel) {
        breakState.playingGame[data.userId] = data.gameLabel;
      } else {
        delete breakState.playingGame[data.userId];
      }
      _refreshBreakRoom({ full: true });
      break;

    case "openBreakRoom":
      if (data.targetUser === game.user.id) openBreakRoom();
      break;

    case "notifyBell":
      if (!game.user.isGM) {
        playSound("break-notify.ogg");
        ui.notifications.info(i18n("AFK_TAVERN.notifications.bellRing"));
      }
      break;

    case "syncPing":
      if (breakState.active && data.userId !== game.user.id) {
        game.socket.emit(SOCKET_KEY, {
          action: "syncPong",
          state: { ...breakState },
          elapsedMs: Date.now() - breakState.startedAt,
          t0: data.t0,
          targetUser: data.userId
        });
      }
      break;

    case "syncPong":
      if (data.targetUser === game.user.id && !_syncResolved) {
        _syncResolved = true;
        const rtt = Date.now() - data.t0;
        const oneWay = Math.floor(rtt / 2);
        const correctedElapsed = data.elapsedMs + oneWay;
        breakState = data.state;
        if (breakState.active) {
          breakState.startedAt = Date.now() - correctedElapsed;
          breakState.remaining = Math.max(0, breakState.duration - Math.floor(correctedElapsed / 1000));
          if (!breakState.playingGame) breakState.playingGame = {};
          if (breakState.playingGame[game.user.id]) {
            delete breakState.playingGame[game.user.id];
            game.socket.emit(SOCKET_KEY, { action: "playerGame", userId: game.user.id, gameLabel: null });
          }
          _startTimer();
          openBreakRoom();
        }
      }
      break;

    case "saveHighscore":
      if (game.user.isGM) {
        import("./highscore-manager.js").then(m =>
          m.saveHighscore(data.gameId, data.gameName, data.difficulty, data.userId, data.userName, data.score, data.sortAsc)
        );
      }
      break;

    case "saveWin":
      if (game.user.isGM) {
        import("./highscore-manager.js").then(m =>
          m.saveWin(data.gameId, data.gameName, data.userId, data.userName)
        );
      }
      break;
  }
}

function cancelPendingInvite() {
  if (_pendingInvite) {
    const fn = _pendingInvite;
    _pendingInvite = null;
    fn();
  }
}

function isInviteDialogOpen() { return _inviteDialogOpen; }
function setInviteDialogOpen(val) { _inviteDialogOpen = val; }

export {
  MODULE_ID,
  SOCKET_KEY,
  INVITE_TIMEOUT,
  MinigameRegistry,
  registerMinigame,
  getBreakState,
  isBreakActive,
  openBreakRoom,
  startBreak,
  endBreak,
  markPlayerBack,
  markPlayerAway,
  setPlayerGame,
  clearPlayerGame,
  moveBreakRoomAside,
  moveBreakRoomCenter,
  getRandomQuote,
  cancelPendingInvite,
  isInviteDialogOpen,
  setInviteDialogOpen,
  playSound,
  isPlayerHidden
};

export function buildPlayerOptions(state) {
  const onlinePlayers = game.users.filter(u => u.active && u.id !== game.user.id);
  const html = onlinePlayers.map(u => {
    const playingGame = state.playingGame?.[u.id];
    const busy = !!playingGame;
    const suffix = busy ? ` (${playingGame})` : "";
    return `<option value="${u.id}" ${busy ? 'data-busy="true"' : ""}>${u.name}${suffix}</option>`;
  }).join("");
  return { onlinePlayers, html };
}

export function setupMultiplayerWaitHandler(SOCKET_KEY, gameId, actions, targetUserId, onAccepted, onDeclined, onFinish) {
  let resolved = false;

  const finish = (reason) => {
    if (resolved) return;
    resolved = true;
    clearTimeout(timeoutId);
    game.socket.off(SOCKET_KEY, waitHandler);
    if (_pendingInvite === cancel) _pendingInvite = null;
    onFinish?.(reason);
  };

  const waitHandler = (data) => {
    if (data.action === actions.accepted && data.gameId === gameId && data.targetUser === game.user.id) {
      finish("accepted");
      onAccepted(data);
    }
    if (data.action === actions.declined && data.targetUser === game.user.id) {
      finish("declined");
      onDeclined(data);
    }
  };

  game.socket.on(SOCKET_KEY, waitHandler);

  const timeoutId = setTimeout(() => {
    finish("expired");
    game.socket.emit(SOCKET_KEY, { action: actions.expired, gameId, targetUser: targetUserId });
    ui.notifications.warn(i18n("AFK_TAVERN.minigames.inviteExpired"));
  }, INVITE_TIMEOUT);

  const cancel = () => {
    if (resolved) return;
    finish("cancelled");
    game.socket.emit(SOCKET_KEY, { action: actions.expired, gameId, targetUser: targetUserId });
  };

  _pendingInvite = cancel;
}