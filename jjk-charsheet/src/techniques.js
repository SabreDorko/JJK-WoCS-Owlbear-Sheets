import { computeActiveModifierEffects, getRollModifierSources } from "./modifiers.js";

let _getState = null;
let _scheduleSave = null;
let _refreshCharacterStats = null;
let _showRollToast = null;
let _initialized = false;
let _isEditing = false;
let _editorStep = "mode";
let _editSnapshot = null;
const _expandedAppIndices = new Map();
let _pendingNewApplicationIndex = null;
let _pendingNewVowIndex = null;

const JUJUTSU_SUBTABS = new Set(["technique", "vows", "training"]);
const APPLICATION_RANGE_TYPES = new Set(["self", "melee", "range", "aoe"]);
const APPLICATION_AOE_SHAPES = ["cone", "cube", "sphere", "cylinder", "line"];

function getState() {
  return _getState ? _getState() : null;
}

function scheduleSave() {
  if (_scheduleSave) _scheduleSave();
}

function refreshCharacterStats() {
  if (_refreshCharacterStats) _refreshCharacterStats();
}

function syncCeCurrentField(value) {
  const ceCurrentInput = document.getElementById("ceCurrent");
  if (ceCurrentInput) ceCurrentInput.value = String(value ?? "");
}

function syncTechniqueThresholdLine(state) {
  const thresholdEl = document.getElementById("techniqueXpThreshold");
  if (!thresholdEl || !state) return;

  const hasActiveTechnique = state?.techniques?.mode !== "none";
  if (!hasActiveTechnique) {
    thresholdEl.style.display = "none";
    return;
  }

  const techScore = parseNonNegativeInt(state?.stats?.technique?.score);
  const xpThreshold = techScore * 2;
  const ceCurrent = parseNonNegativeInt(state.ceCurrent);
  const ceMax = parseNonNegativeInt(state.ceMax);
  thresholdEl.textContent = `Sorcerer Experience Threshold: ${xpThreshold} • CE: ${ceCurrent}/${ceMax}`;
  thresholdEl.style.display = "";
}

function getScaledApplicationValues(app) {
  const currentStep = app.scalingEnabled ? parseNonNegativeInt(app.currentStep) : 0;
  return {
    currentStep,
    ceCost: app.ceCost + (app.scalingEnabled ? app.scalingCeStep * currentStep : 0),
    dc: app.dc + (app.scalingEnabled ? app.scalingDcStep * currentStep : 0),
  };
}

function getScalingSummary(app) {
  if (!app.scalingEnabled) return "Not scaling";
  return `+${app.scalingCeStep} CE / +${app.scalingDcStep} DC per step`;
}

function performApplicationCast(state, techniqueIndex, applicationIndex) {
  if (!state) return;
  ensureTechniquesState(state);
  
  const app = state.techniques.applications[applicationIndex];
  const techniqueName = state.ct || "Technique";
  if (!app) return;
  
  const normalized = normalizeApplication(app, applicationIndex);
  const scaled = getScaledApplicationValues(normalized);
  const dc = scaled.dc;
  const ceCost = scaled.ceCost;
  const techScore = parseNonNegativeInt(state?.stats?.technique?.score);
  const xpThreshold = techScore * 2;
  const ceCurrent = parseNonNegativeInt(state.ceCurrent);
  const label = `${techniqueName} › ${normalized.title}${scaled.currentStep > 0 ? ` (Step ${scaled.currentStep})` : ""}`;

  // Check if auto-pass (DC < XP Threshold = technique score × 2)
  if (xpThreshold > 0 && dc < xpThreshold) {
    // Deduct CE
    state.ceCurrent = String(Math.max(0, ceCurrent - ceCost));
    if (normalized.scalingEnabled && normalized.currentStep > 0) state.techniques.applications[applicationIndex].currentStep = 0;
    syncCeCurrentField(state.ceCurrent);
    syncTechniqueThresholdLine(state);
    scheduleSave();
    return;
  }
  
  // Normal roll: talent check (Technique skill)
  const talentSkillIndex = 3; // Talent is the 4th skill in Technique (index 3)
  const talentAptitude = state?.stats?.technique?.skills?.[talentSkillIndex]?.aptitude || 0;
  const diceCount = Math.max(1, techScore);
  const talentBonus = talentAptitude > 0 ? 2 : 0;
  const effects = computeActiveModifierEffects(state);
  const rollBonus = effects?.rollBonuses?.technique || 0;

  const rolls = Array.from({ length: diceCount }, () => Math.floor(Math.random() * 6) + 1);
  const rawTotal = rolls.reduce((a, b) => a + b, 0);
  const total = rawTotal + talentBonus + rollBonus;
  const maxPossible = diceCount * 6 + talentBonus + rollBonus;
  const allOnes = rolls.every(r => r === 1);

  let rollStatus = null;

  if (allOnes) {
    rollStatus = "fail";
  } else if (total >= dc) {
    if (total >= maxPossible) {
      rollStatus = "success";
    } else {
      rollStatus = "pass";
    }
  } else {
    rollStatus = "fail";
  }

  const breakdown = {
    skillModifier: talentBonus,
    equipmentBonuses: getRollModifierSources(state, "technique"),
  };

  // Show the toast and log the roll
  if (_showRollToast) {
    _showRollToast(label, diceCount, rolls, total, rollStatus, "Talent", breakdown);
  }
  
  // Deduct CE
  state.ceCurrent = String(Math.max(0, ceCurrent - ceCost));
  if (normalized.scalingEnabled && normalized.currentStep > 0) state.techniques.applications[applicationIndex].currentStep = 0;
  syncCeCurrentField(state.ceCurrent);
  syncTechniqueThresholdLine(state);
  scheduleSave();
}

function getApplicationButtonState(state, applicationIndex) {
  if (!state) return { disabled: false, isAutoPass: false, tooltip: "Cast" };
  ensureTechniquesState(state);
  
  const app = state.techniques.applications[applicationIndex];
  if (!app) return { disabled: false, isAutoPass: false, tooltip: "Cast" };
  
  const normalized = normalizeApplication(app, applicationIndex);
  const scaled = getScaledApplicationValues(normalized);
  const dc = scaled.dc;
  const ceCost = scaled.ceCost;
  const ceCurrent = parseNonNegativeInt(state.ceCurrent);
  const techScore = parseNonNegativeInt(state?.stats?.technique?.score);
  const xpThreshold = techScore * 2;

  // Check if insufficient CE
  if (ceCurrent < ceCost) {
    return { disabled: true, isAutoPass: false, tooltip: `Insufficient CE (need ${ceCost})` };
  }

  // Check if auto-pass (DC < XP Threshold = technique score × 2)
  if (xpThreshold > 0 && dc < xpThreshold) {
    return { disabled: false, isAutoPass: true, tooltip: `Auto-pass (DC ${dc} < threshold ${xpThreshold})` };
  }
  
  return { disabled: false, isAutoPass: false, tooltip: "Roll talent check" };
}

function syncApplicationButtonStates(state) {
  const summaryGrid = document.getElementById("techniqueApplicationsSummary");
  if (!summaryGrid || !state) return;

  const apps = Array.isArray(state?.techniques?.applications) ? state.techniques.applications : [];
  apps.forEach((app, idx) => {
    const card = summaryGrid.querySelector(`[data-app-idx="${idx}"]`);
    if (!card || card.classList.contains("techniques-app-card--editing")) return;

    const normalized = normalizeApplication(app, idx);
    const scaled = getScaledApplicationValues(normalized);
    const button = card.querySelector(`[data-app-cast="${idx}"]`);
    const costValue = card.querySelector(`[data-app-metric-cost-value="${idx}"]`);
    const dcValue = card.querySelector(`[data-app-metric-dc-value="${idx}"]`);
    const scalingValue = card.querySelector(`[data-app-scaling-summary="${idx}"]`);
    const stepLabel = card.querySelector(`[data-app-step-label="${idx}"]`);
    const stepDown = card.querySelector(`[data-app-step-down="${idx}"]`);

    const btnState = getApplicationButtonState(state, idx);
    if (costValue) costValue.textContent = scaled.ceCost > 0 ? String(scaled.ceCost) : "-";
    if (dcValue) dcValue.textContent = scaled.dc > 0 ? String(scaled.dc) : "-";
    if (scalingValue) scalingValue.textContent = getScalingSummary(normalized);
    if (stepLabel) stepLabel.textContent = `Step ${scaled.currentStep}`;
    if (stepDown) stepDown.disabled = scaled.currentStep <= 0;
    if (button) {
      button.classList.toggle("techniques-app-cast-btn--auto-pass", btnState.isAutoPass);
      button.disabled = btnState.disabled;
      button.title = btnState.tooltip;
      button.textContent = `${btnState.isAutoPass ? "✦ " : ""}Use`;
    }
  });
}

function parseNonNegativeInt(rawValue) {
  const parsed = parseInt(rawValue, 10);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, parsed);
}

function createDefaultApplication(index) {
  return {
    title: `Application ${index + 1}`,
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
  };
}

function createDefaultBindingVow(index) {
  return {
    title: `Vow ${index + 1}`,
    benefits: "",
    conditions: "",
  };
}

function normalizeApplication(raw, index) {
  const fallbackTitle = `Application ${index + 1}`;
  const title = String(raw?.title || "").trim();
  const description = String(raw?.description || "").trim();
  const effect = String(raw?.effect || "").trim();
  const ceCost = parseNonNegativeInt(raw?.ceCost);
  const dc = parseNonNegativeInt(raw?.dc);
  const rangeTypeRaw = String(raw?.rangeType || "").trim().toLowerCase();
  const rangeType = APPLICATION_RANGE_TYPES.has(rangeTypeRaw) ? rangeTypeRaw : "self";
  const rangeValue = String(raw?.rangeValue || "").trim();
  const aoeShapeRaw = String(raw?.aoeShape || "").trim().toLowerCase();
  const aoeShape = APPLICATION_AOE_SHAPES.includes(aoeShapeRaw) ? aoeShapeRaw : "cone";
  const aoeSize = String(raw?.aoeSize || "").trim();
  const scalingEnabled = Boolean(raw?.scalingEnabled);
  const scalingCeStep = parseNonNegativeInt(raw?.scalingCeStep);
  const scalingDcStep = parseNonNegativeInt(raw?.scalingDcStep);
  const currentStep = scalingEnabled ? parseNonNegativeInt(raw?.currentStep) : 0;
  return {
    title: title || fallbackTitle,
    description,
    effect,
    ceCost,
    dc,
    rangeType,
    rangeValue,
    aoeShape,
    aoeSize,
    scalingEnabled,
    scalingCeStep,
    scalingDcStep,
    currentStep,
  };
}

function getAoeShapeLabel(shape) {
  if (shape === "cube") return "Cube";
  if (shape === "sphere") return "Sphere";
  if (shape === "cylinder") return "Cylinder";
  if (shape === "line") return "Line";
  return "Cone";
}

function getRangeSummary(app) {
  if (app.rangeType === "melee") {
    return "Range: Melee";
  }
  if (app.rangeType === "range") {
    return app.rangeValue ? `Range: ${app.rangeValue}` : "Range: -";
  }
  if (app.rangeType === "aoe") {
    const shapeLabel = getAoeShapeLabel(app.aoeShape);
    const sizeLabel = app.aoeSize || "-";
    return `AOE: ${shapeLabel} (${sizeLabel})`;
  }
  return "Range: Self";
}

function normalizeBindingVow(raw, index) {
  const fallbackTitle = `Vow ${index + 1}`;
  const title = String(raw?.title || "").trim();
  // Migrate legacy `details` field into `benefits`
  const legacyDetails = String(raw?.details || "").trim();
  const benefits = String(raw?.benefits || legacyDetails || "").trim();
  const conditions = String(raw?.conditions || "").trim();
  return {
    title: title || fallbackTitle,
    benefits,
    conditions,
  };
}

function ensureTechniquesState(state) {
  if (!state || typeof state !== "object") return;
  if (!state.techniques || typeof state.techniques !== "object") state.techniques = {};

  const techniques = state.techniques;
  if (!["ct", "domain", "none"].includes(techniques.mode)) techniques.mode = "none";
  if (!JUJUTSU_SUBTABS.has(techniques.activeSubtab)) techniques.activeSubtab = "technique";
  if (!Array.isArray(techniques.applications)) techniques.applications = [];
  if (!Array.isArray(techniques.bindingVows)) techniques.bindingVows = [];

  if (!techniques.applications.length) {
    const legacyCt = Array.isArray(techniques.ctAbilities) ? techniques.ctAbilities : [];
    const legacyDomain = Array.isArray(techniques.domainAbilities) ? techniques.domainAbilities : [];
    const legacy = [...legacyCt, ...legacyDomain]
      .map(v => String(v || "").trim())
      .filter(Boolean)
      .map((title, idx) => ({ title: title || `Application ${idx + 1}`, description: "" }));
    if (legacy.length) techniques.applications = legacy;
  }

  techniques.applications = techniques.applications.map((entry, idx) => normalizeApplication(entry, idx));
  techniques.bindingVows = techniques.bindingVows.map((entry, idx) => normalizeBindingVow(entry, idx));

  // CT/Domain should always start with one editable application slot.
  if (techniques.mode !== "none" && techniques.applications.length === 0) {
    techniques.applications = [createDefaultApplication(0)];
  }

  techniques.noCtPath = String(techniques.noCtPath || "");
  techniques.notes = String(techniques.notes || "");
  techniques.bindingVowsNotes = String(techniques.bindingVowsNotes || "");

  if (!techniques.bindingVows.length && techniques.bindingVowsNotes.trim()) {
    techniques.bindingVows = [{
      title: "Vow 1",
      benefits: techniques.bindingVowsNotes.trim(),
      conditions: "",
    }];
  }
}

function getActiveSubtab(state) {
  ensureTechniquesState(state);
  return JUJUTSU_SUBTABS.has(state?.techniques?.activeSubtab)
    ? state.techniques.activeSubtab
    : "technique";
}

function setJujutsuSubtabUI(subtabKey) {
  const target = JUJUTSU_SUBTABS.has(subtabKey) ? subtabKey : "technique";

  document.querySelectorAll(".jujutsu-subtab").forEach(btn => {
    const isActive = btn.dataset.subtab === target;
    btn.classList.toggle("active", isActive);
    btn.setAttribute("aria-selected", isActive ? "true" : "false");
  });

  document.querySelectorAll(".jujutsu-subpanel").forEach(panel => {
    const isActive = panel.dataset.subpanel === target;
    panel.classList.toggle("active", isActive);
  });
}

function setActiveSubtab(state, subtabKey) {
  ensureTechniquesState(state);
  state.techniques.activeSubtab = JUJUTSU_SUBTABS.has(subtabKey) ? subtabKey : "technique";
  setJujutsuSubtabUI(state.techniques.activeSubtab);
}

function createEditSnapshot(state) {
  ensureTechniquesState(state);
  return {
    ct: String(state.ct || ""),
    techniques: JSON.parse(JSON.stringify(state.techniques)),
  };
}

function restoreEditSnapshot(state, snapshot) {
  if (!state || !snapshot) return;
  state.ct = String(snapshot.ct || "");
  state.techniques = JSON.parse(JSON.stringify(snapshot.techniques || {}));
  ensureTechniquesState(state);
}

function getTechniqueSummaryText(state) {
  ensureTechniquesState(state);
  const mode = state.techniques.mode;
  const name = String(state.ct || "").trim();
  if (mode === "none") return "No technique.";
  return name || "Unnamed technique";
}

function getTechniqueTypeText(mode) {
  if (mode === "domain") return "Domain-Based Cursed Technique";
  if (mode === "none") return "No Cursed Technique";
  return "Cursed Technique";
}

function setTechniqueAddButtonState() {
  const addBtn = document.getElementById("techniqueAddAppSummaryBtn");
  if (!addBtn) return;

  const isCancelMode = Number.isFinite(_pendingNewApplicationIndex);
  addBtn.classList.toggle("is-open", isCancelMode);
  addBtn.setAttribute("aria-label", isCancelMode ? "Cancel New Application" : "Add Application");
  addBtn.setAttribute("title", isCancelMode ? "Cancel New Application" : "Add Application");

  const path = addBtn.querySelector("path");
  if (path) {
    path.setAttribute("d", isCancelMode ? "M5 11h14v2H5z" : "M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6V5z");
  }
}

function refreshApplicationCards(state) {
  renderApplicationsSummary(state);
  setTechniqueAddButtonState();
}

function renderApplicationsSummary(state) {
  const grid = document.getElementById("techniqueApplicationsSummary");
  if (!grid) return;

  const mode = state?.techniques?.mode || "none";
  const apps = Array.isArray(state?.techniques?.applications) ? state.techniques.applications : [];

  if (mode === "none") {
    grid.innerHTML = "";
    return;
  }

  if (!apps.length) {
    grid.innerHTML = '<div class="techniques-app-empty">No applications added yet.</div>';
    return;
  }

  grid.innerHTML = apps.map((app, idx) => {
    const normalized = normalizeApplication(app, idx);
    if (_expandedAppIndices.has(idx)) {
      return `
        <article class="techniques-app-card techniques-app-card--editing" data-app-idx="${idx}">
          <div class="techniques-app-edit-grid">
          <label class="techniques-field" for="appCardTitle${idx}">
            <span class="field-label">Title</span>
            <input id="appCardTitle${idx}" class="meta-input techniques-app-card-field" data-app-title-inline="${idx}" value="${normalized.title}" />
          </label>
          <label class="techniques-field" for="appCardCost${idx}">
            <span class="field-label">CE Cost</span>
            <input id="appCardCost${idx}" class="meta-input techniques-app-card-field" type="number" min="0" step="1" inputmode="numeric" data-app-cost-inline="${idx}" value="${normalized.ceCost || 0}" />
          </label>
          <label class="techniques-field" for="appCardDc${idx}">
            <span class="field-label">DC</span>
            <input id="appCardDc${idx}" class="meta-input techniques-app-card-field" type="number" min="0" step="1" inputmode="numeric" data-app-dc-inline="${idx}" value="${normalized.dc || 0}" />
          </label>
          <label class="techniques-field techniques-field--checkbox" for="appCardScaling${idx}">
            <span class="field-label">Scaling</span>
            <input id="appCardScaling${idx}" class="techniques-checkbox" type="checkbox" data-app-scaling-inline="${idx}"${normalized.scalingEnabled ? " checked" : ""} />
          </label>
          ${normalized.scalingEnabled ? `
          <label class="techniques-field" for="appCardScalingCe${idx}">
            <span class="field-label">CE / Step</span>
            <input id="appCardScalingCe${idx}" class="meta-input techniques-app-card-field" type="number" min="0" step="1" inputmode="numeric" data-app-scaling-ce-inline="${idx}" value="${normalized.scalingCeStep || 0}" />
          </label>
          <label class="techniques-field" for="appCardScalingDc${idx}">
            <span class="field-label">DC / Step</span>
            <input id="appCardScalingDc${idx}" class="meta-input techniques-app-card-field" type="number" min="0" step="1" inputmode="numeric" data-app-scaling-dc-inline="${idx}" value="${normalized.scalingDcStep || 0}" />
          </label>
          ` : ""}
          <label class="techniques-field" for="appCardRangeType${idx}">
            <span class="field-label">Range Type</span>
            <select id="appCardRangeType${idx}" class="meta-select techniques-app-card-field" data-app-range-type-inline="${idx}">
              <option value="self"${normalized.rangeType === "self" ? " selected" : ""}>Self</option>
              <option value="melee"${normalized.rangeType === "melee" ? " selected" : ""}>Melee</option>
              <option value="range"${normalized.rangeType === "range" ? " selected" : ""}>Range</option>
              <option value="aoe"${normalized.rangeType === "aoe" ? " selected" : ""}>AOE</option>
            </select>
          </label>
          ${normalized.rangeType === "range" ? `
          <label class="techniques-field" for="appCardRangeValue${idx}">
            <span class="field-label">Range</span>
            <input id="appCardRangeValue${idx}" class="meta-input techniques-app-card-field" data-app-range-inline="${idx}" value="${normalized.rangeValue}" placeholder="30 ft" />
          </label>
          ` : ""}
          ${normalized.rangeType === "aoe" ? `
          <label class="techniques-field" for="appCardAoeShape${idx}">
            <span class="field-label">AOE Shape</span>
            <select id="appCardAoeShape${idx}" class="meta-select techniques-app-card-field" data-app-aoe-shape-inline="${idx}">
              ${APPLICATION_AOE_SHAPES.map(shape => `<option value="${shape}"${normalized.aoeShape === shape ? " selected" : ""}>${getAoeShapeLabel(shape)}</option>`).join("")}
            </select>
          </label>
          <label class="techniques-field" for="appCardAoeSize${idx}">
            <span class="field-label">AOE Size</span>
            <input id="appCardAoeSize${idx}" class="meta-input techniques-app-card-field" data-app-aoe-size-inline="${idx}" value="${normalized.aoeSize}" placeholder="15 ft radius" />
          </label>
          ` : ""}
          </div>
          <label class="techniques-field" for="appCardEffect${idx}">
            <span class="field-label">Effect</span>
            <textarea id="appCardEffect${idx}" class="inventory-textarea techniques-app-card-field" data-app-effect-inline="${idx}" rows="3" maxlength="700">${normalized.effect}</textarea>
          </label>
          <label class="techniques-field" for="appCardDesc${idx}">
            <span class="field-label">Notes</span>
            <textarea id="appCardDesc${idx}" class="inventory-textarea techniques-app-card-field" data-app-desc-inline="${idx}" rows="3" maxlength="360">${normalized.description}</textarea>
          </label>
          <div class="techniques-app-card-footer">
            <button type="button" class="inventory-mini-btn inventory-icon-btn danger" data-app-remove-inline="${idx}" aria-label="Delete application" title="Delete">
              <svg class="inventory-icon-trash" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <path fill="currentColor" d="M9 3h6a1 1 0 0 1 1 1v1h4v2h-1l-1 12a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 7H4V5h4V4a1 1 0 0 1 1-1Zm1 2v0h4V5h-4Zm-1 4h2v9H9V9Zm4 0h2v9h-2V9Z"/>
                <path fill="none" stroke="currentColor" stroke-width="1.5" d="M6 7.5h12"/>
              </svg>
            </button>
            <button type="button" class="inventory-secondary-btn" data-app-cancel-inline="${idx}">Cancel</button>
            <button type="button" class="meta-toggle-btn techniques-app-save-btn" data-app-save-inline="${idx}">Save</button>
          </div>
        </article>
      `;
    }
    const description = normalized.description || "No description yet.";
    const scaled = getScaledApplicationValues(normalized);
    const costText = scaled.ceCost > 0 ? String(scaled.ceCost) : "-";
    const dcText = scaled.dc > 0 ? String(scaled.dc) : "-";
    const range = getRangeSummary(normalized);
    const effectText = normalized.effect || "No effect listed.";
    const btnState = getApplicationButtonState(state, idx);
    const btnClass = btnState.isAutoPass ? "techniques-app-cast-btn--auto-pass" : "";
    const btnDisabled = btnState.disabled ? " disabled" : "";
    const starMarkup = btnState.isAutoPass ? "✦ " : "";
    return `
      <article class="techniques-app-card" data-app-idx="${idx}">
        <button type="button" class="techniques-app-card-edit-btn" data-app-edit-toggle="${idx}" aria-label="Edit application" title="Edit">&#9998;</button>
        <h4 class="techniques-app-card-title">${normalized.title}</h4>
        <div class="techniques-app-metrics">
          <span class="techniques-app-metric"><strong>CE Cost:</strong> <span data-app-metric-cost-value="${idx}">${costText}</span></span>
          <span class="techniques-app-metric"><strong>DC:</strong> <span data-app-metric-dc-value="${idx}">${dcText}</span></span>
          <span class="techniques-app-metric"><strong>${range.startsWith("AOE") ? "AOE" : "Range"}:</strong> ${range.replace(/^AOE:\s*|^Range:\s*/, "")}</span>
          ${normalized.scalingEnabled ? `<span class="techniques-app-metric"><strong>Scaling:</strong> <span data-app-scaling-summary="${idx}">${getScalingSummary(normalized)}</span></span>` : ""}
        </div>
        <div class="techniques-app-effect"><strong>Effect:</strong> ${effectText}</div>
        <p class="techniques-app-card-desc">${description}</p>
        <div class="techniques-app-card-footer">
          ${normalized.scalingEnabled ? `
          <div class="techniques-app-stepper">
            <button type="button" class="techniques-app-step-btn" data-app-step-down="${idx}"${scaled.currentStep <= 0 ? " disabled" : ""}>-</button>
            <span class="techniques-app-step-label" data-app-step-label="${idx}">Step ${scaled.currentStep}</span>
            <button type="button" class="techniques-app-step-btn" data-app-step-up="${idx}">+</button>
          </div>
          ` : ""}
          <button type="button" class="techniques-app-cast-btn ${btnClass}" data-app-cast="${idx}" title="${btnState.tooltip}"${btnDisabled}>${starMarkup}Use</button>
        </div>
      </article>
    `;
  }).join("");
}

function renderApplicationsEditor(state) {
  const list = document.getElementById("techniqueApplicationsList");
  if (!list) return;

  const apps = Array.isArray(state?.techniques?.applications) ? state.techniques.applications : [];
  if (!apps.length) {
    list.innerHTML = '<div class="techniques-app-empty">No applications yet. Add one to get started.</div>';
    return;
  }

  list.innerHTML = apps.map((app, idx) => {
    const normalized = normalizeApplication(app, idx);
    return `
      <div class="techniques-app-editor-item">
        <div class="techniques-app-editor-item-head">
          <span class="field-label">Application ${idx + 1}</span>
          <button type="button" class="inventory-secondary-btn techniques-app-remove-btn" data-app-remove="${idx}">Remove</button>
        </div>
        <label class="techniques-field" for="techniqueAppTitle${idx}">
          <span class="field-label">Title</span>
          <input id="techniqueAppTitle${idx}" class="meta-input" data-app-title="${idx}" value="${normalized.title}" />
        </label>
        <label class="techniques-field" for="techniqueAppDesc${idx}">
          <span class="field-label">Description</span>
          <textarea id="techniqueAppDesc${idx}" class="inventory-textarea" rows="3" maxlength="360" data-app-description="${idx}">${normalized.description}</textarea>
        </label>
        <label class="techniques-field" for="techniqueAppCeCost${idx}">
          <span class="field-label">CE Cost</span>
          <input id="techniqueAppCeCost${idx}" class="meta-input" type="number" min="0" step="1" inputmode="numeric" data-app-ce-cost="${idx}" value="${normalized.ceCost || 0}" />
        </label>
        <label class="techniques-field" for="techniqueAppDc${idx}">
          <span class="field-label">DC</span>
          <input id="techniqueAppDc${idx}" class="meta-input" type="number" min="0" step="1" inputmode="numeric" data-app-dc="${idx}" value="${normalized.dc || 0}" />
        </label>
        <label class="techniques-field techniques-field--checkbox" for="techniqueAppScaling${idx}">
          <span class="field-label">Scaling</span>
          <input id="techniqueAppScaling${idx}" class="techniques-checkbox" type="checkbox" data-app-scaling="${idx}"${normalized.scalingEnabled ? " checked" : ""} />
        </label>
        ${normalized.scalingEnabled ? `
        <label class="techniques-field" for="techniqueAppScalingCe${idx}">
          <span class="field-label">CE / Step</span>
          <input id="techniqueAppScalingCe${idx}" class="meta-input" type="number" min="0" step="1" inputmode="numeric" data-app-scaling-ce="${idx}" value="${normalized.scalingCeStep || 0}" />
        </label>
        <label class="techniques-field" for="techniqueAppScalingDc${idx}">
          <span class="field-label">DC / Step</span>
          <input id="techniqueAppScalingDc${idx}" class="meta-input" type="number" min="0" step="1" inputmode="numeric" data-app-scaling-dc="${idx}" value="${normalized.scalingDcStep || 0}" />
        </label>
        ` : ""}
        <label class="techniques-field" for="techniqueAppRangeType${idx}">
          <span class="field-label">Range Type</span>
          <select id="techniqueAppRangeType${idx}" class="meta-select" data-app-range-type="${idx}">
            <option value="self"${normalized.rangeType === "self" ? " selected" : ""}>Self</option>
            <option value="melee"${normalized.rangeType === "melee" ? " selected" : ""}>Melee</option>
            <option value="range"${normalized.rangeType === "range" ? " selected" : ""}>Range</option>
            <option value="aoe"${normalized.rangeType === "aoe" ? " selected" : ""}>AOE</option>
          </select>
        </label>
        ${normalized.rangeType === "range" ? `
        <label class="techniques-field" for="techniqueAppRangeValue${idx}">
          <span class="field-label">Range</span>
          <input id="techniqueAppRangeValue${idx}" class="meta-input" data-app-range-value="${idx}" value="${normalized.rangeValue}" placeholder="30 ft" />
        </label>
        ` : ""}
        ${normalized.rangeType === "aoe" ? `
        <label class="techniques-field" for="techniqueAppAoeShape${idx}">
          <span class="field-label">AOE Shape</span>
          <select id="techniqueAppAoeShape${idx}" class="meta-select" data-app-aoe-shape="${idx}">
            ${APPLICATION_AOE_SHAPES.map(shape => `<option value="${shape}"${normalized.aoeShape === shape ? " selected" : ""}>${getAoeShapeLabel(shape)}</option>`).join("")}
          </select>
        </label>
        <label class="techniques-field" for="techniqueAppAoeSize${idx}">
          <span class="field-label">AOE Size</span>
          <input id="techniqueAppAoeSize${idx}" class="meta-input" data-app-aoe-size="${idx}" value="${normalized.aoeSize}" placeholder="15 ft radius" />
        </label>
        ` : ""}
        <label class="techniques-field" for="techniqueAppEffect${idx}">
          <span class="field-label">Effect</span>
          <textarea id="techniqueAppEffect${idx}" class="inventory-textarea" rows="3" maxlength="700" data-app-effect="${idx}">${normalized.effect}</textarea>
        </label>
      </div>
    `;
  }).join("");
}

function renderBindingVowsEditor(state) {
  const list = document.getElementById("bindingVowsList");
  if (!list) return;

  const vows = Array.isArray(state?.techniques?.bindingVows) ? state.techniques.bindingVows : [];
  if (!vows.length) {
    list.innerHTML = '<div class="techniques-app-empty">No Vows Made.</div>';
    return;
  }

  list.innerHTML = vows.map((vow, idx) => renderBindingVowEditorItem(vow, idx, _pendingNewVowIndex === idx)).join("");

  _pendingNewVowIndex = null;
}

function renderBindingVowEditorItem(vow, idx, isNew = false) {
  const normalized = normalizeBindingVow(vow, idx);
  return `
      <div class="techniques-app-editor-item${isNew ? " vow-enter" : ""}">
        <label class="techniques-field" for="bindingVowTitle${idx}">
          <span class="field-label">Title</span>
          <input id="bindingVowTitle${idx}" class="meta-input" data-vow-title="${idx}" value="${normalized.title}" />
        </label>
        <label class="techniques-field" for="bindingVowBenefits${idx}">
          <span class="field-label">Benefits</span>
          <textarea id="bindingVowBenefits${idx}" class="inventory-textarea" rows="3" maxlength="700" data-vow-benefits="${idx}">${normalized.benefits}</textarea>
        </label>
        <label class="techniques-field" for="bindingVowConditions${idx}">
          <span class="field-label">Conditions</span>
          <textarea id="bindingVowConditions${idx}" class="inventory-textarea" rows="3" maxlength="700" data-vow-conditions="${idx}">${normalized.conditions}</textarea>
        </label>
        <div class="techniques-vow-footer">
          <button type="button" class="inventory-mini-btn inventory-icon-btn danger" data-vow-remove="${idx}" aria-label="Delete vow" title="Delete vow" style="margin-left:auto;">
            <svg class="inventory-icon-trash" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path fill="currentColor" d="M9 3h6a1 1 0 0 1 1 1v1h4v2h-1l-1 12a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 7H4V5h4V4a1 1 0 0 1 1-1Zm1 2v0h4V5h-4Zm-1 4h2v9H9V9Zm4 0h2v9h-2V9Z"/>
              <path fill="none" stroke="currentColor" stroke-width="1.5" d="M6 7.5h12"/>
            </svg>
          </button>
        </div>
      </div>
    `;
}

function setEditorVisibility() {
  const summaryCard = document.getElementById("techniqueSummaryCard");
  const editor = document.getElementById("techniqueEditor");
  const modeStep = document.getElementById("techniqueEditorStepMode");
  const detailsStep = document.getElementById("techniqueEditorStepDetails");

  if (summaryCard) summaryCard.style.display = _isEditing ? "none" : "";
  if (editor) editor.style.display = _isEditing ? "" : "none";
  if (modeStep) modeStep.style.display = _isEditing && _editorStep === "mode" ? "" : "none";
  if (detailsStep) detailsStep.style.display = _isEditing && _editorStep === "details" ? "" : "none";
}

function getSelectedMode() {
  if (document.getElementById("techniqueModeDomain")?.checked) return "domain";
  if (document.getElementById("techniqueModeNone")?.checked) return "none";
  return "ct";
}

function setModeUI(mode) {
  const isNone = mode === "none";
  const nameField = document.getElementById("techniquesNameField");
  const noCtSection = document.getElementById("techniquesNoCtSection");
  const noCtInfoCard = document.getElementById("techniquesNoCtInfoCard");

  if (nameField) nameField.style.display = isNone ? "none" : "";
  if (noCtSection) noCtSection.style.display = isNone ? "" : "none";
  if (noCtInfoCard) noCtInfoCard.style.display = isNone ? "" : "none";
}

function syncTechniqueNameInput() {
  const nameInput = document.getElementById("techniqueNameInput");
  const headerInput = document.getElementById("ctInput");
  if (!nameInput || !headerInput) return;
  if (document.activeElement === nameInput) return;
  nameInput.value = headerInput.value;

  const state = getState();
  if (state) {
    state.ct = headerInput.value;
    const summaryEl = document.getElementById("techniqueSummaryText");
    if (summaryEl) summaryEl.textContent = getTechniqueSummaryText(state);
  }
}

export function updateTechniquesDerivedUI(stateArg = null) {
  const state = stateArg || getState();
  if (!state) return;

  ensureTechniquesState(state);

  const summaryEl = document.getElementById("techniqueSummaryText");
  if (summaryEl) summaryEl.textContent = getTechniqueSummaryText(state);

  const typeEl = document.getElementById("techniqueTypeSummary");
  if (typeEl) typeEl.innerHTML = `<em>${getTechniqueTypeText(state.techniques.mode)}</em>`;

  syncTechniqueThresholdLine(state);

  renderApplicationsSummary(state);

  const hasActiveTechnique = state.techniques.mode !== "none";

  const summaryFooter = document.getElementById("techniqueSummaryFooter");
  if (summaryFooter) summaryFooter.style.display = hasActiveTechnique ? "" : "none";

  if (!hasActiveTechnique) _pendingNewApplicationIndex = null;
  setTechniqueAddButtonState();

  const inlineNotes = document.getElementById("techniqueInlineNotesInput");
  if (inlineNotes && document.activeElement !== inlineNotes) {
    inlineNotes.value = state.techniques.notes || "";
  }
}

export function applyTechniquesStateToUI() {
  const state = getState();
  if (!state) return;

  ensureTechniquesState(state);

  const mode = state.techniques.mode;
  const modeCt = document.getElementById("techniqueModeCt");
  const modeDomain = document.getElementById("techniqueModeDomain");
  const modeNone = document.getElementById("techniqueModeNone");
  if (modeCt) modeCt.checked = mode === "ct";
  if (modeDomain) modeDomain.checked = mode === "domain";
  if (modeNone) modeNone.checked = mode === "none";

  const nameInput = document.getElementById("techniqueNameInput");
  if (nameInput) nameInput.value = state.ct || "";

  const noCtPath = document.getElementById("noCtPathSelect");
  if (noCtPath) noCtPath.value = state.techniques.noCtPath || "";

  const notes = document.getElementById("techniqueNotesInput");
  if (notes) notes.value = state.techniques.notes || "";

  const inlineNotes = document.getElementById("techniqueInlineNotesInput");
  if (inlineNotes) inlineNotes.value = state.techniques.notes || "";

  renderApplicationsEditor(state);
  renderBindingVowsEditor(state);

  setJujutsuSubtabUI(getActiveSubtab(state));

  setModeUI(mode);
  updateTechniquesDerivedUI(state);
  setEditorVisibility();
}

function startTechniqueEditing() {
  const state = getState();
  if (!state) return;
  _editSnapshot = createEditSnapshot(state);
  _isEditing = true;
  _editorStep = "mode";
  applyTechniquesStateToUI();
}

function cancelTechniqueEditing() {
  const state = getState();
  if (!state) return;
  restoreEditSnapshot(state, _editSnapshot);
  _isEditing = false;
  _editorStep = "mode";
  _pendingNewApplicationIndex = null;
  _expandedAppIndices.clear();
  refreshCharacterStats();
  applyTechniquesStateToUI();
  scheduleSave();
}

function continueTechniqueEditingFromMode() {
  const state = getState();
  if (!state) return;
  ensureTechniquesState(state);
  state.techniques.mode = getSelectedMode();
  _editorStep = "details";
  setModeUI(state.techniques.mode);
  updateTechniquesDerivedUI(state);
  refreshCharacterStats();
  scheduleSave();
  setEditorVisibility();
}

function backToModeStep() {
  _editorStep = "mode";
  setEditorVisibility();
}

function saveTechniqueEditing() {
  const state = getState();
  if (!state) return;
  ensureTechniquesState(state);
  _isEditing = false;
  _editorStep = "mode";
  _pendingNewApplicationIndex = null;
  _editSnapshot = null;
  refreshCharacterStats();
  applyTechniquesStateToUI();
  scheduleSave();
}

export function initTechniques({ getState: getStateFn, scheduleSave: scheduleSaveFn, refreshCharacterStats: refreshCharacterStatsFn, showRollToast: showRollToastFn }) {
  _getState = getStateFn;
  _scheduleSave = scheduleSaveFn;
  _refreshCharacterStats = refreshCharacterStatsFn;
  _showRollToast = showRollToastFn;

  if (_initialized) {
    applyTechniquesStateToUI();
    return;
  }

  const modeInputs = [
    document.getElementById("techniqueModeCt"),
    document.getElementById("techniqueModeDomain"),
    document.getElementById("techniqueModeNone"),
  ].filter(Boolean);

  modeInputs.forEach(input => {
    input.addEventListener("change", () => {
      const state = getState();
      if (!state) return;
      ensureTechniquesState(state);
      state.techniques.mode = getSelectedMode();
      setModeUI(state.techniques.mode);
      updateTechniquesDerivedUI(state);
      refreshCharacterStats();
      scheduleSave();
    });
  });

  document.querySelectorAll(".jujutsu-subtab").forEach(btn => {
    btn.addEventListener("click", () => {
      const state = getState();
      if (!state) return;
      const next = String(btn.dataset.subtab || "technique");
      setActiveSubtab(state, next);
      scheduleSave();
    });
  });

  const editBtn = document.getElementById("techniqueEditBtn");
  if (editBtn) editBtn.addEventListener("click", startTechniqueEditing);

  const addAppSummaryBtn = document.getElementById("techniqueAddAppSummaryBtn");
  if (addAppSummaryBtn) {
    addAppSummaryBtn.addEventListener("click", () => {
      const state = getState();
      if (!state) return;
      ensureTechniquesState(state);

      if (Number.isFinite(_pendingNewApplicationIndex)) {
        const idx = _pendingNewApplicationIndex;
        if (state.techniques.applications[idx]) {
          state.techniques.applications.splice(idx, 1);
          state.techniques.applications = state.techniques.applications.map((entry, i) => normalizeApplication(entry, i));
        }
        _pendingNewApplicationIndex = null;
        _expandedAppIndices.clear();
        refreshApplicationCards(state);
        scheduleSave();
        return;
      }

      const newIdx = state.techniques.applications.length;
      state.techniques.applications.push(createDefaultApplication(newIdx));
      const newSnap = JSON.parse(JSON.stringify(state.techniques.applications[newIdx]));
      _expandedAppIndices.set(newIdx, newSnap);
      _pendingNewApplicationIndex = newIdx;
      refreshApplicationCards(state);
      scheduleSave();
    });
  }

  const summaryGrid = document.getElementById("techniqueApplicationsSummary");
  if (summaryGrid) {
    summaryGrid.addEventListener("click", e => {
      if (e.target?.tagName !== "INPUT" && e.target?.tagName !== "SELECT" && e.target?.tagName !== "TEXTAREA") {
        e.preventDefault();
        e.stopPropagation();
      }
      // Open edit (pencil icon on view card)
      const openTrigger = e.target?.closest?.("[data-app-edit-toggle]");
      if (openTrigger) {
        const state = getState();
        if (!state) return;
        const idx = parseNonNegativeInt(openTrigger.dataset.appEditToggle);
        const snap = JSON.parse(JSON.stringify(state.techniques.applications[idx] || {}));
        _expandedAppIndices.set(idx, snap);
        refreshApplicationCards(state);
        return;
      }
      // Save (collapse, keep changes already written on input)
      const saveTrigger = e.target?.closest?.("[data-app-save-inline]");
      if (saveTrigger) {
        const idx = parseNonNegativeInt(saveTrigger.dataset.appSaveInline);
        _expandedAppIndices.delete(idx);
        if (_pendingNewApplicationIndex === idx) _pendingNewApplicationIndex = null;
        const state = getState();
        if (state) refreshApplicationCards(state);
        return;
      }
      // Cancel (collapse, revert to snapshot)
      const cancelTrigger = e.target?.closest?.("[data-app-cancel-inline]");
      if (cancelTrigger) {
        const idx = parseNonNegativeInt(cancelTrigger.dataset.appCancelInline);
        const snap = _expandedAppIndices.get(idx);
        _expandedAppIndices.delete(idx);
        const state = getState();
        if (!state) return;
        ensureTechniquesState(state);
        if (snap && state.techniques.applications[idx]) {
          state.techniques.applications[idx] = { ...snap };
        }
        if (_pendingNewApplicationIndex === idx) _pendingNewApplicationIndex = null;
        refreshApplicationCards(state);
        scheduleSave();
        return;
      }
      // Delete
      const removeTrigger = e.target?.closest?.("[data-app-remove-inline]");
      if (removeTrigger) {
        const state = getState();
        if (!state) return;
        ensureTechniquesState(state);
        const removeIdx = parseNonNegativeInt(removeTrigger.dataset.appRemoveInline);
        state.techniques.applications.splice(removeIdx, 1);
        state.techniques.applications = state.techniques.applications.map((entry, i) => normalizeApplication(entry, i));
        if (_pendingNewApplicationIndex !== null) _pendingNewApplicationIndex = null;
        _expandedAppIndices.clear();
        refreshApplicationCards(state);
        scheduleSave();
      }
      const stepDownTrigger = e.target?.closest?.("[data-app-step-down]");
      if (stepDownTrigger) {
        const state = getState();
        if (!state) return;
        const idx = parseNonNegativeInt(stepDownTrigger.dataset.appStepDown);
        const normalized = normalizeApplication(state.techniques.applications[idx], idx);
        if (state.techniques.applications[idx] && normalized.scalingEnabled) {
          state.techniques.applications[idx].currentStep = Math.max(0, normalized.currentStep - 1);
          syncApplicationButtonStates(state);
          scheduleSave();
        }
        return;
      }
      const stepUpTrigger = e.target?.closest?.("[data-app-step-up]");
      if (stepUpTrigger) {
        const state = getState();
        if (!state) return;
        const idx = parseNonNegativeInt(stepUpTrigger.dataset.appStepUp);
        const normalized = normalizeApplication(state.techniques.applications[idx], idx);
        if (state.techniques.applications[idx] && normalized.scalingEnabled) {
          state.techniques.applications[idx].currentStep = normalized.currentStep + 1;
          syncApplicationButtonStates(state);
          scheduleSave();
        }
        return;
      }
      // Cast/Use Application
      const castTrigger = e.target?.closest?.("[data-app-cast]");
      if (castTrigger) {
        const state = getState();
        if (!state) return;
        const idx = parseNonNegativeInt(castTrigger.dataset.appCast);
        performApplicationCast(state, 0, idx);
        syncApplicationButtonStates(state);
      }
    });
    summaryGrid.addEventListener("input", e => {
      const state = getState();
      if (!state) return;
      ensureTechniquesState(state);
      const titleAttr = e.target?.dataset?.appTitleInline;
      const descAttr = e.target?.dataset?.appDescInline;
      const costAttr = e.target?.dataset?.appCostInline;
      const scalingCeAttr = e.target?.dataset?.appScalingCeInline;
      const scalingDcAttr = e.target?.dataset?.appScalingDcInline;
      if (titleAttr !== undefined) {
        const idx = parseNonNegativeInt(titleAttr);
        if (state.techniques.applications[idx]) state.techniques.applications[idx].title = String(e.target.value || "");
      }
      if (descAttr !== undefined) {
        const idx = parseNonNegativeInt(descAttr);
        if (state.techniques.applications[idx]) state.techniques.applications[idx].description = String(e.target.value || "");
      }
      if (costAttr !== undefined) {
        const idx = parseNonNegativeInt(costAttr);
        if (state.techniques.applications[idx]) state.techniques.applications[idx].ceCost = parseNonNegativeInt(e.target.value);
      }
      if (scalingCeAttr !== undefined) {
        const idx = parseNonNegativeInt(scalingCeAttr);
        if (state.techniques.applications[idx]) state.techniques.applications[idx].scalingCeStep = parseNonNegativeInt(e.target.value);
      }
      if (scalingDcAttr !== undefined) {
        const idx = parseNonNegativeInt(scalingDcAttr);
        if (state.techniques.applications[idx]) state.techniques.applications[idx].scalingDcStep = parseNonNegativeInt(e.target.value);
      }
      const dcAttr = e.target?.dataset?.appDcInline;
      if (dcAttr !== undefined) {
        const idx = parseNonNegativeInt(dcAttr);
        if (state.techniques.applications[idx]) state.techniques.applications[idx].dc = parseNonNegativeInt(e.target.value);
      }
      const rangeAttr = e.target?.dataset?.appRangeInline;
      if (rangeAttr !== undefined) {
        const idx = parseNonNegativeInt(rangeAttr);
        if (state.techniques.applications[idx]) state.techniques.applications[idx].rangeValue = String(e.target.value || "").trim();
      }
      const aoeSizeAttr = e.target?.dataset?.appAoeSizeInline;
      if (aoeSizeAttr !== undefined) {
        const idx = parseNonNegativeInt(aoeSizeAttr);
        if (state.techniques.applications[idx]) state.techniques.applications[idx].aoeSize = String(e.target.value || "").trim();
      }
      const effectAttr = e.target?.dataset?.appEffectInline;
      if (effectAttr !== undefined) {
        const idx = parseNonNegativeInt(effectAttr);
        if (state.techniques.applications[idx]) state.techniques.applications[idx].effect = String(e.target.value || "");
      }
      scheduleSave();
    });

    summaryGrid.addEventListener("change", e => {
      const state = getState();
      if (!state) return;
      ensureTechniquesState(state);

      const rangeTypeAttr = e.target?.dataset?.appRangeTypeInline;
      const scalingToggleAttr = e.target?.dataset?.appScalingInline;
      if (scalingToggleAttr !== undefined) {
        const idx = parseNonNegativeInt(scalingToggleAttr);
        if (state.techniques.applications[idx]) {
          state.techniques.applications[idx].scalingEnabled = Boolean(e.target.checked);
          if (!state.techniques.applications[idx].scalingEnabled) state.techniques.applications[idx].currentStep = 0;
          refreshApplicationCards(state);
        }
        scheduleSave();
        return;
      }
      if (rangeTypeAttr !== undefined) {
        const idx = parseNonNegativeInt(rangeTypeAttr);
        if (state.techniques.applications[idx]) {
          state.techniques.applications[idx].rangeType = String(e.target.value || "self").toLowerCase();
          if (state.techniques.applications[idx].rangeType !== "range") state.techniques.applications[idx].rangeValue = "";
          if (state.techniques.applications[idx].rangeType !== "aoe") state.techniques.applications[idx].aoeSize = "";
          refreshApplicationCards(state);
        }
        scheduleSave();
        return;
      }

      const aoeShapeAttr = e.target?.dataset?.appAoeShapeInline;
      if (aoeShapeAttr !== undefined) {
        const idx = parseNonNegativeInt(aoeShapeAttr);
        if (state.techniques.applications[idx]) {
          state.techniques.applications[idx].aoeShape = String(e.target.value || "cone").toLowerCase();
          refreshApplicationCards(state);
        }
        scheduleSave();
      }
    });
  }

  const inlineNotesInput = document.getElementById("techniqueInlineNotesInput");
  if (inlineNotesInput) {
    inlineNotesInput.addEventListener("input", e => {
      const state = getState();
      if (!state) return;
      ensureTechniquesState(state);
      state.techniques.notes = String(e.target.value || "");
      const editorNotes = document.getElementById("techniqueNotesInput");
      if (editorNotes && document.activeElement !== editorNotes) editorNotes.value = state.techniques.notes;
      scheduleSave();
    });
  }

  const modeContinueBtn = document.getElementById("techniqueModeContinueBtn");
  if (modeContinueBtn) modeContinueBtn.addEventListener("click", continueTechniqueEditingFromMode);

  const cancelEditBtn = document.getElementById("techniqueEditCancelBtn");
  if (cancelEditBtn) cancelEditBtn.addEventListener("click", cancelTechniqueEditing);

  const backBtn = document.getElementById("techniqueBackToModeBtn");
  if (backBtn) backBtn.addEventListener("click", backToModeStep);

  const saveBtn = document.getElementById("techniqueSaveBtn");
  if (saveBtn) saveBtn.addEventListener("click", saveTechniqueEditing);

  const nameInput = document.getElementById("techniqueNameInput");
  if (nameInput) {
    nameInput.addEventListener("input", e => {
      const state = getState();
      if (!state) return;
      state.ct = e.target.value;
      const headerInput = document.getElementById("ctInput");
      if (headerInput && headerInput.value !== state.ct) headerInput.value = state.ct;
      updateTechniquesDerivedUI(state);
      scheduleSave();
    });
  }

  const addApplicationBtn = document.getElementById("addTechniqueApplicationBtn");
  if (addApplicationBtn) {
    addApplicationBtn.addEventListener("click", () => {
      const state = getState();
      if (!state) return;
      ensureTechniquesState(state);
      state.techniques.applications.push(createDefaultApplication(state.techniques.applications.length));
      renderApplicationsEditor(state);
      scheduleSave();
    });
  }

  const appList = document.getElementById("techniqueApplicationsList");
  if (appList) {
    appList.addEventListener("input", e => {
      const state = getState();
      if (!state) return;
      ensureTechniquesState(state);

      const titleIdx = parseNonNegativeInt(e.target?.dataset?.appTitle);
      const descIdx = parseNonNegativeInt(e.target?.dataset?.appDescription);
      const costIdx = parseNonNegativeInt(e.target?.dataset?.appCeCost);
      const dcIdx = parseNonNegativeInt(e.target?.dataset?.appDc);
      const rangeTypeIdx = parseNonNegativeInt(e.target?.dataset?.appRangeType);
      const rangeValueIdx = parseNonNegativeInt(e.target?.dataset?.appRangeValue);
      const aoeShapeIdx = parseNonNegativeInt(e.target?.dataset?.appAoeShape);
      const aoeSizeIdx = parseNonNegativeInt(e.target?.dataset?.appAoeSize);
      const effectIdx = parseNonNegativeInt(e.target?.dataset?.appEffect);
      const scalingIdx = parseNonNegativeInt(e.target?.dataset?.appScaling);
      const scalingCeIdx = parseNonNegativeInt(e.target?.dataset?.appScalingCe);
      const scalingDcIdx = parseNonNegativeInt(e.target?.dataset?.appScalingDc);

      if (e.target?.dataset?.appTitle !== undefined && state.techniques.applications[titleIdx]) {
        state.techniques.applications[titleIdx].title = String(e.target.value || "");
      }
      if (e.target?.dataset?.appDescription !== undefined && state.techniques.applications[descIdx]) {
        state.techniques.applications[descIdx].description = String(e.target.value || "");
      }
      if (e.target?.dataset?.appCeCost !== undefined && state.techniques.applications[costIdx]) {
        state.techniques.applications[costIdx].ceCost = parseNonNegativeInt(e.target.value);
      }
      if (e.target?.dataset?.appDc !== undefined && state.techniques.applications[dcIdx]) {
        state.techniques.applications[dcIdx].dc = parseNonNegativeInt(e.target.value);
      }
      if (e.target?.dataset?.appScaling !== undefined && state.techniques.applications[scalingIdx]) {
        state.techniques.applications[scalingIdx].scalingEnabled = Boolean(e.target.checked);
        if (!state.techniques.applications[scalingIdx].scalingEnabled) state.techniques.applications[scalingIdx].currentStep = 0;
        renderApplicationsEditor(state);
      }
      if (e.target?.dataset?.appScalingCe !== undefined && state.techniques.applications[scalingCeIdx]) {
        state.techniques.applications[scalingCeIdx].scalingCeStep = parseNonNegativeInt(e.target.value);
      }
      if (e.target?.dataset?.appScalingDc !== undefined && state.techniques.applications[scalingDcIdx]) {
        state.techniques.applications[scalingDcIdx].scalingDcStep = parseNonNegativeInt(e.target.value);
      }
      if (e.target?.dataset?.appRangeType !== undefined && state.techniques.applications[rangeTypeIdx]) {
        state.techniques.applications[rangeTypeIdx].rangeType = String(e.target.value || "self").toLowerCase();
        if (state.techniques.applications[rangeTypeIdx].rangeType !== "range") state.techniques.applications[rangeTypeIdx].rangeValue = "";
        if (state.techniques.applications[rangeTypeIdx].rangeType !== "aoe") state.techniques.applications[rangeTypeIdx].aoeSize = "";
        renderApplicationsEditor(state);
      }
      if (e.target?.dataset?.appRangeValue !== undefined && state.techniques.applications[rangeValueIdx]) {
        state.techniques.applications[rangeValueIdx].rangeValue = String(e.target.value || "").trim();
      }
      if (e.target?.dataset?.appAoeShape !== undefined && state.techniques.applications[aoeShapeIdx]) {
        state.techniques.applications[aoeShapeIdx].aoeShape = String(e.target.value || "cone").toLowerCase();
      }
      if (e.target?.dataset?.appAoeSize !== undefined && state.techniques.applications[aoeSizeIdx]) {
        state.techniques.applications[aoeSizeIdx].aoeSize = String(e.target.value || "").trim();
      }
      if (e.target?.dataset?.appEffect !== undefined && state.techniques.applications[effectIdx]) {
        state.techniques.applications[effectIdx].effect = String(e.target.value || "");
      }

      scheduleSave();
    });

    appList.addEventListener("click", e => {
      const removeIdxRaw = e.target?.dataset?.appRemove;
      if (removeIdxRaw === undefined) return;
      const state = getState();
      if (!state) return;
      ensureTechniquesState(state);
      const removeIdx = parseNonNegativeInt(removeIdxRaw);
      state.techniques.applications.splice(removeIdx, 1);
      state.techniques.applications = state.techniques.applications.map((entry, idx) => normalizeApplication(entry, idx));
      renderApplicationsEditor(state);
      scheduleSave();
    });
  }

  const noCtPathSelect = document.getElementById("noCtPathSelect");
  if (noCtPathSelect) {
    noCtPathSelect.addEventListener("change", e => {
      const state = getState();
      if (!state) return;
      ensureTechniquesState(state);
      state.techniques.noCtPath = e.target.value;
      scheduleSave();
    });
  }

  const notesInput = document.getElementById("techniqueNotesInput");
  if (notesInput) {
    notesInput.addEventListener("input", e => {
      const state = getState();
      if (!state) return;
      ensureTechniquesState(state);
      state.techniques.notes = e.target.value;      const inlineNotes = document.getElementById("techniqueInlineNotesInput");
      if (inlineNotes && document.activeElement !== inlineNotes) inlineNotes.value = state.techniques.notes;      scheduleSave();
    });
  }

  const addBindingVowBtn = document.getElementById("addBindingVowBtn");
  if (addBindingVowBtn) {
    addBindingVowBtn.addEventListener("click", () => {
      const state = getState();
      if (!state) return;
      ensureTechniquesState(state);
      const newIndex = state.techniques.bindingVows.length;
      state.techniques.bindingVows.push(createDefaultBindingVow(newIndex));
      const list = document.getElementById("bindingVowsList");
      const emptyState = list?.querySelector?.(".techniques-app-empty");
      if (emptyState) emptyState.remove();
      if (list) {
        list.insertAdjacentHTML("beforeend", renderBindingVowEditorItem(state.techniques.bindingVows[newIndex], newIndex, true));
      } else {
        _pendingNewVowIndex = newIndex;
        renderBindingVowsEditor(state);
      }
      _pendingNewVowIndex = null;
      scheduleSave();
    });
  }

  const bindingVowsList = document.getElementById("bindingVowsList");
  if (bindingVowsList) {
    bindingVowsList.addEventListener("input", e => {
      const state = getState();
      if (!state) return;
      ensureTechniquesState(state);

      const titleIdx = parseNonNegativeInt(e.target?.dataset?.vowTitle);
      const benefitsIdx = parseNonNegativeInt(e.target?.dataset?.vowBenefits);
      const conditionsIdx = parseNonNegativeInt(e.target?.dataset?.vowConditions);

      if (e.target?.dataset?.vowTitle !== undefined && state.techniques.bindingVows[titleIdx]) {
        state.techniques.bindingVows[titleIdx].title = String(e.target.value || "");
      }
      if (e.target?.dataset?.vowBenefits !== undefined && state.techniques.bindingVows[benefitsIdx]) {
        state.techniques.bindingVows[benefitsIdx].benefits = String(e.target.value || "");
      }
      if (e.target?.dataset?.vowConditions !== undefined && state.techniques.bindingVows[conditionsIdx]) {
        state.techniques.bindingVows[conditionsIdx].conditions = String(e.target.value || "");
      }

      scheduleSave();
    });

    bindingVowsList.addEventListener("click", e => {
      const removeTrigger = e.target?.closest?.("[data-vow-remove]");
      const removeIdxRaw = removeTrigger?.dataset?.vowRemove;
      if (removeIdxRaw === undefined) return;
      const state = getState();
      if (!state) return;
      ensureTechniquesState(state);
      const removeIdx = parseNonNegativeInt(removeIdxRaw);
      state.techniques.bindingVows.splice(removeIdx, 1);
      state.techniques.bindingVows = state.techniques.bindingVows.map((entry, idx) => normalizeBindingVow(entry, idx));
      renderBindingVowsEditor(state);
      scheduleSave();
    });
  }

  const headerCtInput = document.getElementById("ctInput");
  if (headerCtInput) {
    headerCtInput.addEventListener("input", syncTechniqueNameInput);
    headerCtInput.addEventListener("change", syncTechniqueNameInput);
  }

  _initialized = true;
  applyTechniquesStateToUI();
}
