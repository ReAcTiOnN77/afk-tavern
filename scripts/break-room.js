import { MODULE_ID, SOCKET_KEY, MinigameRegistry, getBreakState, startBreak, endBreak, markPlayerBack, markPlayerAway, setPlayerGame, clearPlayerGame, moveBreakRoomAside, moveBreakRoomCenter, openBreakRoom, getRandomQuote, i18n, i18nFormat, _setBreakRoomLocAccessor, cancelPendingInvite, playSound, isPlayerHidden } from "./afk-tavern.js";
import { getPlayerDisplay, getBadgeText } from "./generic-helpers.js";

import { isSpectateEnabled, requestSpectate, setSpectateAcceptedHandler, setSpectateApp, SpectateViewApp } from "./spectate-engine.js";
import { showMiniBar, hideMiniBar } from "./mini-bar.js";

import { formatTime, allNonGMPlayersBack, ApplicationV2, HandlebarsApplicationMixin } from "./generic-helpers.js";

let _cachedLoc = null;
function _getStaticLoc(bannerSub) {
  if (!_cachedLoc) {
    _cachedLoc = {
      bannerTitle: i18n("AFK_TAVERN.banner.title"),
      durationLabel: i18n("AFK_TAVERN.timer.durationLabel"),
      endTimeLabel: i18n("AFK_TAVERN.timer.endTimeLabel"),
      waiting: i18n("AFK_TAVERN.timer.waiting"),
      startBreak: i18n("AFK_TAVERN.buttons.startBreak"),
      resumeSession: i18n("AFK_TAVERN.buttons.resumeSession"),
      imBack: i18n("AFK_TAVERN.buttons.imBack"),
      stepAway: i18n("AFK_TAVERN.buttons.stepAway"),
      patronsHeading: i18n("AFK_TAVERN.players.heading"),
      allPlayersBack: i18n("AFK_TAVERN.players.allPlayersBack"),
      allBack: i18n("AFK_TAVERN.players.allBack"),
      gmBadge: i18n("AFK_TAVERN.players.gmBadge"),
      gamesHeading: i18n("AFK_TAVERN.minigames.heading"),
      gamesSub: i18n("AFK_TAVERN.minigames.subtitle"),
      highscores: i18n("AFK_TAVERN.minigames.highscores"),
      classicHeading: i18n("AFK_TAVERN.minigames.classicHeading"),
      premiumHeading: i18n("AFK_TAVERN.minigames.premiumHeading"),
      multiplayerHeading: i18n("AFK_TAVERN.minigames.multiplayerHeading"),
      comingSoonLabel: i18n("AFK_TAVERN.minigames.comingSoonLabel"),
      comingSoonDesc: i18n("AFK_TAVERN.minigames.comingSoonDesc"),
      notifyPlayers: i18n("AFK_TAVERN.buttons.notifyPlayers"),
      statusOffline: i18n("AFK_TAVERN.players.statusOffline"),
      breakEndsIn: i18n("AFK_TAVERN.timer.breakEndsIn"),
      sessionStartsIn: i18n("AFK_TAVERN.lobby.sessionStartsIn"),
      startSession: i18n("AFK_TAVERN.lobby.startSession"),
      lobbyLabel: i18n("AFK_TAVERN.lobby.label"),
      lobbyHint: i18n("AFK_TAVERN.lobby.hint"),
      ready: i18n("AFK_TAVERN.lobby.ready"),
      notReady: i18n("AFK_TAVERN.lobby.notReady"),
      allReady: i18n("AFK_TAVERN.lobby.allReady"),
      statusReady: i18n("AFK_TAVERN.lobby.statusReady"),
      statusNotReady: i18n("AFK_TAVERN.lobby.statusNotReady"),
      statusBack: i18n("AFK_TAVERN.players.statusBack"),
      statusAway: i18n("AFK_TAVERN.players.statusAway"),
      watching: i18n("AFK_TAVERN.spectate.watching"),
      statusPlaying: i18n("AFK_TAVERN.players.statusPlaying")
    };
  }
  return { ..._cachedLoc, bannerSub };
}

export class BreakRoomApp extends HandlebarsApplicationMixin(ApplicationV2) {

  #selectedDuration = 600;
  #lobbyMode = false;
  #drawerOpen = false;
  #tabEl = null;
  #drawerEl = null;
  #tavernQuote = null;
  #currentGameApp = null;

  static DEFAULT_OPTIONS = {
    id: "afk-tavern-break-room",
    tag: "div",
    window: {
      title: "AFK_TAVERN.title",
      icon: "fa-solid fa-beer-mug-empty",
      resizable: false,
      minimizable: false
    },
    position: {
      width: 520,
      height: "auto"
    },
    classes: ["afk-tavern", "break-room"],
    actions: {
      startBreak: BreakRoomApp.#onStartBreak,
      endBreak: BreakRoomApp.#onEndBreak,
      markBack: BreakRoomApp.#onMarkBack,
      markAway: BreakRoomApp.#onMarkAway,
      launchMinigame: BreakRoomApp.#onLaunchMinigame,
      setDuration: BreakRoomApp.#onSetDuration,
      spectatePlayer: BreakRoomApp.#onSpectatePlayer,
      openHighscores: BreakRoomApp.#onOpenHighscores,
      notifyPlayers: BreakRoomApp.#onNotifyPlayers,
      toggleLobby: BreakRoomApp.#onToggleLobby
    }
  };

  static PARTS = {
    main: {
      template: `modules/${MODULE_ID}/templates/break-room-app.hbs`
    }
  };

  async _prepareContext(options) {
    const state = getBreakState();
    const isGM = game.user.isGM;
    const { mm: timerMM, ss: timerSS } = formatTime(state.active ? state.remaining : this.#selectedDuration);
    const progressPercent = state.active && state.duration > 0
      ? Math.max(0, (state.remaining / state.duration) * 100)
      : 100;

    const showOffline = game.settings.get(MODULE_ID, "showOfflinePlayers");
    const isLobby = !!state.lobbyMode;
    const loc = _getStaticLoc(this.#tavernQuote ?? (this.#tavernQuote = getRandomQuote()));
    const players = [];

    if (state.active) {
      for (const [userId, status] of Object.entries(state.players)) {
        const user = game.users.get(userId);
        if (!user) continue;
        if (isPlayerHidden(userId)) continue;
        const isOnline = user.active;
        if (!isOnline && !showOffline) continue;
        const actor = user.character;
        const playingGame = state.playingGame?.[userId] ?? null;
        const isSpectating = playingGame?.startsWith("👁");
        const characterName = actor?.name ?? null;
        const canSpectate = isOnline && isSpectateEnabled() && !!playingGame && !isSpectating && userId !== game.user.id;
        const pd = getPlayerDisplay(status, playingGame, isOnline, isLobby, loc);
        players.push({
          userId, name: user.name, color: user.color,
          avatar: actor?.img ?? user.avatar ?? "icons/svg/mystery-man.svg",
          isBack: pd.isBack, isOffline: !isOnline,
          isSelf: userId === game.user.id, isGM: user.isGM,
          playingGame, canSpectate, characterName,
          statusText: pd.statusText, statusIcon: pd.statusIcon,
          btnLabel: pd.btnLabel, btnIcon: pd.btnIcon, btnCls: pd.btnCls, btnAction: pd.btnAction
        });
      }

      if (showOffline) {
        for (const user of game.users) {
          if (user.active || state.players[user.id]) continue;
          if (isPlayerHidden(user.id)) continue;
          const actor = user.character;
          const pd = getPlayerDisplay("away", null, false, isLobby, loc);
          players.push({
            userId: user.id, name: user.name, color: user.color,
            avatar: actor?.img ?? user.avatar ?? "icons/svg/mystery-man.svg",
            isBack: false, isOffline: true, isSelf: false, isGM: user.isGM,
            playingGame: null, canSpectate: false, characterName: actor?.name ?? null,
            statusText: pd.statusText, statusIcon: pd.statusIcon,
            btnLabel: "", btnIcon: "", btnCls: "", btnAction: ""
          });
        }
      }
    }

    const disabledGames = new Set(game.settings.get(MODULE_ID, "disabledGames") ?? []);
    const classicGames = [];
    const premiumGames = [];
    const multiplayerGames = [];
    for (const [id, config] of MinigameRegistry) {
      if (disabledGames.has(id)) continue;
      const entry = { id, label: config.label, icon: config.icon, description: config.description };
      if (config.category === "premium") premiumGames.push(entry);
      else if (config.category === "multiplayer") multiplayerGames.push(entry);
      else classicGames.push(entry);
    }

    const onlinePlayers = players.filter(p => !p.isOffline);
    const nonGMOnline = onlinePlayers.filter(p => !p.isGM);
    const allPlayersBack = state.active && nonGMOnline.length > 0 && nonGMOnline.every(p => p.isBack);
    const everyoneBack = allPlayersBack && onlinePlayers.filter(p => p.isGM).every(p => p.isBack);
    const hasOfflinePlayers = [...game.users].some(u => !u.active && !u.isGM && !isPlayerHidden(u.id));
    const allReady = isLobby && everyoneBack && !hasOfflinePlayers;

    return {
      isGM,
      breakActive: state.active,
      timerMM,
      timerSS,
      progressPercent,
      players,
      classicGames,
      premiumGames,
      multiplayerGames,
      hasClassic: classicGames.length > 0,
      hasPremium: premiumGames.length > 0,
      hasMultiplayer: multiplayerGames.length > 0,
      spectateEnabled: isSpectateEnabled(),
      timerLabel: isLobby ? loc.sessionStartsIn : loc.breakEndsIn,
      gmBtnLabel: isLobby ? loc.startSession : loc.resumeSession,
      gmBtnCls: allReady ? "tavern-btn btn-end btn-all-ready" : "tavern-btn btn-end",
      badgeText: getBadgeText(isLobby, allReady, everyoneBack, allPlayersBack, loc),
      selectedDuration: this.#selectedDuration,
      selectedDurationMinutes: Math.floor(this.#selectedDuration / 60),
      endTimeValue: BreakRoomApp.#computeEndTime(this.#selectedDuration),
      gmtLabel: BreakRoomApp.#getGmtLabel(),
      lobbyMode: this.#lobbyMode,
      preset5Active: this.#selectedDuration === 300,
      preset10Active: this.#selectedDuration === 600,
      preset15Active: this.#selectedDuration === 900,
      preset20Active: this.#selectedDuration === 1200,
      preset25Active: this.#selectedDuration === 1500,
      preset30Active: this.#selectedDuration === 1800,
      timerUrgent: state.active && state.remaining <= 60,
      timerWarning: state.active && state.remaining <= 180 && state.remaining > 60,
      loc
    };
  }

  _onRender(context, options) {
    if (this._minimizedToBar) return;
    const html = this.element;
    if (!html) return;

    const durationInput = html.querySelector(".break-duration-input");
    const endTimeInput = html.querySelector(".break-end-time-input");
    if (durationInput) {
      durationInput.addEventListener("change", (e) => {
        this.#selectedDuration = Number(e.target.value) * 60;
        if (endTimeInput) endTimeInput.value = BreakRoomApp.#computeEndTime(this.#selectedDuration);
      });
      durationInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          this.#selectedDuration = Number(durationInput.value) * 60;
          BreakRoomApp.#onStartBreak.call(this);
        }
      });
    }
    if (endTimeInput) {
      endTimeInput.addEventListener("change", (e) => {
        const [hh, mm] = e.target.value.split(":").map(Number);
        const now = new Date();
        const target = new Date(now);
        target.setHours(hh, mm, 0, 0);
        let diffSecs = Math.round((target - now) / 1000);
        if (diffSecs <= 0) diffSecs += 86400;
        diffSecs = Math.max(60, diffSecs);
        this.#selectedDuration = diffSecs;
        if (durationInput) durationInput.value = Math.round(diffSecs / 60);
        const presets = html.querySelectorAll(".duration-preset");
        presets.forEach(p => p.classList.toggle("active", Number(p.dataset.minutes) * 60 === diffSecs));
      });
    }

    if (this.#tabEl) this.#tabEl.remove();
    if (this.#drawerEl) this.#drawerEl.remove();

    const breakActive = getBreakState().active;
    const appEl = html.closest(".application") ?? html;

    const tab = html.querySelector(".drawer-tab");
    const drawer = html.querySelector(".games-drawer");
    const gamesEnabled = game.settings.get(MODULE_ID, "enableGamesTab");
    if (!breakActive || !gamesEnabled) { tab?.remove(); drawer?.remove(); }
    if (tab && breakActive && gamesEnabled) {
      appEl.appendChild(tab);
      this.#tabEl = tab;
      if (!game.settings.get(MODULE_ID, "drawerTabSeen")) {
        tab.classList.add("drawer-tab-pulse");
      }
      tab.addEventListener("click", () => {
        this.#drawerOpen = !this.#drawerOpen;
        tab.classList.toggle("drawer-open", this.#drawerOpen);
        this.#drawerEl?.classList.toggle("drawer-open", this.#drawerOpen);
        if (tab.classList.contains("drawer-tab-pulse")) {
          tab.classList.remove("drawer-tab-pulse");
          game.settings.set(MODULE_ID, "drawerTabSeen", true);
        }
      });
    }
    if (drawer && breakActive && gamesEnabled) {
      appEl.appendChild(drawer);
      this.#drawerEl = drawer;
    }

    if (this.#drawerOpen) {
      this.#tabEl?.classList.add("drawer-open");
      this.#drawerEl?.classList.add("drawer-open");
    }

    const header = appEl.querySelector(".window-header");
    const musicEnabled = game.settings.get(MODULE_ID, "enableMusicControls");
    if (musicEnabled && breakActive) {
      this.#updateMusicBtn(header);
      this.#updateNowPlaying(header);
    }

    if (musicEnabled && breakActive && !this._musicHookId) {
      const refresh = () => {
        const appEl = this.element?.closest(".application") ?? this.element;
        const h = appEl?.querySelector(".window-header");
        if (h) { this.#updateMusicBtn(h); this.#updateNowPlaying(h); }
      };
      this._musicHookId = Hooks.on("updatePlaylist", refresh);
      this._musicSoundHookId = Hooks.on("updatePlaylistSound", refresh);
    }
  }

  #updateMusicBtn(header) {
    if (!header || !game.user.isGM) return;
    const playing = game.playlists?.contents.some(p => p.channel === "music" && p.playing);

    const existing = header.querySelector(".afk-music-wrapper");
    if (existing) {
      const playBtn = existing.querySelector(".afk-music-btn");
      playBtn.querySelector("i").className = `fa-solid ${playing ? "fa-pause" : "fa-play"}`;
      playBtn.setAttribute("data-tooltip", playing ? i18n("AFK_TAVERN.minigames.music.pause") : i18n("AFK_TAVERN.minigames.music.play"));
      return;
    }

    const closeBtn = header.querySelector('[data-action="close"]');

    const wrapper = document.createElement("div");
    wrapper.className = "afk-music-wrapper";

    const label = document.createElement("span");
    label.className = "afk-music-label";
    label.innerHTML = `<i class="fa-solid fa-music"></i>`;

    const group = document.createElement("div");
    group.className = "afk-music-controls";

    const makeBtn = (cls, icon, tooltip, handler) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = `${cls} header-control icon`;
      btn.setAttribute("data-tooltip", tooltip);
      btn.innerHTML = `<i class="fa-solid ${icon}"></i>`;
      btn.addEventListener("click", async (e) => { e.stopPropagation(); await handler.call(this); });
      return btn;
    };

    group.append(
      makeBtn("afk-music-prev", "fa-backward-step", i18n("AFK_TAVERN.minigames.music.prev"), BreakRoomApp.#onPrevTrack),
      makeBtn("afk-music-btn",  playing ? "fa-pause" : "fa-play", playing ? i18n("AFK_TAVERN.minigames.music.pause") : i18n("AFK_TAVERN.minigames.music.play"), BreakRoomApp.#onToggleMusic),
      makeBtn("afk-music-next", "fa-forward-step",  i18n("AFK_TAVERN.minigames.music.next"), BreakRoomApp.#onNextTrack)
    );

    wrapper.append(label, group);
    if (closeBtn) closeBtn.parentNode.insertBefore(wrapper, closeBtn);
    else header.append(wrapper);
  }

  #updateNowPlaying(header) {
    if (this._minimizedToBar) return;
    const appEl = header?.closest(".application") ?? this.element?.closest(".application") ?? this.element;
    if (!appEl) return;

    const playingSound = game.playlists?.contents
      .filter(p => p.channel === "music" && p.playing)
      .flatMap(p => [...p.sounds])
      .find(s => s.playing);
    const songName = playingSound?.name ?? null;

    let banner = appEl.querySelector("#afk-now-playing-banner");
    if (!songName) { banner?.remove(); return; }

    if (!banner) {
      banner = document.createElement("div");
      banner.id = "afk-now-playing-banner";
      banner.className = "afk-now-playing";
      appEl.appendChild(banner);
    }
    banner.innerHTML = `<i class="fa-solid fa-music"></i> <span>${songName}</span>`;

    requestAnimationFrame(() => {
      const w = banner.offsetWidth;
      const h = banner.offsetHeight;
      if (!w || !h) return;
      const slope = Math.round(w * 0.05);
      const r = 6;
      banner.style.clipPath = `path('M ${slope + r},0 L ${w - slope - r},0 Q ${w - slope},0 ${w - slope + r * 0.6},${r * 0.6} L ${w},${h} L 0,${h} L ${slope - r * 0.6},${r * 0.6} Q ${slope},0 ${slope + r},0 Z')`;
    });
  }

  #cleanupDrawer() {
    this.#tabEl?.remove();
    this.#drawerEl?.remove();
    this.#tabEl = null;
    this.#drawerEl = null;
  }

  #teardownUI() {
    if (this._musicHookId) { Hooks.off("updatePlaylist", this._musicHookId); this._musicHookId = null; }
    if (this._musicSoundHookId) { Hooks.off("updatePlaylistSound", this._musicSoundHookId); this._musicSoundHookId = null; }
    const appEl = this.element?.closest(".application") ?? this.element;
    appEl?.querySelector("#afk-now-playing-banner")?.remove();
  }

  #minimizeToBar() {
    this._minimizedToBar = true;
    this.#teardownUI();
    showMiniBar();
    this.#cleanupDrawer();
    return super.close({ _afkConfirmed: true });
  }

  #openGame(app, gameWidth, drawerWasOpen, { isSpectate = false } = {}) {
    const prev = this.#currentGameApp;
    this.#currentGameApp = app;
    if (prev?.rendered) {
      prev._skipClearPlayer = true;
      try { prev.close(); } catch {}
    }

    if (drawerWasOpen) {
      this.#drawerOpen = false;
      this.#tabEl?.classList.remove("drawer-open");
      this.#drawerEl?.classList.remove("drawer-open");
    }
    let minimizeSetting = "disabled";
    try { minimizeSetting = game.settings.get(MODULE_ID, "minimizeDuringActivity"); } catch {}
    const shouldMinimize = minimizeSetting === "both"
      || (minimizeSetting === "game" && !isSpectate)
      || (minimizeSetting === "spectate" && isSpectate);

    if (shouldMinimize) {
      this.#minimizeToBar();
    } else {
      this.#tabEl?.style.setProperty("display", "none");
      this.#drawerEl?.style.setProperty("display", "none");
      moveBreakRoomAside(app);
    }

    const origClose = app.close.bind(app);
    app.close = (options) => {
      const isSwapping = this.#currentGameApp !== app;
      if (!isSwapping) {
        this.#currentGameApp = null;
        clearPlayerGame(game.user.id);
        if (shouldMinimize) {
          hideMiniBar();
          openBreakRoom({ skipMinimized: true });
        } else {
          moveBreakRoomCenter();
          this.#tabEl?.style.removeProperty("display");
          this.#drawerEl?.style.removeProperty("display");
          if (drawerWasOpen) {
            this.#drawerOpen = true;
            this.#tabEl?.classList.add("drawer-open");
            this.#drawerEl?.classList.add("drawer-open");
          }
        }
      }
      return origClose(options);
    };
  }

  static #onStartBreak(event, target) {
    if (!game.user.isGM) return;
    startBreak(this.#selectedDuration, this.#lobbyMode);
  }

  static #onEndBreak(event, target) {
    if (!game.user.isGM) return;
    const state = getBreakState();
    const isLobby = !!state.lobbyMode;
    if (!allNonGMPlayersBack(state)) {
      foundry.applications.api.DialogV2.confirm({
        classes: ["afk-tavern-config-dialog"],
        window: {
          title: i18n(isLobby ? "AFK_TAVERN.dialog.lobbyEndEarlyTitle" : "AFK_TAVERN.dialog.endEarlyTitle"),
          icon: "fa-solid fa-exclamation-triangle"
        },
        content: `<div class="afk-tavern-config"><p class="config-desc">${i18n(isLobby ? "AFK_TAVERN.dialog.lobbyEndEarlyContent" : "AFK_TAVERN.dialog.endEarlyContent")}</p></div>`,
        yes: { callback: () => endBreak() },
        no: { callback: () => {} },
        defaultYes: false
      });
    } else {
      endBreak();
    }
  }

  static #onMarkBack(event, target) {
    markPlayerBack(game.user.id);
  }

  static #onMarkAway(event, target) {
    markPlayerAway(game.user.id);
  }

  static async #onLaunchMinigame(event, target) {
    const gameId = target.dataset.gameId;
    const config = MinigameRegistry.get(gameId);
    if (!config) return;

    cancelPendingInvite();

    if (config.options?.customLaunch) {
      const self = this;
      config.options.customLaunch({
        onGameOpened: (app, gameWidth = 400) => {
          self.#openGame(app, gameWidth, self.#drawerOpen);
        }
      });
      return;
    }

    const difficultyOptions = config.difficulties.map(d =>
      `<option value="${d}" ${d === config.defaultDifficulty ? "selected" : ""}>${d}</option>`
    ).join("");

    const hasCustomConfig = config.options?.customConfig ?? false;
    const customFields = config.options?.customFields ?? [];
    const presets = config.options?.presets ?? {};

    let mhSettings = null;
    if (hasCustomConfig && config.options?.importFrom) {
      const sourceModule = config.options.importFrom;
      const mod = game.modules.get(sourceModule.moduleId);
      if (mod?.active) {
        try {
          mhSettings = {};
          for (const [key, settingKey] of Object.entries(sourceModule.settingsMap)) {
            mhSettings[key] = game.settings.get(sourceModule.moduleId, settingKey);
          }
        } catch (e) {
          console.warn("AFK Tavern | Could not read settings from", sourceModule.moduleId, e);
          mhSettings = null;
        }
      }
    }

    let customSection = "";

    if (hasCustomConfig && customFields.length > 0) {
      const fieldsHtml = customFields.map(f => {
        const label = i18n(f.label);
        if (f.type === "checkbox") {
          return `<div class="config-field config-field-checkbox"><label class="config-label">${label}</label><input type="checkbox" name="cc_${f.name}" class="config-checkbox" ${f.default ? "checked" : ""} disabled></div>`;
        }
        if (f.type === "select" && f.choices) {
          const opts = f.choices.map(c => `<option value="${c}" ${c === f.default ? "selected" : ""}>${c}</option>`).join("");
          return `<div class="config-field"><label class="config-label">${label}</label><select name="cc_${f.name}" class="config-select" disabled>${opts}</select></div>`;
        }
        return `<div class="config-field"><label class="config-label">${label}</label><input type="number" name="cc_${f.name}" class="config-input" value="${f.default}" min="${f.min}" max="${f.max}" step="${f.step}" disabled></div>`;
      }).join("");

      customSection = `
        <div class="config-custom-fields config-custom-disabled">
          ${fieldsHtml}
        </div>`;
    }

    const content = `
      <div class="afk-tavern-config">
        <div class="config-header">
          <i class="${config.icon} config-icon"></i>
          <span class="config-title">${config.label}</span>
        </div>
        <p class="config-desc">${config.description}</p>
        <div class="config-divider"></div>
        <div class="config-field">
          <label class="config-label">${i18n("AFK_TAVERN.minigames.difficultyLabel")}</label>
          <select name="difficulty" class="config-select">${difficultyOptions}${hasCustomConfig ? `<option value="Custom">${i18n("AFK_TAVERN.minigames.custom")}</option>` : ""}${mhSettings ? `<option value="ImportMH">${i18n("AFK_TAVERN.monsterHarvester.importMH")}</option>` : ""}</select>
        </div>
        ${customSection}
        <div class="config-divider"></div>
        <p class="config-note"><i class="fa-solid fa-info-circle"></i> ${i18n("AFK_TAVERN.minigames.practiceNote")}</p>
      </div>`;

    const result = await foundry.applications.api.DialogV2.wait({
      classes: ["afk-tavern-config-dialog"],
      window: {
        title: i18nFormat("AFK_TAVERN.minigames.settingsTitle", { game: config.label }),
        icon: config.icon
      },
      position: { width: hasCustomConfig ? 380 : 320 },
      content,
      render: (event, dialogApp) => {
        const el = dialogApp?.element ?? dialogApp;
        if (!el || typeof el.querySelector !== "function") return;
        const select = el.querySelector('[name="difficulty"]');
        if (!select) return;

        const customContainer = el.querySelector('.config-custom-fields');
        const allInputs = customContainer ? customContainer.querySelectorAll("input, select") : [];

        const fillPresetValues = (presetKey) => {
          const preset = presets[presetKey];
          if (!preset || !customContainer) return;
          for (const f of customFields) {
            const input = el.querySelector(`[name="cc_${f.name}"]`);
            if (!input) continue;
            if (f.type === "checkbox") input.checked = !!preset[f.name];
            else input.value = preset[f.name] ?? f.default;
          }
        };

        const toggleCustom = () => {
          const val = select.value;
          const isCustom = val === "Custom" || val === "ImportMH";
          if (customContainer) {
            customContainer.classList.toggle("config-custom-disabled", !isCustom);
            allInputs.forEach(inp => inp.disabled = !isCustom);
          }
          if (val === "ImportMH" && mhSettings && customContainer) {
            for (const f of customFields) {
              const input = el.querySelector(`[name="cc_${f.name}"]`);
              if (!input) continue;
              if (f.type === "checkbox") input.checked = !!mhSettings[f.name];
              else if (mhSettings[f.name] !== undefined) input.value = mhSettings[f.name];
            }
          } else if (!isCustom && hasCustomConfig) {
            fillPresetValues(val);
          }
        };

        select.addEventListener("change", toggleCustom);
        if (hasCustomConfig) fillPresetValues(config.defaultDifficulty);
      },
      buttons: [
        {
          action: "play",
          label: i18n("AFK_TAVERN.minigames.play"),
          default: true,
          callback: (event, button, dialog) => {
            const el = dialog?.element ?? button?.form?.closest(".window-content") ?? document.querySelector(".afk-tavern-config");
            const difficulty = el?.querySelector?.('[name="difficulty"]')?.value ?? config.defaultDifficulty;

            if ((difficulty === "Custom" || difficulty === "ImportMH") && hasCustomConfig) {
              const customConfig = {};
              for (const f of customFields) {
                const input = el.querySelector(`[name="cc_${f.name}"]`);
                if (!input) continue;
                customConfig[f.name] = f.type === "checkbox" ? input.checked : Number(input.value);
              }
              return { difficulty: "Custom", customConfig };
            }

            return { difficulty };
          }
        },
        {
          action: "cancel",
          label: i18n("AFK_TAVERN.minigames.cancel")
        }
      ],
      rejectClose: false
    });

    if (!result || result === "cancel") return;

    const appOptions = typeof result === "object" ? result : { difficulty: result };
    const app = new config.appClass(appOptions);
    app.render(true);
    const diffName = appOptions.difficulty?.split("(")[0].trim() || "";
    const diffLabel = diffName ? ` [${diffName}]` : "";
    setPlayerGame(game.user.id, `${config.label}${diffLabel}`);

    let gameWidth;
    if (config.id === "memory-match") {
      const CARD_W = 100;
      const GAP = 8;
      const PAD = 86;
      let gameCols = 4;
      const match = appOptions.difficulty?.match(/(\d+)×(\d+)/);
      if (match) gameCols = parseInt(match[2]);
      gameWidth = Math.max(360, (gameCols * CARD_W) + ((gameCols - 1) * GAP) + PAD);
    } else {
      gameWidth = config.appClass.DEFAULT_OPTIONS?.position?.width ?? 400;
    }

    this.#openGame(app, gameWidth, this.#drawerOpen);
  }

  static #onSpectatePlayer(event, target) {
    const userId = target.dataset.userId ?? target.closest("[data-user-id]")?.dataset.userId;
    if (!userId) return;
    const user = game.users.get(userId);
    if (!user) return;

    setSpectateAcceptedHandler((data) => {
      const app = new SpectateViewApp({
        hostId: data.hostId,
        hostName: data.hostName,
        gameType: data.gameType,
        isMultiplayer: data.isMultiplayer ?? false,
        playerNames: data.playerNames ?? [],
        gameWidth: data.gameWidth ?? 500
      });
      app.render(true);
      setSpectateApp(app);
      setTimeout(() => {
        app.applySpectateState(data.gameType, data.state);
        if (app.rendered) {
          const w = app.position.width ?? 500;
          const h = app.element?.getBoundingClientRect()?.height ?? 400;
          app.setPosition({
            left: Math.max(10, (window.innerWidth - w) / 2),
            top: Math.max(10, (window.innerHeight - h) / 2)
          });
        }
      }, 300);

      const spectateTarget = (data.isMultiplayer && data.playerNames?.length >= 2)
        ? `${data.playerNames[0]} vs ${data.playerNames[1]}`
        : data.hostName;
      const spectateLabel = `👁 ${spectateTarget}`;
      setPlayerGame(game.user.id, spectateLabel);

      this.#openGame(app, 500, this.#drawerOpen, { isSpectate: true });
    });

    requestSpectate(userId);
    ui.notifications.info(`${i18n("AFK_TAVERN.spectate.requesting")} ${user.name}...`);
  }

  static #computeEndTime(durationSecs) {
    const end = new Date(Date.now() + durationSecs * 1000);
    const hh = String(end.getHours()).padStart(2, "0");
    const mm = String(end.getMinutes()).padStart(2, "0");
    return `${hh}:${mm}`;
  }

  static #getGmtLabel() {
    const offset = new Date().getTimezoneOffset();
    const sign = offset <= 0 ? "+" : "-";
    const absH = Math.floor(Math.abs(offset) / 60);
    const absM = Math.abs(offset) % 60;
    return absM ? `GMT${sign}${absH}:${String(absM).padStart(2, "0")}` : `GMT${sign}${absH}`;
  }

  static #onSetDuration(event, target) {
    const mins = Number(target.dataset.minutes);
    if (mins) {
      this.#selectedDuration = mins * 60;
      this.render(false);
    }
  }

  static #onOpenHighscores() {
    const journal = game.journal.find(j => j.getFlag(MODULE_ID, "managed") === true);
    if (!journal) {
      ui.notifications.info(i18n("AFK_TAVERN.minigames.noHighscores"));
      return;
    }
    try {
      journal.sheet.render(true);
    } catch(e) {
      console.error("AFK Tavern | Failed to open highscores journal:", e);
    }
  }

  static #onNotifyPlayers() {
    if (!game.user.isGM) return;
    game.socket.emit(SOCKET_KEY, { action: "notifyBell" });
    playSound("break-notify.ogg");
  }

  static #onToggleLobby(event, target) {
    this.#lobbyMode = !this.#lobbyMode;
    const icon = target.querySelector("i") ?? target;
    icon.className = `fa-solid ${this.#lobbyMode ? "fa-square-check" : "fa-square"}`;
  }

  static async #onToggleMusic() {
    const musicPlaylists = game.playlists?.contents.filter(p => p.channel === "music") ?? [];
    const anyPlaying = musicPlaylists.some(p => p.playing);
    if (anyPlaying) {
      for (const playlist of musicPlaylists.filter(p => p.playing)) {
        const updates = playlist.sounds
          .filter(s => s.playing)
          .map(s => ({ _id: s.id, playing: false, pausedTime: s.sound?.currentTime ?? 0 }));
        if (updates.length) await playlist.updateEmbeddedDocuments("PlaylistSound", updates);
        await playlist.update({ playing: false });
      }
    } else {
      const paused = musicPlaylists.filter(p => p.sounds.some(s => s.pausedTime > 0));
      for (const playlist of paused) await playlist.playAll();
    }
    this.render(false);
  }

  static async #onNextTrack() {
    const playlist = game.playlists?.contents.find(p => p.channel === "music" && p.playing);
    if (playlist) await playlist.playNext();
  }

  static async #onPrevTrack() {
    const playlist = game.playlists?.contents.find(p => p.channel === "music" && p.playing);
    if (playlist) await playlist.playNext(undefined, { direction: -1 });
  }

  async close(options = {}) {
    if (options._afkConfirmed) {
      this.#teardownUI();
      hideMiniBar();
      this.#cleanupDrawer();
      return super.close(options);
    }

    const state = getBreakState();

    if (game.user.isGM && state.active) {
      const isLobby = !!state.lobbyMode;
      const result = await foundry.applications.api.DialogV2.wait({
        classes: ["afk-tavern-config-dialog"],
        window: {
          title: i18n(isLobby ? "AFK_TAVERN.dialog.lobbyCloseTitle" : "AFK_TAVERN.dialog.closeTitle"),
          icon: "fa-solid fa-beer-mug-empty"
        },
        position: { width: 300 },
        content: `<div class="afk-tavern-config"><p class="config-desc">${i18n(isLobby ? "AFK_TAVERN.dialog.lobbyCloseContent" : "AFK_TAVERN.dialog.closeContent")}</p></div>`,
        buttons: [
          {
            action: "end",
            label: i18n(isLobby ? "AFK_TAVERN.dialog.lobbyCloseEnd" : "AFK_TAVERN.dialog.closeEnd")
          },
          {
            action: "minimize",
            label: i18n("AFK_TAVERN.dialog.closeMinimize"),
            default: true
          }
        ],
        rejectClose: false
      });

      if (result === "end") {
        endBreak();
        setTimeout(() => {
          this.#teardownUI();
          hideMiniBar();
          this.#cleanupDrawer();
          super.close({ _afkConfirmed: true });
        }, 50);
        return;
      } else if (result === "minimize") {
        return this.#minimizeToBar();
      }
      return;
    }

    if (state.active) {
      return this.#minimizeToBar();
    }

    this.#teardownUI();
    hideMiniBar();
    this.#cleanupDrawer();
    return super.close(options);
  }
}

_setBreakRoomLocAccessor(() => _cachedLoc);