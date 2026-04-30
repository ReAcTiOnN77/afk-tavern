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

export function getPlayerDisplay(status, playingGame, isOnline, isLobby, loc) {
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
    statusText = isLobby ? (loc.statusReady ?? "") : (loc.statusBack ?? "");
    statusIcon = "fa-solid fa-check-circle";
  } else {
    statusText = isLobby ? (loc.statusNotReady ?? "") : (loc.statusAway ?? "");
    statusIcon = isLobby ? "fa-solid fa-clock" : "fa-solid fa-moon";
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

  return { statusText, statusIcon, isBack, btnLabel, btnIcon, btnCls, btnAction };
}

export function getBadgeText(isLobby, allReady, everyoneBack, allPlayersBack, loc) {
  if (isLobby) return allReady ? (loc?.allReady ?? "") : null;
  if (everyoneBack) return loc?.allBack ?? "";
  if (allPlayersBack) return loc?.allPlayersBack ?? "";
  return null;
}

export const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
