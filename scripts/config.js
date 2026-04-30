import { MODULE_ID, i18n } from "./afk-tavern.js";
import { AudioSettings, PlayerSettings, GameSettings } from "./settings.js";

export function registerSettings() {
  game.settings.registerMenu(MODULE_ID, "audioSettings", {
    name: "AFK_TAVERN.settings.audioSettings.name",
    label: "AFK_TAVERN.settings.audioSettings.label",
    hint: "AFK_TAVERN.settings.audioSettings.hint",
    icon: "fa-solid fa-volume-high",
    type: AudioSettings,
    restricted: true
  });

  game.settings.registerMenu(MODULE_ID, "playerSettings", {
    name: "AFK_TAVERN.settings.playerSettings.name",
    label: "AFK_TAVERN.settings.playerSettings.label",
    hint: "AFK_TAVERN.settings.playerSettings.hint",
    icon: "fa-solid fa-users",
    type: PlayerSettings,
    restricted: true
  });

  game.settings.registerMenu(MODULE_ID, "gameSettings", {
    name: "AFK_TAVERN.settings.gameSettings.name",
    label: "AFK_TAVERN.settings.gameSettings.label",
    hint: "AFK_TAVERN.settings.gameSettings.hint",
    icon: "fa-solid fa-dice",
    type: GameSettings,
    restricted: true
  });

  game.settings.register(MODULE_ID, "enableGamesTab", {
    scope: "world",
    config: false,
    default: true,
    type: Boolean
  });

  game.settings.register(MODULE_ID, "disabledGames", {
    scope: "world",
    config: false,
    default: [],
    type: Array
  });

  game.settings.register(MODULE_ID, "soundBreakStart", {
    scope: "world", config: false, default: "", type: String
  });
  game.settings.register(MODULE_ID, "soundBreakEnd", {
    scope: "world", config: false, default: "", type: String
  });
  game.settings.register(MODULE_ID, "soundBreakCountdown", {
    scope: "world", config: false, default: "", type: String
  });
  game.settings.register(MODULE_ID, "soundBreakNotify", {
    scope: "world", config: false, default: "", type: String
  });

  game.settings.register(MODULE_ID, "startMinimized", {
    name: "AFK_TAVERN.settings.startMinimized.name",
    hint: "AFK_TAVERN.settings.startMinimized.hint",
    scope: "client",
    config: true,
    default: false,
    type: Boolean
  });

  game.settings.register(MODULE_ID, "minimizeDuringActivity", {
    name: "AFK_TAVERN.settings.minimizeDuringActivity.name",
    hint: "AFK_TAVERN.settings.minimizeDuringActivity.hint",
    scope: "client",
    config: true,
    default: "disabled",
    type: String,
    choices: {
      disabled: "AFK_TAVERN.settings.minimizeDuringActivity.disabled",
      game: "AFK_TAVERN.settings.minimizeDuringActivity.game",
      spectate: "AFK_TAVERN.settings.minimizeDuringActivity.spectate",
      both: "AFK_TAVERN.settings.minimizeDuringActivity.both"
    }
  });

  game.settings.register(MODULE_ID, "allowSpectating", {
    name: "AFK_TAVERN.settings.spectate.name",
    hint: "AFK_TAVERN.settings.spectate.hint",
    scope: "world",
    config: true,
    default: true,
    type: Boolean
  });

  game.settings.register(MODULE_ID, "showOfflinePlayers", {
    name: "AFK_TAVERN.settings.showOfflinePlayers.name",
    hint: "AFK_TAVERN.settings.showOfflinePlayers.hint",
    scope: "world",
    config: false,
    default: true,
    type: Boolean
  });

  game.settings.register(MODULE_ID, "hiddenPlayers", {
    scope: "world",
    config: false,
    default: [],
    type: Array
  });

  game.settings.register(MODULE_ID, "enableMusicControls", {
    name: "AFK_TAVERN.settings.enableMusicControls.name",
    hint: "AFK_TAVERN.settings.enableMusicControls.hint",
    scope: "world",
    config: true,
    default: true,
    type: Boolean
  });

  game.settings.register(MODULE_ID, "breakPlaylist", {
    name: "AFK_TAVERN.settings.breakPlaylist.name",
    hint: "AFK_TAVERN.settings.breakPlaylist.hint",
    scope: "world",
    config: true,
    default: "",
    type: String,
    choices: {}
  });

  Hooks.on("renderSettingsConfig", (app, html) => {
    const select = html instanceof HTMLElement
      ? html.querySelector(`select[name="${MODULE_ID}.breakPlaylist"]`)
      : html[0]?.querySelector(`select[name="${MODULE_ID}.breakPlaylist"]`);
    if (!select) return;
    const current = game.settings.get(MODULE_ID, "breakPlaylist");
    select.innerHTML = `<option value="">— ${i18n("AFK_TAVERN.settings.breakPlaylist.none")} —</option>`;
    for (const playlist of game.playlists) {
      const opt = document.createElement("option");
      opt.value = playlist.id;
      opt.textContent = playlist.name;
      if (playlist.id === current) opt.selected = true;
      select.appendChild(opt);
    }
  });

  game.settings.register(MODULE_ID, "drawerTabSeen", {
    scope: "client",
    config: false,
    default: false,
    type: Boolean
  });
}
