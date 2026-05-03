let _getState = null;
let _scheduleSave = null;
let _refreshCharacterStats = null;
let _initialized = false;
let _isEditing = false;
let _editorStep = "mode";
let _editSnapshot = null;
const _expandedAppIndices = new Map();

const JUJUTSU_SUBTABS = new Set(["technique", "vows", "training"]);

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

function createDefaultApplication(index) {
  return {
    title: `Application ${index + 1}`,
    description: "",
    ceCost: 0,
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
  const ceCost = parseNonNegativeInt(raw?.ceCost);
  return {
    title: title || fallbackTitle,
    description,
    ceCost,
  };
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
          <label class="techniques-field" for="appCardTitle${idx}">
            <span class="field-label">Title</span>
            <input id="appCardTitle${idx}" class="meta-input techniques-app-card-field" data-app-title-inline="${idx}" value="${normalized.title}" />
          </label>
          <label class="techniques-field" for="appCardCost${idx}">
            <span class="field-label">CE Cost</span>
            <input id="appCardCost${idx}" class="meta-input techniques-app-card-field" type="number" min="0" step="1" inputmode="numeric" data-app-cost-inline="${idx}" value="${normalized.ceCost || 0}" />
          </label>
          <label class="techniques-field" for="appCardDesc${idx}">
            <span class="field-label">Description</span>
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
    const costText = normalized.ceCost > 0 ? `CE Cost: ${normalized.ceCost}` : "CE Cost: -";
    return `
      <article class="techniques-app-card" data-app-idx="${idx}">
        <button type="button" class="techniques-app-card-edit-btn" data-app-edit-toggle="${idx}" aria-label="Edit application" title="Edit">&#9998;</button>
        <h4 class="techniques-app-card-title">${normalized.title}</h4>
        <div class="techniques-app-card-cost">${costText}</div>
        <p class="techniques-app-card-desc">${description}</p>
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

  list.innerHTML = vows.map((vow, idx) => {
    const normalized = normalizeBindingVow(vow, idx);
    return `
      <div class="techniques-app-editor-item">
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
  }).join("");
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

  renderApplicationsSummary(state);

  const hasActiveTechnique = state.techniques.mode !== "none";

  const xpThresholdEl = document.getElementById("techniqueXpThreshold");
  if (xpThresholdEl) {
    if (hasActiveTechnique) {
      const techScore = parseInt(state?.stats?.technique?.score, 10) || 0;
      const threshold = techScore * 2;
      xpThresholdEl.textContent = `Sorcerer XP Threshold: ${threshold}`;
      xpThresholdEl.style.display = "";
    } else {
      xpThresholdEl.style.display = "none";
    }
  }

  const summaryFooter = document.getElementById("techniqueSummaryFooter");
  if (summaryFooter) summaryFooter.style.display = hasActiveTechnique ? "" : "none";

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

  const addAppSummaryBtn = document.getElementById("techniqueAddAppSummaryBtn");
  if (addAppSummaryBtn) {
    addAppSummaryBtn.addEventListener("click", () => {
      const state = getState();
      if (!state) return;
      ensureTechniquesState(state);
      const newIdx = state.techniques.applications.length;
      state.techniques.applications.push(createDefaultApplication(newIdx));
      const newSnap = JSON.parse(JSON.stringify(state.techniques.applications[newIdx]));
      _expandedAppIndices.set(newIdx, newSnap);
      updateTechniquesDerivedUI(state);
      scheduleSave();
    });
  }

  const summaryGrid = document.getElementById("techniqueApplicationsSummary");
  if (summaryGrid) {
    summaryGrid.addEventListener("click", e => {
      // Open edit (pencil icon on view card)
      const openTrigger = e.target?.closest?.("[data-app-edit-toggle]");
      if (openTrigger) {
        const state = getState();
        if (!state) return;
        const idx = parseNonNegativeInt(openTrigger.dataset.appEditToggle);
        const snap = JSON.parse(JSON.stringify(state.techniques.applications[idx] || {}));
        _expandedAppIndices.set(idx, snap);
        renderApplicationsSummary(state);
        return;
      }
      // Save (collapse, keep changes already written on input)
      const saveTrigger = e.target?.closest?.("[data-app-save-inline]");
      if (saveTrigger) {
        const idx = parseNonNegativeInt(saveTrigger.dataset.appSaveInline);
        _expandedAppIndices.delete(idx);
        const state = getState();
        if (state) renderApplicationsSummary(state);
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
        renderApplicationsSummary(state);
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
        _expandedAppIndices.clear();
        updateTechniquesDerivedUI(state);
        scheduleSave();
      }
    });
    summaryGrid.addEventListener("input", e => {
      const state = getState();
      if (!state) return;
      ensureTechniquesState(state);
      const titleAttr = e.target?.dataset?.appTitleInline;
      const descAttr = e.target?.dataset?.appDescInline;
      const costAttr = e.target?.dataset?.appCostInline;
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
      scheduleSave();
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
      updateTechniquesDerivedUI(state);
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

      if (e.target?.dataset?.appTitle !== undefined && state.techniques.applications[titleIdx]) {
        state.techniques.applications[titleIdx].title = String(e.target.value || "");
      }
      if (e.target?.dataset?.appDescription !== undefined && state.techniques.applications[descIdx]) {
        state.techniques.applications[descIdx].description = String(e.target.value || "");
      }
      if (e.target?.dataset?.appCeCost !== undefined && state.techniques.applications[costIdx]) {
        state.techniques.applications[costIdx].ceCost = parseNonNegativeInt(e.target.value);
      }

      updateTechniquesDerivedUI(state);
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
      updateTechniquesDerivedUI(state);
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
      state.techniques.bindingVows.push(createDefaultBindingVow(state.techniques.bindingVows.length));
      renderBindingVowsEditor(state);
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
