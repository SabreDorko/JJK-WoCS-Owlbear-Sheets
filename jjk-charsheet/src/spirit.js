// ── SPIRIT MODULE ─────────────────────────────────────────────────────────────
// Cursed Spirits are stored as full character-state objects inside state.spirits[].
// They share the same stat/skill/combat architecture as players but with:
//   - Grade 5 → Special Grade (5 is weakest, Special is strongest)
//   - "Points" instead of XP
//   - Cursed Abilities (= CT Applications with same scaling system)
//   - Martial Arts gated behind Intelligence ≥ 4
//   - Healing ability that scales with Grade (5 CE cost)
//   - No archetype system

import { CENTER_STATS, RIGHT_STATS } from "./state/store.js";

const ALL_STATS = [...CENTER_STATS, ...RIGHT_STATS];

let _getState       = null;
let _scheduleSave   = null;
let _onOpenSpirit   = null;
let _searchQuery    = "";

// ── SPIRIT OVERRIDE MODE ─────────────────────────────────────────────
// Per-spirit toggle; resets when a new spirit is opened.
let _spiritOverrideMode = false;
let _lastSpiritId = null;

export function isSpiritOverrideMode() {
  return _spiritOverrideMode;
}

export function toggleSpiritOverrideMode() {
  _spiritOverrideMode = !_spiritOverrideMode;
}

// Call this when a spirit is opened; resets override mode if spirit changes
export function handleOpenSpiritOverride(spirit) {
  if (_lastSpiritId !== spirit.id) {
    _spiritOverrideMode = false;
    _lastSpiritId = spirit.id;
  }
}

// ── OVERRIDE HELPERS ──────────────────────────────────────────────────────────
// Mirrors the same overrides.derived pattern used in character.js.

export function ensureSpiritOverrides(spirit) {
  if (!spirit.overrides || typeof spirit.overrides !== "object") spirit.overrides = {};
  if (!spirit.overrides.derived || typeof spirit.overrides.derived !== "object") spirit.overrides.derived = {};
}

export function getSpiritDerivedOverride(spirit, key) {
  ensureSpiritOverrides(spirit);
  const v = parseInt(spirit.overrides.derived[key], 10);
  return Number.isFinite(v) ? v : null;
}

export function setSpiritDerivedOverride(spirit, key, rawValue) {
  ensureSpiritOverrides(spirit);
  const v = parseInt(rawValue, 10);
  if (Number.isFinite(v)) spirit.overrides.derived[key] = v;
  else delete spirit.overrides.derived[key];
}

export function clearSpiritDerivedOverride(spirit, key) {
  ensureSpiritOverrides(spirit);
  delete spirit.overrides.derived[key];
}

// ── ROLL HELPERS ──────────────────────────────────────────────────────────────

function rollDicePool(n) {
  return Array.from({ length: n }, () => Math.floor(Math.random() * 6) + 1);
}

export function spiritRollWithMode(statScore, bonus, rollMode) {
  const compute = rolls => rolls.reduce((a, b) => a + b, 0) + bonus;
  const first   = rollDicePool(statScore);
  const firstTot = compute(first);
  if (rollMode === "normal") {
    return { rolls: first, total: firstTot, diceCount: statScore, firstRolls: first, firstTotal: firstTot, secondRolls: null, secondTotal: null, selectedRollIndex: 0 };
  }
  const second    = rollDicePool(statScore);
  const secondTot = compute(second);
  const idx = rollMode === "advantage"
    ? (firstTot >= secondTot ? 0 : 1)
    : (firstTot <= secondTot ? 0 : 1);
  return {
    rolls: idx === 0 ? first : second,
    total: idx === 0 ? firstTot : secondTot,
    diceCount: statScore,
    firstRolls: first, firstTotal: firstTot,
    secondRolls: second, secondTotal: secondTot,
    selectedRollIndex: idx,
  };
}

export function buildSpiritRollBreakdown(base, rollMode, r) {
  if (rollMode === "normal") return base;
  return { ...base, rollMode, comparedRolls: [r.firstRolls, r.secondRolls], comparedTotals: [r.firstTotal, r.secondTotal], selectedRollIndex: r.selectedRollIndex };
}

// ── ROLL MODE MENU ────────────────────────────────────────────────────────────
// Singleton menu; created once and reused across all spirit sheet renders.

let _rollModeMenu = null;

export function ensureSpiritRollModeMenu() {
  if (_rollModeMenu) return _rollModeMenu;
  const menu = document.createElement("div");
  menu.className = "roll-mode-menu";
  menu.hidden = true;
  menu.innerHTML = `
    <button type="button" class="roll-mode-item" data-spirit-roll-mode="advantage">Roll with Advantage</button>
    <button type="button" class="roll-mode-item" data-spirit-roll-mode="disadvantage">Roll with Disadvantage</button>
    <button type="button" class="roll-mode-item" data-spirit-roll-mode="normal">Normal Roll</button>
  `;
  menu.addEventListener("click", e => {
    const btn = e.target.closest("[data-spirit-roll-mode]");
    if (!btn) return;
    const mode   = btn.dataset.spiritRollMode;
    const action = _rollModeMenu._pendingAction;
    _rollModeMenu.hidden = true;
    _rollModeMenu._pendingAction = null;
    if (action && mode) action(mode);
  });
  document.body.appendChild(menu);
  document.addEventListener("click",  () => { if (_rollModeMenu) _rollModeMenu.hidden = true; });
  document.addEventListener("scroll", () => { if (_rollModeMenu) _rollModeMenu.hidden = true; }, true);
  document.addEventListener("keydown", e => { if (e.key === "Escape" && _rollModeMenu) _rollModeMenu.hidden = true; });
  _rollModeMenu = menu;
  return _rollModeMenu;
}

export function openSpiritRollModeMenu(event, onSelectMode) {
  event.preventDefault();
  event.stopPropagation();
  const menu = ensureSpiritRollModeMenu();
  menu._pendingAction = onSelectMode;
  menu.hidden = false;
  menu.style.left = "0px";
  menu.style.top  = "0px";
  requestAnimationFrame(() => {
    const rect = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(8, Math.min(event.clientX, window.innerWidth  - rect.width  - 8))}px`;
    menu.style.top  = `${Math.max(8, Math.min(event.clientY, window.innerHeight - rect.height - 8))}px`;
  });
}

function getState() { return _getState ? _getState() : null; }
function scheduleSave() { if (_scheduleSave) _scheduleSave(); }

// ── GRADE SYSTEM ──────────────────────────────────────────────────────────────
// Spirits go 5 (weakest) → 4 → Semi-3 → 3 → Semi-2 → 2 → Semi-1 → 1 → Special Grade

export const SPIRIT_GRADES = ["5", "4", "Semi-3", "3", "Semi-2", "2", "Semi-1", "1", "Special Grade"];

// Maps grade to number of d8s for healing (Grade 5 = 0 = N/A)
const HEALING_DICE = {
  "5": 0,
  "4": 1,
  "Semi-3": 1,
  "3": 2,
  "Semi-2": 2,
  "2": 3,
  "Semi-1": 3,
  "1": 4,
  "Special Grade": 5,
};

function getHealingDice(grade) {
  return HEALING_DICE[grade] ?? 0;
}

// ── STATE HELPERS ─────────────────────────────────────────────────────────────

function parseScore(raw) {
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? Math.max(0, n) : 0;
}

function ensureSpirits(state) {
  if (!Array.isArray(state.spirits)) state.spirits = [];
}

function generateId() {
  return `spirit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function createBlankSpirit() {
  const stats = {};
  ALL_STATS.forEach(s => {
    stats[s.key] = { score: "", skills: s.skills.map(() => ({ score: "" })) };
  });

  return {
    id:            generateId(),
    charName:      "New Spirit",
    grade:         "5",
    age:           "",
    ac:            "",
    hpCurrent:     "",
    hpMax:         "",
    ceCurrent:     "",
    ceMax:         "",
    movement:      "",
    ceNote:        "",
    // Points = XP for spirits
    xp:            "0",
    sorcererXp:    "",   // XP threshold override (if blank, computed as TEC × 2)
    // Cursed Abilities — same shape as CT applications
    cursedAbilities: [],
    // Skills — same shape as player skills
    skills:        { xpSkills: [], jujutsuSkills: [] },
    training:      { jujutsuSkills: [], aptitudeTraining: { activeTrainings: [] } },
    // Imbue level (1-3)
    imbueLevel:    1,
    // Martial arts are only available if INT ≥ 4
    martialArts:   [],
    // Misc
    notes:         "",
    directModifiers: [],
    overrides:     { derived: {}, subskills: {} },
    stats,
    favorite:      false,
    isSpirit:      true,   // flag so renderers know this is a spirit
  };
}

// ── COMPUTED VALUES ───────────────────────────────────────────────────────────

export function computeSpiritData(spirit) {
  const techniqueLevel = parseScore(spirit?.stats?.technique?.score);
  const powerLevel     = parseScore(spirit?.stats?.power?.score);
  const speedLevel     = parseScore(spirit?.stats?.speed?.score);
  const intLevel       = parseScore(spirit?.stats?.intelligence?.score);

  // Derived base values
  const baseAc       = techniqueLevel + speedLevel;
  const baseHpMax    = 10 + powerLevel * 5;
  const baseCeMax    = 15 + techniqueLevel * 5;
  const baseMovement = 30 + speedLevel * 5;

  // Apply overrides if present (same pattern as character.js)
  const ac       = getSpiritDerivedOverride(spirit, "ac")       ?? baseAc;
  const hpMax    = getSpiritDerivedOverride(spirit, "hpMax")    ?? baseHpMax;
  const ceMax    = getSpiritDerivedOverride(spirit, "ceMax")    ?? baseCeMax;
  const movement = getSpiritDerivedOverride(spirit, "movement") ?? baseMovement;

  // Black Flash Range
  let blackFlashRange = null;
  if (Number.isFinite(techniqueLevel) && techniqueLevel >= 2 && techniqueLevel <= 7) {
    blackFlashRange = techniqueLevel * 4 + 4;
  }

  // Imbue
  const imbueLevel = Math.max(1, Math.min(3, parseInt(spirit?.imbueLevel, 10) || 1));
  const imbueDie   = imbueLevel === 1 ? "1d4" : imbueLevel === 2 ? "1d4+2" : "2d4";
  const imbueDC    = techniqueLevel * 2;

  // XP Threshold (Points threshold for spirits)
  const xpThreshold = parseScore(spirit?.sorcererXp) || techniqueLevel * 2;

  // Healing
  const healingDice  = getHealingDice(spirit?.grade || "5");
  const healingStr   = healingDice > 0
    ? `${healingDice}d8 + ${techniqueLevel}`
    : "N/A";

  // Martial Arts available if INT ≥ 4
  const martialArtsAvailable = intLevel >= 4;

  // Which derived fields have overrides stored
  const hasAcOverride       = getSpiritDerivedOverride(spirit, "ac")       !== null;
  const hasHpMaxOverride    = getSpiritDerivedOverride(spirit, "hpMax")    !== null;
  const hasCeMaxOverride    = getSpiritDerivedOverride(spirit, "ceMax")    !== null;
  const hasMovementOverride = getSpiritDerivedOverride(spirit, "movement") !== null;

  return {
    techniqueLevel,
    powerLevel,
    speedLevel,
    intLevel,
    ac,
    hpMax,
    ceMax,
    movement,
    blackFlashRange,
    imbueDie,
    imbueDC,
    imbueLevel,
    xpThreshold,
    healingDice,
    healingStr,
    healingCeCost: 5,
    martialArtsAvailable,
    hasAcOverride,
    hasHpMaxOverride,
    hasCeMaxOverride,
    hasMovementOverride,
  };
}

// ── SPIRIT LIST RENDER ────────────────────────────────────────────────────────

export function renderSpiritList() {
  const list = document.getElementById("spiritList");
  if (!list) return;

  const state = getState();
  if (!state) return;
  ensureSpirits(state);

  const query = _searchQuery.toLowerCase().trim();
  const spirits = state.spirits
    .filter(s => !query || (s.charName || "").toLowerCase().includes(query))
    .sort((a, b) => (b.favorite ? 1 : 0) - (a.favorite ? 1 : 0));

  if (!spirits.length) {
    list.innerHTML = `<div class="party-empty">${query ? "No spirits match that search." : "No spirits yet. Click New Spirit to add one."}</div>`;
    return;
  }

  list.innerHTML = spirits.map(spirit => {
    const data    = computeSpiritData(spirit);
    const isFav   = !!spirit.favorite;
    const grade   = spirit.grade ? `Grade ${spirit.grade}` : "";
    const intStr  = data.intLevel ? `INT ${data.intLevel}` : "";
    const meta    = [grade, intStr].filter(Boolean).join(" · ");

    return `
      <div class="party-item party-item--gm-openable spirit-item" data-spirit-id="${spirit.id}"
        role="button" tabindex="0" title="Open ${escHtml(spirit.charName)}">
        <div class="party-item-header">
          <div class="party-character">${escHtml(spirit.charName || "Unnamed Spirit")}</div>
          <div class="npc-item-actions">
            <button class="npc-fav-btn${isFav ? " npc-fav-btn--active" : ""}"
              data-spirit-fav="${spirit.id}" title="${isFav ? "Unfavourite" : "Favourite"}" type="button">★</button>
            <button class="inventory-mini-btn inventory-icon-btn danger npc-delete-btn"
              data-spirit-delete="${spirit.id}" title="Delete spirit" type="button" aria-label="Delete spirit">
              <svg class="inventory-icon-trash" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <path fill="currentColor" d="M9 3h6a1 1 0 0 1 1 1v1h4v2h-1l-1 12a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 7H4V5h4V4a1 1 0 0 1 1-1Zm1 2v0h4V5h-4Zm-1 4h2v9H9V9Zm4 0h2v9h-2V9Z"/>
                <path fill="none" stroke="currentColor" stroke-width="1.5" d="M6 7.5h12"/>
              </svg>
            </button>
          </div>
        </div>
        ${meta ? `<div class="party-meta"><span class="party-meta-left">${escHtml(meta)}</span></div>` : ""}
        <div class="party-stats" style="display:grid;grid-template-columns:repeat(3,1fr);gap:7px;text-align:center;align-items:center;justify-items:center;">
          <div class="party-stat" style="display:flex;align-items:center;justify-content:center;gap:6px;">
            ${getSpiritStatIcon("hp")}
            <div class="party-stat-value">${track(spirit.hpCurrent, spirit.hpMax)}</div>
          </div>
          <div class="party-stat" style="display:flex;align-items:center;justify-content:center;gap:6px;">
            ${getSpiritStatIcon("ce")}
            <div class="party-stat-value">${track(spirit.ceCurrent, spirit.ceMax)}</div>
          </div>
          <div class="party-stat" style="display:flex;align-items:center;justify-content:center;gap:6px;">
            ${getSpiritStatIcon("ac")}
            <div class="party-stat-value">${data.ac || "—"}</div>
          </div>
        </div>
        <div class="divider" style="margin:10px 0 6px 0;"></div>
        <div class="npc-core-stats" style="display:grid;grid-template-columns:repeat(5,1fr);gap:2px 0;">
          <div style="grid-column:1/-1;display:grid;grid-template-columns:repeat(5,1fr);text-align:center;">
            <span class="npc-core-stat-label">PWR</span>
            <span class="npc-core-stat-label">SPD</span>
            <span class="npc-core-stat-label">TEC</span>
            <span class="npc-core-stat-label">INT</span>
            <span class="npc-core-stat-label">COOP</span>
          </div>
          <div style="grid-column:1/-1;display:grid;grid-template-columns:repeat(5,1fr);">
            ${["power","speed","technique","intelligence","cooperation"].map(k => `
              <span class="npc-core-stat-value" style="display:flex;justify-content:center;align-items:center;">
                ${spirit.stats?.[k]?.score !== "" && spirit.stats?.[k]?.score != null ? spirit.stats[k].score : "—"}
              </span>`).join("")}
          </div>
        </div>

      </div>`;
  }).join("");

  // Click handlers
  list.querySelectorAll(".spirit-item").forEach(el => {
    el.addEventListener("click", e => {
      if (e.target.closest("[data-spirit-delete]")) return;
      if (e.target.closest("[data-spirit-fav]")) return;
      const id = el.dataset.spiritId;
      const spirit = state.spirits.find(s => s.id === id);
      if (spirit && _onOpenSpirit) _onOpenSpirit(spirit);
    });
    el.addEventListener("keydown", e => {
      if (e.key === "Enter" || e.key === " ") el.click();
    });
  });

  list.querySelectorAll("[data-spirit-fav]").forEach(btn => {
    btn.addEventListener("click", e => {
      e.stopPropagation();
      toggleFavorite(btn.dataset.spiritFav);
    });
  });

  list.querySelectorAll("[data-spirit-delete]").forEach(btn => {
    btn.addEventListener("click", e => {
      e.stopPropagation();
      deleteSpirit(btn.dataset.spiritDelete);
    });
  });
}

// ── CRUD ──────────────────────────────────────────────────────────────────────

function addSpirit() {
  const state = getState();
  if (!state) return;
  ensureSpirits(state);
  const spirit = createBlankSpirit();
  state.spirits.push(spirit);
  scheduleSave();
  renderSpiritList();
  if (_onOpenSpirit) _onOpenSpirit(spirit);
}

function deleteSpirit(id) {
  const state = getState();
  if (!state) return;
  ensureSpirits(state);
  state.spirits = state.spirits.filter(s => s.id !== id);
  scheduleSave();
  renderSpiritList();
}

function toggleFavorite(id) {
  const state = getState();
  if (!state) return;
  ensureSpirits(state);
  const spirit = state.spirits.find(s => s.id === id);
  if (!spirit) return;
  spirit.favorite = !spirit.favorite;
  scheduleSave();
  renderSpiritList();
}

export function saveSpiritEdits(spiritId, editedState) {
  const state = getState();
  if (!state) return;
  ensureSpirits(state);
  const idx = state.spirits.findIndex(s => s.id === spiritId);
  if (idx === -1) return;
  state.spirits[idx] = { ...editedState, id: spiritId, isSpirit: true };
  scheduleSave();
  renderSpiritList();
}

// ── INIT ──────────────────────────────────────────────────────────────────────

export function initSpirits({
  getState: getStateFn,
  scheduleSave: scheduleSaveFn,
  onOpenSpirit,
}) {
  _getState     = getStateFn;
  _scheduleSave = scheduleSaveFn;
  _onOpenSpirit = onOpenSpirit;

  document.getElementById("addSpiritBtn")?.addEventListener("click", addSpirit);

  const searchInput = document.getElementById("spiritSearchInput");
  if (searchInput) {
    searchInput.addEventListener("input", () => {
      _searchQuery = searchInput.value;
      renderSpiritList();
    });
  }

  // Optionally, wire up override mode button for spirits here if you have one:
  // const overrideBtn = document.getElementById("spiritOverrideModeBtn");
  // if (overrideBtn) overrideBtn.addEventListener("click", () => { toggleSpiritOverrideMode(); /* re-render UI as needed */ });
}

// ── TINY HELPERS ─────────────────────────────────────────────────────────────

function escHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function track(cur, max) {
  return `${cur === "" || cur == null ? "—" : cur} / ${max === "" || max == null ? "—" : max}`;
}

function getSpiritStatIcon(type) {
  if (type === "hp") {
    return `
      <svg class="party-stat-icon" viewBox="0 0 28 28" aria-hidden="true" focusable="false">
        <path fill="currentColor" d="M14 24c-.2 0-.4-.1-.6-.2C8.5 21 4 17 4 11.8 4 8.6 6.3 6.2 9.2 6.2c2.1 0 3.8 1.1 4.8 2.8 1-1.7 2.7-2.8 4.8-2.8C21.7 6.2 24 8.6 24 11.8c0 5.2-4.5 9.2-9.4 12-.2.1-.4.2-.6.2Z"/>
        <text x="14" y="14">HP</text>
      </svg>
    `;
  }
  if (type === "ce") {
    return `
      <svg class="party-stat-icon" viewBox="0 0 28 28" aria-hidden="true" focusable="false">
        <path fill="currentColor" d="M14 2 25 14 14 26 3 14Z"/>
        <text x="14" y="15">CE</text>
      </svg>
    `;
  }
  return `
    <svg class="party-stat-icon" viewBox="0 0 28 28" aria-hidden="true" focusable="false">
      <path fill="currentColor" d="M14 2 23 6v7c0 5.4-3.4 9.8-9 13-5.6-3.2-9-7.6-9-13V6l9-4Z"/>
      <text x="14" y="14">AC</text>
    </svg>
  `;
}