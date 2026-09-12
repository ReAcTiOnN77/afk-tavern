export function formatTime(seconds) {
  return {
    mm: String(Math.floor(seconds / 60)).padStart(2, "0"),
    ss: String(seconds % 60).padStart(2, "0")
  };
}

export function allNonGMPlayersBack(breakState) {
  return Object.entries(breakState.players)
    .filter(([uid]) => !game.users.get(uid)?.isGM)
    .every(([, s]) => s === "back");
}

export function getPlayerDisplay(status, playingGame, isOnline, isLobby, loc, isPlayerTavern = false) {
  const isBack = isOnline && status === "back";
  const isSpectating = playingGame?.startsWith("👁");

  let statusText, statusIcon;
  if (!isOnline) {
    statusText = loc.statusOffline ?? "";
    statusIcon = "fa-solid fa-plug-circle-xmark";
  } else if (isSpectating) {
    statusText = `${loc.watching ?? ""} ${playingGame.slice(2)}`;
    statusIcon = "fa-solid fa-eye";
  } else if (playingGame) {
    statusText = (loc.statusPlaying ?? "").replace("{game}", playingGame);
    statusIcon = "fa-solid fa-dice";
  } else if (isBack) {
    if (isPlayerTavern) {
      statusText = loc.statusInTavern ?? "";
      statusIcon = "fa-solid fa-beer-mug-empty";
    } else {
      statusText = isLobby ? (loc.statusReady ?? "") : (loc.statusBack ?? "");
      statusIcon = "fa-solid fa-check-circle";
    }
  } else {
    if (isPlayerTavern) {
      statusText = loc.statusInScene ?? "";
      statusIcon = "fa-solid fa-chess-board";
    } else {
      statusText = isLobby ? (loc.statusNotReady ?? "") : (loc.statusAway ?? "");
      statusIcon = isLobby ? "fa-solid fa-clock" : "fa-solid fa-moon";
    }
  }

  // In player-tavern mode we don't render a status-toggle button on the
  // player's own card — presence is controlled by opening/closing the
  // tavern window itself, not by clicking a button.
  if (isPlayerTavern) {
    return { statusText, statusIcon, isBack, btnLabel: "", btnIcon: "", btnCls: "", btnAction: "", hideOwnBtn: true };
  }

  let btnLabel, btnIcon, btnCls, btnAction;
  if (isBack) {
    btnCls = "tavern-btn btn-away";
    btnAction = "markAway";
    btnIcon = isLobby ? "fa-solid fa-clock" : "fa-solid fa-moon";
    btnLabel = isLobby ? (loc.notReady ?? "") : (loc.stepAway ?? "");
  } else {
    btnCls = "tavern-btn btn-back";
    btnAction = "markBack";
    btnIcon = isLobby ? "fa-solid fa-check" : "fa-solid fa-hand";
    btnLabel = isLobby ? (loc.ready ?? "") : (loc.imBack ?? "");
  }

  return { statusText, statusIcon, isBack, btnLabel, btnIcon, btnCls, btnAction, hideOwnBtn: false };
}

export function getBadgeText(isLobby, allReady, everyoneBack, allPlayersBack, loc, isPlayerTavern = false) {
  // In player-tavern mode the "everyone back from AFK" concept doesn't apply
  // — "back" just means "in the tavern", so a badge would be misleading.
  if (isPlayerTavern) return null;
  if (isLobby) return allReady ? (loc?.allReady ?? "") : null;
  if (everyoneBack) return loc?.allBack ?? "";
  if (allPlayersBack) return loc?.allPlayersBack ?? "";
  return null;
}

export const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

// Load a JSON asset the GM may have replaced with a custom file. Reads a
// configured path from settings first (any path Foundry can serve — a file
// in the world folder, in Data root, or anywhere else). Falls back to the
// shipped default under the module's assets if the setting is empty, or
// the configured file is missing or invalid. Empty override is the "use
// default" state — no error.
export async function loadCustomizableJson(moduleId, filename, settingKey = null) {
  let overridePath = "";
  if (settingKey) {
    try { overridePath = (game.settings.get(moduleId, settingKey) ?? "").trim(); }
    catch { overridePath = ""; }
  }
  if (overridePath) {
    try {
      const res = await fetch(overridePath, { cache: "no-store" });
      if (res.ok) {
        const text = await res.text();
        try {
          const data = JSON.parse(text);
          console.log(`AFK Tavern | Using custom ${filename} from ${overridePath}`);
          return data;
        } catch {
          console.warn(`AFK Tavern | Custom ${filename} at ${overridePath} is not valid JSON; using shipped default`);
        }
      } else {
        console.warn(`AFK Tavern | Custom ${filename} at ${overridePath} not found (HTTP ${res.status}); using shipped default`);
      }
    } catch (e) {
      console.warn(`AFK Tavern | Failed to fetch custom ${filename} at ${overridePath}; using shipped default`, e);
    }
  }
  const defaultUrl = `modules/${moduleId}/assets/${filename}`;
  try {
    const res = await fetch(defaultUrl);
    if (res.ok) return await res.json();
  } catch (e) {
    console.warn(`AFK Tavern | Failed to load ${filename}`, e);
  }
  return null;
}
