import { isGm, getGmOverride, setGmOverride, getObrRole } from "./gm.js";

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

  // ── SKILL ROLL TOASTS ─────────────────────────────────────────────
  // Attach click listeners to skill names for rolling (with crit/bonus logic)
  panel.querySelectorAll('.skill-name').forEach((el, idx) => {
    el.style.cursor = 'pointer';
    el.title = 'Roll this skill';
    el.addEventListener('click', () => {
      // Find statKey and skillIdx from parent .stat-block and .skill-row
      const skillRow = el.closest('.skill-row');
      const statBlock = el.closest('.stat-block');
      if (!skillRow || !statBlock) return;
      // Find statKey from stat-block's input
      const statInput = statBlock.querySelector('.stat-score-input');
      if (!statInput) return;
      const statKey = statInput.dataset.spiritStat;
      // Find skillIdx by index of .skill-row in .skills-side
      const skillsSide = statBlock.querySelector('.skills-side');
      const skillRows = Array.from(skillsSide.querySelectorAll('.skill-row'));
      const skillIdx = skillRows.indexOf(skillRow);
      // Get skill value
      let val = 0;
      const statObj = _viewingSpirit.stats?.[statKey];
      if (statObj && Array.isArray(statObj.skills) && statObj.skills[skillIdx]) {
        val = parseInt(statObj.skills[skillIdx].score, 10);
        if (!Number.isFinite(val)) val = 0;
      }
      // Always roll 1d6 for skills, add crit logic
      const rolls = [Math.floor(Math.random() * 6) + 1];
      const total = rolls[0] + val;
      const maxPossible = 6 + val;
      const allOnes = rolls[0] === 1;
      const critStatus = allOnes ? "fail" : (total >= maxPossible ? "success" : null);
      const breakdown = { skillModifier: val, die: "d6" };
      if (typeof window.showRollToast === 'function') {
        const skillName = el.textContent;
        window.showRollToast(
          statKey.charAt(0).toUpperCase() + statKey.slice(1).toLowerCase(),
          1,
          rolls,
          total,
          critStatus,
          skillName,
          breakdown,
          null
        );
      }
    });
  });

  const s = spirit;
  const parseScore = v => { const n = parseInt(v, 10); return Number.isFinite(n) ? Math.max(0, n) : 0; };

  // Helper: recompute and push derived values into the DOM without re-rendering
  const updateDerived = () => {
    const TL = parseScore(_viewingSpirit.stats?.technique?.score);
    const SL = parseScore(_viewingSpirit.stats?.speed?.score);
    const PL = parseScore(_viewingSpirit.stats?.power?.score);
    const ac = TL + SL;
    const hpMax      = 10 + (PL * 5);
    const ceMax      = 15 + (TL * 5);
    const movement   = 30 + (SL * 5);
    const healingDiceMap = { "5":0,"4":1,"Semi-3":1,"3":2,"Semi-2":2,"2":3,"Semi-1":3,"1":4,"Special Grade":5 };
    const healingDice = healingDiceMap[_viewingSpirit.grade] ?? 0;
    const healingStr = healingDice > 0 ? `${healingDice}d8 + ${TL}` : "N/A";
    const xpThreshold = parseScore(_viewingSpirit.sorcererXp) || TL * 2;

    // Persist computed values to state
    _viewingSpirit.hpMax    = String(hpMax);
    _viewingSpirit.ceMax    = String(ceMax);
    _viewingSpirit.movement = String(movement);

    const acInput = panel.querySelector(".ac-inside");
    if (acInput) acInput.value = ac;

    const hpMaxEl = panel.querySelector("#spiritHpMax");
    if (hpMaxEl) hpMaxEl.value = hpMax;

    const ceMaxEl = panel.querySelector("#spiritCeMax");
    if (ceMaxEl) ceMaxEl.value = ceMax;

    const movementEl = panel.querySelector("#spiritMovement");
    if (movementEl) movementEl.value = movement;

    const healStrEl = panel.querySelector(".spirit-healing-str");
    if (healStrEl) healStrEl.textContent = healingStr;

    const healBtn = panel.querySelector("#spiritHealBtn");
    if (healBtn) healBtn.disabled = healingDice === 0;

    const xpThreshEl = panel.querySelector(".spirit-xp-threshold-val");
    if (xpThreshEl) xpThreshEl.textContent = xpThreshold;

    // Also push to combat panel
    renderSpiritCombatPanel(_viewingSpirit);
  };

  const TL = parseScore(s.stats?.technique?.score);
  const SL = parseScore(s.stats?.speed?.score);
  const PL = parseScore(s.stats?.power?.score);
  const ac = TL + SL;
  const hpMax    = 10 + (PL * 5);
  const ceMax    = 15 + (TL * 5);
  const movement = 30 + (SL * 5);
  const healingDiceMap = { "5":0,"4":1,"Semi-3":1,"3":2,"Semi-2":2,"2":3,"Semi-1":3,"1":4,"Special Grade":5 };
  const healingDice = healingDiceMap[s.grade] ?? 0;
  const healingStr = healingDice > 0 ? `${healingDice}d8 + ${TL}` : "N/A";
  const xpThreshold = parseScore(s.sorcererXp) || TL * 2;

  // Sync computed vitals into state on open
  s.hpMax    = String(hpMax);
  s.ceMax    = String(ceMax);
  s.movement = String(movement);

  const esc = str => String(str ?? "")
    .replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");

  const GRADES = ["5","4","Semi-3","3","Semi-2","2","Semi-1","1","Special Grade"];
  const STATS = [
    { key:"power",        label:"POWER",        skills:["Athletics","Combat","Fortitude","Intimidation","Strength"] },
    { key:"speed",        label:"SPEED",        skills:["Precision","Reaction","Stealth","Tempo"] },
    { key:"technique",    label:"TECHNIQUE",    skills:["Acrobatics","Control","Survival","Talent"] },
    { key:"intelligence", label:"INTELLIGENCE", skills:["Cursed Technique Education","General Education","Medical Education","Perception","Tech Education"] },
    { key:"cooperation",  label:"COOPERATION",  skills:["Charisma","Combo","Deception","Insight","Persuasion"] },
  ];

  const renderStatBlock = (stat) => {
    const ss = s.stats?.[stat.key] || { score: "", skills: [] };
    return `
      <div class="stat-block">
        <div class="stat-score-side">
          <div class="stat-label">${esc(stat.label)}</div>
          <input class="stat-score-input" data-spirit-stat="${stat.key}" type="number" min="0" max="7"
            placeholder="—" value="${esc(ss.score)}" />
        </div>
        <div class="skills-side">
          ${stat.skills.map((skill, si) => {
            const skillScore = ss.skills?.[si]?.score ?? "";
            return `<div class="skill-row">
              <input class="skill-bonus-input" type="number" min="0"
                data-spirit-skill="${stat.key}:${si}"
                value="${esc(skillScore)}" placeholder="—" />
              <span class="skill-name">${esc(skill)}</span>
            </div>`;
          }).join("")}
        </div>
      </div>`;
  };

  panel.innerHTML = `
    <div class="spirit-sheet">
      <!-- Header -->
      <div class="header-grid">
        <div>
          <div class="jjk-label">呪術廻戦 · Cursed Spirit</div>
          <input class="name-input" id="spiritName" value="${esc(s.charName || "")}" placeholder="Spirit Name" />
          <div class="field-label">Spirit Name</div>
        </div>
        <div style="display:flex;align-items:center;justify-content:center;padding-top:4px;">
          <div class="crest"><div class="crest-inner">霊</div></div>
        </div>
        <div class="meta-grid">
          <div class="meta-field" style="grid-column:1/-1;">
            <div class="field-label">Grade</div>
            <select class="meta-select" id="spiritGrade">
              ${GRADES.map(g => `<option${s.grade === g ? " selected" : ""}>${esc(g)}</option>`).join("")}
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
              <div class="spirit-healing-str" id="spiritHealingValue" style="cursor:pointer;${healingDice === 0 ? 'opacity:0.5;pointer-events:none;' : ''}" title="Click to roll healing">${esc(healingStr)}</div>
            </div>
          </div>
        </div>
      </div>

      <div class="divider"></div>

      <!-- Main body -->
      <div class="main-body">

        <!-- Vitals column -->
        <div class="vitals-col">
          <div class="character-vital-box">
            <span class="vital-label">Health</span>
            <div class="hp-row">
              <input class="hp-input" id="spiritHpCurrent" type="number" min="0" value="${esc(s.hpCurrent)}" placeholder="0" />
              <span class="hp-sep">/</span>
              <input class="hp-input" id="spiritHpMax" type="number" value="${hpMax}" readonly style="cursor:default;" />
            </div>
          </div>
          <div class="character-vital-box">
            <span class="vital-label">Cursed Energy</span>
            <div class="hp-row">
              <input class="hp-input" id="spiritCeCurrent" type="number" min="0" value="${esc(s.ceCurrent)}" placeholder="0" />
              <span class="hp-sep">/</span>
              <input class="hp-input" id="spiritCeMax" type="number" value="${ceMax}" readonly style="cursor:default;" />
            </div>
          </div>
          <div class="character-vital-box">
            <div class="shield-wrap">
              <svg viewBox="0 0 60 68" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M30 4L5 13V36C5 50 17 62 30 66C43 62 55 50 55 36V13L30 4Z" stroke="#1a1410" stroke-width="1.8" fill="#e2d9c8"/>
                <path d="M30 9L9 17V36C9 48 19 58 30 62C41 58 51 48 51 36V17L30 9Z" stroke="#1a1410" stroke-width="0.8" fill="none" stroke-dasharray="2 2"/>
                <foreignObject x="11" y="22" width="38" height="28">
                  <div xmlns="http://www.w3.org/1999/xhtml" style="display:flex;align-items:center;justify-content:center;height:100%">
                    <input class="ac-inside" value="${esc(ac)}" readonly style="cursor:default;" />
                  </div>
                </foreignObject>
              </svg>
            </div>
            <div class="vital-label" style="text-align:center;margin-top:2px;">Armor Class</div>
          </div>
          <div class="character-vital-box">
            <span class="vital-label">Movement</span>
            <div class="move-row">
              <input class="move-input" id="spiritMovement" value="${movement}" readonly style="cursor:default;" />
              <span class="move-unit">ft</span>
            </div>
          </div>
        </div>

        <!-- Center stats: Power, Speed, Technique -->
        <div class="stats-col">
          ${STATS.slice(0,3).map(renderStatBlock).join("")}
        </div>

        <!-- Right stats: Intelligence, Cooperation -->
        <div class="intel-col">
          ${STATS.slice(3).map(renderStatBlock).join("")}
        </div>

      </div>
    </div>`;

  // ── EVENT WIRING ─────────────────────────────────────────────────────────────
  const save = () => { if (_spiritSave) _spiritSave(); };
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

  // Grade — update derived values in-place, no full re-render
  document.getElementById("spiritGrade")?.addEventListener("change", e => {
    _viewingSpirit.grade = e.target.value;
    updateDerived();
    save();
  });

  // Stat score inputs — update state and refresh derived values in-place
  panel.querySelectorAll("[data-spirit-stat]").forEach(input => {
    input.addEventListener("input", () => {
      const key = input.dataset.spiritStat;
      if (!_viewingSpirit.stats[key]) _viewingSpirit.stats[key] = { score: "", skills: [] };
      _viewingSpirit.stats[key].score = input.value;
      updateDerived();
      save();
    });
  });

  // Subskill score inputs
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

  // Healing value click — show roll toast and update CE
  panel.querySelector('#spiritHealingValue')?.addEventListener('click', () => {
    const TLnow = parseScore(_viewingSpirit.stats?.technique?.score);
    const healingDiceNow = healingDiceMap[_viewingSpirit.grade] ?? 0;
    const ce = parseInt(_viewingSpirit.ceCurrent, 10) || 0;
    if (ce < 5 || healingDiceNow === 0) return;
    _viewingSpirit.ceCurrent = String(ce - 5);
    // Update CE input in-place
    const ceInput = panel.querySelector('#spiritHpCurrent') ? panel.querySelector('#spiritCeCurrent') : null;
    if (ceInput) ceInput.value = _viewingSpirit.ceCurrent;
    let total = TLnow;
    const rolls = [];
    for (let i = 0; i < healingDiceNow; i++) {
      const r = Math.floor(Math.random() * 8) + 1;
      rolls.push(r);
      total += r;
    }
    // Show as roll toast (if available)
    if (typeof window.showRollToast === 'function') {
      window.showRollToast(
        'Technique',
        healingDiceNow,
        rolls,
        total,
        null,
        'Healing',
        { die: 'd8', skillModifier: TLnow },
        null
      );
    }
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
        <div id="spiritAbilitiesList" class="combat-attacks-list">
          <span class="combat-empty">No cursed abilities yet.</span>
        </div>
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