[![Discord](https://img.shields.io/badge/Discord-Join-5865F2?logo=discord&logoColor=white)](https://discord.gg/7DkfrUV7ru)
[![Patreon](https://img.shields.io/badge/Patreon-Support-F96854?logo=patreon&logoColor=white)](https://www.patreon.com/cw/ReAcTiOnN)

# AFK Tavern
A **system-agnostic Foundry VTT module** that turns mid-session breaks into a shared experience. GMs run a break timer; players track who's away, who's back, and pass the time with a stack of built-in tavern minigames — solo, multiplayer, and spectatable.
All features are fully toggleable through world settings so tables can keep things as light or as featureful as they like.

---

## Features

### **Break Room**
A central window the GM opens to start and manage breaks. Auto-pauses the game when a break begins and unpauses when it ends.
#### **Timer Options**
Choose how the break duration is set:
- **Preset buttons** — 5, 10, 15, 20, 25, 30 minutes
- **Custom duration**
- **End time Picker** (auto-converts to remaining minutes)

#### **Pre-Session Lobby Mode**
Use the lobby toggle before a session starts so players can mark themselves *Ready* instead of *Away*. Notification fires when everyone's ready.

#### **GM Tools**
- **Ring Bell** — broadcasts a sound + notification to grab everyone's attention
- **End Early** confirmation if not all players are back yet
- **Auto-detect** when all non-GM players are back

---

### **Tavern Patrons**
Live list of every player in the world during a break, with avatars, character names, and color-coded status.
#### **Status Tracking**
Each player shows one of:
- **Back** *(returned to the table)*
- **Away** *(stepped away)*
- **Offline** *(not connected)*
- **Playing {game}** *(in a minigame)*
- **Watching {game}** *(spectating someone else)*

#### **Visibility Controls**
- **Show / hide offline players** in the patron list
- **Hide specific users** entirely (great for spectator accounts or assistant GMs)

---

### **Mini Bar**
A compact, dockable bar that hovers above the player list when the main window is closed.
- Live countdown timer
- Quick **I'm Back / Step Away** toggle
- Tap-to-expand patron roster popup
- Optional **auto-minimize** when launching a game, when spectating, or both

---

### **Minigames**
Eight built-in games organized into three categories. Difficulty selectable per launch, with leaderboards tracked per game.

#### **Classic**
- **Memory Match** — flip-and-match with six grid sizes from 3×4 up to 5×8
- **Minesweeper** — six difficulty tiers from 8×8 (8 mines) up to 18×16 (56 mines)
- **Simon Says** — 4 to 9 colour sequences across six difficulty tiers
- **Whack-a-Mole** — time-attack scoring with mimics (+1), chests (+3), and cats (-2), plus streak bonuses
- **Word Scramble** — four difficulty modes with hint and skip options

#### **Premium Module Integration**
- **Monster Harvester** — a preview of my paid patereon module minigame for Monster Harvester

#### **Multiplayer**
- **Tic Tac Toe** — classic tic tac toe
- **Connect Four** — 6×7 grid of connect 4

---

### **Spectator Mode**
Watch other players' games live during a break - works for every minigame including the multiplayer ones.
- **GM-toggleable** in world settings

---

### **Highscores**
Auto-managed journal entry with one page per game, populated as players finish games.
- **Top 5 leaderboard** per game with difficulty-weighted scoring
- **Personal best per difficulty** so easier difficulties don't get buried by harder ones
- **Win tracking** with leaderboards for multiplayer games

---

### **Audio & Music**
#### **Sound Effects**
Customizable audio for every break event:
- **Break Start**
- **Break End / Timer Expired**
- **10-Second Countdown**
- **Bell Notification**

Each slot has a file browser and built-in **preview** button.

#### **Break Playlist**
Pick a playlist to play during breaks — currently-playing music is paused and resumed automatically.
- In-window **music controls** (play / pause / prev / next)
- **Now-playing banner** under the break room window

---

### **Settings**
Three dedicated settings menus for fine-tuning:
- **Sound Effects** — pick custom audio files for each event
- **Player Visibility** — control which users appear in the patron list
- **Games Configuration** — toggle the games drawer entirely, or disable individual games

---

## Installation
1. Open Foundry VTT
2. Go to **Add-on Modules → Install Module**
3. Enter the manifest URL or search for the module in the package browser
4. Enable it in your world
5. Configure options in **Module Settings**

---

## License
Released under the [MIT License](./LICENSE).

---

## Issues & Support
Report bugs or request features here:
**https://github.com/ReAcTiOnN77/afk-tavern/issues**
