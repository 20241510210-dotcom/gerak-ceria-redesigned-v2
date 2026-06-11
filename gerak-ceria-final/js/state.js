// ══════════════════════════════════════════
// STATE.JS — Global Game State Manager
// Gerak Ceria AI Adventure
// ══════════════════════════════════════════

const STATE_KEY = 'gerakCeriaState';

const DEFAULT_STATE = {
  playerName: 'Pemain Baru',
  level: 1,
  exp: 0,
  energy: 0,
  totalStars: 0,
  totalMoves: 0,
  streak: 0,
  lastPlayDate: null,
  settings: { sound: true, music: true, tracking: true },

  // Mission map: level => star count (0-3)
  levelStars: { 1:0, 2:0, 3:0, 4:0, 5:0 },
  // Which levels are unlocked
  levelUnlocked: { 1:true, 2:false, 3:false, 4:false, 5:false },

  // Badges: id => { unlocked, date }
  badges: {},

  // Activity log: array of { type, name, score, date, icon }
  activityLog: [],

  // Weekly activity for chart: array of 7 numbers (moves per day)
  weeklyActivity: [0,0,0,0,0,0,0],

  // AI Coach stats
  totalCalories: 0,
  warmupCount: 0,
  challengeHighScore: 0,
  miniGameHighScores: {},

  // Multiplayer
  redTeamWins: 0,
  blueTeamWins: 0,
};

let _state = { ...DEFAULT_STATE };

/** Load state from localStorage */
function loadState() {
  try {
    const saved = localStorage.getItem(STATE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      _state = deepMerge(DEFAULT_STATE, parsed);
    }
  } catch (e) {
    console.warn('State load error:', e);
    _state = { ...DEFAULT_STATE };
  }
  updateStreakCheck();
}

/** Save state to localStorage */
function saveState() {
  try {
    localStorage.setItem(STATE_KEY, JSON.stringify(_state));
  } catch (e) {
    console.warn('State save error:', e);
  }
}

/** Deep merge helper */
function deepMerge(target, source) {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
      result[key] = deepMerge(target[key] || {}, source[key]);
    } else {
      result[key] = source[key];
    }
  }
  return result;
}

/** Check and update daily streak */
function updateStreakCheck() {
  const today = new Date().toDateString();
  if (_state.lastPlayDate) {
    const last = new Date(_state.lastPlayDate);
    const diff = Math.floor((new Date() - last) / 86400000);
    if (diff > 1) _state.streak = 0;
  }
}

/** GET full state */
function getState() { return _state; }

/** GET specific key */
function get(key) { return _state[key]; }

/** SET key value and auto-save */
function set(key, value) {
  _state[key] = value;
  saveState();
}

/** Add XP and handle level up */
function addXP(amount) {
  _state.exp += amount;
  let leveled = false;
  while (_state.exp >= 100) {
    _state.exp -= 100;
    _state.level++;
    leveled = true;
  }
  saveState();
  return leveled;
}

/** Add energy (capped at 100) */
function addEnergy(amount) {
  _state.energy = Math.min(100, _state.energy + amount);
  saveState();
}

/** Add stars to a level */
function setLevelStars(levelId, stars) {
  const prev = _state.levelStars[levelId] || 0;
  _state.levelStars[levelId] = Math.max(prev, stars);
  _state.totalStars = Object.values(_state.levelStars).reduce((a,b)=>a+b,0);
  // Unlock next level
  if (stars >= 1 && levelId < 5) {
    _state.levelUnlocked[levelId + 1] = true;
  }
  saveState();
}

/** Unlock a badge */
function unlockBadge(badgeId) {
  if (_state.badges[badgeId]?.unlocked) return false;
  _state.badges[badgeId] = { unlocked: true, date: new Date().toISOString() };
  saveState();
  return true;
}

/** Add activity log entry */
function addActivity(entry) {
  // entry: { type, name, score, icon }
  const fullEntry = {
    ...entry,
    date: new Date().toLocaleDateString('id-ID'),
    timestamp: Date.now()
  };
  _state.activityLog.unshift(fullEntry);
  if (_state.activityLog.length > 20) _state.activityLog.pop();

  // Update weekly activity (today = index 6)
  const today = new Date().getDay();
  _state.weeklyActivity[today] = (_state.weeklyActivity[today] || 0) + 1;

  // Update streak
  const today2 = new Date().toDateString();
  if (_state.lastPlayDate !== today2) {
    _state.lastPlayDate = today2;
    _state.streak++;
  }

  _state.totalMoves++;
  _state.totalCalories += Math.floor(Math.random() * 8) + 3;
  saveState();
}

/** Reset all data */
function resetState() {
  _state = { ...DEFAULT_STATE };
  localStorage.removeItem(STATE_KEY);
}

// ─── EXPOSE GLOBALLY ───
window.GameState = {
  load: loadState, save: saveState,
  get, set, getState,
  addXP, addEnergy,
  setLevelStars, unlockBadge, addActivity,
  reset: resetState,
};
