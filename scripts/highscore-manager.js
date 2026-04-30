import { MODULE_ID, SOCKET_KEY, MinigameRegistry, i18n, i18nFormat } from "./afk-tavern.js";

const TOP5_MAX = 5;
let _journalLock = null;

// ── Journal / page helpers ────────────────────────────────────────────────────

async function _getOrCreateJournal() {
  if (_journalLock) return _journalLock;
  _journalLock = (async () => {
    let journal = game.journal.find(j => j.getFlag(MODULE_ID, "managed") === true);
    if (!journal) {
      journal = await JournalEntry.create({
        name: i18n("AFK_TAVERN.highscores.journalName"),
        ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER }
      });
      await journal.setFlag(MODULE_ID, "managed", true);
    }
    return journal;
  })();
  try { return await _journalLock; } finally { _journalLock = null; }
}

async function _getOrCreatePage(journal, gameId, gameName) {
  let page = journal.pages.find(p => p.getFlag(MODULE_ID, "gameId") === gameId);
  if (!page) {
    [page] = await journal.createEmbeddedDocuments("JournalEntryPage", [{
      name: gameName,
      type: "text",
      title: { show: true, level: 1 },
      text: { content: "" }
    }]);
    await page.setFlag(MODULE_ID, "gameId", gameId);
  }
  return page;
}

// ── Score label per game ──────────────────────────────────────────────────────

function _scoreLabel(gameId) {
  const labels = {
    "memory-match":      "AFK_TAVERN.highscores.moves",
    "minesweeper":       "AFK_TAVERN.highscores.timeSeconds",
    "simon-says":        "AFK_TAVERN.highscores.rounds",
    "whack-a-mole":      "AFK_TAVERN.highscores.score",
    "word-scramble":     "AFK_TAVERN.highscores.score",
    "monster-harvester": "AFK_TAVERN.highscores.harvested"
  };
  return i18n(labels[gameId] ?? "AFK_TAVERN.highscores.score");
}

// ── HTML renderer — single page, all data under headers ──────────────────────

function _renderPageHtml(data, gameId) {
  const { top5 = [], personal = {}, wins = null, sortAsc = false } = data;
  const label = _scoreLabel(gameId);
  const sections = [];

  const rank = i18n("AFK_TAVERN.highscores.rank");
  const player = i18n("AFK_TAVERN.highscores.player");
  const date = i18n("AFK_TAVERN.highscores.date");
  const topHeading = i18nFormat("AFK_TAVERN.highscores.top", { count: TOP5_MAX });

  const S = "style=\"text-align:center;padding:4px 8px;\"";
  const ths = (cols) => cols.map(c => `<th ${S}>${c}</th>`).join("");
  const tds = (cols) => cols.map(c => `<td ${S}>${c}</td>`).join("");
  const table = (headers, rows) =>
    `<table style="width:100%;border-collapse:collapse;"><thead><tr>${ths(headers)}</tr></thead><tbody>${rows}</tbody></table>`;

  if (wins !== null) {
    const sorted = Object.values(wins).sort((a, b) => b.wins - a.wins).slice(0, TOP5_MAX);
    if (sorted.length) {
      const rows = sorted.map((e, idx) => `<tr>${tds([idx + 1, e.userName, e.wins])}</tr>`).join("");
      sections.push(`<h2>${topHeading}</h2>${table([rank, player, i18n("AFK_TAVERN.highscores.wins")], rows)}`);
    } else {
      sections.push(`<h2>${topHeading}</h2><p><em>${i18n("AFK_TAVERN.highscores.noWins")}</em></p>`);
    }
  } else {
    const sortNote = sortAsc ? ` <small><em>${i18n("AFK_TAVERN.highscores.lowerIsBetter")}</em></small>` : "";
    if (top5.length) {
      const rows = top5.map((e, idx) => `<tr>${tds([idx + 1, e.userName, e.score + (e.difficulty ? ` <small>(${e.difficulty})</small>` : ""), e.date])}</tr>`).join("");
      sections.push(`<h2>${topHeading}${sortNote}</h2>${table([rank, player, label, date], rows)}`);
    } else {
      sections.push(`<h2>${topHeading}${sortNote}</h2><p><em>${i18n("AFK_TAVERN.highscores.noScores")}</em></p>`);
    }

    for (const [difficulty, players] of Object.entries(personal)) {
      const entries = Object.values(players).sort((a, b) => sortAsc ? a.score - b.score : b.score - a.score);
      if (!entries.length) continue;
      const rows = entries.map((e, idx) => `<tr>${tds([idx + 1, e.userName, e.score, e.date])}</tr>`).join("");
      sections.push(`<h3>${i18nFormat("AFK_TAVERN.highscores.personalBests", { difficulty })}</h3>${table([rank, player, label, date], rows)}`);
    }
  }

  return sections.join("\n");
}


// ── Read API ──────────────────────────────────────────────────────────────────

async function getPageData(gameId) {
  const journal = game.journal.find(j => j.getFlag(MODULE_ID, "managed") === true);
  if (!journal) return null;
  const page = journal.pages.find(p => p.getFlag(MODULE_ID, "gameId") === gameId);
  if (!page) return null;
  return page.getFlag(MODULE_ID, "data") ?? null;
}

export async function getMyBest(gameId, difficulty) {
  const data = await getPageData(gameId);
  if (!data?.personal?.[difficulty]) return null;
  return data.personal[difficulty][game.user.id] ?? null;
}

// ── Difficulty weighting for leaderboard sorting ──────────────────────────────
//
// 2% bonus per tier so harder difficulties rank higher for equal raw scores,
// but a genuinely better raw score on an easier difficulty still wins.
//   Higher-is-better: weightedScore = score * (1 + weight)
//   Lower-is-better:  weightedScore = score * (1 - weight)

function _difficultyWeight(difficulty) {
  if (!difficulty) return 0;
  const d = difficulty.toLowerCase();
  if (d.startsWith("legendary")) return 0.10;
  if (d.startsWith("master"))    return 0.08;
  if (d.startsWith("expert"))    return 0.06;
  if (d.startsWith("hard"))      return 0.04;
  if (d.startsWith("medium"))    return 0.02;
  return 0;
}

function _weightedScore(score, difficulty, sortAsc) {
  const w = _difficultyWeight(difficulty);
  return sortAsc ? score * (1 - w) : score * (1 + w);
}

// ── Write API (GM only) ───────────────────────────────────────────────────────
//
// sortAsc controls leaderboard sort direction:
//   false (default) = higher score is better  (Whack-a-Mole, Simon Says, Word Scramble, Monster Harvester)
//   true            = lower score is better   (Memory Match = fewer moves, Minesweeper = faster time)

export async function saveHighscore(gameId, gameName, difficulty, userId, userName, score, sortAsc = false) {
  const journal = await _getOrCreateJournal();
  const page = await _getOrCreatePage(journal, gameId, gameName);
  const config = MinigameRegistry.get(gameId);
  const hasDifficulties = config?.difficulties?.length > 0;

  const data = page.getFlag(MODULE_ID, "data") ?? { top5: [], personal: {}, sortAsc };

  // Top 5 (dupes allowed, any difficulty) - sorted by weighted score
  const weighted = _weightedScore(score, difficulty, sortAsc);
  data.top5.push({ userId, userName, score, weighted, difficulty: hasDifficulties ? difficulty : null, date: new Date().toISOString().slice(0, 10) });
  data.top5.sort((a, b) => sortAsc ? (a.weighted ?? a.score) - (b.weighted ?? b.score) : (b.weighted ?? b.score) - (a.weighted ?? a.score));
  if (data.top5.length > TOP5_MAX) data.top5.length = TOP5_MAX;

  // Personal best per difficulty (raw score, no weighting)
  if (hasDifficulties && difficulty) {
    data.personal[difficulty] ??= {};
    const current = data.personal[difficulty][userId];
    const isBetter = !current || (sortAsc ? score < current.score : score > current.score);
    if (isBetter) {
      data.personal[difficulty][userId] = { userName, score, date: new Date().toISOString().slice(0, 10) };
    }
  }

  await page.update({
    [`flags.${MODULE_ID}.data`]: data,
    "text.content": _renderPageHtml(data, gameId)
  });
}

// ── Win tracking (multiplayer games) ─────────────────────────────────────────

export async function saveWin(gameId, gameName, userId, userName) {
  const journal = await _getOrCreateJournal();
  const page = await _getOrCreatePage(journal, gameId, gameName);

  const data = page.getFlag(MODULE_ID, "data") ?? { wins: {} };
  data.wins ??= {};

  if (!data.wins[userId]) data.wins[userId] = { userName, wins: 0 };
  data.wins[userId].userName = userName;
  data.wins[userId].wins += 1;

  await page.update({
    [`flags.${MODULE_ID}.data`]: data,
    "text.content": _renderPageHtml(data, gameId)
  });
}

async function getWinLeaderboard(gameId, limit = 5) {
  const data = await getPageData(gameId);
  if (!data?.wins) return [];
  return Object.values(data.wins)
    .sort((a, b) => b.wins - a.wins)
    .slice(0, limit);
}

// ── Submit (player-facing) ────────────────────────────────────────────────────
//
// sortAsc should be true for games where a lower score is better.
// Currently: memory-match (moves) and minesweeper (seconds elapsed).

export function submitHighscore(gameId, score, difficulty = null, sortAsc = false) {
  const config = MinigameRegistry.get(gameId);
  if (!config) return;

  const gameName = config.label;
  const userId   = game.user.id;
  const userName = game.user.name;

  if (game.user.isGM) {
    saveHighscore(gameId, gameName, difficulty, userId, userName, score, sortAsc);
    return;
  }

  game.socket.emit(SOCKET_KEY, {
    action: "saveHighscore",
    gameId, gameName, difficulty, userId, userName, score, sortAsc
  });
}

export function submitWin(gameId) {
  const config = MinigameRegistry.get(gameId);
  if (!config) return;

  const gameName = config.label;
  const userId   = game.user.id;
  const userName = game.user.name;

  if (game.user.isGM) {
    saveWin(gameId, gameName, userId, userName);
    return;
  }

  game.socket.emit(SOCKET_KEY, {
    action: "saveWin",
    gameId, gameName, userId, userName
  });
}