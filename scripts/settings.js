import { MODULE_ID, i18n, MinigameRegistry } from "./afk-tavern.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

const SOUND_DEFAULTS = {
  soundBreakStart:     `modules/${MODULE_ID}/assets/sounds/break-start.ogg`,
  soundBreakEnd:       `modules/${MODULE_ID}/assets/sounds/break-end.ogg`,
  soundBreakCountdown: `modules/${MODULE_ID}/assets/sounds/break-countdown.ogg`,
  soundBreakNotify:    `modules/${MODULE_ID}/assets/sounds/break-notify.ogg`
};

class AFKSettingsBase extends HandlebarsApplicationMixin(ApplicationV2) {

  static SETTING_KEYS = [];

  static DEFAULT_OPTIONS = foundry.utils.mergeObject(super.DEFAULT_OPTIONS ?? {}, {
    tag: "form",
    classes: ["standard-form", "afk-tavern-settings"],
    position: { width: 560 },
    window: {
      contentClasses: ["standard-form"]
    },
    form: {
      submitOnChange: false,
      closeOnSubmit: true,
      handler(event, form, formData) {
        return this.constructor._onSubmit(event, form, formData);
      }
    }
  }, { inplace: false });

  static PARTS = {
    config: { template: `modules/${MODULE_ID}/templates/settings-app.hbs` },
    footer: { template: "templates/generic/form-footer.hbs" }
  };

  async _preparePartContext(partId, context, options) {
    context = await super._preparePartContext(partId, context, options);
    context.buttons ??= [{ type: "submit", icon: "fa-solid fa-save", label: i18n("AFK_TAVERN.settingsApp.save") }];
    return context;
  }

  static async _onSubmit(event, form, formData) {
    event.preventDefault();
    const data = foundry.utils.expandObject(formData.object ?? {});
    for (const [key, value] of Object.entries(data)) {
      if (this.SETTING_KEYS.includes(key)) {
        await game.settings.set(MODULE_ID, key, value);
      }
    }
  }
}

export class PlayerSettings extends HandlebarsApplicationMixin(ApplicationV2) {

  static DEFAULT_OPTIONS = foundry.utils.mergeObject(super.DEFAULT_OPTIONS ?? {}, {
    id: "afk-tavern-settings-players",
    tag: "form",
    classes: ["standard-form", "afk-tavern-settings"],
    position: { width: 420 },
    window: {
      title: "AFK_TAVERN.settingsApp.players.title",
      icon: "fa-solid fa-users",
      contentClasses: ["standard-form"]
    },
    form: {
      submitOnChange: false,
      closeOnSubmit: true,
      handler(event, form, formData) {
        return PlayerSettings._onSubmit(event, form, formData);
      }
    }
  }, { inplace: false });

  static PARTS = {
    config: { template: `modules/${MODULE_ID}/templates/player-settings-app.hbs` },
    footer: { template: "templates/generic/form-footer.hbs" }
  };

  async _preparePartContext(partId, context, options) {
    context = await super._preparePartContext(partId, context, options);
    context.buttons ??= [{ type: "submit", icon: "fa-solid fa-save", label: i18n("AFK_TAVERN.settingsApp.save") }];
    if (partId === "config") {
      const hiddenIds = game.settings.get(MODULE_ID, "hiddenPlayers");
      context.description = i18n("AFK_TAVERN.settingsApp.players.description");
      context.showOffline = game.settings.get(MODULE_ID, "showOfflinePlayers");
      context.showOfflineLabel = i18n("AFK_TAVERN.settings.showOfflinePlayers.name");
      context.showOfflineHint = i18n("AFK_TAVERN.settings.showOfflinePlayers.hint");
      context.playerListHint = i18n("AFK_TAVERN.settingsApp.players.playerListHint");
      context.players = game.users.map(u => ({
        id: u.id,
        name: u.name,
        color: u.color,
        avatar: u.character?.img ?? u.avatar ?? "icons/svg/mystery-man.svg",
        isGM: u.isGM,
        visible: !hiddenIds.includes(u.id)
      }));
    }
    return context;
  }

  static async _onSubmit(event, form, formData) {
    event.preventDefault();
    const data = foundry.utils.expandObject(formData.object ?? {});
    await game.settings.set(MODULE_ID, "showOfflinePlayers", !!data.showOfflinePlayers);
    const hiddenIds = [];
    for (const user of game.users) {
      if (!data[`player_${user.id}`]) hiddenIds.push(user.id);
    }
    await game.settings.set(MODULE_ID, "hiddenPlayers", hiddenIds);
  }
}

export class AudioSettings extends AFKSettingsBase {
  static SETTING_KEYS = ["soundBreakStart", "soundBreakEnd", "soundBreakCountdown", "soundBreakNotify"];

  static DEFAULT_OPTIONS = foundry.utils.mergeObject(super.DEFAULT_OPTIONS, {
    id: "afk-tavern-settings-audio",
    window: {
      title: "AFK_TAVERN.settingsApp.audio.title",
      icon: "fa-solid fa-volume-high",
      contentClasses: ["standard-form"]
    },
    actions: {
      browseFile:   AudioSettings.#onBrowseFile,
      previewSound: AudioSettings.#onPreviewSound
    }
  }, { inplace: false });

  async _preparePartContext(partId, context, options) {
    context = await super._preparePartContext(partId, context, options);
    if (partId === "config") {
      context.description = i18n("AFK_TAVERN.settingsApp.audio.description");
      context.settings = this.constructor.SETTING_KEYS.map(key => {
        const fullPath = SOUND_DEFAULTS[key] ?? "";
        const filename = fullPath.split("/").pop();
        return {
          key,
          name: i18n(`AFK_TAVERN.settingsApp.${key}.name`),
          hint: i18n(`AFK_TAVERN.settingsApp.${key}.hint`),
          value: game.settings.get(MODULE_ID, key),
          placeholder: filename,
          isFile: true,
          previewable: true
        };
      });
    }
    return context;
  }

  static #onBrowseFile(event, target) {
    const key = target.dataset.key;
    const input = this.element?.querySelector(`input[name="${key}"]`);
    if (!input) return;
    const FP = foundry.applications.apps.FilePicker.implementation;
    new FP({
      type: "audio",
      current: input.value || SOUND_DEFAULTS[key] || "",
      callback: (path) => { input.value = path; }
    }).render(true);
  }

  static #onPreviewSound(event, target) {
    const key = target.dataset.key;
    const input = this.element?.querySelector(`input[name="${key}"]`);
    const src = input?.value || SOUND_DEFAULTS[key] || "";
    if (!src) return;
    foundry.audio.AudioHelper.play({
      src, volume: 0.8, autoplay: true, loop: false, channel: "interface"
    });
  }
}

export class GameSettings extends HandlebarsApplicationMixin(ApplicationV2) {

  static DEFAULT_OPTIONS = foundry.utils.mergeObject(super.DEFAULT_OPTIONS ?? {}, {
    id: "afk-tavern-settings-games",
    tag: "form",
    classes: ["standard-form", "afk-tavern-settings"],
    position: { width: 420 },
    window: {
      title: "AFK_TAVERN.settingsApp.games.title",
      icon: "fa-solid fa-dice",
      contentClasses: ["standard-form"]
    },
    form: {
      submitOnChange: false,
      closeOnSubmit: true,
      handler(event, form, formData) {
        return GameSettings._onSubmit(event, form, formData);
      }
    }
  }, { inplace: false });

  static PARTS = {
    config: { template: `modules/${MODULE_ID}/templates/game-settings-app.hbs` },
    footer: { template: "templates/generic/form-footer.hbs" }
  };

  async _preparePartContext(partId, context, options) {
    context = await super._preparePartContext(partId, context, options);
    context.buttons ??= [{ type: "submit", icon: "fa-solid fa-save", label: i18n("AFK_TAVERN.settingsApp.save") }];
    if (partId === "config") {
      const disabledGames = game.settings.get(MODULE_ID, "disabledGames");
      context.description = i18n("AFK_TAVERN.settingsApp.games.description");
      context.enableGamesTab = game.settings.get(MODULE_ID, "enableGamesTab");
      context.enableGamesTabLabel = i18n("AFK_TAVERN.settingsApp.games.enableGamesTab");
      context.enableGamesTabHint = i18n("AFK_TAVERN.settingsApp.games.enableGamesTabHint");
      context.gameListHint = i18n("AFK_TAVERN.settingsApp.games.gameListHint");
      context.games = [...MinigameRegistry.values()].map(g => ({
        id: g.id,
        label: g.label,
        icon: g.icon,
        category: g.category,
        enabled: !disabledGames.includes(g.id)
      }));
    }
    return context;
  }

  static async _onSubmit(event, form, formData) {
    event.preventDefault();
    const data = foundry.utils.expandObject(formData.object ?? {});
    await game.settings.set(MODULE_ID, "enableGamesTab", !!data.enableGamesTab);
    const disabledGames = [];
    for (const [id] of MinigameRegistry) {
      if (!data[`game_${id}`]) disabledGames.push(id);
    }
    await game.settings.set(MODULE_ID, "disabledGames", disabledGames);
  }
}
