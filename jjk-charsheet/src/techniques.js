import { computeActiveModifierEffects } from "./modifiers.js";

let _getState = null;
let _scheduleSave = null;
let _refreshCharacterStats = null;
let _initialized = false;
let _isEditing = false;
let _editorStep = "mode";
let _editSnapshot = null;

const JUJUTSU_SUBTABS = new Set(["technique", "training"]);

function getState() {
  return _getState ? _getState() : null;
}

function scheduleSave() {
  if (_scheduleSave) _scheduleSave();
}

function refreshCharacterStats() {
  if (_refreshCharacterStats) _refreshCharacterStats();
}

function parseNonNegativeInt(rawValue) {
  const parsed = parseInt(rawValue, 10);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, parsed);
}

function ensureTechniquesState(state) {
  if (!state || typeof state !== "object") return;
  if (!state.techniques || typeof state.techniques !== "object") state.techniques = {};

  const techniques = state.techniques;
  if (!["ct", "domain", "none"].includes(techniques.mode)) techniques.mode = "none";
  if (!JUJUTSU_SUBTABS.has(techniques.activeSubtab)) techniques.activeSubtab = "technique";
  if (!Array.isArray(techniques.ctAbilities)) techniques.ctAbilities = ["", "", ""];
  if (!Array.isArray(techniques.domainAbilities)) techniques.domainAbilities = ["", "", ""];
  while (techniques.ctAbilities.length < 3) techniques.ctAbilities.push("");
  while (techniques.domainAbilities.length < 3) techniques.domainAbilities.push("");
  techniques.ctAbilities = techniques.ctAbilities.slice(0, 3).map(v => String(v || ""));
  techniques.domainAbilities = techniques.domainAbilities.slice(0, 3).map(v => String(v || ""));
  techniques.noCtPath = String(techniques.noCtPath || "");
  techniques.notes = String(techniques.notes || "");
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
  if (!name) return mode === "domain" ? "Domain-based cursed technique." : "Cursed technique.";
  if (mode === "domain") return `${name} (Domain-Based Cursed Technique)`;
  return name;
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

function getEffectiveTechniqueLevel(state) {
  const effects = computeActiveModifierEffects(state);
  const baseLevel = parseNonNegativeInt(state?.stats?.technique?.score);
  return Math.max(0, baseLevel + (effects?.statBonuses?.technique || 0));
}

function getFilledAbilityCount(list) {
  if (!Array.isArray(list)) return 0;
  return list.filter(name => String(name || "").trim()).length;
}

function getSelectedMode() {
  if (document.getElementById("techniqueModeDomain")?.checked) return "domain";
  if (document.getElementById("techniqueModeNone")?.checked) return "none";
  return "ct";
}

function setModeUI(mode) {
  const isNone = mode === "none";
  const isDomain = mode === "domain";

  const ctSection = document.getElementById("techniquesCtSection");
  const domainSection = document.getElementById("techniquesDomainSection");
  const noCtSection = document.getElementById("techniquesNoCtSection");

  if (ctSection) ctSection.style.display = isNone ? "none" : "";
  if (domainSection) domainSection.style.display = isDomain ? "" : "none";
  if (noCtSection) noCtSection.style.display = isNone ? "" : "none";
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

function updateCapacityWarning(state, techniqueLevel) {
  const warningEl = document.getElementById("techniquesCapacityWarning");
  if (!warningEl) return;

  const mode = state?.techniques?.mode || "ct";
  const ctFilled = getFilledAbilityCount(state?.techniques?.ctAbilities);
  const startingCtCap = Math.max(0, Math.min(3, techniqueLevel));
  const domainOutsideCap = Math.max(0, techniqueLevel);

  let warningText = "";
  if (mode === "ct" && ctFilled > startingCtCap) {
    warningText = `You have ${ctFilled} CT abilities listed, but your current starting cap is ${startingCtCap}.`;
  } else if (mode === "domain" && ctFilled > domainOutsideCap) {
    warningText = `You have ${ctFilled} outside-domain abilities listed, but your current outside-domain cap is ${domainOutsideCap}.`;
  }

  warningEl.textContent = warningText;
  warningEl.style.display = warningText ? "block" : "none";
}

export function updateTechniquesDerivedUI(stateArg = null) {
  const state = stateArg || getState();
  if (!state) return;

  ensureTechniquesState(state);

  const techniqueLevel = getEffectiveTechniqueLevel(state);
  const startingCtCap = Math.max(0, Math.min(3, techniqueLevel));
  const domainOutsideCap = Math.max(0, techniqueLevel);
  const autoSuccessThreshold = techniqueLevel * 2;

  const levelEl = document.getElementById("techniqueLevelValue");
  const capEl = document.getElementById("ctAbilityCapValue");
  const domainCapEl = document.getElementById("domainOutsideCapValue");
  const autoEl = document.getElementById("talentAutoValue");
  const ceEl = document.getElementById("domainCeValue");

  if (levelEl) levelEl.textContent = String(techniqueLevel);
  if (capEl) capEl.textContent = String(startingCtCap);
  if (domainCapEl) domainCapEl.textContent = String(domainOutsideCap);
  if (autoEl) autoEl.textContent = `< ${autoSuccessThreshold}`;
  if (ceEl) ceEl.textContent = state.techniques.mode === "domain" ? "+10 (active)" : "+10";

  updateCapacityWarning(state, techniqueLevel);
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

  for (let i = 0; i < 3; i += 1) {
    const ctInput = document.getElementById(`ctAbilityInput${i + 1}`);
    const domainInput = document.getElementById(`domainAbilityInput${i + 1}`);
    if (ctInput) ctInput.value = state.techniques.ctAbilities[i] || "";
    if (domainInput) domainInput.value = state.techniques.domainAbilities[i] || "";
  }

  const noCtPath = document.getElementById("noCtPathSelect");
  if (noCtPath) noCtPath.value = state.techniques.noCtPath || "";

  const notes = document.getElementById("techniqueNotesInput");
  if (notes) notes.value = state.techniques.notes || "";

  const summaryEl = document.getElementById("techniqueSummaryText");
  if (summaryEl) summaryEl.textContent = getTechniqueSummaryText(state);

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
  _editSnapshot = null;
  refreshCharacterStats();
  applyTechniquesStateToUI();
  scheduleSave();
}

export function initTechniques({ getState: getStateFn, scheduleSave: scheduleSaveFn, refreshCharacterStats: refreshCharacterStatsFn }) {
  _getState = getStateFn;
  _scheduleSave = scheduleSaveFn;
  _refreshCharacterStats = refreshCharacterStatsFn;

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
      scheduleSave();
    });
  }

  for (let i = 0; i < 3; i += 1) {
    const ctInput = document.getElementById(`ctAbilityInput${i + 1}`);
    if (ctInput) {
      ctInput.addEventListener("input", e => {
        const state = getState();
        if (!state) return;
        ensureTechniquesState(state);
        state.techniques.ctAbilities[i] = e.target.value;
        updateTechniquesDerivedUI(state);
        scheduleSave();
      });
    }

    const domainInput = document.getElementById(`domainAbilityInput${i + 1}`);
    if (domainInput) {
      domainInput.addEventListener("input", e => {
        const state = getState();
        if (!state) return;
        ensureTechniquesState(state);
        state.techniques.domainAbilities[i] = e.target.value;
        scheduleSave();
      });
    }
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
      state.techniques.notes = e.target.value;
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
