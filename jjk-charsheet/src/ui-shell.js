import { isGm, getGmOverride, setGmOverride, getObrRole } from "./gm.js";
import { initSpiritTechniques, renderAbilitiesSummary, wireSpiritAbilitiesGrid } from "./spirit-techniques.js";
import {
  computeSpiritData,
  ensureSpiritOverrides,
  getSpiritDerivedOverride,
  setSpiritDerivedOverride,
  clearSpiritDerivedOverride,
  isSpiritOverrideMode,
  toggleSpiritOverrideMode,
  handleOpenSpiritOverride,
  spiritRollWithMode,
  buildSpiritRollBreakdown,
  openSpiritRollModeMenu,
  SPIRIT_GRADES,
} from "./spirit.js";

let _activateMainTab = null;
let _getActiveRollTab = null;
let _clearGroupRollHistory = null;
let _renderRollHistory = null;
let _switchRollTab = null;
let _getState = null;
let _scheduleSave = null;
let _applySheetState = null; // (fullState) => void
let _clearSheetState = null; // () => void
let _isInitialized = false;

// Tracks the member currently being viewed (slim display info only — NOT used for rendering)
let _viewingMember  = null; // { name, playerName } | null
let _viewingSpirit  = null; // spirit state object | null
let _spiritSave     = null; // scheduleSave callback for spirit edits

function getState() { return _getState ? _getState() : null; }
function scheduleSave() { if (_scheduleSave) _scheduleSave(); }

const GM_HOME_TABS   = ["party", "npcs", "spirits", "notes"]; // GM home tabs
const PLAYER_TABS    = ["character", "archetype", "inventory", "combat", "jujutsu", "notes"];
const MEMBER_TABS    = ["character", "archetype", "inventory", "combat", "jujutsu"]; // no notes when viewing a member
const SPIRIT_TABS    = ["spirit-sheet", "spirit-combat"]; // spirit gets its own dedicated panels

// ── GM LAYOUT ─────────────────────────────────────────────────────────────────

export function applyGmLayout() {
  const gm = isGm();
  const viewingSpirit = _viewingSpirit !== null;

  document.querySelectorAll(".tab[data-tab]").forEach(tab => {
    const name = tab.dataset.tab;
    if (viewingSpirit) {
      tab.style.display = SPIRIT_TABS.includes(name) ? "" : "none";
    } else if (gm && !_viewingMember) {
      tab.style.display = GM_HOME_TABS.includes(name) ? "" : "none";
    } else if (gm && _viewingMember) {
      tab.style.display = MEMBER_TABS.includes(name) ? "" : "none";
    } else {
      tab.style.display = PLAYER_TABS.includes(name) ? "" : "none";
    }
  });

  // ── Rest button — hidden for GM ───────────────────────────────────────────
  const restWrap = document.querySelector(".rest-control-wrap");
  if (restWrap) restWrap.style.display = gm ? "none" : "";

  // ── Back button ───────────────────────────────────────────────────────────
  let backBtn = document.getElementById("gmBackBtn");
  const showBack = (gm && _viewingMember) || _viewingSpirit !== null;
  if (showBack) {
    if (!backBtn) {
      backBtn = document.createElement("div");
      backBtn.id = "gmBackBtn";
      backBtn.className = "tab gm-back-btn";
      backBtn.addEventListener("click", () => {
        if (_viewingSpirit !== null) exitSpiritSheet();
        else exitMemberSheet();
      });
      document.querySelector(".tab-bar")?.insertAdjacentElement("afterbegin", backBtn);
    }
    backBtn.textContent = "← Back";
    backBtn.style.display = "";
  } else if (backBtn) {
    backBtn.style.display = "none";
  }

  // ── GM badge ─────────────────────────────────────────────────────────────
  let badge = document.getElementById("gmRoleBadge");
  if (gm) {
    if (!badge) {
      badge = document.createElement("div");
      badge.id = "gmRoleBadge";
      badge.className = "gm-role-badge";
      badge.textContent = "GM";
      document.body.appendChild(badge);
    }
    badge.style.display = "";
    badge.title = _viewingMember
      ? `GM — viewing ${_viewingMember.name}`
      : "GM mode";
  } else if (badge) {
    badge.style.display = "none";
  }
}

// ── PARTY SHEET DRILL-IN ──────────────────────────────────────────────────────

/**
 * Called by main.js after it has fetched the member's full saved state.
 * @param {object} fullState  - complete saved state object for the member
 * @param {string} memberName - display name for the back button / badge
 * @param {string} playerName - player name for context
 */
export function enterMemberSheet(fullState, memberName, playerName) {
  if (!isGm()) return;
  _viewingMember = { name: memberName || playerName || "Member", playerName };
  if (_applySheetState) _applySheetState(fullState);
  applyGmLayout();
  _activateMainTab?.("character");
}

function exitMemberSheet() {
  _viewingMember = null;
  if (_clearSheetState) _clearSheetState();
  applyGmLayout();
  _activateMainTab?.("party");
}

export function isViewingMemberSheet() {
  return _viewingMember !== null;
}

// ── SPIRIT SHEET ──────────────────────────────────────────────────────────────

/**
 * Called by main.js when the GM opens a spirit.
 * Shows panel-spirit-sheet instead of the player tabs.
 * @param {object} spiritState - the spirit's full state (_gmState copy)
 * @param {function} scheduleSave - debounced save callback from main.js
 */
export function enterSpiritSheet(spiritState, scheduleSave) {
  _viewingSpirit = spiritState;
  _spiritSave    = scheduleSave || null;

  // Initialise the spirit techniques module for this spirit
  initSpiritTechniques({
    getSpirit:    () => _viewingSpirit,
    scheduleSave: () => { if (_spiritSave) _spiritSave(); },
    showRollToast: window.showRollToast?.bind(window) ?? null,
  });

  // Render both spirit panels
  renderSpiritSheetPanel(spiritState);
  renderSpiritCombatPanel(spiritState);

  // Wire the top-level spirit-combat tab to re-render on click (keeps data fresh)
  document.querySelector(".tab[data-tab='spirit-combat']")?.addEventListener("click", () => {
    if (_viewingSpirit) renderSpiritCombatPanel(_viewingSpirit);
  });

  applyGmLayout();
  _activateMainTab?.("spirit-sheet");
}

function exitSpiritSheet() {
  if (_clearSheetState) _clearSheetState();
  _viewingSpirit = null;
  _spiritSave    = null;
  applyGmLayout();
  _activateMainTab?.("spirits");
}

function renderSpiritSheetPanel(spirit) {
  const panel = document.getElementById("panel-spirit-sheet");
  if (!panel) return;

  // Reset override mode when switching to a different spirit
  handleOpenSpiritOverride(spirit);

  const s   = spirit;
  const om  = isSpiritOverrideMode();
  const save = () => { if (_spiritSave) _spiritSave(); };
  const esc  = str => String(str ?? "")
    .replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");

  // ── DERIVED VALUES ────────────────────────────────────────────────────────
  // computeSpiritData reads overrides.derived first, falls back to auto-calc.
  ensureSpiritOverrides(s);
  const data = computeSpiritData(s);
  const { TL, SL, PL, ac, hpMax, ceMax, movement, healingDice, healingStr } = {
    TL: data.techniqueLevel, SL: data.speedLevel, PL: data.powerLevel,
    ac: data.ac, hpMax: data.hpMax, ceMax: data.ceMax, movement: data.movement,
    healingDice: data.healingDice, healingStr: data.healingStr,
  };
  const xpThreshold = data.xpThreshold;

  // Persist effective values to state so combat panel / list card are correct
  s.hpMax    = String(hpMax);
  s.ceMax    = String(ceMax);
  s.movement = String(movement);

  // ── HELPERS ───────────────────────────────────────────────────────────────
  const parseScore = v => { const n = parseInt(v, 10); return Number.isFinite(n) ? Math.max(0, n) : 0; };

  // Re-compute derived values in-place (called when a stat score changes).
  // Respects any stored overrides — only auto-updates fields that are NOT overridden.
  const updateDerived = () => {
    const d = computeSpiritData(_viewingSpirit);
    _viewingSpirit.hpMax    = String(d.hpMax);
    _viewingSpirit.ceMax    = String(d.ceMax);
    _viewingSpirit.movement = String(d.movement);

    if (!getSpiritDerivedOverride(_viewingSpirit, "hpMax"))    { const el = panel.querySelector("#spiritHpMax");   if (el) el.value = d.hpMax; }
    if (!getSpiritDerivedOverride(_viewingSpirit, "ceMax"))    { const el = panel.querySelector("#spiritCeMax");   if (el) el.value = d.ceMax; }
    if (!getSpiritDerivedOverride(_viewingSpirit, "ac"))       { const el = panel.querySelector(".ac-inside");     if (el) el.value = d.ac;    }
    if (!getSpiritDerivedOverride(_viewingSpirit, "movement")) { const el = panel.querySelector("#spiritMovement");if (el) el.value = d.movement; }

    const healStrEl = panel.querySelector(".spirit-healing-str");
    if (healStrEl) healStrEl.textContent = d.healingStr;

    // Refresh override marker visibility
    refreshAllMarkers();
    renderSpiritCombatPanel(_viewingSpirit);
  };

  // Override marker * badge — shows when a field has a stored override
  const markerFor = (key) => {
    const has = getSpiritDerivedOverride(s, key) !== null;
    return `<button type="button" class="override-marker-btn${has ? " visible" : ""}"
      data-spirit-derived-clear="${key}"
      title="${om ? "Click to clear override" : "Overridden"}"
      ${om ? "" : 'tabindex="-1"'}>*</button>`;
  };

  const refreshAllMarkers = () => {
    ["hpMax","ceMax","ac","movement"].forEach(key => {
      const btn = panel.querySelector(`[data-spirit-derived-clear="${key}"]`);
      if (!btn) return;
      const has = getSpiritDerivedOverride(_viewingSpirit, key) !== null;
      btn.classList.toggle("visible", has);
      btn.title    = isSpiritOverrideMode() ? "Click to clear override" : "Overridden";
      btn.tabIndex = isSpiritOverrideMode() && has ? 0 : -1;
    });
  };

  // ── STAT BLOCKS ───────────────────────────────────────────────────────────
  const STATS = [
    { key:"power",        label:"POWER",        skills:["Athletics","Combat","Fortitude","Intimidation","Strength"] },
    { key:"speed",        label:"SPEED",        skills:["Precision","Reaction","Stealth","Tempo"] },
    { key:"technique",    label:"TECHNIQUE",    skills:["Acrobatics","Control","Survival","Talent"] },
    { key:"intelligence", label:"INTELLIGENCE", skills:["Cursed Technique Education","General Education","Medical Education","Perception","Tech Education"] },
    { key:"cooperation",  label:"COOPERATION",  skills:["Charisma","Combo","Deception","Insight","Persuasion"] },
  ];

  const renderStatBlock = stat => {
    const ss = s.stats?.[stat.key] || { score: "", skills: [] };
    return `
      <div class="stat-block">
        <div class="stat-score-side">
          <div class="stat-label">${esc(stat.label)}</div>
          <input class="stat-score-input" data-spirit-stat="${stat.key}" type="number" min="0" max="7"
            placeholder="—" value="${esc(ss.score)}"
            style="cursor:pointer;" title="Click to roll · Right-click for advantage/disadvantage" />
        </div>
        <div class="skills-side">
          ${stat.skills.map((skill, si) => {
            const skillScore = ss.skills?.[si]?.score ?? "";
            return `<div class="skill-row">
              <input class="skill-bonus-input" type="number" min="0"
                data-spirit-skill="${stat.key}:${si}"
                value="${esc(skillScore)}" placeholder="—" />
              <span class="skill-name" data-spirit-skill-roll="${stat.key}:${si}"
                style="cursor:pointer;" title="Click to roll · Right-click for advantage/disadvantage">${esc(skill)}</span>
            </div>`;
          }).join("")}
        </div>
      </div>`;
  };

  // ── HEALING BUTTON STATE ──────────────────────────────────────────────────
  const ceNum  = parseInt(s.ceCurrent, 10) || 0;
  const canHeal = healingDice > 0 && ceNum >= 5;
  const healStyle = healingDice === 0
    ? "opacity:0.45;pointer-events:none;cursor:default;"
    : canHeal ? "cursor:pointer;" : "opacity:0.45;pointer-events:none;cursor:not-allowed;";
  const healTitle = healingDice === 0 ? "N/A"
    : canHeal ? "Click to heal (costs 5 CE)" : "Not enough CE (need 5)";

  // ── RENDER HTML ───────────────────────────────────────────────────────────
  const derivedRO = om ? "" : "readonly";

  panel.innerHTML = `
    <div class="spirit-sheet">
      <!-- Header -->
      <div class="header-grid">
        <div>
          <div class="jjk-label">呪術廻戦 · Cursed Spirit</div>
          <input class="name-input" id="spiritName" value="${esc(s.charName || "")}" placeholder="Spirit Name" />
          <div class="field-label">Spirit Name</div>
          <button class="info-btn${om ? " active" : ""}" id="spiritOverrideModeBtn" type="button"
            aria-label="Toggle override mode"
            title="${om ? "Disable manual overrides" : "Enable manual overrides"}">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"
              aria-hidden="true" focusable="false">
              <path d="M3 17.25V21h3.75L19.81 7.94l-3.75-3.75L3 17.25z" stroke="currentColor" stroke-width="1.4" fill="none"/>
              <path d="M14.06 4.19l3.75 3.75" stroke="currentColor" stroke-width="1.4"/>
            </svg>
            <span id="spiritOverrideModeBtnLabel">Override</span>
          </button>
        </div>
        <div style="display:flex;align-items:center;justify-content:center;padding-top:4px;">
          <div class="crest"><div class="crest-inner">霊</div></div>
        </div>
        <div class="meta-grid">
          <div class="meta-field" style="grid-column:1/-1;">
            <div class="field-label">Grade</div>
            <select class="meta-select" id="spiritGrade">
              ${SPIRIT_GRADES.map(g => `<option${s.grade === g ? " selected" : ""}>${esc(g)}</option>`).join("")}
            </select>
          </div>
          <div class="header-mini-vitals">
            <div class="vital-box header-mini-vital">
              <span class="vital-label">Points</span>
              <div class="header-mini-value">
                <input class="header-mini-input" id="spiritXp" type="number" min="0" placeholder="0" value="${esc(s.xp || "0")}" />
              </div>
            </div>
            <div class="vital-box header-mini-vital spirit-healing-box">
              <span class="vital-label">Healing (5 CE)</span>
              <div class="spirit-healing-str" id="spiritHealingValue"
                style="${healStyle}" title="${healTitle}">${esc(healingStr)}</div>
            </div>
          </div>
        </div>
      </div>

      <div class="divider"></div>

      <!-- Main body -->
      <div class="main-body">

        <!-- Vitals column -->
        <div class="vitals-col">
          <div class="character-vital-box" id="spiritHpVitalBox">
            <div style="display:flex;align-items:center;justify-content:space-between;">
              <span class="vital-label">Health</span>
              ${markerFor("hpMax")}
            </div>
            <div class="hp-row">
              <input class="hp-input" id="spiritHpCurrent" type="number" min="0"
                value="${esc(s.hpCurrent)}" placeholder="0" />
              <span class="hp-sep">/</span>
              <input class="hp-input" id="spiritHpMax" type="number"
                value="${hpMax}" ${derivedRO}
                title="${om ? "Manual override enabled" : "Auto-calculated"}" />
            </div>
          </div>
          <div class="character-vital-box" id="spiritCeVitalBox">
            <div style="display:flex;align-items:center;justify-content:space-between;">
              <span class="vital-label">Cursed Energy</span>
              ${markerFor("ceMax")}
            </div>
            <div class="hp-row">
              <input class="hp-input" id="spiritCeCurrent" type="number" min="0"
                value="${esc(s.ceCurrent)}" placeholder="0" />
              <span class="hp-sep">/</span>
              <input class="hp-input" id="spiritCeMax" type="number"
                value="${ceMax}" ${derivedRO}
                title="${om ? "Manual override enabled" : "Auto-calculated"}" />
            </div>
          </div>
          <div class="character-vital-box" id="spiritAcVitalBox">
            <div style="display:flex;align-items:center;justify-content:space-between;">
              <span class="vital-label" style="text-align:center;margin-top:2px;">Armor Class</span>
              ${markerFor("ac")}
            </div>
            <div class="shield-wrap">
              <svg viewBox="0 0 60 68" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M30 4L5 13V36C5 50 17 62 30 66C43 62 55 50 55 36V13L30 4Z" stroke="#1a1410" stroke-width="1.8" fill="#e2d9c8"/>
                <path d="M30 9L9 17V36C9 48 19 58 30 62C41 58 51 48 51 36V17L30 9Z" stroke="#1a1410" stroke-width="0.8" fill="none" stroke-dasharray="2 2"/>
                <foreignObject x="11" y="22" width="38" height="28">
                  <div xmlns="http://www.w3.org/1999/xhtml" style="display:flex;align-items:center;justify-content:center;height:100%">
                    <input class="ac-inside" value="${ac}" ${derivedRO}
                      title="${om ? "Manual override enabled" : "Auto-calculated"}" />
                  </div>
                </foreignObject>
              </svg>
            </div>
          </div>
          <div class="character-vital-box" id="spiritMovVitalBox">
            <div style="display:flex;align-items:center;justify-content:space-between;">
              <span class="vital-label">Movement</span>
              ${markerFor("movement")}
            </div>
            <div class="move-row">
              <input class="move-input" id="spiritMovement"
                value="${movement}" ${derivedRO}
                title="${om ? "Manual override enabled" : "Auto-calculated"}" />
              <span class="move-unit">ft</span>
            </div>
          </div>
        </div>

        <!-- Center stats: Power, Speed, Technique -->
        <div class="stats-col">
          ${STATS.slice(0, 3).map(renderStatBlock).join("")}
        </div>

        <!-- Right stats: Intelligence, Cooperation -->
        <div class="intel-col">
          ${STATS.slice(3).map(renderStatBlock).join("")}
        </div>

      </div>
    </div>`;

  // ── OVERRIDE BUTTON ───────────────────────────────────────────────────────
  panel.querySelector("#spiritOverrideModeBtn")?.addEventListener("click", () => {
    toggleSpiritOverrideMode();
    // Re-render — simplest way to flip readonly state and button appearance
    renderSpiritSheetPanel(_viewingSpirit);
  });

  // ── DERIVED FIELD OVERRIDE INPUTS ─────────────────────────────────────────
  // Wire all four derived inputs. When override mode is on, typing stores the
  // value; the * badge can be clicked to clear it and revert to auto-calc.
  [
    { id: "spiritHpMax",   key: "hpMax"    },
    { id: "spiritCeMax",   key: "ceMax"    },
    { id: "spiritMovement",key: "movement" },
  ].forEach(({ id, key }) => {
    document.getElementById(id)?.addEventListener("input", e => {
      if (!isSpiritOverrideMode()) return;
      setSpiritDerivedOverride(_viewingSpirit, key, e.target.value);
      // Persist effective value to state immediately
      const d = computeSpiritData(_viewingSpirit);
      _viewingSpirit.hpMax    = String(d.hpMax);
      _viewingSpirit.ceMax    = String(d.ceMax);
      _viewingSpirit.movement = String(d.movement);
      refreshAllMarkers();
      save();
    });
  });

  // AC lives inside an SVG foreignObject — select by class
  panel.querySelector(".ac-inside")?.addEventListener("input", e => {
    if (!isSpiritOverrideMode()) return;
    setSpiritDerivedOverride(_viewingSpirit, "ac", e.target.value);
    refreshAllMarkers();
    save();
  });

  // Clear-marker * buttons
  panel.querySelectorAll("[data-spirit-derived-clear]").forEach(btn => {
    btn.addEventListener("click", () => {
      if (!isSpiritOverrideMode()) return;
      clearSpiritDerivedOverride(_viewingSpirit, btn.dataset.spiritDerivedClear);
      renderSpiritSheetPanel(_viewingSpirit); // re-render so value reverts visually
      save();
    });
  });

  // ── GRADE ─────────────────────────────────────────────────────────────────
  document.getElementById("spiritGrade")?.addEventListener("change", e => {
    _viewingSpirit.grade = e.target.value;
    renderSpiritSheetPanel(_viewingSpirit); // healing dice depends on grade
    save();
  });

  // ── SIMPLE FIELDS ─────────────────────────────────────────────────────────
  const wire = (id, field) => {
    document.getElementById(id)?.addEventListener("input", e => {
      _viewingSpirit[field] = e.target.value;
      save();
    });
  };
  wire("spiritName",      "charName");
  wire("spiritHpCurrent", "hpCurrent");
  wire("spiritCeCurrent", "ceCurrent");
  wire("spiritXp",        "xp");

  // ── STAT SCORE INPUTS ────────────────────────────────────────────────────
  panel.querySelectorAll("[data-spirit-stat]").forEach(input => {
    const statKey = input.dataset.spiritStat;

    const doRoll = rollMode => {
      const score = parseInt(input.value, 10) || 0;
      if (score < 1) return;
      const r         = spiritRollWithMode(score, 0, rollMode);
      const breakdown = buildSpiritRollBreakdown({ die: "d6" }, rollMode, r);
      const label     = statKey.charAt(0).toUpperCase() + statKey.slice(1).toLowerCase();
      window.showRollToast?.(label, r.diceCount, r.rolls, r.total, null, null, breakdown,
        rollMode === "normal" ? null : rollMode);
    };

    input.addEventListener("click",       ()    => doRoll("normal"));
    input.addEventListener("contextmenu", event => openSpiritRollModeMenu(event, doRoll));
    input.addEventListener("input", () => {
      if (!_viewingSpirit.stats[statKey]) _viewingSpirit.stats[statKey] = { score: "", skills: [] };
      _viewingSpirit.stats[statKey].score = input.value;
      updateDerived();
      save();
    });
  });

  // ── SKILL INPUTS ──────────────────────────────────────────────────────────
  panel.querySelectorAll("[data-spirit-skill]").forEach(input => {
    input.addEventListener("input", () => {
      const [statKey, siStr] = input.dataset.spiritSkill.split(":");
      const si = parseInt(siStr, 10);
      if (!_viewingSpirit.stats[statKey]) _viewingSpirit.stats[statKey] = { score: "", skills: [] };
      const skills = _viewingSpirit.stats[statKey].skills;
      while (skills.length <= si) skills.push({});
      skills[si].score = input.value;
      save();
    });
  });

  // ── SKILL NAME ROLLS ──────────────────────────────────────────────────────
  panel.querySelectorAll("[data-spirit-skill-roll]").forEach(el => {
    const [statKey, siStr] = el.dataset.spiritSkillRoll.split(":");
    const si        = parseInt(siStr, 10);
    const skillName = el.textContent.trim();

    const doRoll = rollMode => {
      const score = parseInt(_viewingSpirit.stats?.[statKey]?.score, 10) || 0;
      if (score < 1) return;
      const bonus     = parseInt(_viewingSpirit.stats?.[statKey]?.skills?.[si]?.score, 10) || 0;
      const r         = spiritRollWithMode(score, bonus, rollMode);
      const maxPoss   = score * 6 + bonus;
      const allOnes   = r.rolls.every(d => d === 1);
      const crit      = rollMode === "normal"
        ? (allOnes ? "fail" : r.total >= maxPoss ? "success" : null) : null;
      const breakdown = buildSpiritRollBreakdown({ skillModifier: bonus, die: "d6" }, rollMode, r);
      const label     = statKey.charAt(0).toUpperCase() + statKey.slice(1).toLowerCase();
      window.showRollToast?.(label, r.diceCount, r.rolls, r.total, crit, skillName, breakdown,
        rollMode === "normal" ? null : rollMode);
    };

    el.addEventListener("click",       ()    => doRoll("normal"));
    el.addEventListener("contextmenu", event => openSpiritRollModeMenu(event, doRoll));
  });

  // ── HEALING ───────────────────────────────────────────────────────────────
  const healEl = panel.querySelector("#spiritHealingValue");
  const refreshHealAppearance = () => {
    if (!healEl) return;
    const d   = computeSpiritData(_viewingSpirit);
    const ce  = parseInt(_viewingSpirit.ceCurrent, 10) || 0;
    const can = d.healingDice > 0 && ce >= 5;
    healEl.style.opacity       = (d.healingDice === 0 || !can) ? "0.45" : "";
    healEl.style.pointerEvents = (d.healingDice === 0 || !can) ? "none" : "";
    healEl.style.cursor        = d.healingDice === 0 ? "default" : can ? "pointer" : "not-allowed";
    healEl.title               = d.healingDice === 0 ? "N/A" : can ? "Click to heal (costs 5 CE)" : "Not enough CE (need 5)";
  };

  document.getElementById("spiritCeCurrent")?.addEventListener("input", refreshHealAppearance);

  healEl?.addEventListener("click", () => {
    const d  = computeSpiritData(_viewingSpirit);
    const ce = parseInt(_viewingSpirit.ceCurrent, 10) || 0;
    if (d.healingDice === 0 || ce < 5) return;

    _viewingSpirit.ceCurrent = String(ce - 5);
    const rolls  = Array.from({ length: d.healingDice }, () => Math.floor(Math.random() * 8) + 1);
    const total  = rolls.reduce((a, b) => a + b, 0) + d.techniqueLevel;
    const hpCur  = parseInt(_viewingSpirit.hpCurrent, 10) || 0;
    _viewingSpirit.hpCurrent = String(Math.min(d.hpMax, hpCur + total));

    ["spiritCeCurrent","spiritCeCurrent2"].forEach(id => { const el = document.getElementById(id); if (el) el.value = _viewingSpirit.ceCurrent; });
    ["spiritHpCurrent","spiritHpCurrent2"].forEach(id => { const el = document.getElementById(id); if (el) el.value = _viewingSpirit.hpCurrent; });
    refreshHealAppearance();
    window.showRollToast?.("Healing", d.healingDice, rolls, total, null,
      _viewingSpirit.charName || "Spirit", { die: "d8", skillModifier: d.techniqueLevel }, null);
    save();
  });
}


// ── SPIRIT COMBAT PANEL ───────────────────────────────────────────────────────

function renderSpiritCombatPanel(spirit) {
  const panel = document.getElementById("panel-spirit-combat");
  if (!panel) return;

  const s = spirit;
  const parseScore = v => { const n = parseInt(v, 10); return Number.isFinite(n) ? Math.max(0, n) : 0; };
  const TL = parseScore(s.stats?.technique?.score);
  const SL = parseScore(s.stats?.speed?.score);
  const IL = parseScore(s.stats?.intelligence?.score);
  const ac = TL + SL;
  const bfRange = (TL >= 2 && TL <= 7) ? TL * 4 + 4 : null;
  const imbueLevel = Math.max(1, Math.min(3, parseInt(s.imbueLevel, 10) || 1));
  const imbueDie = imbueLevel === 1 ? "1d4" : imbueLevel === 2 ? "1d4+2" : "2d4";
  const xpThreshold = parseScore(s.sorcererXp) || TL * 2;
  const martialAvail = IL >= 4;

  const esc = str => String(str ?? "")
    .replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");

  panel.innerHTML = `
    <div class="spirit-sheet">
      <!-- Combat header row -->
      <div class="combat-header-grid" style="grid-template-columns:1fr 1fr 1fr;margin-bottom:0.5em;">
        <div class="vital-box" style="display:flex;flex-direction:column;align-items:center;justify-content:flex-start;padding:6px 0 2px 0;">
          <span class="combat-label" style="margin-bottom:0.5em;margin-top:0.1em;">HP</span>
          <div class="combat-value" style="margin-top:-4px;">
            <input type="number" class="hp-input" id="spiritHpCurrent2" min="0" value="${esc(s.hpCurrent)}" />
            <span class="hp-sep">/</span>
            <span class="hp-input" style="border:none;background:transparent;width:auto;">${esc(s.hpMax) || "—"}</span>
          </div>
        </div>
        <div class="vital-box" style="display:flex;flex-direction:column;align-items:center;justify-content:flex-start;padding:6px 0 2px 0;">
          <span class="combat-label" style="margin-bottom:0.5em;margin-top:0.1em;">CE</span>
          <div class="combat-value" style="margin-top:-4px;">
            <input type="number" class="hp-input" id="spiritCeCurrent2" min="0" value="${esc(s.ceCurrent)}" />
            <span class="hp-sep">/</span>
            <span class="hp-input" style="border:none;background:transparent;width:auto;">${esc(s.ceMax) || "—"}</span>
          </div>
        </div>
        <div class="vital-box" style="display:flex;flex-direction:column;align-items:center;justify-content:flex-start;padding:6px 0 2px 0;">
          <span class="combat-label" style="margin-bottom:0.5em;margin-top:0.1em;">AC</span>
          <div class="combat-value" style="margin-top:-4px;">${ac}</div>
        </div>
      </div>
      <div class="combat-header-grid" style="grid-template-columns:1fr 1fr 1fr;margin-bottom:0.5em;">
        <div class="character-vital-box black-flash-box" style="padding-top:2px;padding-bottom:2px;">
          <div class="black-flash-label" style="color:var(--accent);font-size:11px;letter-spacing:1.5px;text-transform:uppercase;margin-top:2px;margin-bottom:0;">Black Flash</div>
          <div class="black-flash-value" style="font-size:24px;font-weight:600;color:#110d0a;line-height:1;min-height:24px;">${bfRange ?? "—"}</div>
          <div class="black-flash-label" style="color:var(--accent);font-size:11px;letter-spacing:1.5px;text-transform:uppercase;margin-bottom:0;">Range</div>
        </div>
        <div class="vital-box" style="display:flex;flex-direction:column;align-items:center;justify-content:flex-start;padding:6px 0 2px 0;">
          <span class="combat-label" style="margin-bottom:0.5em;margin-top:0.1em;">Experience Threshold</span>
          <div class="combat-value" style="margin-top:-4px;">${xpThreshold}</div>
        </div>
        <div class="vital-box combat-imbue-field" style="padding:0 0 0.5px 0;">
          <div class="combat-imbue-split" style="min-height:28px;">
            <div class="combat-imbue-left" style="min-width:52px;">
              <span class="vital-label" style="margin-bottom:0;">Imbue</span>
              <input type="number" id="spiritImbueInput" class="combat-imbue-input" min="1" max="3" value="${imbueLevel}" />
            </div>
            <div class="combat-imbue-right">
              <div class="combat-imbue-die">${esc(imbueDie)}</div>
            </div>
          </div>
        </div>
      </div>

      <!-- Cursed Abilities -->
      <div class="combat-actions-section">
        <div class="combat-section-title">Cursed Abilities</div>
        <div id="spiritAbilitiesList" class="techniques-app-card-grid"></div>
        <button class="inventory-mini-btn" id="addSpiritAbilityBtn" type="button" style="margin-top:6px;">+ Add Ability</button>
      </div>

      ${martialAvail ? `
      <div class="combat-actions-section">
        <div class="combat-section-title">Martial Arts</div>
        <span class="combat-empty">Martial arts editor — coming soon.</span>
      </div>` : ""}

      <div class="combat-actions-section">
        <div class="combat-section-title">Cursed Skills</div>
        <span class="combat-empty">Skill editor — coming soon.</span>
      </div>
    </div>`;

  // ── EVENT WIRING ─────────────────────────────────────────────────────────────
  const save = () => { if (_spiritSave) _spiritSave(); };

  // HP/CE mirrors — keep in sync with the stats panel
  document.getElementById("spiritHpCurrent2")?.addEventListener("input", e => {
    _viewingSpirit.hpCurrent = e.target.value;
    const mirror = document.getElementById("spiritHpCurrent");
    if (mirror) mirror.value = e.target.value;
    save();
  });
  document.getElementById("spiritCeCurrent2")?.addEventListener("input", e => {
    _viewingSpirit.ceCurrent = e.target.value;
    const mirror = document.getElementById("spiritCeCurrent");
    if (mirror) mirror.value = e.target.value;
    save();
  });

  // Imbue level — re-render combat panel to update die display
  document.getElementById("spiritImbueInput")?.addEventListener("input", e => {
    _viewingSpirit.imbueLevel = parseInt(e.target.value, 10) || 1;
    renderSpiritCombatPanel(_viewingSpirit);
    save();
  });

  // ── Cursed Abilities ──────────────────────────────────────────────────────
  // Delegate all ability interactions to spirit-techniques.js.
  // wireSpiritAbilitiesGrid is safe to call multiple times; it replaces listeners
  // because the grid element is recreated on each renderSpiritCombatPanel call.
  renderAbilitiesSummary();
  wireSpiritAbilitiesGrid("addSpiritAbilityBtn");
}

// ── DEV TOGGLE PANEL ─────────────────────────────────────────────────────────

function buildDevPanel() {
  document.getElementById("gmDevPanel")?.remove();

  const panel = document.createElement("div");
  panel.id = "gmDevPanel";
  panel.className = "gm-dev-panel";

  const obrRole = getObrRole();
  const override = getGmOverride();
  const effectiveRole = isGm() ? "GM" : "PLAYER";

  panel.innerHTML = `
    <div class="gm-dev-panel-header">
      <span class="gm-dev-panel-title">⚙ Dev — Role Override</span>
      <button class="gm-dev-panel-close" id="gmDevPanelClose">✕</button>
    </div>
    <div class="gm-dev-panel-body">
      <div class="gm-dev-row">
        <span class="gm-dev-label">OBR Role</span>
        <span class="gm-dev-value">${obrRole ?? "not resolved"}</span>
      </div>
      <div class="gm-dev-row">
        <span class="gm-dev-label">Override</span>
        <span class="gm-dev-value">${override ?? "none"}</span>
      </div>
      <div class="gm-dev-row">
        <span class="gm-dev-label">Effective</span>
        <span class="gm-dev-value gm-dev-effective">${effectiveRole}</span>
      </div>
      <div class="gm-dev-buttons">
        <button class="gm-dev-btn" data-role="GM">Force GM</button>
        <button class="gm-dev-btn" data-role="PLAYER">Force Player</button>
        <button class="gm-dev-btn gm-dev-btn--clear" data-role="clear">Clear Override</button>
      </div>
    </div>`;

  document.body.appendChild(panel);

  document.getElementById("gmDevPanelClose")?.addEventListener("click", () => panel.remove());
  panel.querySelectorAll("[data-role]").forEach(btn => {
    btn.addEventListener("click", () => {
      setGmOverride(btn.dataset.role === "clear" ? null : btn.dataset.role);
      applyGmLayout();
      buildDevPanel();
    });
  });

  setTimeout(() => {
    document.addEventListener("click", function outsideClose(e) {
      if (!panel.contains(e.target)) {
        panel.remove();
        document.removeEventListener("click", outsideClose);
      }
    });
  }, 0);
}

// ── INIT ──────────────────────────────────────────────────────────────────────

export function initUiShell({
  activateMainTab,
  getActiveRollTab,
  clearGroupRollHistory,
  renderRollHistory,
  switchRollTab,
  getState: getStateFn,
  scheduleSave: scheduleSaveFn,
  applySheetState = null,
  clearSheetState = null,
}) {
  _activateMainTab       = activateMainTab;
  _getActiveRollTab      = getActiveRollTab;
  _clearGroupRollHistory = clearGroupRollHistory;
  _renderRollHistory     = renderRollHistory;
  _switchRollTab         = switchRollTab;
  _getState              = getStateFn;
  _scheduleSave          = scheduleSaveFn;
  _applySheetState       = applySheetState;
  _clearSheetState       = clearSheetState;

  if (_isInitialized) {
    _renderRollHistory?.();
    applyGmLayout();
    return;
  }

  document.querySelectorAll(".tab:not(.disabled)").forEach(tab => {
    tab.addEventListener("click", () => _activateMainTab?.(tab.dataset.tab));
  });

  const rollHistoryPanel    = document.getElementById("rollHistoryPanel");
  const rollHistoryBtn      = document.getElementById("rollHistoryBtn");
  const closeRollHistoryBtn = document.getElementById("closeRollHistoryBtn");
  const clearRollHistoryBtn = document.getElementById("clearRollHistoryBtn");
  const tabMine             = document.getElementById("rollLogTabMine");
  const tabGroup            = document.getElementById("rollLogTabGroup");
  const partyQuickBtn       = document.getElementById("partyQuickBtn");

  rollHistoryBtn?.addEventListener("click",      () => rollHistoryPanel?.classList.toggle("open"));
  closeRollHistoryBtn?.addEventListener("click", () => rollHistoryPanel?.classList.remove("open"));

  clearRollHistoryBtn?.addEventListener("click", () => {
    const state = getState();
    if (!state) return;
    if (_getActiveRollTab?.() === "mine") {
      state.rollHistory = [];
      _renderRollHistory?.();
      scheduleSave();
    } else {
      _clearGroupRollHistory?.();
    }
  });

  tabMine?.addEventListener("click",       () => _switchRollTab?.("mine"));
  tabGroup?.addEventListener("click",      () => _switchRollTab?.("group"));
  partyQuickBtn?.addEventListener("click", () => _activateMainTab?.("party"));

  // Info overlay + triple-click dev toggle
  const infoBtn      = document.getElementById("infoBtn");
  const infoCloseBtn = document.getElementById("infoCloseBtn");
  const infoOverlay  = document.getElementById("infoOverlay");

  if (infoBtn) {
    let clickCount = 0;
    let clickTimer = null;
    infoBtn.addEventListener("click", () => {
      clickCount++;
      clearTimeout(clickTimer);
      clickTimer = setTimeout(() => {
        if (clickCount === 1)    infoOverlay?.classList.add("open");
        else if (clickCount >= 3) buildDevPanel();
        clickCount = 0;
      }, 350);
    });
  }

  infoCloseBtn?.addEventListener("click", () => infoOverlay?.classList.remove("open"));
  infoOverlay?.addEventListener("click", e => {
    if (e.target === e.currentTarget) e.currentTarget.classList.remove("open");
  });

  applyGmLayout();
  _isInitialized = true;
  _renderRollHistory?.();
}