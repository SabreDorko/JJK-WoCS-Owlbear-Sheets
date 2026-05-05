import { ARCHETYPES, CENTER_STATS, RIGHT_STATS } from "./state/store.js";
import { computeActiveModifierEffects, applyDirectModifiers, normalizeDirectModifierList } from "./modifiers.js";
import { updateTechniquesDerivedUI } from "./techniques.js";

let _getState = null;
let _scheduleSave = null;
let _showRollToast = null;
let _initialized = false;
let _isOverrideMode = false;
let _rollModeMenu = null;
let _pendingRollModeAction = null;
let _pendingRollModeModifierAction = null;
let _activeDirectModifierTarget = null;
let _editingDirectModifierId = null;
let _refreshCombatTab = null;

const DIRECT_DERIVED_LABELS = {
  hpMax: "Max HP",
  ceMax: "Max CE",
  ac: "Armor Class",
  movement: "Movement",
  aptitudeBonus: "Aptitude Bonus",
};

function getState() {
  return _getState ? _getState() : null;
}

function scheduleSave() {
  if (_scheduleSave) _scheduleSave();
}

function ensureOverrideState(state) {
  if (!state.overrides || typeof state.overrides !== "object") state.overrides = {};
  if (!state.overrides.derived || typeof state.overrides.derived !== "object") state.overrides.derived = {};
  if (!state.overrides.subskills || typeof state.overrides.subskills !== "object") state.overrides.subskills = {};
}

function ensureRestState(state) {
  if (!state || typeof state !== "object") return;
  if (!state.restState || typeof state.restState !== "object") state.restState = {};
  state.restState.quickRestUsed = Boolean(state.restState.quickRestUsed);
}

function ensureDirectModifierState(state) {
  if (!state || typeof state !== "object") return;
  if (!Array.isArray(state.directModifiers)) state.directModifiers = [];
}

function parseDirectModifierValue(rawValue, operation = "add") {
  const parsed = parseFloat(rawValue);
  if (!Number.isFinite(parsed)) return null;
  if (operation === "add") {
    if (parsed === 0) return null;
    return Math.max(-999, Math.min(999, parsed));
  }
  if (operation === "multiply") return Math.max(-50, Math.min(50, parsed));
  if (operation === "divide") {
    if (parsed === 0) return null;
    return Math.max(-50, Math.min(50, parsed));
  }
  return null;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function getStatLabel(statKey) {
  const def = [...CENTER_STATS, ...RIGHT_STATS].find(entry => entry.key === statKey);
  if (!def) return "Stat";
  return def.label.charAt(0) + def.label.slice(1).toLowerCase();
}

function parseSubskillTargetKey(targetKey) {
  const [statKey, rawSkillIndex] = String(targetKey || "").split(":");
  const skillIndex = parseInt(rawSkillIndex, 10);
  if (!statKey || !Number.isInteger(skillIndex)) return null;
  const statDef = [...CENTER_STATS, ...RIGHT_STATS].find(entry => entry.key === statKey);
  if (!statDef || skillIndex < 0 || skillIndex >= statDef.skills.length) return null;
  return { statKey, skillIndex, skillName: statDef.skills[skillIndex], statLabel: getStatLabel(statKey) };
}

function getDirectModifierTargetLabel(targetType, targetKey) {
  if (targetType === "stat") return `${getStatLabel(targetKey)} Level`;
  if (targetType === "statRoll") return `${getStatLabel(targetKey)} Rolls`;
  if (targetType === "subskill") {
    const parsed = parseSubskillTargetKey(targetKey);
    if (!parsed) return "Substat";
    return `${parsed.skillName} (${parsed.statLabel})`;
  }
  if (targetType === "derived") return DIRECT_DERIVED_LABELS[targetKey] || "Derived Field";
  return "Modifier Target";
}

function getTargetDirectModifiers(state, targetType, targetKey) {
  ensureDirectModifierState(state);
  return normalizeDirectModifierList(state.directModifiers)
    .filter(entry => entry.targetType === targetType && entry.targetKey === targetKey);
}

function hasDirectModifiers(state, targetType, targetKey) {
  return getTargetDirectModifiers(state, targetType, targetKey).length > 0;
}

function hasAnyStatDirectModifiers(state, statKey) {
  return hasDirectModifiers(state, "stat", statKey) || hasDirectModifiers(state, "statRoll", statKey);
}

function setModifiedBadgeState(badgeEl, isVisible) {
  if (!badgeEl) return;
  badgeEl.classList.toggle("visible", Boolean(isVisible));
  badgeEl.title = isVisible ? "Modified" : "";
  badgeEl.setAttribute("aria-label", isVisible ? "Modified" : "");
  badgeEl.tabIndex = isVisible ? 0 : -1;
  badgeEl.setAttribute("role", "button");
}

function ensureVitalModifierBadge(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return null;

  let badge = container.querySelector(".direct-modified-badge.vital-mod-badge");
  if (!badge) {
    badge = document.createElement("span");
    badge.className = "direct-modified-badge vital-mod-badge";
    container.appendChild(badge);
  }

  return badge;
}

function updateDerivedModifierBadges(state) {
  const configs = [
    ["hpVitalBox", "derived", "hpMax"],
    ["ceVitalBox", "derived", "ceMax"],
    ["acVitalBox", "derived", "ac"],
    ["movementVitalBox", "derived", "movement"],
    ["aptitudeBonusVitalBox", "derived", "aptitudeBonus"],
  ];

  configs.forEach(([containerId, targetType, targetKey]) => {
    const badge = ensureVitalModifierBadge(containerId);
    if (badge && !badge.dataset.boundClick) {
      badge.dataset.boundClick = "true";
      badge.addEventListener("click", e => {
        e.preventDefault();
        e.stopPropagation();
        if (!badge.classList.contains("visible")) return;
        openDirectModifierPanel(targetType, targetKey);
      });
      badge.addEventListener("keydown", e => {
        if (e.key !== "Enter" && e.key !== " ") return;
        e.preventDefault();
        e.stopPropagation();
        if (!badge.classList.contains("visible")) return;
        openDirectModifierPanel(targetType, targetKey);
      });
    }
    setModifiedBadgeState(badge, hasDirectModifiers(state, targetType, targetKey));
  });
}

function getDirectModifierOperationLabel(operation, value) {
  if (operation === "multiply") return `x${value}`;
  if (operation === "divide") return `/${value}`;
  return formatSignedValue(value);
}

function formatSignedValue(value) {
  return value >= 0 ? `+${value}` : `${value}`;
}

function applyDirectModifiersForTarget(state, targetType, targetKey, baseValue) {
  const entries = getTargetDirectModifiers(state, targetType, targetKey);
  return applyDirectModifiers(baseValue, entries);
}

function getDirectModifierSummaryDelta(state, targetType, targetKey, baseValue) {
  const totalValue = applyDirectModifiersForTarget(state, targetType, targetKey, baseValue);
  return {
    baseValue,
    totalValue,
    deltaValue: totalValue - baseValue,
  };
}

function parseOptionalInt(rawValue) {
  const parsed = parseInt(rawValue, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function getSubskillKey(statKey, skillIndex) {
  return `${statKey}:${skillIndex}`;
}

function getSubskillOverride(state, statKey, skillIndex) {
  ensureOverrideState(state);
  const value = parseOptionalInt(state.overrides.subskills[getSubskillKey(statKey, skillIndex)]);
  return Number.isFinite(value) ? value : null;
}

function setSubskillOverride(state, statKey, skillIndex, value) {
  ensureOverrideState(state);
  const key = getSubskillKey(statKey, skillIndex);
  const parsed = parseOptionalInt(value);
  if (!Number.isFinite(parsed)) delete state.overrides.subskills[key];
  else state.overrides.subskills[key] = parsed;
}

function getDerivedOverride(state, fieldKey) {
  ensureOverrideState(state);
  const value = parseOptionalInt(state.overrides.derived[fieldKey]);
  return Number.isFinite(value) ? value : null;
}

function setDerivedOverride(state, fieldKey, value) {
  ensureOverrideState(state);
  const parsed = parseOptionalInt(value);
  if (!Number.isFinite(parsed)) delete state.overrides.derived[fieldKey];
  else state.overrides.derived[fieldKey] = parsed;
}

function getNextAptitudeActionLabel(currentAptitude, isOverrideMode = false) {
  if (isOverrideMode) {
    if (currentAptitude <= 0) return "Set as Aptitude";
    if (currentAptitude === 1) return "Set as Permanent Aptitude";
    return "Clear Aptitude";
  }
  if (currentAptitude <= 0) return "Set as Aptitude";
  return "Clear Aptitude";
}

function showRollToast(statLabel, diceCount, rolls, total, critStatus, skillName, breakdown, rollMode) {
  if (_showRollToast) {
    _showRollToast(statLabel, diceCount, rolls, total, critStatus, skillName, breakdown, rollMode);
  }
}

function rollDicePool(diceCount) {
  return Array.from({ length: diceCount }, () => Math.floor(Math.random() * 6) + 1);
}

function buildComparedBreakdown(baseBreakdown, rollMode, firstRolls, firstTotal, secondRolls, secondTotal, selectedIndex) {
  if (rollMode !== "advantage" && rollMode !== "disadvantage") return baseBreakdown;
  return {
    ...baseBreakdown,
    rollMode,
    comparedRolls: [firstRolls, secondRolls],
    comparedTotals: [firstTotal, secondTotal],
    selectedRollIndex: selectedIndex,
  };
}

function rollWithMode(diceCount, computeTotal, rollMode = "normal") {
  const firstRolls = rollDicePool(diceCount);
  const firstTotal = computeTotal(firstRolls);
  if (rollMode !== "advantage" && rollMode !== "disadvantage") {
    return {
      rolls: firstRolls,
      total: firstTotal,
      selectedRollIndex: 0,
      firstRolls,
      firstTotal,
      secondRolls: null,
      secondTotal: null,
    };
  }

  const secondRolls = rollDicePool(diceCount);
  const secondTotal = computeTotal(secondRolls);
  const selectedRollIndex = rollMode === "advantage"
    ? (firstTotal >= secondTotal ? 0 : 1)
    : (firstTotal <= secondTotal ? 0 : 1);

  return {
    rolls: selectedRollIndex === 0 ? firstRolls : secondRolls,
    total: selectedRollIndex === 0 ? firstTotal : secondTotal,
    selectedRollIndex,
    firstRolls,
    firstTotal,
    secondRolls,
    secondTotal,
  };
}

function closeRollModeMenu() {
  if (!_rollModeMenu) return;
  _rollModeMenu.hidden = true;
  _pendingRollModeAction = null;
  _pendingRollModeModifierAction = null;
}

function ensureRollModeMenu() {
  if (_rollModeMenu) return _rollModeMenu;

  const menu = document.createElement("div");
  menu.className = "roll-mode-menu";
  menu.hidden = true;
  menu.innerHTML = `
    <button type="button" class="roll-mode-item" data-roll-mode="advantage">Roll with Advantage</button>
    <button type="button" class="roll-mode-item" data-roll-mode="disadvantage">Roll with Disadvantage</button>
    <button type="button" class="roll-mode-item" data-roll-mode="normal">Normal Roll</button>
    <div class="roll-mode-divider" data-roll-mode-divider hidden></div>
    <button type="button" class="roll-mode-item" data-roll-mode-action="addModifier" hidden>Add Modifier</button>
  `;

  menu.addEventListener("click", e => {
    const modifierButton = e.target.closest("[data-roll-mode-action]");
    if (modifierButton) {
      const modifierAction = _pendingRollModeModifierAction;
      closeRollModeMenu();
      if (modifierAction) modifierAction();
      return;
    }

    const button = e.target.closest("[data-roll-mode]");
    if (!button) return;
    const selectedMode = button.dataset.rollMode;
    const action = _pendingRollModeAction;
    closeRollModeMenu();
    if (action && selectedMode) action(selectedMode);
  });

  document.body.appendChild(menu);
  document.addEventListener("click", closeRollModeMenu);
  document.addEventListener("scroll", closeRollModeMenu, true);
  document.addEventListener("keydown", e => {
    if (e.key === "Escape") closeRollModeMenu();
  });

  _rollModeMenu = menu;
  return menu;
}

function openRollModeMenu(event, onSelectMode, options = {}) {
  event.preventDefault();
  event.stopPropagation();

  const menu = ensureRollModeMenu();
  _pendingRollModeAction = onSelectMode;
  _pendingRollModeModifierAction = typeof options?.onAddModifier === "function"
    ? options.onAddModifier
    : null;

  const modifierButton = menu.querySelector("[data-roll-mode-action='addModifier']");
  const divider = menu.querySelector("[data-roll-mode-divider]");
  const showModifierAction = Boolean(_pendingRollModeModifierAction);
  if (modifierButton) modifierButton.hidden = !showModifierAction;
  if (divider) divider.hidden = !showModifierAction;

  menu.hidden = false;
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const rect = menu.getBoundingClientRect();
  const left = Math.max(8, Math.min(event.clientX, viewportWidth - rect.width - 8));
  const top = Math.max(8, Math.min(event.clientY, viewportHeight - rect.height - 8));
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
}

function getModifierContextMenu() {
  return document.getElementById("sheetModifierContextMenu");
}

function closeModifierContextMenu() {
  const menu = getModifierContextMenu();
  if (!menu) return;
  menu.hidden = true;
  menu.dataset.targetType = "";
  menu.dataset.targetKey = "";
  menu.dataset.targetLabel = "";
}

function openModifierContextMenu(event, targetType, targetKey) {
  event.preventDefault();
  event.stopPropagation();

  const menu = getModifierContextMenu();
  if (!menu) return;

  menu.hidden = false;
  menu.dataset.targetType = targetType;
  menu.dataset.targetKey = targetKey;
  menu.dataset.targetLabel = getDirectModifierTargetLabel(targetType, targetKey);
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const rect = menu.getBoundingClientRect();
  const left = Math.max(8, Math.min(event.clientX, viewportWidth - rect.width - 8));
  const top = Math.max(8, Math.min(event.clientY, viewportHeight - rect.height - 8));
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
}

function getDirectModifierTargetValues(state, targetType, targetKey, effects) {
  if (targetType === "stat") {
    const baseValue = getEffectiveStatLevel(state, effects, targetKey, { includeDirect: false });
    return getDirectModifierSummaryDelta(state, targetType, targetKey, baseValue);
  }

  if (targetType === "statRoll") {
    const baseEffects = computeActiveModifierEffects({ ...state, directModifiers: [] });
    const baseValue = baseEffects?.rollBonuses?.[targetKey] || 0;
    return getDirectModifierSummaryDelta(state, targetType, targetKey, baseValue);
  }

  if (targetType === "subskill") {
    const parsed = parseSubskillTargetKey(targetKey);
    if (!parsed) return { baseValue: 0, totalValue: 0, deltaValue: 0 };
    const baseValue = getSubskillValue(state, effects, parsed.statKey, parsed.skillIndex, { includeDirect: false });
    return getDirectModifierSummaryDelta(state, targetType, targetKey, baseValue);
  }

  if (targetType === "derived") {
    if (targetKey === "aptitudeBonus") {
      const baseValue = getAptitudeBonusValue(state, effects, { includeDirect: false });
      return getDirectModifierSummaryDelta(state, targetType, targetKey, baseValue);
    }

    let baseValue = 0;
    if (targetKey === "hpMax") {
      const powerLevel = getEffectiveStatLevel(state, effects, "power");
      baseValue = Math.max(1, 10 + (powerLevel * 5));
      baseValue = Math.max(1, getDerivedOverride(state, "hpMax") ?? baseValue);
    } else if (targetKey === "ceMax") {
      const techniqueLevel = getEffectiveStatLevel(state, effects, "technique");
      const domainCtBonus = state?.techniques?.mode === "domain" ? 10 : 0;
      baseValue = Math.max(1, 15 + (techniqueLevel * 5) + domainCtBonus);
      baseValue = Math.max(1, getDerivedOverride(state, "ceMax") ?? baseValue);
    } else if (targetKey === "ac") {
      const techniqueLevel = getEffectiveStatLevel(state, effects, "technique");
      const speedLevel = getEffectiveStatLevel(state, effects, "speed");
      baseValue = Math.max(0, techniqueLevel + speedLevel + (effects?.acBonus || 0));
      baseValue = Math.max(0, getDerivedOverride(state, "ac") ?? baseValue);
    } else if (targetKey === "movement") {
      const speedLevel = getEffectiveStatLevel(state, effects, "speed");
      baseValue = Math.max(0, 30 + (speedLevel * 5) + (effects?.movementBonus || 0));
      baseValue = Math.max(0, getDerivedOverride(state, "movement") ?? baseValue);
    }
    return getDirectModifierSummaryDelta(state, targetType, targetKey, baseValue);
  }

  return { baseValue: 0, totalValue: 0, deltaValue: 0 };
}

function setDirectModifierFormOpen(isOpen) {
  const form = document.getElementById("sheetModifierForm");
  if (!form) return;
  if (!isOpen) {
    form.classList.remove("is-open");
    setTimeout(() => {
      if (!form.classList.contains("is-open")) form.hidden = true;
    }, 160);
    return;
  }
  form.hidden = false;
  requestAnimationFrame(() => form.classList.add("is-open"));
}

function syncDirectModifierOperationAvailability() {
  const operationInput = document.getElementById("sheetModifierOperationInput");
  if (!operationInput) return;
  const isRollTarget = _activeDirectModifierTarget?.targetType === "statRoll";
  [...operationInput.options].forEach(option => {
    if (!option) return;
    option.disabled = isRollTarget && option.value !== "add";
  });
  if (isRollTarget && operationInput.value !== "add") operationInput.value = "add";
}

function closeDirectModifierPanel() {
  const panel = document.getElementById("sheetModifierPanel");
  if (!panel) return;
  panel.classList.remove("is-open");
  setTimeout(() => {
    if (!panel.classList.contains("is-open")) panel.hidden = true;
  }, 220);
  _activeDirectModifierTarget = null;
  _editingDirectModifierId = null;
  setDirectModifierFormOpen(false);
}

function renderDirectModifierPanel() {
  const state = getState();
  const panel = document.getElementById("sheetModifierPanel");
  if (!state || !panel || !_activeDirectModifierTarget) return;
  ensureDirectModifierState(state);

  const { targetType, targetKey, label } = _activeDirectModifierTarget;
  const effects = computeActiveModifierEffects(state);
  const totals = getDirectModifierTargetValues(state, targetType, targetKey, effects);
  const entries = getTargetDirectModifiers(state, targetType, targetKey);

  const headingEl = document.getElementById("sheetModifierTargetLabel");
  const baseEl = document.getElementById("sheetModifierBaseValue");
  const deltaEl = document.getElementById("sheetModifierDeltaValue");
  const totalEl = document.getElementById("sheetModifierTotalValue");
  const listEl = document.getElementById("sheetModifierList");

  if (headingEl) headingEl.textContent = label || getDirectModifierTargetLabel(targetType, targetKey);
  if (baseEl) baseEl.textContent = `${Math.round(totals.baseValue * 1000) / 1000}`;
  if (deltaEl) deltaEl.textContent = formatSignedValue(Math.round(totals.deltaValue * 1000) / 1000);
  if (totalEl) totalEl.textContent = `${Math.round(totals.totalValue * 1000) / 1000}`;

  if (!listEl) return;
  const addRow = `
    <button type="button" id="sheetModifierAddBtn" class="sheet-modifier-add-row">
      + Add Modifier
    </button>
  `;

  if (!entries.length) {
    listEl.innerHTML = `<div class="sheet-modifier-empty">No direct modifiers yet.</div>${addRow}`;
    return;
  }

  listEl.innerHTML = entries.map(entry => {
    const sourceText = entry.source ? escapeHtml(entry.source) : "No source";
    const modifierLabel = getDirectModifierOperationLabel(entry.operation, entry.value);
    return `
      <div class="sheet-modifier-row" data-direct-modifier-id="${escapeHtml(entry.id)}">
        <div class="sheet-modifier-row-main">
          <span class="sheet-modifier-row-value">${modifierLabel}</span>
          <span class="sheet-modifier-row-source">${sourceText}</span>
        </div>
        <div class="sheet-modifier-row-actions">
          <button type="button" class="inventory-mini-btn" data-action="editDirectModifier" data-modifier-id="${escapeHtml(entry.id)}">Edit</button>
          <button type="button" class="inventory-mini-btn danger" data-action="removeDirectModifier" data-modifier-id="${escapeHtml(entry.id)}">Remove</button>
        </div>
      </div>
    `;
  }).join("") + addRow;
}

function openDirectModifierPanel(targetType, targetKey) {
  const panel = document.getElementById("sheetModifierPanel");
  const statModeWrap = document.getElementById("sheetModifierStatTargetModeWrap");
  const statModeSelect = document.getElementById("sheetModifierStatTargetMode");
  if (!panel) return;

  const resolvedType = targetType === "statRoll" ? "statRoll" : targetType;
  _activeDirectModifierTarget = {
    targetType: resolvedType,
    targetKey,
    label: getDirectModifierTargetLabel(resolvedType, targetKey),
  };

  const isStatTarget = resolvedType === "stat" || resolvedType === "statRoll";
  if (statModeWrap) statModeWrap.hidden = !isStatTarget;
  if (statModeSelect && isStatTarget) statModeSelect.value = resolvedType;

  _editingDirectModifierId = null;
  syncDirectModifierOperationAvailability();
  panel.hidden = false;
  requestAnimationFrame(() => panel.classList.add("is-open"));
  setDirectModifierFormOpen(false);
  renderDirectModifierPanel();
}

function addDirectModifierFromForm() {
  const state = getState();
  if (!state || !_activeDirectModifierTarget) return;

  const valueInput = document.getElementById("sheetModifierValueInput");
  const sourceInput = document.getElementById("sheetModifierSourceInput");
  const operationInput = document.getElementById("sheetModifierOperationInput");
  if (!valueInput || !sourceInput || !operationInput) return;

  const operation = operationInput.value || "add";
  const value = parseDirectModifierValue(valueInput.value, operation);
  if (!Number.isFinite(value)) {
    valueInput.focus();
    return;
  }

  ensureDirectModifierState(state);
  const normalized = normalizeDirectModifierList(state.directModifiers);
  const editingIndex = normalized.findIndex(entry => entry.id === _editingDirectModifierId);
  const nextEntry = {
    id: _editingDirectModifierId || `direct_mod_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    targetType: _activeDirectModifierTarget.targetType,
    targetKey: _activeDirectModifierTarget.targetKey,
    operation,
    value,
    source: sourceInput.value,
  };

  if (editingIndex >= 0) normalized[editingIndex] = nextEntry;
  else normalized.push(nextEntry);
  state.directModifiers = normalizeDirectModifierList(normalized);

  valueInput.value = "";
  sourceInput.value = "";
  operationInput.value = "add";
  _editingDirectModifierId = null;
  setDirectModifierFormOpen(false);
  applyCharacterStateToUI();
  scheduleSave();
}

function removeDirectModifier(modifierId, rowEl = null) {
  const state = getState();
  if (!state || !modifierId) return;
  ensureDirectModifierState(state);

  if (rowEl) {
    rowEl.classList.add("is-removing");
    setTimeout(() => removeDirectModifier(modifierId, null), 170);
    return;
  }

  const beforeCount = state.directModifiers.length;
  state.directModifiers = normalizeDirectModifierList(state.directModifiers)
    .filter(entry => entry.id !== modifierId);
  if (state.directModifiers.length === beforeCount) return;

  applyCharacterStateToUI();
  scheduleSave();
}

function beginEditDirectModifier(modifierId) {
  const state = getState();
  if (!state || !_activeDirectModifierTarget || !modifierId) return;

  const targetModifiers = getTargetDirectModifiers(
    state,
    _activeDirectModifierTarget.targetType,
    _activeDirectModifierTarget.targetKey,
  );
  const current = targetModifiers.find(entry => entry.id === modifierId);
  if (!current) return;

  const valueInput = document.getElementById("sheetModifierValueInput");
  const sourceInput = document.getElementById("sheetModifierSourceInput");
  const operationInput = document.getElementById("sheetModifierOperationInput");
  if (!valueInput || !sourceInput || !operationInput) return;

  _editingDirectModifierId = modifierId;
  operationInput.value = current.operation || "add";
  syncDirectModifierOperationAvailability();
  valueInput.value = String(current.value);
  valueInput.step = operationInput.value === "add" ? "1" : "0.1";
  sourceInput.value = current.source || "";
  setDirectModifierFormOpen(true);
  valueInput.focus();
}

function initDirectModifierUI() {
  const menu = getModifierContextMenu();
  const menuBtn = document.getElementById("sheetModifierContextAdjustBtn");
  const panel = document.getElementById("sheetModifierPanel");
  const closeBtn = document.getElementById("sheetModifierCloseBtn");
  const saveBtn = document.getElementById("sheetModifierSaveBtn");
  const cancelBtn = document.getElementById("sheetModifierCancelBtn");
  const listEl = document.getElementById("sheetModifierList");
  const operationInput = document.getElementById("sheetModifierOperationInput");
  const statModeSelect = document.getElementById("sheetModifierStatTargetMode");

  if (!menu || !menuBtn || !panel || !closeBtn || !saveBtn || !cancelBtn || !listEl || !operationInput) return;

  menuBtn.addEventListener("click", e => {
    e.preventDefault();
    e.stopPropagation();
    const targetType = menu.dataset.targetType;
    const targetKey = menu.dataset.targetKey;
    closeModifierContextMenu();
    if (!targetType || !targetKey) return;
    // Defer panel open so document-level click handlers from this same click cannot close it.
    setTimeout(() => openDirectModifierPanel(targetType, targetKey), 0);
  });

  closeBtn.addEventListener("click", closeDirectModifierPanel);

  saveBtn.addEventListener("click", addDirectModifierFromForm);
  cancelBtn.addEventListener("click", () => {
    _editingDirectModifierId = null;
    setDirectModifierFormOpen(false);
  });

  operationInput.addEventListener("change", () => {
    const valueInput = document.getElementById("sheetModifierValueInput");
    if (!valueInput) return;
    valueInput.step = operationInput.value === "add" ? "1" : "0.1";
  });

  if (statModeSelect) {
    statModeSelect.addEventListener("change", () => {
      if (!_activeDirectModifierTarget || _activeDirectModifierTarget.targetType === "subskill" || _activeDirectModifierTarget.targetType === "derived") return;
      const nextType = statModeSelect.value === "statRoll" ? "statRoll" : "stat";
      _activeDirectModifierTarget.targetType = nextType;
      _activeDirectModifierTarget.label = getDirectModifierTargetLabel(nextType, _activeDirectModifierTarget.targetKey);
      _editingDirectModifierId = null;
      setDirectModifierFormOpen(false);
      syncDirectModifierOperationAvailability();
      renderDirectModifierPanel();
    });
  }

  listEl.addEventListener("click", e => {
    const addBtn = e.target.closest("#sheetModifierAddBtn");
    if (addBtn) {
      _editingDirectModifierId = null;
      const valueInput = document.getElementById("sheetModifierValueInput");
      const sourceInput = document.getElementById("sheetModifierSourceInput");
      const operationInputInner = document.getElementById("sheetModifierOperationInput");
      if (valueInput) valueInput.value = "";
      if (sourceInput) sourceInput.value = "";
      if (operationInputInner) operationInputInner.value = "add";
      if (valueInput) valueInput.step = "1";
      syncDirectModifierOperationAvailability();
      setDirectModifierFormOpen(true);
      if (valueInput) valueInput.focus();
      return;
    }

    const editBtn = e.target.closest("button[data-action='editDirectModifier']");
    if (editBtn) {
      beginEditDirectModifier(editBtn.dataset.modifierId || "");
      return;
    }

    const removeBtn = e.target.closest("button[data-action='removeDirectModifier']");
    if (removeBtn) {
      const row = removeBtn.closest(".sheet-modifier-row");
      removeDirectModifier(removeBtn.dataset.modifierId || "", row);
    }
  });

  document.addEventListener("click", e => {
    if (!menu.hidden && !menu.contains(e.target)) closeModifierContextMenu();
  });

  document.addEventListener("scroll", () => closeModifierContextMenu(), true);
  document.addEventListener("keydown", e => {
    if (e.key === "Escape") {
      closeModifierContextMenu();
      closeDirectModifierPanel();
    }
  });
}

function getBlackFlashRange(techniqueScore) {
  if (!Number.isFinite(techniqueScore) || techniqueScore < 2) return null;
  if (techniqueScore > 7) return null;
  return (techniqueScore * 4) + 4;
}

function parseStatScore(rawValue) {
  const parsed = parseInt(rawValue, 10);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, parsed);
}

function getAptitudeState(skillState) {
  const parsed = parseInt(skillState?.aptitude, 10);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.min(2, parsed));
}

function parseXpValue(rawValue) {
  const parsed = parseInt(rawValue, 10);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, parsed);
}

export function promoteStatFromFullAptitudes(state, statKey) {
  const statState = state?.stats?.[statKey];
  if (!statState || !Array.isArray(statState.skills) || !statState.skills.length) return false;

  const temporaryAptitudeIndices = [];
  for (let i = 0; i < statState.skills.length; i += 1) {
    const lockedFromArchetype = getArchetypePermanentAptitudeSource(state, statKey, i);
    const aptitudeState = getAptitudeState(statState.skills[i]);
    const hasAptitude = Boolean(lockedFromArchetype) || aptitudeState > 0;
    if (!hasAptitude) return false;
    if (!lockedFromArchetype && aptitudeState === 1) temporaryAptitudeIndices.push(i);
  }

  // Only consume temporary aptitudes; permanent aptitudes are preserved.
  if (!temporaryAptitudeIndices.length) return false;

  const newStatValue = parseStatScore(statState.score) + 1;
  statState.score = String(newStatValue);
  state.xp = String(parseXpValue(state.xp) + newStatValue);
  temporaryAptitudeIndices.forEach(index => {
    const currentSkill = statState.skills[index] || { aptitude: 0 };
    statState.skills[index] = { ...currentSkill, aptitude: 0, trainedAptitude: false, overriddenAptitude: false };
  });
  return true;
}

function getDisplayedTechniqueName(state) {
  const mode = String(state?.techniques?.mode || "none");
  const name = String(state?.ct || "").trim();
  if (mode === "none") return "No Technique";
  return name || "No Technique";
}

function parseResourceValue(rawValue) {
  const parsed = parseInt(rawValue, 10);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, parsed);
}

function applyRestRecovery(state, kind) {
  ensureRestState(state);

  if (kind === "quick" && state.restState.quickRestUsed) return false;

  const hpCurrent = parseResourceValue(state.hpCurrent);
  const hpMax = parseResourceValue(state.hpMax);
  const ceCurrent = parseResourceValue(state.ceCurrent);
  const ceMax = parseResourceValue(state.ceMax);

  if (kind === "full") {
    state.hpCurrent = String(hpMax);
    state.ceCurrent = String(ceMax);
    state.restState.quickRestUsed = false;
    return true;
  }

  const fraction = kind === "short" ? 0.5 : 0.25;
  const hpRecovered = hpMax > 0 ? Math.max(1, Math.floor(hpMax * fraction)) : 0;
  const ceRecovered = ceMax > 0 ? Math.max(1, Math.floor(ceMax * fraction)) : 0;
  state.hpCurrent = String(Math.min(hpMax, hpCurrent + hpRecovered));
  state.ceCurrent = String(Math.min(ceMax, ceCurrent + ceRecovered));
  if (kind === "quick") state.restState.quickRestUsed = true;
  return true;
}

function setRestPopoverOpen(isOpen) {
  const restBtn = document.getElementById("restBtn");
  const popover = document.getElementById("restOptionsPopover");
  if (!restBtn || !popover) return;
  restBtn.setAttribute("aria-expanded", isOpen ? "true" : "false");
  popover.hidden = !isOpen;
}

function syncRestControlsUI(state) {
  ensureRestState(state);
  const quickRestBtn = document.getElementById("quickRestBtn");
  if (!quickRestBtn) return;

  const disabled = Boolean(state.restState.quickRestUsed);
  quickRestBtn.disabled = disabled;
  quickRestBtn.title = disabled
    ? "Must full rest first"
    : "Recover 25% HP and CE";
}

function getArchetypePermanentAptitudeSource(state, statKey, skillIndex) {
  const picks = state?.archetypeProgress?.permanentAptitudeSelections;
  if (!Array.isArray(picks)) return null;
  return picks.find(entry => entry?.sourceArchetype === state.archetype
    && entry?.statKey === statKey
    && parseInt(entry?.skillIndex, 10) === skillIndex) || null;
}

function setInputValueWithPulse(inputEl, nextValue) {
  if (!inputEl) return;
  const next = String(nextValue ?? "");
  if (inputEl.value === next) {
    inputEl.value = next;
    inputEl.classList.remove("stat-derived-pulse");
    return;
  }
  inputEl.value = next;
  inputEl.classList.remove("stat-derived-pulse");
  void inputEl.offsetWidth;
  inputEl.classList.add("stat-derived-pulse");
  inputEl.addEventListener("animationend", () => {
    inputEl.classList.remove("stat-derived-pulse");
  }, { once: true });
}

function getEffectiveStatLevel(state, effects, statKey) {
  const base = parseStatScore(state?.stats?.[statKey]?.score) + (effects?.statBonuses?.[statKey] || 0);
  const directMods = normalizeDirectModifierList(state?.directModifiers || [])
    .filter(e => e.targetType === "stat" && e.targetKey === statKey);
  return Math.max(0, Math.round(applyDirectModifiers(base, directMods)));
}

function getSubskillValue(state, effects, statKey, skillIndex) {
  const skillState = state?.stats?.[statKey]?.skills?.[skillIndex] || {};
  const aptitude = parseInt(skillState.aptitude, 10) || 0;
  const hasPermanentAptitude = !!getArchetypePermanentAptitudeSource?.(state, statKey, skillIndex);
  const aptitudeBonus = (aptitude > 0 || hasPermanentAptitude) ? getAptitudeBonusValue(state, effects) : 0;
  const statSkillBonus = effects?.skillBonuses?.[statKey] || 0;
  const specificBonus = effects?.specificSkillBonuses?.[`${statKey}:${skillIndex}`] || 0;
  const baseValue = aptitudeBonus + statSkillBonus + specificBonus;

  // Apply direct modifiers for this subskill
  const directMods = normalizeDirectModifierList(state?.directModifiers || [])
    .filter(e => e.targetType === "subskill" && e.targetKey === `${statKey}:${skillIndex}`);
  return Math.round(applyDirectModifiers(baseValue, directMods));
}

function getAptitudeBonusValue(state, effects) {
  const overridden = parseInt(state?.overrides?.derived?.aptitudeBonus, 10);
  const base = Number.isFinite(overridden) ? overridden : 2;
  const directMods = normalizeDirectModifierList(state?.directModifiers || [])
    .filter(e => e.targetType === "derived" && e.targetKey === "aptitudeBonus");
  return Math.round(applyDirectModifiers(base, directMods));
}

function applyDerivedCharacterFields({ preserveCurrent = true } = {}) {
  const state = getState();
  if (!state) return;

  const effects = computeActiveModifierEffects(state);
  const powerLevel = getEffectiveStatLevel(state, effects, "power");
  const techniqueLevel = getEffectiveStatLevel(state, effects, "technique");
  const speedLevel = getEffectiveStatLevel(state, effects, "speed");
  const domainCtBonus = state?.techniques?.mode === "domain" ? 10 : 0;

  const baseHpMax = Math.max(1, 10 + (powerLevel * 5));
  const baseCeMax = Math.max(1, 15 + (techniqueLevel * 5) + domainCtBonus);
  const baseAc = Math.max(0, techniqueLevel + speedLevel + (effects.acBonus || 0));
  const baseMovement = Math.max(0, 30 + (speedLevel * 5) + (effects.movementBonus || 0));

  const hpBaseFromOverride = Math.max(1, getDerivedOverride(state, "hpMax") ?? baseHpMax);
  const ceBaseFromOverride = Math.max(1, getDerivedOverride(state, "ceMax") ?? baseCeMax);
  const acBaseFromOverride = Math.max(0, getDerivedOverride(state, "ac") ?? baseAc);
  const movementBaseFromOverride = Math.max(0, getDerivedOverride(state, "movement") ?? baseMovement);

  const finalHpMax = Math.max(0, Math.round(applyDirectModifiersForTarget(state, "derived", "hpMax", hpBaseFromOverride)));
  const finalCeMax = Math.max(0, Math.round(applyDirectModifiersForTarget(state, "derived", "ceMax", ceBaseFromOverride)));
  const finalAc = Math.max(0, Math.round(applyDirectModifiersForTarget(state, "derived", "ac", acBaseFromOverride)));
  const finalMovement = Math.max(0, Math.round(applyDirectModifiersForTarget(state, "derived", "movement", movementBaseFromOverride)));

  const previousHpMax = parseInt(state.hpMax, 10);
  const previousCeMax = parseInt(state.ceMax, 10);
  const currentHp = parseInt(state.hpCurrent, 10);
  const currentCe = parseInt(state.ceCurrent, 10);

  state.hpMax = String(finalHpMax);
  state.ceMax = String(finalCeMax);
  state.ac = String(finalAc);
  state.movement = String(finalMovement);

  if (!preserveCurrent || !Number.isFinite(currentHp) || !Number.isFinite(previousHpMax) || currentHp === previousHpMax) {
    state.hpCurrent = String(finalHpMax);
  } else {
    state.hpCurrent = String(Math.max(0, Math.min(currentHp, finalHpMax)));
  }

  if (!preserveCurrent || !Number.isFinite(currentCe) || !Number.isFinite(previousCeMax) || currentCe === previousCeMax) {
    state.ceCurrent = String(finalCeMax);
  } else {
    state.ceCurrent = String(Math.max(0, Math.min(currentCe, finalCeMax)));
  }
}

export function updateBlackFlashRangeDisplay() {
  const state = getState();
  const valueEl = document.getElementById("blackFlashRangeValue");
  const noteEl = document.getElementById("blackFlashRangeNote");
  if (!valueEl || !noteEl || !state) return;

  const techRaw = state?.stats?.technique?.score;
  const effects = computeActiveModifierEffects(state);
  const tech = getEffectiveStatLevel(state, effects, "technique");
  const range = getBlackFlashRange(tech);

  if (range === null) {
    valueEl.textContent = "—";
    noteEl.textContent = "Requires Technique 2-7";
    return;
  }

  valueEl.textContent = String(range);
  noteEl.textContent = `Technique ${tech}`;
  updateTechniquesDerivedUI(state);
}

export function renderStats() {
  buildStatBlocks(CENTER_STATS, document.getElementById("centerStats"));
  buildStatBlocks(RIGHT_STATS, document.getElementById("rightStats"));
}

function buildStatBlocks(defs, container) {
  const state = getState();
  if (!container || !state) return;
  const effects = computeActiveModifierEffects(state);

  container.innerHTML = "";
  defs.forEach(def => {
    const sd = state.stats[def.key];
    const block = document.createElement("div");
    block.className = "stat-block";

    const scoreSide = document.createElement("div");
    scoreSide.className = "stat-score-side";
    const statHasDirectModifiers = hasAnyStatDirectModifiers(state, def.key);
    scoreSide.innerHTML = `
      <div class="stat-label">${def.label}</div>
      <span class="direct-modified-badge stat-mod-badge${statHasDirectModifiers ? " visible" : ""}" title="${statHasDirectModifiers ? "Modified" : ""}" aria-label="${statHasDirectModifiers ? "Modified" : ""}"></span>
      <input class="stat-score-input" type="number" placeholder="—"
             id="score_${def.key}" value="${sd.score}" min="0" />
      <button class="roll-btn" type="button" title="Roll ${def.label.charAt(0).toUpperCase() + def.label.slice(1).toLowerCase()}">Roll</button>
    `;

    const runStatRoll = (rollMode = "normal") => {
      const currentEffects = computeActiveModifierEffects(state);
      const n = getEffectiveStatLevel(state, currentEffects, def.key);
      if (!n || n < 1) return;
      const rollBonus = currentEffects.rollBonuses[def.key] || 0;
      const rollResult = rollWithMode(n, rolls => rolls.reduce((a, b) => a + b, 0) + rollBonus, rollMode);
      const breakdown = buildComparedBreakdown(
        {
        equipmentBonuses: getRollModifierSources(state, def.key),
        },
        rollMode,
        rollResult.firstRolls,
        rollResult.firstTotal,
        rollResult.secondRolls,
        rollResult.secondTotal,
        rollResult.selectedRollIndex,
      );
      showRollToast(def.label, n, rollResult.rolls, rollResult.total, null, null, breakdown, rollMode === "normal" ? null : rollMode);
    };

    const statRollBtn = scoreSide.querySelector(".roll-btn");
    const statScoreInput = scoreSide.querySelector(".stat-score-input");
    scoreSide.addEventListener("contextmenu", event => {
      const target = event.target;
      if (target instanceof Element && target.closest(".roll-btn")) return;
      openModifierContextMenu(event, "stat", def.key);
    });
    if (statScoreInput) {
      statScoreInput.title = "Base stat value (right-click to adjust modifiers)";
      statScoreInput.addEventListener("contextmenu", event => {
        openModifierContextMenu(event, "stat", def.key);
      });
    }
    const statBadgeEl = scoreSide.querySelector(".direct-modified-badge.stat-mod-badge");
    if (statBadgeEl) {
      statBadgeEl.addEventListener("click", e => {
        e.preventDefault();
        e.stopPropagation();
        if (!statBadgeEl.classList.contains("visible")) return;
        openDirectModifierPanel("stat", def.key);
      });
      statBadgeEl.addEventListener("keydown", e => {
        if (e.key !== "Enter" && e.key !== " ") return;
        e.preventDefault();
        e.stopPropagation();
        if (!statBadgeEl.classList.contains("visible")) return;
        openDirectModifierPanel("stat", def.key);
      });
    }
    statRollBtn.addEventListener("click", () => runStatRoll("normal"));
    statRollBtn.addEventListener("contextmenu", event => {
      openRollModeMenu(event, selectedMode => runStatRoll(selectedMode));
    });

    const skillsSide = document.createElement("div");
    skillsSide.className = "skills-side";
    def.skills.forEach((skill, i) => {
      const sk = sd.skills[i];
      const lockedAptitudeSource = getArchetypePermanentAptitudeSource(state, def.key, i);
      const aptitudeState = lockedAptitudeSource ? 2 : getAptitudeState(sk);
      const trainedAptitude = Boolean(sk?.trainedAptitude) && aptitudeState > 0 && !lockedAptitudeSource;
      const overriddenAptitude = Boolean(sk?.overriddenAptitude) && aptitudeState > 0 && !lockedAptitudeSource;
      const subskillValue = getSubskillValue(state, effects, def.key, i);
      const aptitudeLabel = aptitudeState === 2 ? "Permanent Aptitude" : aptitudeState === 1 ? "Aptitude" : "No Aptitude";
      const sourceLabel = lockedAptitudeSource?.sourceLabel || (lockedAptitudeSource?.sourceArchetype
        ? lockedAptitudeSource.sourceArchetype.charAt(0).toUpperCase() + lockedAptitudeSource.sourceArchetype.slice(1)
        : "");
      const nextAptitudeAction = lockedAptitudeSource
        ? (_isOverrideMode ? "Override lock: cycle aptitude" : `Permanent Aptitude (${sourceLabel || "Archetype"})`)
        : overriddenAptitude
        ? (_isOverrideMode ? getNextAptitudeActionLabel(aptitudeState, true) : "Overridden")
        : trainedAptitude
        ? (_isOverrideMode ? getNextAptitudeActionLabel(aptitudeState, true) : "Trained Attribute")
        : _isOverrideMode
        ? getNextAptitudeActionLabel(aptitudeState, true)
        : (aptitudeState > 0 ? "Aptitude" : "Locked");
      const hasOverride = Number.isFinite(getSubskillOverride(state, def.key, i));
      const subskillHasDirectModifiers = hasDirectModifiers(state, "subskill", `${def.key}:${i}`);
      const row = document.createElement("div");
      row.className = "skill-row";
      row.innerHTML = `
        <div class="skill-dot${aptitudeState > 0 ? " filled" : ""}${aptitudeState === 2 ? " permanent" : ""}${lockedAptitudeSource ? " locked-by-archetype" : ""}${trainedAptitude ? " trained-aptitude" : ""}${overriddenAptitude ? " overridden-aptitude" : ""}"
             id="dot_${def.key}_${i}" role="checkbox" aria-label="${skill} ${aptitudeLabel}" title="${nextAptitudeAction}"></div>
        <input class="skill-bonus-input" type="text"
               id="bonus_${def.key}_${i}" value="${formatSignedValue(subskillValue)}" ${_isOverrideMode ? "" : "readonly"} title="${hasOverride ? "Overridden" : "Auto-calculated"}" />
        <button type="button" class="override-marker-btn${hasOverride ? " visible" : ""}" data-subskill-override-clear="${def.key}:${i}" title="${_isOverrideMode ? "Click to clear override" : "Overridden"}" ${_isOverrideMode ? "" : "tabindex=\"-1\""}>*</button>
        <span class="skill-name" title="Roll ${skill}">${skill}</span>
         <span class="direct-modified-badge skill-mod-badge${subskillHasDirectModifiers ? " visible" : ""}" title="${subskillHasDirectModifiers ? "Modified" : ""}" aria-label="${subskillHasDirectModifiers ? "Modified" : ""}"></span>
      `;
      skillsSide.appendChild(row);

      row.title = "Right-click row area to adjust modifiers";
      row.addEventListener("contextmenu", event => {
        const target = event.target;
        if (target instanceof Element && target.closest(".skill-name, .skill-bonus-input")) return;
        openModifierContextMenu(event, "subskill", `${def.key}:${i}`);
      });

      const subskillBadgeEl = row.querySelector(".direct-modified-badge.skill-mod-badge");
      if (subskillBadgeEl) {
        subskillBadgeEl.addEventListener("click", e => {
          e.preventDefault();
          e.stopPropagation();
          if (!subskillBadgeEl.classList.contains("visible")) return;
          openDirectModifierPanel("subskill", `${def.key}:${i}`);
        });
        subskillBadgeEl.addEventListener("keydown", e => {
          if (e.key !== "Enter" && e.key !== " ") return;
          e.preventDefault();
          e.stopPropagation();
          if (!subskillBadgeEl.classList.contains("visible")) return;
          openDirectModifierPanel("subskill", `${def.key}:${i}`);
        });
      }

      row.querySelector(".skill-dot").addEventListener("click", () => {
        // In normal mode, dots are fully locked
        if (!_isOverrideMode) return;
        // In override mode, archetype-permanent locks can cycle but not be cleared to 0
        if (lockedAptitudeSource && !_isOverrideMode) return;
        const skillState = state.stats[def.key].skills[i] || { aptitude: 0 };
        const currentAptitude = getAptitudeState(skillState);
        const nextAptitude = _isOverrideMode
          ? (currentAptitude + 1) % 3
          : (currentAptitude > 0 ? 0 : 1);
        // In override mode, mark as overridden (clear trainedAptitude flag)
        state.stats[def.key].skills[i] = {
          ...skillState,
          aptitude: nextAptitude,
          trainedAptitude: false,
          overriddenAptitude: nextAptitude > 0,
        };

        if (promoteStatFromFullAptitudes(state, def.key)) {
          applyCharacterStateToUI();
          scheduleSave();
          return;
        }

        const dot = row.querySelector(".skill-dot");
        dot.classList.toggle("filled", nextAptitude > 0);
        dot.classList.toggle("permanent", nextAptitude === 2);
        dot.classList.toggle("locked-by-archetype", Boolean(lockedAptitudeSource));
        dot.classList.toggle("trained-aptitude", false);
        dot.classList.toggle("overridden-aptitude", nextAptitude > 0);
        const nextLabel = nextAptitude === 2 ? "Permanent Aptitude" : nextAptitude === 1 ? "Aptitude" : "No Aptitude";
        dot.setAttribute("title", lockedAptitudeSource
          ? "Override lock: cycle aptitude"
          : nextAptitude > 0
          ? getNextAptitudeActionLabel(nextAptitude, true)
          : getNextAptitudeActionLabel(0, true));
        dot.setAttribute("aria-label", `${skill} ${nextLabel}`);
        const valueEl = row.querySelector(".skill-bonus-input");
        const nextValue = getSubskillValue(state, computeActiveModifierEffects(state), def.key, i);
        valueEl.value = formatSignedValue(nextValue);
        scheduleSave();
      });
      row.querySelector(".skill-bonus-input").addEventListener("input", e => {
        if (!_isOverrideMode) return;
        setSubskillOverride(state, def.key, i, e.target.value);
        applyCharacterStateToUI();
        scheduleSave();
      });
      row.querySelector("button[data-subskill-override-clear]").addEventListener("click", () => {
        if (!_isOverrideMode) return;
        setSubskillOverride(state, def.key, i, null);
        applyCharacterStateToUI();
        scheduleSave();
      });
      const runSkillRoll = (rollMode = "normal") => {
        const currentEffects = computeActiveModifierEffects(state);
        const n = getEffectiveStatLevel(state, currentEffects, def.key);
        if (!n || n < 1) return;
        const subskillBonus = getSubskillValue(state, currentEffects, def.key, i);
        const statRollBonus = currentEffects.rollBonuses[def.key] || 0;
        const rollResult = rollWithMode(
          n,
          rolls => rolls.reduce((a, b) => a + b, 0) + subskillBonus + statRollBonus,
          rollMode,
        );
        const rolls = rollResult.rolls;
        const total = rollResult.total;
        const maxPossible = n * 6;
        const allOnes = rolls.every(r => r === 1);
        const critStatus = allOnes ? "fail" : total >= maxPossible ? "success" : null;
        const breakdown = buildComparedBreakdown(
          {
            skillModifier: subskillBonus,
            equipmentBonuses: getRollModifierSources(state, def.key),
          },
          rollMode,
          rollResult.firstRolls,
          rollResult.firstTotal,
          rollResult.secondRolls,
          rollResult.secondTotal,
          rollResult.selectedRollIndex,
        );
        showRollToast(
          def.label,
          n,
          rolls,
          total,
          critStatus,
          skill,
          breakdown,
          rollMode === "normal" ? null : rollMode,
        );
      };

      const skillNameEl = row.querySelector(".skill-name");
      const skillBonusEl = row.querySelector(".skill-bonus-input");

      skillNameEl.addEventListener("click", () => runSkillRoll("normal"));
      skillNameEl.addEventListener("contextmenu", event => {
        openRollModeMenu(event, selectedMode => runSkillRoll(selectedMode), {
          onAddModifier: () => openDirectModifierPanel("subskill", `${def.key}:${i}`),
        });
      });

      skillBonusEl.addEventListener("click", () => {
        if (_isOverrideMode) return;
        runSkillRoll("normal");
      });
      skillBonusEl.addEventListener("contextmenu", event => {
        if (_isOverrideMode) return;
        openRollModeMenu(event, selectedMode => runSkillRoll(selectedMode), {
          onAddModifier: () => openDirectModifierPanel("subskill", `${def.key}:${i}`),
        });
      });
    });

    block.appendChild(scoreSide);
    block.appendChild(skillsSide);
    container.appendChild(block);

    block.querySelector(`#score_${def.key}`).addEventListener("input", e => {
      state.stats[def.key].score = e.target.value;
      applyDerivedCharacterFields({ preserveCurrent: true });
      const currentEffects = computeActiveModifierEffects(state);
      const valueInputs = block.querySelectorAll(".skill-bonus-input");
      valueInputs.forEach((inputEl, idx) => {
        setInputValueWithPulse(inputEl, formatSignedValue(getSubskillValue(state, currentEffects, def.key, idx)));
      });
      setInputValueWithPulse(document.getElementById("acInput"), state.ac || "");
      setInputValueWithPulse(document.getElementById("hpMax"), state.hpMax || "");
      setInputValueWithPulse(document.getElementById("ceMax"), state.ceMax || "");
      setInputValueWithPulse(document.getElementById("moveInput"), state.movement || "");
      if (def.key === "technique") {
        updateBlackFlashRangeDisplay();
        updateTechniquesDerivedUI();
      }
      if (_refreshCombatTab) _refreshCombatTab(); // ← add this
      scheduleSave();
    });
  });
}

function handleArchetypeChange(archetypeId, subId, archetypeKey, subKey) {
  const state = getState();
  const arc = document.getElementById(archetypeId).value;
  state[archetypeKey] = arc;
  state[subKey] = "";
  updateSubSelect(subId, arc, "");
}

function updateSubSelect(subId, arc, selectedSub) {
  const sel = document.getElementById(subId);
  if (!sel) return;

  if (!arc) {
    sel.innerHTML = '<option value="">— Pick archetype first —</option>';
    sel.disabled = true;
    return;
  }

  sel.disabled = false;
  const state = getState();
  const opts = arc === "custom"
    ? [state?.customArchetype?.subArchetypeA || "Custom A", state?.customArchetype?.subArchetypeB || "Custom B"]
    : (ARCHETYPES[arc] || []);
  sel.innerHTML = '<option value="">— Sub-Archetype —</option>' +
    opts.map(o => `<option value="${o}"${selectedSub === o ? " selected" : ""}>${o}</option>`).join("");
}

function updateSecondArchetypeUI() {
  const state = getState();
  const show = !!state.hasSecondArchetype;
  const className = "meta-field multi-class-field" + (show ? "" : " hidden");
  document.getElementById("multiClassArchetypeField").className = className;
  document.getElementById("multiClassSubArchetypeField").className = className;
  document.getElementById("removeSecondArchetypeField").className = className + " grid-col-full";
  document.getElementById("addSecondArchetypeBtn").style.display = show ? "none" : "";
}

function toggleSecondArchetype() {
  const state = getState();
  state.hasSecondArchetype = !state.hasSecondArchetype;
  if (!state.hasSecondArchetype) {
    state.archetype2 = "";
    state.subArchetype2 = "";
    document.getElementById("archetypeSelect2").value = "";
    updateSubSelect("subArchetypeSelect2", "", "");
  }
  updateSecondArchetypeUI();
  scheduleSave();
}

function bindField(id, stateKey) {
  const el = document.getElementById(id);
  if (!el) return;
  el.addEventListener("input", e => {
    const state = getState();
    if (!state) return;
    state[stateKey] = e.target.value;
    scheduleSave();
  });
  el.addEventListener("change", e => {
    const state = getState();
    if (!state) return;
    state[stateKey] = e.target.value;
    scheduleSave();
  });
}

function syncHP() {
  applyDerivedCharacterFields({ preserveCurrent: true });
  applyCharacterStateToUI();
  scheduleSave();
}

function updateOverrideButtonUI() {
  const btn = document.getElementById("overrideModeBtn");
  const label = document.getElementById("overrideModeBtnLabel");
  if (!btn) return;
  btn.classList.toggle("active", _isOverrideMode);
  if (label) label.textContent = "Override";
  btn.title = _isOverrideMode ? "Disable manual overrides" : "Enable manual overrides";
}

function ensureDerivedOverrideMarker(inputId, fieldKey) {
  const input = document.getElementById(inputId);
  if (!input || !input.parentElement) return;

  let marker = input.parentElement.querySelector(`.override-marker-btn[data-derived-override-clear='${fieldKey}']`);
  if (!marker) {
    marker = document.createElement("button");
    marker.type = "button";
    marker.className = "override-marker-btn";
    marker.classList.add("derived-override-marker");
    marker.dataset.derivedOverrideClear = fieldKey;
    marker.textContent = "*";
    input.parentElement.style.position = "relative";
    marker.addEventListener("click", () => {
      if (!_isOverrideMode) return;
      const state = getState();
      if (!state) return;
      setDerivedOverride(state, fieldKey, null);
      applyCharacterStateToUI();
      scheduleSave();
    });
    input.parentElement.appendChild(marker);
  }

  const state = getState();
  const hasOverride = state ? Number.isFinite(getDerivedOverride(state, fieldKey)) : false;
  marker.classList.toggle("visible", hasOverride);
  marker.title = _isOverrideMode ? "Click to clear override" : "Overridden";
  marker.tabIndex = _isOverrideMode && hasOverride ? 0 : -1;
}

function wireDerivedOverrideInput(inputId, fieldKey) {
  const input = document.getElementById(inputId);
  if (!input) return;

  input.addEventListener("input", e => {
    if (!_isOverrideMode) return;
    const state = getState();
    if (!state) return;
    setDerivedOverride(state, fieldKey, e.target.value);
    applyCharacterStateToUI();
    scheduleSave();
  });
}

function applyOverrideFieldReadOnlyState() {
  document.body.classList.toggle("override-mode", _isOverrideMode);
  const editableWhenOverride = ["acInput", "hpMax", "ceMax", "moveInput", "aptitudeBonusInput"];
  editableWhenOverride.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.readOnly = !_isOverrideMode;
    el.title = _isOverrideMode ? "Manual override enabled" : "Auto-calculated";
  });
}

export function applyCharacterStateToUI() {
  const state = getState();
  if (!state) return;

  ensureOverrideState(state);
  ensureRestState(state);
  ensureDirectModifierState(state);
  applyDerivedCharacterFields({ preserveCurrent: true });

  document.getElementById("charName").value = state.charName || "";
  document.getElementById("ageInput").value = state.age || "";
  const ctInput = document.getElementById("ctInput");
  if (ctInput) {
    ctInput.value = getDisplayedTechniqueName(state);
    ctInput.readOnly = true;
    ctInput.title = "Managed from the Jujutsu tab";
  }
  const aptitudeBonusInput = document.getElementById("aptitudeBonusInput");
  if (aptitudeBonusInput) {
    setInputValueWithPulse(aptitudeBonusInput, formatSignedValue(getAptitudeBonusValue(state)));
  }
  state.xp = String(parseXpValue(state.xp));
  const xpInput = document.getElementById("xpInput");
  if (xpInput) xpInput.value = state.xp;
  document.getElementById("playerName").value = state.playerName || "";
  setInputValueWithPulse(document.getElementById("acInput"), state.ac || "");
  setInputValueWithPulse(document.getElementById("hpCurrent"), state.hpCurrent || "");
  setInputValueWithPulse(document.getElementById("hpMax"), state.hpMax || "");
  setInputValueWithPulse(document.getElementById("moveInput"), state.movement || "");
  setInputValueWithPulse(document.getElementById("ceCurrent"), state.ceCurrent || "");
  setInputValueWithPulse(document.getElementById("ceMax"), state.ceMax || "");
  const ceNoteEl = document.getElementById("ceNote");
  if (ceNoteEl) ceNoteEl.value = state.ceNote || "";

  const arcSel = document.getElementById("archetypeSelect");
  arcSel.value = state.archetype || "";
  updateSubSelect("subArchetypeSelect", state.archetype || "", state.subArchetype || "");
  if (state.subArchetype) document.getElementById("subArchetypeSelect").value = state.subArchetype;

  const arcSel2 = document.getElementById("archetypeSelect2");
  arcSel2.value = state.archetype2 || "";
  updateSubSelect("subArchetypeSelect2", state.archetype2 || "", state.subArchetype2 || "");
  if (state.subArchetype2) document.getElementById("subArchetypeSelect2").value = state.subArchetype2;

  updateSecondArchetypeUI();
  document.getElementById("gradeSelect").value = state.grade || "";

  renderStats();
  updateBlackFlashRangeDisplay();
  updateTechniquesDerivedUI(state);
  applyOverrideFieldReadOnlyState();
  updateOverrideButtonUI();
  ensureDerivedOverrideMarker("acInput", "ac");
  ensureDerivedOverrideMarker("hpMax", "hpMax");
  ensureDerivedOverrideMarker("ceMax", "ceMax");
  ensureDerivedOverrideMarker("moveInput", "movement");
  ensureDerivedOverrideMarker("aptitudeBonusInput", "aptitudeBonus");
  updateDerivedModifierBadges(state);
  syncRestControlsUI(state);
  if (_activeDirectModifierTarget) renderDirectModifierPanel();
  if (_refreshCombatTab) _refreshCombatTab();
}

export function initCharacter({ getState: getStateFn, scheduleSave: scheduleSaveFn, showRollToast: showRollToastFn, refreshCombatTab: refreshCombatTabFn = null }) {
  _getState = getStateFn;
  _scheduleSave = scheduleSaveFn;
  _showRollToast = showRollToastFn;
  _refreshCombatTab = refreshCombatTabFn;

  window.onArchetypeChange = function () {
    handleArchetypeChange("archetypeSelect", "subArchetypeSelect", "archetype", "subArchetype");
    scheduleSave();
  };

  window.onArchetypeChange2 = function () {
    handleArchetypeChange("archetypeSelect2", "subArchetypeSelect2", "archetype2", "subArchetype2");
    scheduleSave();
  };

  window.syncHP = syncHP;

  if (_initialized) {
    applyCharacterStateToUI();
    return;
  }

  bindField("charName", "charName");
  bindField("ageInput", "age");
  bindField("gradeSelect", "grade");
  bindField("playerName", "playerName");
  bindField("xpInput", "xp");
  bindField("hpCurrent", "hpCurrent");
  bindField("ceCurrent", "ceCurrent");
  bindField("ceNote", "ceNote");
  bindField("subArchetypeSelect", "subArchetype");
  bindField("subArchetypeSelect2", "subArchetype2");

  const ceCurrentInput = document.getElementById("ceCurrent");
  if (ceCurrentInput) {
    ceCurrentInput.addEventListener("input", () => updateTechniquesDerivedUI());
    ceCurrentInput.addEventListener("change", () => updateTechniquesDerivedUI());
  }

  wireDerivedOverrideInput("acInput", "ac");
  wireDerivedOverrideInput("hpMax", "hpMax");
  wireDerivedOverrideInput("ceMax", "ceMax");
  wireDerivedOverrideInput("moveInput", "movement");
  wireDerivedOverrideInput("aptitudeBonusInput", "aptitudeBonus");

  [
    ["hpMax", "derived", "hpMax"],
    ["ceMax", "derived", "ceMax"],
    ["acInput", "derived", "ac"],
    ["moveInput", "derived", "movement"],
    ["aptitudeBonusInput", "derived", "aptitudeBonus"],
  ].forEach(([id, targetType, targetKey]) => {
    const input = document.getElementById(id);
    if (!input) return;
    input.title = `${input.title ? `${input.title} ` : ""}(Right-click to adjust modifiers)`;
    input.addEventListener("contextmenu", event => {
      openModifierContextMenu(event, targetType, targetKey);
    });
  });

  [
    ["hpVitalBox", "derived", "hpMax"],
    ["ceVitalBox", "derived", "ceMax"],
    ["acVitalBox", "derived", "ac"],
    ["movementVitalBox", "derived", "movement"],
    ["aptitudeBonusVitalBox", "derived", "aptitudeBonus"],
  ].forEach(([id, targetType, targetKey]) => {
    const box = document.getElementById(id);
    if (!box) return;
    box.title = "Right-click to adjust modifiers";
    box.addEventListener("contextmenu", event => {
      openModifierContextMenu(event, targetType, targetKey);
    });
  });

  const gradeSelect = document.getElementById("gradeSelect");
  if (gradeSelect) {
    gradeSelect.addEventListener("change", () => {
      if (_refreshCombatTab) _refreshCombatTab();
    });
  }

  initDirectModifierUI();

  const overrideBtn = document.getElementById("overrideModeBtn");
  if (overrideBtn) {
    overrideBtn.addEventListener("click", () => {
      _isOverrideMode = !_isOverrideMode;
      applyCharacterStateToUI();
    });
  }

  document.getElementById("addSecondArchetypeBtn").addEventListener("click", toggleSecondArchetype);
  document.getElementById("removeSecondArchetypeBtn").addEventListener("click", toggleSecondArchetype);

  const restBtn = document.getElementById("restBtn");
  const quickRestBtn = document.getElementById("quickRestBtn");
  const shortRestBtn = document.getElementById("shortRestBtn");
  const fullRestBtn = document.getElementById("fullRestBtn");

  if (restBtn) {
    restBtn.addEventListener("click", e => {
      e.stopPropagation();
      const popover = document.getElementById("restOptionsPopover");
      const isOpen = popover ? popover.hidden : false;
      setRestPopoverOpen(isOpen);
    });
  }

  [
    [quickRestBtn, "quick"],
    [shortRestBtn, "short"],
    [fullRestBtn, "full"],
  ].forEach(([button, kind]) => {
    if (!button) return;
    button.addEventListener("click", e => {
      e.stopPropagation();
      const state = getState();
      if (!state) return;
      const applied = applyRestRecovery(state, kind);
      if (!applied) {
        syncRestControlsUI(state);
        return;
      }
      setRestPopoverOpen(false);
      applyCharacterStateToUI();
      scheduleSave();
    });
  });

  document.addEventListener("click", e => {
    const popover = document.getElementById("restOptionsPopover");
    const wrap = document.querySelector(".rest-control-wrap");
    if (!popover || popover.hidden) return;
    if (wrap && wrap.contains(e.target)) return;
    setRestPopoverOpen(false);
  });

  _initialized = true;
  applyCharacterStateToUI();
}
