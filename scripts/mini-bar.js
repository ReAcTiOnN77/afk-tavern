import { MODULE_ID, getBreakState, markPlayerBack, markPlayerAway, openBreakRoom, i18n, isPlayerHidden } from "./afk-tavern.js";
import { formatTime, getPlayerDisplay } from "./generic-helpers.js";

let _miniBarEl = null;
let _miniBarInterval = null;
let _miniBarObserver = null;
let _miniBarResizeHandler = null;
let _rosterEl = null;
let _miniBarLoc = null;

function _getMiniBarLoc() {
  if (!_miniBarLoc) {
    _miniBarLoc = {
      statusOffline: i18n("AFK_TAVERN.players.statusOffline"),
      statusBack: i18n("AFK_TAVERN.players.statusBack"),
      statusAway: i18n("AFK_TAVERN.players.statusAway"),
      statusReady: i18n("AFK_TAVERN.lobby.statusReady"),
      statusNotReady: i18n("AFK_TAVERN.lobby.statusNotReady"),
      watching: i18n("AFK_TAVERN.spectate.spectating"),
      statusPlaying: i18n("AFK_TAVERN.minigames.playing"),
      imBack: i18n("AFK_TAVERN.buttons.imBack"),
      stepAway: i18n("AFK_TAVERN.buttons.stepAway"),
      ready: i18n("AFK_TAVERN.lobby.ready"),
      notReady: i18n("AFK_TAVERN.lobby.notReady")
    };
  }
  return _miniBarLoc;
}

function _buildRosterHTML() {
  const state = getBreakState();
  if (!state.active) return "";

  let showOffline = true;
  try { showOffline = !!game.settings.get(MODULE_ID, "showOfflinePlayers"); } catch {}

  const players = [];

  for (const [userId, status] of Object.entries(state.players)) {
    const user = game.users.get(userId);
    if (!user) continue;
    if (isPlayerHidden(userId)) continue;
    const isOnline = user.active;
    if (!isOnline && !showOffline) continue;
    players.push(_rosterRow(user, isOnline, status, state));
  }

  if (showOffline) {
    for (const user of game.users) {
      if (user.active || state.players[user.id]) continue;
      if (isPlayerHidden(user.id)) continue;
      players.push(_rosterRow(user, false, "away", state));
    }
  }

  return players.join("");
}

function _rosterRow(user, isOnline, status, state) {
  const playingGame = state.playingGame?.[user.id] ?? null;
  const isLobby = !!state.lobbyMode;
  const pd = getPlayerDisplay(status, playingGame, isOnline, isLobby, _getMiniBarLoc());
  const cls = !isOnline ? "roster-offline" : pd.isBack ? "roster-back" : "roster-away";
  return `<div class="afk-mini-roster-row ${cls}">
    <span class="roster-name" style="color:${user.color}">${user.name}</span>
    <span class="roster-status"><i class="${pd.statusIcon}"></i> ${pd.statusText}</span>
  </div>`;
}

function _toggleRoster() {
  if (_rosterEl) {
    _closeRoster();
    return;
  }
  if (!_miniBarEl) return;
  const roster = document.createElement("div");
  roster.className = "afk-mini-roster";
  roster.innerHTML = _buildRosterHTML();
  document.body.appendChild(roster);
  _rosterEl = roster;
  _positionRoster();
}

function _closeRoster() {
  _rosterEl?.remove();
  _rosterEl = null;
}

export function refreshMiniBarRoster() {
  if (!_rosterEl) return;
  _rosterEl.innerHTML = _buildRosterHTML();
}

function _positionRoster() {
  if (!_rosterEl || !_miniBarEl) return;
  const barRect = _miniBarEl.getBoundingClientRect();
  _rosterEl.style.left = `${barRect.left}px`;
  _rosterEl.style.width = `${barRect.width}px`;
  _rosterEl.style.bottom = `${window.innerHeight - barRect.top + 4}px`;
}

export function showMiniBar() {
  if (_miniBarEl) return;

  const state = getBreakState();
  if (!state.active) return;

  const status = state.players?.[game.user.id] ?? "away";
  const isLobby = !!state.lobbyMode;
  const pd = getPlayerDisplay(status, null, true, isLobby, _getMiniBarLoc());

  const bar = document.createElement("div");
  bar.className = "afk-mini-bar";
  bar.innerHTML = `
    <div class="afk-mini-timer">
      <i class="fa-solid fa-hourglass-half"></i>
      <span class="afk-mini-time"></span>
    </div>
    <button class="afk-mini-status-btn ${pd.isBack ? "afk-mini-back" : "afk-mini-away"}">
      <i class="${pd.statusIcon}"></i>
      <span>${pd.statusText}</span>
    </button>
    <button class="afk-mini-expand" data-tooltip="${i18n("AFK_TAVERN.title")}">
      <i class="fa-solid fa-beer-mug-empty"></i>
    </button>
  `;

  document.body.appendChild(bar);
  _miniBarEl = bar;

  const positionAbovePlayerList = () => {
    const playerList = document.getElementById("players");
    if (!playerList || !_miniBarEl) return;
    const rect = playerList.getBoundingClientRect();
    _miniBarEl.style.left = `${rect.left}px`;
    _miniBarEl.style.bottom = `${window.innerHeight - rect.top + 4}px`;
    _miniBarEl.style.top = "auto";
    _positionRoster();
  };
  positionAbovePlayerList();

  _miniBarObserver = new MutationObserver(positionAbovePlayerList);
  const playerList = document.getElementById("players");
  if (playerList) {
    _miniBarObserver.observe(playerList, { attributes: true, childList: true, subtree: true });
  }
  _miniBarResizeHandler = positionAbovePlayerList;
  window.addEventListener("resize", _miniBarResizeHandler);

  const timeEl = bar.querySelector(".afk-mini-time");
  const updateTime = () => {
    const s = getBreakState();
    if (!s.active) { hideMiniBar(); return; }
    const elapsed = Math.floor((Date.now() - s.startedAt) / 1000);
    const rem = Math.max(0, s.duration - elapsed);
    if (timeEl) {
      const { mm, ss } = formatTime(rem);
      timeEl.textContent = `${mm}:${ss}`;
      timeEl.classList.toggle("timer-urgent", rem <= 60);
      timeEl.classList.toggle("timer-warning", rem <= 180 && rem > 60);
    }
  };
  updateTime();
  _miniBarInterval = setInterval(updateTime, 1000);

  const statusBtn = bar.querySelector(".afk-mini-status-btn");
  const statusIcon = statusBtn?.querySelector("i");
  const statusLabel = statusBtn?.querySelector("span");
  statusBtn?.addEventListener("click", () => {
    const s = getBreakState();
    const lobby = !!s.lobbyMode;
    const back = s.players?.[game.user.id] === "back";
    if (back) {
      markPlayerAway(game.user.id);
      const pd = getPlayerDisplay("away", null, true, lobby, _getMiniBarLoc());
      statusBtn.classList.replace("afk-mini-back", "afk-mini-away");
      statusIcon.className = pd.statusIcon;
      statusLabel.textContent = pd.statusText;
    } else {
      markPlayerBack(game.user.id);
      const pd = getPlayerDisplay("back", null, true, lobby, _getMiniBarLoc());
      statusBtn.classList.replace("afk-mini-away", "afk-mini-back");
      statusIcon.className = pd.statusIcon;
      statusLabel.textContent = pd.statusText;
    }
  });

  bar.querySelector(".afk-mini-expand")?.addEventListener("click", () => {
    hideMiniBar();
    openBreakRoom({ skipMinimized: true });
  });

  bar.addEventListener("click", (e) => {
    if (e.target.closest("button")) return;
    _toggleRoster();
  });
}

export function hideMiniBar() {
  if (_miniBarInterval) { clearInterval(_miniBarInterval); _miniBarInterval = null; }
  if (_miniBarObserver) { _miniBarObserver.disconnect(); _miniBarObserver = null; }
  if (_miniBarResizeHandler) { window.removeEventListener("resize", _miniBarResizeHandler); _miniBarResizeHandler = null; }
  _closeRoster();
  _miniBarEl?.remove();
  _miniBarEl = null;
}

export function isMiniBarVisible() {
  return !!_miniBarEl;
}
