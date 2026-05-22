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
const SPIRIT_TABS    = ["spirit-sheet", "combat"]; // spirit gets its own dedicated panel and combat tab

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
// Called by main.js when the GM opens a spirit.
// Shows panel-spirit-sheet and panel-combat as top bar tabs.
export function enterSpiritSheet(spiritState, scheduleSave) {
  _viewingSpirit = spiritState;
  _spiritSave    = scheduleSave || null;

  applyGmLayout();
  _activateMainTab?.("spirit-sheet");
  renderSpiritSheetPanel(spiritState, "spirit-sheet");
}

function exitSpiritSheet() {
  if (_clearSheetState) _clearSheetState();
  _viewingSpirit = null;
  _spiritSave    = null;
  applyGmLayout();
  _activateMainTab?.("spirits");
}


// Renders the spirit sheet or combat panel depending on the activeTab
function renderSpiritSheetPanel(spirit, activeTab = "spirit-sheet") {
  const sheetPanel = document.getElementById("panel-spirit-sheet");
  const combatPanel = document.getElementById("panel-combat");
  if (!sheetPanel || !combatPanel) return;

  const s = spirit;
  const parseScore = v => { const n = parseInt(v, 10); return Number.isFinite(n) ? Math.max(0, n) : 0; };
  const TL = parseScore(s.stats?.technique?.score);
  const SL = parseScore(s.stats?.speed?.score);
  const IL = parseScore(s.stats?.intelligence?.score);
  const ac = TL + SL;
  const bfRange = (TL >= 2 && TL <= 7) ? TL * 4 + 4 : null;
  const imbueLevel = Math.max(1, Math.min(3, parseInt(s.imbueLevel, 10) || 1));
  const imbueDie = imbueLevel === 1 ? "1d4" : imbueLevel === 2 ? "1d4+2" : "2d4";
  const imbueDC = TL * 2;
  const xpThreshold = parseScore(s.sorcererXp) || TL * 2;
  const martialAvail = IL >= 4;
  const healingDiceMap = { "5":0,"4":1,"Semi-3":1,"3":2,"Semi-2":2,"2":3,"Semi-1":3,"1":4,"Special Grade":5 };
  const healingDice = healingDiceMap[s.grade] ?? 0;
  const healingStr = healingDice > 0 ? `${healingDice}d8 + ${TL} (TL)` : "N/A";

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
  const aptitudeLabels = ["○","◑","●"];

  // Main sheet content (matches player sheet layout)
  const sheetContent = `
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
        <div class="meta-field">
          <div class="field-label">Grade</div>
          <select class="meta-select" id="spiritGrade">
            ${GRADES.map(g => `<option${s.grade === g ? " selected" : ""}>${esc(g)}</option>`).join("")}
          </select>
        </div>
        <div class="meta-field">
          <div class="field-label">Age</div>
          <input class="meta-input" id="spiritAge" type="number" min="0" placeholder="—" value="${esc(s.age || "")}" />
        </div>
        <div class="header-mini-vitals">
          <div class="vital-box header-mini-vital">
            <span class="vital-label">Points</span>
            <div class="header-mini-value">
              <input class="header-mini-input" id="spiritXp" type="number" min="0" placeholder="0" value="${esc(s.xp || "0")}" />
            </div>
          </div>
          <div class="vital-box header-mini-vital">
            <span class="vital-label">XP Threshold</span>
            <div class="header-mini-value" style="font-family:'Cinzel',serif;font-size:13px;">${xpThreshold}</div>
          </div>
        </div>
      </div>
    </div>
    <div class="divider"></div>
    <div class="main-body">
      <div class="vitals-col">
        <div class="character-vital-box">
          <span class="vital-label">Health</span>
          <div class="hp-row">
            <input class="hp-input" id="spiritHpCurrent" type="number" min="0" value="${esc(s.hpCurrent)}" placeholder="0" />
            <span class="hp-sep">/</span>
            <input class="hp-input" id="spiritHpMax" type="number" min="0" value="${esc(s.hpMax)}" placeholder="0" />
          </div>
        </div>
        <div class="character-vital-box">
          <span class="vital-label">Cursed Energy</span>
          <div class="hp-row">
            <input class="hp-input" id="spiritCeCurrent" type="number" min="0" value="${esc(s.ceCurrent)}" placeholder="0" />
            <span class="hp-sep">/</span>
            <input class="hp-input" id="spiritCeMax" type="number" min="0" value="${esc(s.ceMax)}" placeholder="0" />
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
            <input class="move-input" id="spiritMovement" value="${esc(s.movement || "")}" placeholder="—" />
            <span class="move-unit">ft</span>
          </div>
        </div>
        <div class="character-vital-box spirit-healing-box">
          <span class="vital-label">Healing (5 CE)</span>
          <div class="spirit-healing-str">${esc(healingStr)}</div>
          <button class="inventory-mini-btn spirit-heal-btn" id="spiritHealBtn" type="button"
            ${healingDice === 0 ? "disabled" : ""}>Use</button>
        </div>
      </div>
      <div class="stats-col">
        ${STATS.slice(0,3).map(stat => {
          const ss = s.stats?.[stat.key] || { score:"", skills: stat.skills.map(()=>({aptitude:0})) };
          return `
            <div class="stat-block">
              <div class="stat-header">
                <span class="stat-label">${esc(stat.label)}</span>
                <input class="stat-score" data-spirit-stat="${stat.key}" type="number" min="0" max="7"
                  value="${esc(ss.score)}" placeholder="0" />
              </div>
              <div class="skill-list">
                ${stat.skills.map((skill, si) => {
                  const apt = Math.max(0, Math.min(2, parseInt(ss.skills?.[si]?.aptitude,10)||0));
                  return `<div class="skill-row">
                    <span class="skill-name">${esc(skill)}</span>
                    <button class="apt-dot-btn" data-spirit-apt="${stat.key}:${si}">${aptitudeLabels[apt]}</button>
                  </div>`;
                }).join("")}
              </div>
            </div>`;
        }).join("")}
      </div>
      <div class="intel-col">
        ${STATS.slice(3).map(stat => {
          const ss = s.stats?.[stat.key] || { score:"", skills: stat.skills.map(()=>({aptitude:0})) };
          return `
            <div class="stat-block">
              <div class="stat-header">
                <span class="stat-label">${esc(stat.label)}</span>
                <input class="stat-score" data-spirit-stat="${stat.key}" type="number" min="0" max="7"
                  value="${esc(ss.score)}" placeholder="0" />
              </div>
              <div class="skill-list">
                ${stat.skills.map((skill, si) => {
                  const apt = Math.max(0, Math.min(2, parseInt(ss.skills?.[si]?.aptitude,10)||0));
                  return `<div class="skill-row">
                    <span class="skill-name">${esc(skill)}</span>
                    <button class="apt-dot-btn" data-spirit-apt="${stat.key}:${si}">${aptitudeLabels[apt]}</button>
                  </div>`;
                }).join("")}
              </div>
            </div>`;
        }).join("")}
      </div>
    </div>`;

  // Combat content (matches player combat tab style)
  const combatContent = `
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
        <span class="combat-label" style="margin-bottom:0.5em;margin-top:0.1em;">Points Threshold</span>
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
    </div>`;

  // Show/hide panels based on activeTab
  if (activeTab === "spirit-sheet") {
    sheetPanel.innerHTML = `<div class="spirit-sheet">${sheetContent}</div>`;
    sheetPanel.style.display = "";
    combatPanel.style.display = "none";
  } else if (activeTab === "combat") {
    combatPanel.innerHTML = `<div class="spirit-sheet-combat">${combatContent}</div>`;
    combatPanel.style.display = "";
    sheetPanel.style.display = "none";
  }

  // Event wiring (same as before, but for both panels)
  const save = () => { if (_spiritSave) _spiritSave(); };
  const wire = (id, field) => {
    document.getElementById(id)?.addEventListener("input", e => {
      _viewingSpirit[field] = e.target.value;
      save();
    });
  };
  wire("spiritName",      "charName");
  wire("spiritAge",       "age");
  wire("spiritHpCurrent", "hpCurrent");
  wire("spiritHpMax",     "hpMax");
  wire("spiritCeCurrent", "ceCurrent");
  wire("spiritCeMax",     "ceMax");
  wire("spiritMovement",  "movement");
  wire("spiritXp",        "xp");
  document.getElementById("spiritHpCurrent2")?.addEventListener("input", e => {
    _viewingSpirit.hpCurrent = e.target.value; save();
  });
  document.getElementById("spiritCeCurrent2")?.addEventListener("input", e => {
    _viewingSpirit.ceCurrent = e.target.value; save();
  });
  document.getElementById("spiritImbueInput")?.addEventListener("input", e => {
    _viewingSpirit.imbueLevel = parseInt(e.target.value, 10) || 1;
    if (activeTab === "combat") renderSpiritSheetPanel(_viewingSpirit, "combat");
    save();
  });
  document.getElementById("spiritGrade")?.addEventListener("change", e => {
    _viewingSpirit.grade = e.target.value;
    renderSpiritSheetPanel(_viewingSpirit, activeTab);
    save();
  });
  document.querySelectorAll("[data-spirit-stat]").forEach(input => {
    input.addEventListener("input", () => {
      const key = input.dataset.spiritStat;
      if (!_viewingSpirit.stats[key]) _viewingSpirit.stats[key] = { score:"", skills:[] };
      _viewingSpirit.stats[key].score = input.value;
      save();
    });
  });
  document.querySelectorAll("[data-spirit-apt]").forEach(btn => {
    btn.addEventListener("click", () => {
      const [statKey, siStr] = btn.dataset.spiritApt.split(":");
      const si = parseInt(siStr, 10);
      if (!_viewingSpirit.stats[statKey]) _viewingSpirit.stats[statKey] = { score:"", skills:[] };
      const skills = _viewingSpirit.stats[statKey].skills;
      while (skills.length <= si) skills.push({ aptitude:0 });
      const cur = parseInt(skills[si].aptitude, 10) || 0;
      skills[si].aptitude = (cur + 1) % 3;
      btn.textContent = aptitudeLabels[skills[si].aptitude];
      save();
    });
  });
  document.getElementById("spiritHealBtn")?.addEventListener("click", () => {
    const ce = parseInt(_viewingSpirit.ceCurrent, 10) || 0;
    if (ce < 5 || healingDice === 0) return;
    _viewingSpirit.ceCurrent = String(ce - 5);
    let total = TL;
    const rolls = [];
    for (let i = 0; i < healingDice; i++) {
      const r = Math.floor(Math.random() * 8) + 1;
      rolls.push(r);
      total += r;
    }
    const resultStr = `${rolls.join(" + ")} + ${TL} (TL) = ${total}`;
    const healBox = document.querySelector(".spirit-healing-box");
    if (healBox) {
      const existing = healBox.querySelector(".spirit-heal-result");
      if (existing) existing.remove();
      const resultEl = document.createElement("div");
      resultEl.className = "spirit-heal-result combat-empty";
      resultEl.textContent = resultStr;
      healBox.appendChild(resultEl);
    }
    renderSpiritSheetPanel(_viewingSpirit, activeTab);
    save();
  });
}

  // ── EVENT WIRING ─────────────────────────────────────────────────────────────
  const save = () => { if (_spiritSave) _spiritSave(); };
  const wire = (id, field) => {
    document.getElementById(id)?.addEventListener("input", e => {
      _viewingSpirit[field] = e.target.value;
      save();
    });
  };

  // Subtab switching — preserves state on switch
  panel.querySelectorAll("[data-spirit-subtab]").forEach(btn => {
    btn.addEventListener("click", () => {
      renderSpiritSheetPanel(_viewingSpirit, btn.dataset.spiritSubtab);
    });
  });

  wire("spiritName",      "charName");
  wire("spiritAge",       "age");
  wire("spiritHpCurrent", "hpCurrent");
  wire("spiritHpMax",     "hpMax");
  wire("spiritCeCurrent", "ceCurrent");
  wire("spiritCeMax",     "ceMax");
  wire("spiritMovement",  "movement");
  wire("spiritXp",        "xp");

  // Combat tab HP/CE mirrors (keep in sync)
  document.getElementById("spiritHpCurrent2")?.addEventListener("input", e => {
    _viewingSpirit.hpCurrent = e.target.value; save();
  });
  document.getElementById("spiritCeCurrent2")?.addEventListener("input", e => {
    _viewingSpirit.ceCurrent = e.target.value; save();
  });

  // Imbue level
  document.getElementById("spiritImbueInput")?.addEventListener("input", e => {
    _viewingSpirit.imbueLevel = parseInt(e.target.value, 10) || 1;
    // Re-render combat tab to update die display
    if (activeSubtab === "combat") renderSpiritSheetPanel(_viewingSpirit, "combat");
    save();
  });

  // Grade
  document.getElementById("spiritGrade")?.addEventListener("change", e => {
    _viewingSpirit.grade = e.target.value;
    renderSpiritSheetPanel(_viewingSpirit, activeSubtab);
    save();
  });

  // Stat score inputs
  panel.querySelectorAll("[data-spirit-stat]").forEach(input => {
    input.addEventListener("input", () => {
      const key = input.dataset.spiritStat;
      if (!_viewingSpirit.stats[key]) _viewingSpirit.stats[key] = { score:"", skills:[] };
      _viewingSpirit.stats[key].score = input.value;
      save();
    });
  });

  // Aptitude buttons — reuse existing player apt-dot-btn class
  panel.querySelectorAll("[data-spirit-apt]").forEach(btn => {
    btn.addEventListener("click", () => {
      const [statKey, siStr] = btn.dataset.spiritApt.split(":");
      const si = parseInt(siStr, 10);
      if (!_viewingSpirit.stats[statKey]) _viewingSpirit.stats[statKey] = { score:"", skills:[] };
      const skills = _viewingSpirit.stats[statKey].skills;
      while (skills.length <= si) skills.push({ aptitude:0 });
      const cur = parseInt(skills[si].aptitude, 10) || 0;
      skills[si].aptitude = (cur + 1) % 3;
      btn.textContent = aptitudeLabels[skills[si].aptitude];
      // Update computed AC if TEC or SPD changed
      save();
    });
  });

  // Healing button
  document.getElementById("spiritHealBtn")?.addEventListener("click", () => {
    const ce = parseInt(_viewingSpirit.ceCurrent, 10) || 0;
    if (ce < 5 || healingDice === 0) return;
    _viewingSpirit.ceCurrent = String(ce - 5);
    let total = TL;
    const rolls = [];
    for (let i = 0; i < healingDice; i++) {
      const r = Math.floor(Math.random() * 8) + 1;
      rolls.push(r);
      total += r;
    }
    // Show roll result inline — replace alert with toast later
    const resultStr = `${rolls.join(" + ")} + ${TL} (TL) = ${total}`;
    const healBox = document.querySelector(".spirit-healing-box");
    if (healBox) {
      const existing = healBox.querySelector(".spirit-heal-result");
      if (existing) existing.remove();
      const resultEl = document.createElement("div");
      resultEl.className = "spirit-heal-result combat-empty";
      resultEl.textContent = resultStr;
      healBox.appendChild(resultEl);
    }
    renderSpiritSheetPanel(_viewingSpirit, activeSubtab);
    save();
  });

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
