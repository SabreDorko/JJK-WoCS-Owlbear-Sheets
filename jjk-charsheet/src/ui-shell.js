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
const SPIRIT_TABS    = ["spirit-sheet"]; // spirit gets its own dedicated panel

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

  // Render the spirit sheet into its dedicated panel
  renderSpiritSheetPanel(spiritState);

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

  // Import computeSpiritData lazily — spirit.js is loaded by main.js
  // We use a globally accessible version via window or we compute inline
  const s = spirit;
  const parseScore = v => { const n = parseInt(v, 10); return Number.isFinite(n) ? Math.max(0, n) : 0; };
  const TL = parseScore(s.stats?.technique?.score);
  const PL = parseScore(s.stats?.power?.score);
  const SL = parseScore(s.stats?.speed?.score);
  const IL = parseScore(s.stats?.intelligence?.score);
  const CL = parseScore(s.stats?.cooperation?.score);
  const ac = TL + SL;
  const bfRange = (TL >= 2 && TL <= 7) ? TL * 4 + 4 : null;
  const imbueLevel = Math.max(1, Math.min(3, parseInt(s.imbueLevel, 10) || 1));
  const imbueDie = imbueLevel === 1 ? "1d4" : imbueLevel === 2 ? "1d4+2" : "2d4";
  const imbueDC = TL * 2;
  const xpThreshold = parseScore(s.sorcererXp) || TL * 2;
  const martialAvail = IL >= 4;
  const healingDiceMap = { "5":0, "4":1, "Semi-3":1, "3":2, "Semi-2":2, "2":3, "Semi-1":3, "1":4, "Special Grade":5 };
  const healingDice = healingDiceMap[s.grade] ?? 0;
  const healingStr = healingDice > 0 ? `${healingDice}d8 + ${TL} (TL)` : "N/A";

  const esc = str => String(str ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");

  const GRADES = ["5","4","Semi-3","3","Semi-2","2","Semi-1","1","Special Grade"];
  const gradeOptions = GRADES.map(g => `<option${s.grade === g ? " selected" : ""}>${esc(g)}</option>`).join("");

  const STATS = [
    { key:"power",        label:"POWER",        skills:["Athletics","Combat","Fortitude","Intimidation","Strength"] },
    { key:"speed",        label:"SPEED",        skills:["Precision","Reaction","Stealth","Tempo"] },
    { key:"technique",    label:"TECHNIQUE",    skills:["Acrobatics","Control","Survival","Talent"] },
    { key:"intelligence", label:"INTELLIGENCE", skills:["Cursed Technique Education","General Education","Medical Education","Perception","Tech Education"] },
    { key:"cooperation",  label:"COOPERATION",  skills:["Charisma","Combo","Deception","Insight","Persuasion"] },
  ];

  const aptitudeLabels = ["○","◑","●"];

  panel.innerHTML = `
    <div class="spirit-sheet">

      <!-- ── Header ── -->
      <div class="spirit-header">
        <div class="spirit-header-name-row">
          <input class="name-input spirit-name-input" id="spiritName" value="${esc(s.charName || "")}" placeholder="Spirit Name" />
          <div class="meta-field">
            <div class="field-label">Grade</div>
            <select class="meta-select" id="spiritGrade">${gradeOptions}</select>
          </div>
        </div>
        <div class="spirit-vitals-row">
          <div class="vital-box spirit-vital">
            <span class="vital-label">HP</span>
            <div class="spirit-vital-track">
              <input class="spirit-vital-input" id="spiritHpCurrent" type="number" min="0" value="${esc(s.hpCurrent)}" placeholder="0" />
              <span class="spirit-vital-sep">/</span>
              <input class="spirit-vital-input" id="spiritHpMax" type="number" min="0" value="${esc(s.hpMax)}" placeholder="0" />
            </div>
          </div>
          <div class="vital-box spirit-vital">
            <span class="vital-label">CE</span>
            <div class="spirit-vital-track">
              <input class="spirit-vital-input" id="spiritCeCurrent" type="number" min="0" value="${esc(s.ceCurrent)}" placeholder="0" />
              <span class="spirit-vital-sep">/</span>
              <input class="spirit-vital-input" id="spiritCeMax" type="number" min="0" value="${esc(s.ceMax)}" placeholder="0" />
            </div>
          </div>
          <div class="vital-box spirit-vital">
            <span class="vital-label">AC</span>
            <div class="spirit-vital-value">${ac}</div>
          </div>
          <div class="vital-box spirit-vital">
            <span class="vital-label">Move</span>
            <div class="spirit-vital-value">${s.movement || "—"}</div>
          </div>
        </div>
      </div>

      <!-- ── Stats ── -->
      <div class="combat-actions-section">
        <div class="combat-section-title">Statistics</div>
        <div class="spirit-stats-grid">
          ${STATS.map(stat => {
            const statState = s.stats?.[stat.key] || { score: "", skills: stat.skills.map(() => ({ aptitude: 0 })) };
            const score = statState.score ?? "";
            return `
              <div class="spirit-stat-block">
                <div class="spirit-stat-header">
                  <span class="spirit-stat-label">${esc(stat.label)}</span>
                  <input class="spirit-stat-input" data-spirit-stat="${stat.key}" type="number" min="0" max="7" value="${esc(score)}" placeholder="—" />
                </div>
                <div class="spirit-skills-list">
                  ${stat.skills.map((skill, si) => {
                    const apt = parseInt(statState.skills?.[si]?.aptitude, 10) || 0;
                    const clamped = Math.max(0, Math.min(2, apt));
                    return `<div class="spirit-skill-row">
                      <span class="spirit-skill-name">${esc(skill)}</span>
                      <button class="spirit-apt-btn" data-spirit-apt="${stat.key}:${si}" title="Cycle aptitude">${aptitudeLabels[clamped]}</button>
                    </div>`;
                  }).join("")}
                </div>
              </div>`;
          }).join("")}
        </div>
      </div>

      <!-- ── Combat Block ── -->
      <div class="combat-actions-section">
        <div class="combat-section-title">Combat</div>
        <div class="spirit-combat-grid">
          <div class="spirit-combat-stat">
            <span class="vital-label">Imbue</span>
            <span class="spirit-combat-val">${esc(imbueDie)}</span>
            <span class="spirit-combat-sub">DC ${imbueDC}</span>
          </div>
          <div class="spirit-combat-stat">
            <span class="vital-label">Black Flash</span>
            <span class="spirit-combat-val">${bfRange != null ? bfRange : "—"}</span>
            <span class="spirit-combat-sub">Range</span>
          </div>
          <div class="spirit-combat-stat">
            <span class="vital-label">Points Threshold</span>
            <span class="spirit-combat-val">${xpThreshold}</span>
            <span class="spirit-combat-sub">Auto-pass below</span>
          </div>
          <div class="spirit-combat-stat spirit-healing-stat">
            <span class="vital-label">Healing (5 CE)</span>
            <span class="spirit-combat-val">${esc(healingStr)}</span>
            <button class="inventory-mini-btn spirit-heal-btn" id="spiritHealBtn" type="button"
              ${healingDice === 0 ? "disabled" : ""}>Use</button>
          </div>
        </div>
      </div>

      <!-- ── Cursed Abilities ── -->
      <div class="combat-actions-section">
        <div class="combat-section-title">Cursed Abilities</div>
        <div id="spiritAbilitiesList" class="combat-attacks-list">
          <span class="combat-empty">No cursed abilities yet.</span>
        </div>
        <button class="inventory-mini-btn" id="addSpiritAbilityBtn" type="button" style="margin-top:6px;">+ Add Ability</button>
      </div>

      <!-- ── Martial Arts (INT ≥ 4) ── -->
      <div class="combat-actions-section" id="spiritMartialSection" style="${martialAvail ? "" : "display:none;"}">
        <div class="combat-section-title">Martial Arts</div>
        <div class="combat-empty" style="font-style:italic;font-family:'Crimson Text',serif;font-size:13px;color:var(--ink-faint);">
          Martial arts editor — coming soon.
        </div>
      </div>

      <!-- ── Points / Cursed Skills ── -->
      <div class="combat-actions-section">
        <div class="combat-section-title" style="display:flex;justify-content:space-between;align-items:center;">
          <span>Cursed Skills</span>
          <span class="spirit-points-label">Points: <input class="spirit-points-input" id="spiritXp" type="number" min="0" value="${esc(s.xp || "0")}" /></span>
        </div>
        <div class="combat-empty" style="font-style:italic;font-family:'Crimson Text',serif;font-size:13px;color:var(--ink-faint);">
          Skill editor — coming soon.
        </div>
      </div>

    </div>`;

  // Wire inputs
  const wire = (id, field) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener("input", () => {
      _viewingSpirit[field] = el.value;
      if (_spiritSave) _spiritSave();
    });
  };

  wire("spiritName",      "charName");
  wire("spiritHpCurrent", "hpCurrent");
  wire("spiritHpMax",     "hpMax");
  wire("spiritCeCurrent", "ceCurrent");
  wire("spiritCeMax",     "ceMax");
  wire("spiritXp",        "xp");

  document.getElementById("spiritGrade")?.addEventListener("change", e => {
    _viewingSpirit.grade = e.target.value;
    // Re-render to update computed values
    renderSpiritSheetPanel(_viewingSpirit);
    if (_spiritSave) _spiritSave();
  });

  // Stat inputs
  panel.querySelectorAll("[data-spirit-stat]").forEach(input => {
    input.addEventListener("input", () => {
      const key = input.dataset.spiritStat;
      if (!_viewingSpirit.stats) _viewingSpirit.stats = {};
      if (!_viewingSpirit.stats[key]) _viewingSpirit.stats[key] = { score: "", skills: [] };
      _viewingSpirit.stats[key].score = input.value;
      if (_spiritSave) _spiritSave();
    });
  });

  // Aptitude cycle buttons
  panel.querySelectorAll("[data-spirit-apt]").forEach(btn => {
    btn.addEventListener("click", () => {
      const [statKey, siStr] = btn.dataset.spiritApt.split(":");
      const si = parseInt(siStr, 10);
      if (!_viewingSpirit.stats) _viewingSpirit.stats = {};
      if (!_viewingSpirit.stats[statKey]) _viewingSpirit.stats[statKey] = { score: "", skills: [] };
      const skills = _viewingSpirit.stats[statKey].skills;
      while (skills.length <= si) skills.push({ aptitude: 0 });
      const cur = parseInt(skills[si].aptitude, 10) || 0;
      skills[si].aptitude = (cur + 1) % 3;
      btn.textContent = aptitudeLabels[skills[si].aptitude];
      if (_spiritSave) _spiritSave();
    });
  });

  // Healing button
  document.getElementById("spiritHealBtn")?.addEventListener("click", () => {
    const ce = parseInt(_viewingSpirit.ceCurrent, 10) || 0;
    if (ce < 5) return;
    _viewingSpirit.ceCurrent = String(ce - 5);
    // Roll healing dice
    const dice = healingDiceMap[_viewingSpirit.grade] ?? 0;
    if (dice === 0) return;
    let total = 0;
    const rolls = [];
    for (let i = 0; i < dice; i++) {
      const r = Math.floor(Math.random() * 8) + 1;
      rolls.push(r);
      total += r;
    }
    total += TL;
    alert(`Healing: ${rolls.join(" + ")} + ${TL} (TL) = ${total}`);
    if (_spiritSave) _spiritSave();
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