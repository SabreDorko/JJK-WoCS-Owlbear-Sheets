// ── SPIRIT TECHNIQUES MODULE ──────────────────────────────────────────────────
// Manages Cursed Abilities for Cursed Spirits. Data shape is identical to
// techniques.js applications so saves are compatible.
//
// Spirits do NOT have:
//   - Output bonus (no outputLevel)
//   - Archetype bonuses
//   - Binding Vows or technique mode selection
//
// Spirits DO have:
//   - cursedAbilities[] on the spirit state object
//   - XP Threshold from spirit.sorcererXp or TEC × 2
//   - CE Current / CE Max tracked on the spirit directly
//   - "Imbue level" instead of output level (handled separately in ui-shell)

import { openSpiritRollModeMenu } from "./spirit.js";

// ── Injected dependencies ─────────────────────────────────────────────────────

let _getSpirit    = null;   // () => spirit state object
let _scheduleSave = null;   // () => void
let _showRollToast = null;  // window.showRollToast signature

export function initSpiritTechniques({ getSpirit, scheduleSave, showRollToast }) {
  _getSpirit    = getSpirit;
  _scheduleSave = scheduleSave;
  _showRollToast = showRollToast;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const APPLICATION_RANGE_TYPES = new Set(["self", "melee", "range", "aoe"]);
const APPLICATION_AOE_SHAPES  = ["cone", "cube", "sphere", "cylinder", "line"];
const ALLOWED_DICE            = [4, 6, 8, 10, 12, 20];

// ── Utilities ─────────────────────────────────────────────────────────────────

function nn(v) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? Math.max(0, n) : 0;
}

function esc(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function save() { if (_scheduleSave) _scheduleSave(); }

// ── State helpers ─────────────────────────────────────────────────────────────

function ensureAbilities(spirit) {
  if (!Array.isArray(spirit.cursedAbilities)) spirit.cursedAbilities = [];
}

function getAbilities(spirit) {
  ensureAbilities(spirit);
  return spirit.cursedAbilities;
}

function getTechScore(spirit) {
  return nn(spirit?.stats?.technique?.score);
}

function getXpThreshold(spirit) {
  return nn(spirit?.sorcererXp) || getTechScore(spirit) * 2;
}

function getCeCurrent(spirit) { return nn(spirit?.ceCurrent); }
function getCeMax(spirit)     { return nn(spirit?.ceMax); }

// ── Application data model (identical to techniques.js) ──────────────────────

export function createDefaultAbility(index) {
  return {
    title: `Ability ${index + 1}`,
    description: "",
    effect: "",
    ceCost: 0,
    dc: 0,
    rangeType: "self",
    rangeValue: "",
    aoeShape: "cone",
    aoeSize: "",
    scalingEnabled: false,
    scalingCeStep: 0,
    scalingDcStep: 0,
    currentStep: 0,
    damageParts: [],
    scalingDamageParts: [],
    addTechniqueLevel: false,
  };
}

function normalizeAbility(raw, index) {
  const fallback    = `Ability ${index + 1}`;
  const rangeTypeRaw = String(raw?.rangeType || "").trim().toLowerCase();
  const aoeShapeRaw  = String(raw?.aoeShape || "").trim().toLowerCase();
  const scalingEnabled = Boolean(raw?.scalingEnabled);
  const damageParts = Array.isArray(raw?.damageParts)
    ? raw.damageParts.map(p => ({ count: nn(p.count ?? 1), die: String(p.die || "").trim() }))
        .filter(p => p.die && nn(p.count) > 0)
    : [];
  const scalingDamageParts = Array.isArray(raw?.scalingDamageParts)
    ? raw.scalingDamageParts.map(p => ({ count: nn(p.count ?? 1), die: String(p.die || "").trim() }))
        .filter(p => p.die && nn(p.count) > 0)
    : [];

  return {
    title:            String(raw?.title || "").trim() || fallback,
    description:      String(raw?.description || "").trim(),
    effect:           String(raw?.effect || "").trim(),
    ceCost:           nn(raw?.ceCost),
    dc:               nn(raw?.dc),
    rangeType:        APPLICATION_RANGE_TYPES.has(rangeTypeRaw) ? rangeTypeRaw : "self",
    rangeValue:       String(raw?.rangeValue || "").trim(),
    aoeShape:         APPLICATION_AOE_SHAPES.includes(aoeShapeRaw) ? aoeShapeRaw : "cone",
    aoeSize:          String(raw?.aoeSize || "").trim(),
    scalingEnabled,
    scalingCeStep:    nn(raw?.scalingCeStep),
    scalingDcStep:    nn(raw?.scalingDcStep),
    currentStep:      scalingEnabled ? nn(raw?.currentStep) : 0,
    damageParts,
    scalingDamageParts,
    addTechniqueLevel: Boolean(raw?.addTechniqueLevel),
  };
}

function getScaled(app) {
  const step = app.scalingEnabled ? nn(app.currentStep) : 0;
  return {
    currentStep: step,
    ceCost: app.ceCost + (app.scalingEnabled ? app.scalingCeStep * step : 0),
    dc:     app.dc    + (app.scalingEnabled ? app.scalingDcStep    * step : 0),
  };
}

function getAoeShapeLabel(shape) {
  return { cone:"Cone", cube:"Cube", sphere:"Sphere", cylinder:"Cylinder", line:"Line" }[shape] ?? "Cone";
}

function getRangeSummary(app) {
  if (app.rangeType === "melee") return "Range: Melee";
  if (app.rangeType === "range") return app.rangeValue ? `Range: ${app.rangeValue}` : "Range: —";
  if (app.rangeType === "aoe")   return `AOE: ${getAoeShapeLabel(app.aoeShape)} (${app.aoeSize || "—"})`;
  return "Range: Self";
}

function getScalingSummary(app) {
  if (!app.scalingEnabled) return "Not scaling";
  return `+${app.scalingCeStep} CE / +${app.scalingDcStep} DC per step`;
}

// ── Button state ──────────────────────────────────────────────────────────────

function getButtonState(spirit, idx) {
  const ab      = getAbilities(spirit)[idx];
  if (!ab) return { disabled: false, isAutoPass: false, tooltip: "Use" };
  const norm    = normalizeAbility(ab, idx);
  const scaled  = getScaled(norm);
  const ceCost  = scaled.ceCost;
  const dc      = scaled.dc;
  const xpThr   = getXpThreshold(spirit);
  const ce      = getCeCurrent(spirit);

  if (ce < ceCost) return { disabled: true,  isAutoPass: false, tooltip: `Not enough CE (need ${ceCost})` };
  if (xpThr > 0 && dc < xpThr) return { disabled: false, isAutoPass: true,  tooltip: `Auto-pass (DC ${dc} < threshold ${xpThr})` };
  return { disabled: false, isAutoPass: false, tooltip: "Roll talent check" };
}

// ── Expanded / snapshot tracking ──────────────────────────────────────────────

const _expandedIndices = new Map();   // idx → snapshot of ability before edit
let _pendingNewIdx     = null;

// ── Cast logic ────────────────────────────────────────────────────────────────

function performCast(spirit, idx) {
  const abilities = getAbilities(spirit);
  const ab = abilities[idx];
  if (!ab) return;

  const norm    = normalizeAbility(ab, idx);
  const scaled  = getScaled(norm);
  const ceCost  = scaled.ceCost;
  const dc      = scaled.dc;
  const xpThr   = getXpThreshold(spirit);
  const TL      = getTechScore(spirit);
  const ce      = getCeCurrent(spirit);

  if (ce < ceCost) return;

  // Auto-pass branch
  if (xpThr > 0 && dc < xpThr) {
    spirit.ceCurrent = String(Math.max(0, ce - ceCost));
    if (norm.scalingEnabled && norm.currentStep > 0) ab.currentStep = 0;
    _syncCeDisplay(spirit);
    save();
    _showAutoPassToast(norm.title);
    return;
  }

  // Damage branch
  let damageParts = [...(norm.damageParts || [])];
  if (norm.scalingEnabled && norm.currentStep > 0 && norm.scalingDamageParts.length) {
    for (let i = 0; i < norm.currentStep; i++) damageParts = damageParts.concat(norm.scalingDamageParts);
  }
  if (!damageParts.length) damageParts = [{ count: 1, die: "d6" }];

  const techBonus = norm.addTechniqueLevel ? TL : 0;
  const damageResults = damageParts.map(part => {
    const sides = parseInt(String(part.die).match(/d(\d+)/i)?.[1] ?? "6", 10);
    const rolls  = Array.from({ length: part.count }, () => Math.floor(Math.random() * sides) + 1);
    return { ...part, rolls, total: rolls.reduce((a, b) => a + b, 0) };
  });
  const damageTotal = damageResults.reduce((s, r) => s + r.total, 0) + techBonus;

  const dieGroups = damageResults.map(r => ({ label: `${r.count}${r.die}`, rolls: r.rolls, total: r.total }));
  if (norm.addTechniqueLevel && techBonus) dieGroups.push({ label: "Technique Level", rolls: [`+${TL}`], total: techBonus });

  const breakdown = { skillModifier: 0, die: damageResults[0]?.die || "d6", dieGroups, total: damageTotal };

  if (_showRollToast) {
    const label = `${norm.title}${scaled.currentStep > 0 ? ` (Step ${scaled.currentStep})` : ""}`;
    _showRollToast(label + " (Damage)", null, null, damageTotal, null, "Damage", breakdown, null);
  }

  spirit.ceCurrent = String(Math.max(0, ce - ceCost));
  if (norm.scalingEnabled && norm.currentStep > 0) ab.currentStep = 0;
  _syncCeDisplay(spirit);
  save();
}

function performTalentCheck(spirit, idx, rollMode = "normal") {
  const abilities = getAbilities(spirit);
  const ab = abilities[idx];
  if (!ab) return;

  const norm    = normalizeAbility(ab, idx);
  const scaled  = getScaled(norm);
  const ceCost  = scaled.ceCost;
  const dc      = scaled.dc;
  const xpThr   = getXpThreshold(spirit);
  const TL      = getTechScore(spirit);
  const ce      = getCeCurrent(spirit);

  if (!TL || TL < 1) return;
  if (ce < ceCost) return;

  // Auto-pass shortcut
  if (xpThr > 0 && dc < xpThr) {
    performCast(spirit, idx);
    return;
  }

  // Roll TL d6 + Talent skill bonus (technique skill index 3)
  const talentBonus = nn(spirit?.stats?.technique?.skills?.[3]?.score);
  const bonus       = talentBonus;

  function rollPool() {
    return Array.from({ length: TL }, () => Math.floor(Math.random() * 6) + 1);
  }
  const compute = rolls => rolls.reduce((a, b) => a + b, 0) + bonus;

  const first    = rollPool();
  const firstTot = compute(first);
  let rolls, total, comparedRolls, comparedTotals, selectedRollIndex;

  if (rollMode === "normal") {
    rolls = first; total = firstTot;
    comparedRolls = null; comparedTotals = null; selectedRollIndex = 0;
  } else {
    const second    = rollPool();
    const secondTot = compute(second);
    const idx2      = rollMode === "advantage"
      ? (firstTot >= secondTot ? 0 : 1)
      : (firstTot <= secondTot ? 0 : 1);
    rolls = idx2 === 0 ? first : second;
    total = idx2 === 0 ? firstTot : secondTot;
    comparedRolls = [first, second]; comparedTotals = [firstTot, secondTot]; selectedRollIndex = idx2;
  }

  const allOnes = rolls.every(d => d === 1);
  const passed  = allOnes ? false : total >= dc;

  let toastStatus = allOnes ? "fail" : passed ? "pass" : "miss";

  const breakdown = rollMode === "normal"
    ? { skillModifier: bonus, die: "d6" }
    : { skillModifier: bonus, die: "d6", rollMode, comparedRolls, comparedTotals, selectedRollIndex };

  if (_showRollToast) {
    _showRollToast(norm.title, TL, rolls, total, toastStatus, "Talent Check", breakdown, rollMode === "normal" ? null : rollMode);
  }

  if (passed) {
    spirit.ceCurrent = String(Math.max(0, ce - ceCost));
    _syncCeDisplay(spirit);

    // Roll damage automatically after a passed check
    let damageParts = [...(norm.damageParts || [])];
    if (norm.scalingEnabled && norm.currentStep > 0 && norm.scalingDamageParts.length) {
      for (let i = 0; i < norm.currentStep; i++) damageParts = damageParts.concat(norm.scalingDamageParts);
    }
    if (damageParts.length) {
      const techBonus  = norm.addTechniqueLevel ? TL : 0;
      const dmgResults = damageParts.map(part => {
        const sides = parseInt(String(part.die).match(/d(\d+)/i)?.[1] ?? "6", 10);
        const r = Array.from({ length: part.count }, () => Math.floor(Math.random() * sides) + 1);
        return { ...part, rolls: r, total: r.reduce((a, b) => a + b, 0) };
      });
      const dmgTotal = dmgResults.reduce((s, r) => s + r.total, 0) + techBonus;
      const dieGroups = dmgResults.map(r => ({ label: `${r.count}${r.die}`, rolls: r.rolls, total: r.total }));
      if (norm.addTechniqueLevel && techBonus) dieGroups.push({ label: "Technique Level", rolls: [`+${TL}`], total: techBonus });
      const dmgBreakdown = { skillModifier: 0, die: dmgResults[0]?.die || "d6", dieGroups, total: dmgTotal };
      if (_showRollToast) {
        _showRollToast(norm.title + " (Damage)", null, null, dmgTotal, null, "Damage", dmgBreakdown, null);
      }
    }

    if (norm.scalingEnabled && norm.currentStep > 0) ab.currentStep = 0;
  }

  save();
  renderAbilitiesSummary();
  _syncButtonStates();
}

function rollDamageOnly(spirit, idx) {
  const abilities = getAbilities(spirit);
  const ab = abilities[idx];
  if (!ab) return;

  const norm   = normalizeAbility(ab, idx);
  const TL     = getTechScore(spirit);
  const scaled = getScaled(norm);

  // Aggregate damage dice by type
  const diceMap = new Map();
  (norm.damageParts || []).forEach(p => {
    if (!p.die) return;
    diceMap.set(p.die, (diceMap.get(p.die) || 0) + nn(p.count));
  });
  if (norm.scalingEnabled && norm.currentStep > 0) {
    (norm.scalingDamageParts || []).forEach(p => {
      if (!p.die) return;
      diceMap.set(p.die, (diceMap.get(p.die) || 0) + nn(p.count) * norm.currentStep);
    });
  }
  const damageParts = Array.from(diceMap.entries()).filter(([, c]) => c > 0).map(([die, count]) => ({ count, die }));
  if (!damageParts.length) return;

  const techBonus = norm.addTechniqueLevel ? TL : 0;
  const results   = damageParts.map(part => {
    const sides = parseInt(String(part.die).match(/d(\d+)/i)?.[1] ?? "6", 10);
    const rolls  = Array.from({ length: part.count }, () => Math.floor(Math.random() * sides) + 1);
    return { ...part, rolls, total: rolls.reduce((a, b) => a + b, 0) };
  });
  const total = results.reduce((s, r) => s + r.total, 0) + techBonus;
  const dieGroups = results.map(r => ({ label: `${r.count}${r.die}`, rolls: r.rolls, total: r.total }));
  if (norm.addTechniqueLevel && techBonus) dieGroups.push({ label: "Technique Level", rolls: [`+${TL}`], total: techBonus });
  const breakdown = { skillModifier: 0, die: results[0]?.die || "d6", dieGroups, total };

  if (_showRollToast) {
    const label = `${norm.title}${scaled.currentStep > 0 ? ` (Step ${scaled.currentStep})` : ""}`;
    _showRollToast(label, null, null, total, null, "Damage", breakdown, null);
  }
}

// ── CE sync ───────────────────────────────────────────────────────────────────

function _syncCeDisplay(spirit) {
  ["spiritCeCurrent", "spiritCeCurrent2"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = spirit.ceCurrent;
  });
}

function _showAutoPassToast(title) {
  const container = document.getElementById("rollToastContainer");
  if (!container) return;
  const toast = document.createElement("div");
  toast.className = "roll-toast auto-pass";
  toast.style.cssText = "background:#dee5df;border:1px solid #1a5f7a;";
  toast.innerHTML = `
    <div class="roll-toast-title">${esc(title)} (Cast)</div>
    <div class="roll-toast-body"><div style="color:#1a4a8b;font-family:'Cinzel',serif;font-size:10px;margin-top:3px;">✦ PASS (XP Threshold)</div></div>
  `;
  container.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add("show"));
  while (container.children.length > 5) container.removeChild(container.firstElementChild);
  setTimeout(() => { toast.classList.remove("show"); setTimeout(() => toast.remove(), 220); }, 4200);
}

// ── Render: view card ─────────────────────────────────────────────────────────

function renderViewCard(spirit, ab, idx) {
  const norm    = normalizeAbility(ab, idx);
  const scaled  = getScaled(norm);
  const btnSt   = getButtonState(spirit, idx);
  const costTxt = scaled.ceCost > 0 ? String(scaled.ceCost) : "—";
  const dcTxt   = scaled.dc    > 0 ? String(scaled.dc)    : "—";
  const range   = getRangeSummary(norm);
  const hasDmg  = norm.damageParts.length > 0;
  const dmgSummary = hasDmg ? norm.damageParts.map(p => `${p.count > 1 ? p.count : ""}${p.die}`).join(" + ") : "";

  const btnClasses = [
    "techniques-app-cast-btn",
    btnSt.isAutoPass ? "techniques-app-cast-btn--auto-pass" : "",
  ].filter(Boolean).join(" ");

  const star = btnSt.isAutoPass ? "✦ " : "";

  return `
    <article class="techniques-app-card" data-ability-idx="${idx}">
      <button type="button" class="techniques-app-card-edit-btn" data-ability-edit-toggle="${idx}"
        aria-label="Edit" title="Edit">&#9998;</button>
      <h4 class="techniques-app-card-title">${esc(norm.title)}</h4>

      <div class="techniques-app-metrics">
        <span class="techniques-app-metric"><strong>CE Cost:</strong>
          <span data-ability-cost-val="${idx}">${costTxt}</span></span>
        <span class="techniques-app-metric"><strong>DC:</strong>
          <span data-ability-dc-val="${idx}">${dcTxt}</span></span>
        <span class="techniques-app-metric">
          <strong>${range.startsWith("AOE") ? "AOE" : "Range"}:</strong>
          ${range.replace(/^AOE:\s*|^Range:\s*/, "")}
        </span>
        ${norm.scalingEnabled ? `<span class="techniques-app-metric"><strong>Scaling:</strong>
          <span data-ability-scaling-summary="${idx}">${getScalingSummary(norm)}</span></span>` : ""}
      </div>

      ${norm.effect ? `<div class="techniques-app-effect"><strong>Effect:</strong> ${esc(norm.effect)}</div>` : ""}
      ${norm.description ? `<p class="techniques-app-card-desc">${esc(norm.description)}</p>` : ""}

      <div class="techniques-app-card-footer">
        <div class="techniques-app-footer-left">
          ${norm.scalingEnabled ? `
            <div class="techniques-app-stepper">
              <button type="button" class="techniques-app-step-btn" data-ability-step-down="${idx}"
                ${scaled.currentStep <= 0 ? "disabled" : ""}>-</button>
              <span class="techniques-app-step-label" data-ability-step-label="${idx}">Step ${scaled.currentStep}</span>
              <button type="button" class="techniques-app-step-btn" data-ability-step-up="${idx}">+</button>
            </div>` : ""}
        </div>
        <div class="techniques-app-footer-right">
          ${hasDmg ? `<button type="button" class="techniques-app-cast-btn techniques-app-damage-btn"
            data-ability-damage="${idx}" title="Roll Damage${dmgSummary ? ` (${dmgSummary})` : ""}">Damage</button>` : ""}
          <button type="button" class="${btnClasses}" data-ability-cast="${idx}"
            title="${esc(btnSt.tooltip)}"${btnSt.disabled ? " disabled" : ""}>${star}Use</button>
        </div>
      </div>
    </article>`;
}

// ── Render: expanded edit card ────────────────────────────────────────────────

function renderExpandedCard(norm, idx) {
  const damageRows = (norm.damageParts.length ? norm.damageParts : []).map((part, i) => `
    <div style="display:flex;align-items:center;gap:4px;">
      <input type="number" min="1" step="1" class="meta-input" style="width:36px;"
        data-ability-dmg-count="${idx}:${i}" value="${part.count}" />
      <span>d</span>
      <select class="meta-select" style="width:44px;" data-ability-dmg-die="${idx}:${i}">
        ${ALLOWED_DICE.map(d => `<option value="d${d}"${String(part.die).toLowerCase() === `d${d}` ? " selected" : ""}>d${d}</option>`).join("")}
      </select>
      <button type="button" class="inventory-mini-btn danger" data-ability-remove-dmg="${idx}:${i}">&times;</button>
    </div>`).join("") + `<button type="button" class="inventory-mini-btn" data-ability-add-dmg="${idx}">+ Add</button>`;

  const scalingDamageRows = norm.scalingEnabled
    ? (norm.scalingDamageParts.length ? norm.scalingDamageParts : []).map((part, i) => `
    <div style="display:flex;align-items:center;gap:4px;">
      <input type="number" min="1" step="1" class="meta-input" style="width:36px;"
        data-ability-scale-dmg-count="${idx}:${i}" value="${part.count}" />
      <span>d</span>
      <select class="meta-select" style="width:44px;" data-ability-scale-dmg-die="${idx}:${i}">
        ${ALLOWED_DICE.map(d => `<option value="d${d}"${String(part.die).toLowerCase() === `d${d}` ? " selected" : ""}>d${d}</option>`).join("")}
      </select>
      <button type="button" class="inventory-mini-btn danger" data-ability-remove-scale-dmg="${idx}:${i}">&times;</button>
    </div>`).join("") + `<button type="button" class="inventory-mini-btn" data-ability-add-scale-dmg="${idx}">+ Add Scaling Die</button>`
    : "";

  return `
    <article class="techniques-app-card techniques-app-card--editing" data-ability-idx="${idx}">
      <div class="techniques-app-edit-grid">
        <label class="techniques-field">
          <span class="field-label">Title</span>
          <input class="meta-input techniques-app-card-field" data-ability-title-inline="${idx}" value="${esc(norm.title)}" />
        </label>
        <label class="techniques-field">
          <span class="field-label">CE Cost</span>
          <input class="meta-input techniques-app-card-field" type="number" min="0" step="1"
            data-ability-cost-inline="${idx}" value="${norm.ceCost}" />
        </label>
        <label class="techniques-field">
          <span class="field-label">DC</span>
          <input class="meta-input techniques-app-card-field" type="number" min="0" step="1"
            data-ability-dc-inline="${idx}" value="${norm.dc}" />
        </label>
        <label class="techniques-field techniques-field--checkbox">
          <span class="field-label">Scaling</span>
          <input class="techniques-checkbox" type="checkbox"
            data-ability-scaling-inline="${idx}"${norm.scalingEnabled ? " checked" : ""} />
        </label>
        ${norm.scalingEnabled ? `
        <label class="techniques-field">
          <span class="field-label">CE / Step</span>
          <input class="meta-input techniques-app-card-field" type="number" min="0" step="1"
            data-ability-scaling-ce-inline="${idx}" value="${norm.scalingCeStep}" />
        </label>
        <label class="techniques-field">
          <span class="field-label">DC / Step</span>
          <input class="meta-input techniques-app-card-field" type="number" min="0" step="1"
            data-ability-scaling-dc-inline="${idx}" value="${norm.scalingDcStep}" />
        </label>` : ""}
        <label class="techniques-field">
          <span class="field-label">Damage Dice</span>
          <div style="display:flex;flex-direction:column;gap:2px;">${damageRows}</div>
        </label>
        ${norm.scalingEnabled ? `
        <label class="techniques-field">
          <span class="field-label">Scaling Damage (per step)</span>
          <div style="display:flex;flex-direction:column;gap:2px;">${scalingDamageRows}</div>
        </label>` : ""}
        <label class="techniques-field techniques-field--checkbox">
          <span class="field-label">Add Technique Level</span>
          <input class="techniques-checkbox" type="checkbox"
            data-ability-add-tl-inline="${idx}"${norm.addTechniqueLevel ? " checked" : ""} />
        </label>
        <label class="techniques-field">
          <span class="field-label">Range Type</span>
          <select class="meta-select techniques-app-card-field" data-ability-range-type-inline="${idx}">
            <option value="self"${norm.rangeType === "self" ? " selected" : ""}>Self</option>
            <option value="melee"${norm.rangeType === "melee" ? " selected" : ""}>Melee</option>
            <option value="range"${norm.rangeType === "range" ? " selected" : ""}>Range</option>
            <option value="aoe"${norm.rangeType === "aoe" ? " selected" : ""}>AOE</option>
          </select>
        </label>
        ${norm.rangeType === "range" ? `
        <label class="techniques-field">
          <span class="field-label">Range</span>
          <input class="meta-input techniques-app-card-field"
            data-ability-range-inline="${idx}" value="${esc(norm.rangeValue)}" placeholder="30 ft" />
        </label>` : ""}
        ${norm.rangeType === "aoe" ? `
        <label class="techniques-field">
          <span class="field-label">AOE Shape</span>
          <select class="meta-select techniques-app-card-field" data-ability-aoe-shape-inline="${idx}">
            ${APPLICATION_AOE_SHAPES.map(s => `<option value="${s}"${norm.aoeShape === s ? " selected" : ""}>${getAoeShapeLabel(s)}</option>`).join("")}
          </select>
        </label>
        <label class="techniques-field">
          <span class="field-label">AOE Size</span>
          <input class="meta-input techniques-app-card-field"
            data-ability-aoe-size-inline="${idx}" value="${esc(norm.aoeSize)}" placeholder="15 ft radius" />
        </label>` : ""}
      </div>
      <label class="techniques-field">
        <span class="field-label">Effect</span>
        <textarea class="inventory-textarea techniques-app-card-field" rows="3" maxlength="700"
          data-ability-effect-inline="${idx}">${esc(norm.effect)}</textarea>
      </label>
      <label class="techniques-field">
        <span class="field-label">Notes</span>
        <textarea class="inventory-textarea techniques-app-card-field" rows="3" maxlength="360"
          data-ability-desc-inline="${idx}">${esc(norm.description)}</textarea>
      </label>
      <div class="techniques-app-card-footer">
        <button type="button" class="inventory-mini-btn inventory-icon-btn danger" data-ability-remove-inline="${idx}"
          title="Delete ability" aria-label="Delete ability">
          <svg class="inventory-icon-trash" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path fill="currentColor" d="M9 3h6a1 1 0 0 1 1 1v1h4v2h-1l-1 12a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 7H4V5h4V4a1 1 0 0 1 1-1Zm1 2v0h4V5h-4Zm-1 4h2v9H9V9Zm4 0h2v9h-2V9Z"/>
            <path fill="none" stroke="currentColor" stroke-width="1.5" d="M6 7.5h12"/>
          </svg>
        </button>
        <button type="button" class="inventory-secondary-btn" data-ability-cancel-inline="${idx}">Cancel</button>
        <button type="button" class="meta-toggle-btn techniques-app-save-btn" data-ability-save-inline="${idx}">Save</button>
      </div>
    </article>`;
}

// ── Render: full grid ─────────────────────────────────────────────────────────

export function renderAbilitiesSummary() {
  const spirit = _getSpirit?.();
  const grid   = document.getElementById("spiritAbilitiesList");
  if (!grid || !spirit) return;

  const abilities = getAbilities(spirit);

  if (!abilities.length) {
    grid.innerHTML = '<div class="techniques-app-empty">No cursed abilities yet. Click + Add Ability to create one.</div>';
    return;
  }

  grid.innerHTML = abilities.map((ab, idx) => {
    if (_expandedIndices.has(idx)) return renderExpandedCard(normalizeAbility(ab, idx), idx);
    return renderViewCard(spirit, ab, idx);
  }).join("");
}

function _syncButtonStates() {
  const spirit = _getSpirit?.();
  const grid   = document.getElementById("spiritAbilitiesList");
  if (!grid || !spirit) return;

  getAbilities(spirit).forEach((ab, idx) => {
    const card = grid.querySelector(`[data-ability-idx="${idx}"]`);
    if (!card || card.classList.contains("techniques-app-card--editing")) return;

    const norm    = normalizeAbility(ab, idx);
    const scaled  = getScaled(norm);
    const btnSt   = getButtonState(spirit, idx);

    const castBtn      = card.querySelector(`[data-ability-cast="${idx}"]`);
    const costVal      = card.querySelector(`[data-ability-cost-val="${idx}"]`);
    const dcVal        = card.querySelector(`[data-ability-dc-val="${idx}"]`);
    const scalingSum   = card.querySelector(`[data-ability-scaling-summary="${idx}"]`);
    const stepLabel    = card.querySelector(`[data-ability-step-label="${idx}"]`);
    const stepDown     = card.querySelector(`[data-ability-step-down="${idx}"]`);

    if (costVal)    costVal.textContent    = scaled.ceCost > 0 ? String(scaled.ceCost) : "—";
    if (dcVal)      dcVal.textContent      = scaled.dc    > 0 ? String(scaled.dc)    : "—";
    if (scalingSum) scalingSum.textContent = getScalingSummary(norm);
    if (stepLabel)  stepLabel.textContent  = `Step ${scaled.currentStep}`;
    if (stepDown)   stepDown.disabled      = scaled.currentStep <= 0;

    if (castBtn) {
      castBtn.classList.toggle("techniques-app-cast-btn--auto-pass", btnSt.isAutoPass);
      castBtn.disabled = btnSt.disabled;
      castBtn.title    = btnSt.tooltip;
      castBtn.textContent = btnSt.isAutoPass ? "✦ Use" : "Use";
    }
  });
}

// ── Wire up the ability grid ──────────────────────────────────────────────────

export function wireSpiritAbilitiesGrid(addBtnId = "addSpiritAbilityBtn") {
  const grid = document.getElementById("spiritAbilitiesList");
  if (!grid) return;

  // Add button
  document.getElementById(addBtnId)?.addEventListener("click", () => {
    const spirit = _getSpirit?.();
    if (!spirit) return;
    ensureAbilities(spirit);
    const newIdx = spirit.cursedAbilities.length;
    spirit.cursedAbilities.push(createDefaultAbility(newIdx));
    _expandedIndices.set(newIdx, JSON.parse(JSON.stringify(spirit.cursedAbilities[newIdx])));
    _pendingNewIdx = newIdx;
    save();
    renderAbilitiesSummary();
  });

  // All events on the grid use delegation

  // ── click ──────────────────────────────────────────────────────────────────
  grid.addEventListener("click", e => {
    if (!["INPUT","SELECT","TEXTAREA"].includes(e.target.tagName)) {
      e.preventDefault(); e.stopPropagation();
    }

    const spirit = _getSpirit?.();
    if (!spirit) return;
    ensureAbilities(spirit);

    // Edit toggle
    const editToggle = e.target.closest("[data-ability-edit-toggle]");
    if (editToggle) {
      const idx = nn(editToggle.dataset.abilityEditToggle);
      _expandedIndices.set(idx, JSON.parse(JSON.stringify(spirit.cursedAbilities[idx] || {})));
      renderAbilitiesSummary();
      return;
    }

    // Save inline
    const saveTrigger = e.target.closest("[data-ability-save-inline]");
    if (saveTrigger) {
      const idx = nn(saveTrigger.dataset.abilitySaveInline);
      _expandedIndices.delete(idx);
      if (_pendingNewIdx === idx) _pendingNewIdx = null;
      save();
      renderAbilitiesSummary();
      return;
    }

    // Cancel inline
    const cancelTrigger = e.target.closest("[data-ability-cancel-inline]");
    if (cancelTrigger) {
      const idx  = nn(cancelTrigger.dataset.abilityCancelInline);
      const snap = _expandedIndices.get(idx);
      _expandedIndices.delete(idx);
      if (snap && spirit.cursedAbilities[idx]) spirit.cursedAbilities[idx] = { ...snap };
      // If it was a brand new unsaved ability, remove it
      if (_pendingNewIdx === idx) {
        spirit.cursedAbilities.splice(idx, 1);
        _pendingNewIdx = null;
        save();
      }
      renderAbilitiesSummary();
      return;
    }

    // Delete inline
    const deleteTrigger = e.target.closest("[data-ability-remove-inline]");
    if (deleteTrigger) {
      const idx = nn(deleteTrigger.dataset.abilityRemoveInline);
      spirit.cursedAbilities.splice(idx, 1);
      _expandedIndices.clear();
      _pendingNewIdx = null;
      save();
      renderAbilitiesSummary();
      return;
    }

    // Cast
    const castBtn = e.target.closest("[data-ability-cast]");
    if (castBtn && !castBtn.disabled) {
      const idx = nn(castBtn.dataset.abilityCast);
      performTalentCheck(spirit, idx, "normal");
      return;
    }

    // Damage only
    const dmgBtn = e.target.closest("[data-ability-damage]");
    if (dmgBtn) {
      const idx = nn(dmgBtn.dataset.abilityDamage);
      rollDamageOnly(spirit, idx);
      return;
    }

    // Step up / down
    const stepUp = e.target.closest("[data-ability-step-up]");
    if (stepUp) {
      const idx = nn(stepUp.dataset.abilityStepUp);
      const ab = spirit.cursedAbilities[idx];
      if (ab && ab.scalingEnabled) { ab.currentStep = nn(ab.currentStep) + 1; save(); _syncButtonStates(); }
      return;
    }
    const stepDown = e.target.closest("[data-ability-step-down]");
    if (stepDown) {
      const idx = nn(stepDown.dataset.abilityStepDown);
      const ab = spirit.cursedAbilities[idx];
      if (ab && ab.scalingEnabled && nn(ab.currentStep) > 0) { ab.currentStep = nn(ab.currentStep) - 1; save(); _syncButtonStates(); }
      return;
    }

    // Add damage die
    const addDmg = e.target.closest("[data-ability-add-dmg]");
    if (addDmg) {
      const idx = nn(addDmg.dataset.abilityAddDmg);
      const ab = spirit.cursedAbilities[idx];
      if (ab) { if (!Array.isArray(ab.damageParts)) ab.damageParts = []; ab.damageParts.push({ count: 1, die: "d6" }); save(); renderAbilitiesSummary(); }
      return;
    }
    const removeDmg = e.target.closest("[data-ability-remove-dmg]");
    if (removeDmg) {
      const [ai, pi] = removeDmg.dataset.abilityRemoveDmg.split(":").map(Number);
      const ab = spirit.cursedAbilities[ai];
      if (ab && Array.isArray(ab.damageParts)) { ab.damageParts.splice(pi, 1); save(); renderAbilitiesSummary(); }
      return;
    }

    // Add scaling damage die
    const addScaleDmg = e.target.closest("[data-ability-add-scale-dmg]");
    if (addScaleDmg) {
      const idx = nn(addScaleDmg.dataset.abilityAddScaleDmg);
      const ab = spirit.cursedAbilities[idx];
      if (ab) { if (!Array.isArray(ab.scalingDamageParts)) ab.scalingDamageParts = []; ab.scalingDamageParts.push({ count: 1, die: "d6" }); save(); renderAbilitiesSummary(); }
      return;
    }
    const removeScaleDmg = e.target.closest("[data-ability-remove-scale-dmg]");
    if (removeScaleDmg) {
      const [ai, pi] = removeScaleDmg.dataset.abilityRemoveScaleDmg.split(":").map(Number);
      const ab = spirit.cursedAbilities[ai];
      if (ab && Array.isArray(ab.scalingDamageParts)) { ab.scalingDamageParts.splice(pi, 1); save(); renderAbilitiesSummary(); }
      return;
    }
  });

  // ── contextmenu on Use button → roll mode menu ────────────────────────────
  grid.addEventListener("contextmenu", e => {
    const castBtn = e.target.closest("[data-ability-cast]");
    if (!castBtn) return;
    const spirit = _getSpirit?.();
    if (!spirit) return;
    const idx = nn(castBtn.dataset.abilityCast);
    openSpiritRollModeMenu(e, mode => {
      performTalentCheck(spirit, idx, mode);
    });
  });

  // ── input ─────────────────────────────────────────────────────────────────
  grid.addEventListener("input", e => {
    const spirit = _getSpirit?.();
    if (!spirit) return;
    ensureAbilities(spirit);
    const ds = e.target.dataset;

    // Damage count/die
    if (ds.abilityDmgCount !== undefined) {
      const [ai, pi] = ds.abilityDmgCount.split(":").map(Number);
      const ab = spirit.cursedAbilities[ai];
      if (ab?.damageParts?.[pi]) { ab.damageParts[pi].count = Math.max(1, parseInt(e.target.value, 10) || 1); save(); }
      return;
    }
    if (ds.abilityDmgDie !== undefined) {
      const [ai, pi] = ds.abilityDmgDie.split(":").map(Number);
      const ab = spirit.cursedAbilities[ai];
      const raw = e.target.value.replace(/[^0-9]/g, "") || "6";
      if (ab?.damageParts?.[pi]) { ab.damageParts[pi].die = `d${raw}`; save(); }
      return;
    }
    if (ds.abilityScaleDmgCount !== undefined) {
      const [ai, pi] = ds.abilityScaleDmgCount.split(":").map(Number);
      const ab = spirit.cursedAbilities[ai];
      if (ab?.scalingDamageParts?.[pi]) { ab.scalingDamageParts[pi].count = Math.max(1, parseInt(e.target.value, 10) || 1); save(); }
      return;
    }
    if (ds.abilityScaleDmgDie !== undefined) {
      const [ai, pi] = ds.abilityScaleDmgDie.split(":").map(Number);
      const ab = spirit.cursedAbilities[ai];
      const raw = e.target.value.replace(/[^0-9]/g, "") || "6";
      if (ab?.scalingDamageParts?.[pi]) { ab.scalingDamageParts[pi].die = `d${raw}`; save(); }
      return;
    }

    // Inline text fields
    const inlineMap = {
      abilityTitleInline:      (ab, v) => ab.title       = String(v || ""),
      abilityDescInline:       (ab, v) => ab.description = String(v || ""),
      abilityEffectInline:     (ab, v) => ab.effect      = String(v || ""),
      abilityCostInline:       (ab, v) => ab.ceCost      = nn(v),
      abilityDcInline:         (ab, v) => ab.dc          = nn(v),
      abilityScalingCeInline:  (ab, v) => ab.scalingCeStep = nn(v),
      abilityScalingDcInline:  (ab, v) => ab.scalingDcStep = nn(v),
      abilityRangeInline:      (ab, v) => ab.rangeValue  = String(v || "").trim(),
      abilityAoeSizeInline:    (ab, v) => ab.aoeSize     = String(v || "").trim(),
    };
    for (const [key, handler] of Object.entries(inlineMap)) {
      if (ds[key] !== undefined) {
        const ab = spirit.cursedAbilities[nn(ds[key])];
        if (ab) handler(ab, e.target.value);
        save();
        return;
      }
    }
  });

  // ── change (checkboxes, selects) ──────────────────────────────────────────
  grid.addEventListener("change", e => {
    const spirit = _getSpirit?.();
    if (!spirit) return;
    ensureAbilities(spirit);
    const ds = e.target.dataset;

    if (ds.abilityScalingInline !== undefined) {
      const ab = spirit.cursedAbilities[nn(ds.abilityScalingInline)];
      if (ab) { ab.scalingEnabled = Boolean(e.target.checked); if (!ab.scalingEnabled) ab.currentStep = 0; renderAbilitiesSummary(); }
      save(); return;
    }
    if (ds.abilityRangeTypeInline !== undefined) {
      const ab = spirit.cursedAbilities[nn(ds.abilityRangeTypeInline)];
      if (ab) {
        ab.rangeType = String(e.target.value || "self").toLowerCase();
        if (ab.rangeType !== "range") ab.rangeValue = "";
        if (ab.rangeType !== "aoe")   ab.aoeSize    = "";
        renderAbilitiesSummary();
      }
      save(); return;
    }
    if (ds.abilityAoeShapeInline !== undefined) {
      const ab = spirit.cursedAbilities[nn(ds.abilityAoeShapeInline)];
      if (ab) { ab.aoeShape = String(e.target.value || "cone").toLowerCase(); renderAbilitiesSummary(); }
      save(); return;
    }
    if (ds.abilityAddTlInline !== undefined) {
      const ab = spirit.cursedAbilities[nn(ds.abilityAddTlInline)];
      if (ab) ab.addTechniqueLevel = Boolean(e.target.checked);
      save(); return;
    }
  });
}