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

  // AC = techniqueLevel + speedLevel (same as players, no archetype bonuses)
  const ac = techniqueLevel + speedLevel;

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

  return {
    techniqueLevel,
    powerLevel,
    speedLevel,
    intLevel,
    ac,
    blackFlashRange,
    imbueDie,
    imbueDC,
    imbueLevel,
    xpThreshold,
    healingDice,
    healingStr,
    healingCeCost: 5,
    martialArtsAvailable,
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
        <div class="spirit-quick-row">
          ${(() => {
            const ce = parseInt(spirit.ceCurrent, 10);
            const canHeal = data.healingDice > 0 && Number.isFinite(ce) && ce >= 5;
            const noHeal  = data.healingDice === 0;
            const style   = noHeal
              ? 'pointer-events:none;opacity:0.45;'
              : canHeal
                ? 'cursor:pointer;'
                : 'cursor:not-allowed;opacity:0.45;';
            const title   = noHeal  ? 'N/A'
                          : canHeal ? 'Click to heal (costs 5 CE)'
                                    : 'Not enough CE (need 5)';
            return `<span class="spirit-quick-chip spirit-heal-chip" data-spirit-heal="${spirit.id}"
              style="${style}" title="${title}">⟳ ${escHtml(data.healingStr)}</span>`;
          })()}
          <span class="spirit-quick-chip" title="Black Flash Range">${data.blackFlashRange != null ? `⚡ ${data.blackFlashRange}` : ""}</span>
          <span class="spirit-quick-chip" title="Imbue">◈ ${escHtml(data.imbueDie)}</span>
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

  list.querySelectorAll("[data-spirit-heal]").forEach(chip => {
    chip.addEventListener("click", e => {
      e.stopPropagation();
      const id = chip.dataset.spiritHeal;
      const spirit = state.spirits.find(s => s.id === id);
      if (!spirit) return;

      const data = computeSpiritData(spirit);
      if (data.healingDice === 0) return;

      const ce = parseInt(spirit.ceCurrent, 10);
      if (!Number.isFinite(ce) || ce < 5) return;

      // Deduct CE
      spirit.ceCurrent = String(ce - 5);

      // Roll healing dice (Nd8 + TEC)
      const rolls = [];
      for (let i = 0; i < data.healingDice; i++) {
        rolls.push(Math.floor(Math.random() * 8) + 1);
      }
      const rolled = rolls.reduce((a, b) => a + b, 0);
      const total  = rolled + data.techniqueLevel;

      // Apply HP, capped at max (no overheal)
      const hpMax     = parseInt(spirit.hpMax, 10) || 0;
      const hpCurrent = parseInt(spirit.hpCurrent, 10) || 0;
      spirit.hpCurrent = String(Math.min(hpMax, hpCurrent + total));

      scheduleSave();
      renderSpiritList();

      // Show roll toast if available
      if (typeof window.showRollToast === "function") {
        window.showRollToast(
          "Healing",
          data.healingDice,
          rolls,
          total,
          null,
          spirit.charName || "Spirit",
          { die: "d8", skillModifier: data.techniqueLevel },
          null
        );
      }
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