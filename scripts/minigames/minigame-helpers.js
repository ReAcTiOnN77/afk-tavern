import { formatTime, ApplicationV2, HandlebarsApplicationMixin } from "../generic-helpers.js";
import { clearPlayerGame, moveBreakRoomCenter, SOCKET_KEY, i18n, i18nFormat, escapeHtml, setPlayerGame, moveBreakRoomAside, buildPlayerOptions, setupMultiplayerWaitHandler, cancelPendingInvite, getBreakState, INVITE_TIMEOUT, isInviteDialogOpen, setInviteDialogOpen } from "../afk-tavern.js";
import { unregisterGameForSpectate } from "../spectate-engine.js";

export { formatTime, ApplicationV2, HandlebarsApplicationMixin, clearPlayerGame };

const MODULE_ID = "afk-tavern";
export { MODULE_ID };

export function cleanupSoloGame(app) {
  unregisterGameForSpectate(app);
  if (!app._skipClearPlayer) clearPlayerGame(game.user.id);
}

export function wrapGameClose(app, { moveBR = true } = {}) {
  const origClose = app.close.bind(app);
  app.close = (opts) => {
    clearPlayerGame(game.user.id);
    if (moveBR) moveBreakRoomCenter();
    return origClose(opts);
  };
}

export function difficultyLevel(difficulty) {
  if (difficulty?.startsWith("Easy")) return "easy";
  if (difficulty?.startsWith("Hard")) return "hard";
  if (difficulty?.startsWith("Expert") || difficulty?.startsWith("Master") || difficulty?.startsWith("Legendary")) return "hard";
  return "medium";
}

/**
 * Lazy-init localization cache. Avoids the repeated `let _loc = null` /
 * `_loc ?? (_loc = {...})` boilerplate across every game file.
 *
 * Usage:
 *   const loc = buildLocCache(() => ({ score: i18n("..."), ... }));
 *   // later:  const strings = loc();
 */
export function buildLocCache(builder) {
  let cached = null;
  return () => cached ?? (cached = builder());
}

/**
 * Build DEFAULT_OPTIONS for a solo minigame app.
 * Keeps per-game files focused on what's unique (actions, width, icon).
 */
export function soloGameDefaults(slug, { title, icon, width = 420, actions = {}, extraClasses = [] }) {
  return {
    id: `afk-tavern-${slug}`,
    tag: "div",
    window: {
      title,
      icon,
      resizable: false,
      minimizable: true,
      contentClasses: ["minigame-content"]
    },
    position: { width, height: "auto" },
    classes: ["afk-tavern", ...extraClasses.length ? extraClasses : [slug]],
    actions
  };
}

/**
 * Build PARTS for a solo minigame (header + board + optional footer).
 */
export function soloGameParts(boardHbs, { footer = true } = {}) {
  const parts = {
    header: { template: `modules/${MODULE_ID}/templates/minigames/minigame-header.hbs` },
    board:  { template: `modules/${MODULE_ID}/templates/minigames/${boardHbs}` }
  };
  if (footer) parts.footer = { template: `modules/${MODULE_ID}/templates/minigames/minigame-footer.hbs` };
  return parts;
}

/**
 * Build DEFAULT_OPTIONS for a multiplayer game app.
 * ID template uses {id} suffix for per-instance uniqueness.
 */
export function mpGameDefaults(slug, { title, icon, width = 420, actions = {} }) {
  return {
    id: `afk-tavern-${slug}-{id}`,
    tag: "div",
    window: {
      title,
      icon,
      resizable: false,
      minimizable: true,
      contentClasses: ["minigame-content"]
    },
    position: { width, height: "auto" },
    classes: ["afk-tavern", slug],
    actions
  };
}

export function setupMultiplayerInviteListener({ locPrefix, actions, icon, createAcceptedApp }) {
  game.socket.on(SOCKET_KEY, async (data) => {
    if (data.action !== actions.invite || data.targetUser !== game.user.id) return;

    const state = getBreakState();
    if (state.playingGame?.[game.user.id] || isInviteDialogOpen()) {
      game.socket.emit(SOCKET_KEY, {
        action: actions.declined,
        targetUser: data.senderId,
        declinerName: game.user.name
      });
      return;
    }

    setInviteDialogOpen(true);
    let dialogApp = null;
    let expired = false;
    let countdownInterval = null;
    const timeout = data.timeout ?? 30000;
    let remaining = Math.ceil(timeout / 1000);

    const expireHandler = (msg) => {
      if (msg.action === actions.expired && msg.gameId === data.gameId && msg.targetUser === game.user.id) {
        expired = true;
        cleanup();
        dialogApp?.close();
      }
    };

    const cleanup = () => {
      game.socket.off(SOCKET_KEY, expireHandler);
      if (countdownInterval) { clearInterval(countdownInterval); countdownInterval = null; }
      setInviteDialogOpen(false);
    };

    game.socket.on(SOCKET_KEY, expireHandler);

    const accept = await foundry.applications.api.DialogV2.confirm({
      classes: ["afk-tavern-config-dialog"],
      window: {
        title: i18n(`${locPrefix}.inviteTitle`),
        icon
      },
      position: { width: 320 },
      content: `<div class="afk-tavern-config">
        <div class="config-header">
          <i class="${icon} config-icon"></i>
          <span class="config-title">${i18n(`${locPrefix}.title`)}</span>
        </div>
        <p class="config-desc">${escapeHtml(data.senderName)} ${i18n(`${locPrefix}.inviteMessage`)}</p>
      </div>`,
      yes: { label: i18n(`${locPrefix}.accept`) },
      no: { label: i18n(`${locPrefix}.decline`) },
      defaultYes: true,
      rejectClose: false,
      render: (event, app) => {
        dialogApp = app;
        const header = app?.element?.querySelector(".window-header");
        const titleEl = header?.querySelector(".window-title");
        if (!titleEl) return;
        const timerSpan = document.createElement("span");
        timerSpan.style.cssText = "margin-left:auto;font-size:0.85em;opacity:0.8;font-weight:normal;font-variant-numeric:tabular-nums;";
        titleEl.parentNode.insertBefore(timerSpan, titleEl.nextSibling);
        const updateDisplay = () => {
          const ss = String(remaining % 60).padStart(2, "0");
          timerSpan.textContent = `0:${ss}`;
          if (remaining <= 10) timerSpan.style.color = "var(--tavern-red, #cc4444)";
        };
        updateDisplay();
        countdownInterval = setInterval(() => {
          remaining--;
          if (remaining <= 0) {
            expired = true;
            cleanup();
            app.close();
            return;
          }
          updateDisplay();
        }, 1000);
      }
    });

    cleanup();
    if (expired) return;

    if (accept) {
      game.socket.emit(SOCKET_KEY, {
        action: actions.accepted,
        gameId: data.gameId,
        targetUser: data.senderId,
        accepterName: game.user.name,
        accepterId: game.user.id
      });

      const app = createAcceptedApp(data);
      app.render(true);
      setPlayerGame(game.user.id, `${i18n(`${locPrefix}.title`)} [vs ${escapeHtml(data.senderName)}]`);
      moveBreakRoomAside(app);
      wrapGameClose(app);
    } else {
      game.socket.emit(SOCKET_KEY, {
        action: actions.declined,
        targetUser: data.senderId,
        declinerName: game.user.name
      });
    }
  });
}

export async function showMultiplayerInviteDialog({ locPrefix, actions, icon, gameWidth, createHostApp }, ctx = {}) {
  cancelPendingInvite();
  const state = getBreakState();

  const { onlinePlayers, html: playerOptions } = buildPlayerOptions(state);
  if (onlinePlayers.length === 0) {
    ui.notifications.warn(i18n(`${locPrefix}.noPlayers`));
    return;
  }

  const result = await foundry.applications.api.DialogV2.wait({
    classes: ["afk-tavern-config-dialog"],
    window: {
      title: i18n(`${locPrefix}.inviteTitle`),
      icon
    },
    position: { width: 320 },
    content: `
      <div class="afk-tavern-config">
        <div class="config-header">
          <i class="${icon} config-icon"></i>
          <span class="config-title">${i18n(`${locPrefix}.title`)}</span>
        </div>
        <p class="config-desc">${i18n(`${locPrefix}.selectOpponent`)}</p>
        <div class="config-divider"></div>
        <div class="config-field">
          <label class="config-label">${i18n(`${locPrefix}.opponent`)}</label>
          <select name="opponent" class="config-select">${playerOptions}</select>
        </div>
        <p class="mp-busy-warning config-note" style="display:none; color: var(--tavern-warm);">
          <i class="fa-solid fa-exclamation-triangle"></i> ${i18n(`${locPrefix}.busyWarning`)}
        </p>
      </div>`,
    render: (event, dialogApp) => {
      const el = dialogApp?.element ?? dialogApp;
      if (!el) return;
      const select = el.querySelector('[name="opponent"]');
      const warning = el.querySelector('.mp-busy-warning');
      if (!select || !warning) return;
      const checkBusy = () => {
        const opt = select.selectedOptions[0];
        warning.style.display = opt?.dataset?.busy ? "" : "none";
      };
      select.addEventListener("change", checkBusy);
      checkBusy();
    },
    buttons: [
      {
        action: "invite",
        label: i18n(`${locPrefix}.sendInvite`),
        default: true,
        callback: (event, button, dialog) => {
          const el = dialog?.element ?? document.querySelector(".afk-tavern-config");
          return el?.querySelector('[name="opponent"]')?.value;
        }
      },
      { action: "cancel", label: i18n("AFK_TAVERN.minigames.cancel") }
    ],
    rejectClose: false
  });

  if (!result || result === "cancel") return;
  const selectedId = result;
  if (!selectedId) return;

  const selectedUser = game.users.get(selectedId);
  if (!selectedUser) return;

  if (state.playingGame?.[selectedId]) {
    ui.notifications.warn(`${selectedUser.name} ${i18n(`${locPrefix}.playerBusy`)}`);
    return;
  }

  const gameId = foundry.utils.randomID();

  game.socket.emit(SOCKET_KEY, {
    action: actions.invite,
    gameId,
    senderId: game.user.id,
    senderName: game.user.name,
    targetUser: selectedId,
    timeout: INVITE_TIMEOUT
  });

  let waitDialog = null;
  let origWaitClose = null;
  let countdownInterval = null;
  let remaining = Math.ceil(INVITE_TIMEOUT / 1000);

  const cleanupWait = () => {
    if (countdownInterval) { clearInterval(countdownInterval); countdownInterval = null; }
    if (waitDialog?.rendered && origWaitClose) try { origWaitClose(); } catch {}
    waitDialog = null;
  };

  waitDialog = new foundry.applications.api.DialogV2({
    classes: ["afk-tavern-config-dialog"],
    window: {
      title: i18n(`${locPrefix}.inviteTitle`),
      icon
    },
    position: { width: 300 },
    content: `
      <div class="afk-tavern-config" style="text-align:center;padding:12px;">
        <p class="config-desc">${i18nFormat("AFK_TAVERN.minigames.waitingFor", { name: escapeHtml(selectedUser.name) })}</p>
        <p class="mp-wait-timer" style="font-size:18px;color:var(--tavern-gold);margin:8px 0;">${remaining}</p>
      </div>`,
    buttons: [{
      action: "cancel",
      label: i18n("AFK_TAVERN.minigames.cancel"),
      callback: () => { cancelPendingInvite(); }
    }],
    rejectClose: false
  });
  waitDialog.render(true);

  origWaitClose = waitDialog.close.bind(waitDialog);
  waitDialog.close = (opts) => {
    cancelPendingInvite();
    return origWaitClose(opts);
  };

  countdownInterval = setInterval(() => {
    remaining--;
    const timerEl = waitDialog?.element?.querySelector(".mp-wait-timer");
    if (timerEl) timerEl.textContent = remaining;
    if (remaining <= 0) clearInterval(countdownInterval);
  }, 1000);

  setupMultiplayerWaitHandler(SOCKET_KEY, gameId,
    { accepted: actions.accepted, declined: actions.declined, expired: actions.expired },
    selectedId,
    (data) => {
      cleanupWait();
      const app = createHostApp(gameId, data);
      app.render(true);
      setPlayerGame(game.user.id, `${i18n(`${locPrefix}.title`)} [vs ${escapeHtml(data.accepterName)}]`);
      if (ctx.onGameOpened) ctx.onGameOpened(app, gameWidth);
      else wrapGameClose(app, { moveBR: false });
    },
    (data) => {
      cleanupWait();
      ui.notifications.warn(`${escapeHtml(data.declinerName)} ${i18n(`${locPrefix}.inviteDeclined`)}`);
    },
    (reason) => {
      cleanupWait();
    }
  );
}
