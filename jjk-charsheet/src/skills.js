let _getState = null;
let _scheduleSave = null;
let _refreshTraining = null;
let _refreshCharacterStats = null;
let _initialized = false;
let _skillsSearchQuery = "";
let _showXpSkillForm = false;
let _openStackRefundConfirm = null; // { skillId, targetStacks, refundAmount }

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function getState() {
  return _getState ? _getState() : null;
}

function scheduleSave() {
  if (_scheduleSave) _scheduleSave();
}

function refreshTraining() {
  if (_refreshTraining) _refreshTraining();
}

function refreshCharacterStats() {
  if (_refreshCharacterStats) _refreshCharacterStats();
}

function createId(prefix = "id") {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function parsePositiveInt(raw, fallback = 1) {
  const parsed = parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, parsed);
}

function parseNonNegativeInt(raw, fallback = 0) {
  const parsed = parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, parsed);
}

function getAvailableXp(state) {
  return parseNonNegativeInt(state?.xp, 0);
}

function setAvailableXp(state, value) {
  state.xp = String(parseNonNegativeInt(value, 0));
}

function validateXpCost(state, rawCost) {
  const parsedCost = parseInt(rawCost, 10);
  if (!Number.isFinite(parsedCost) || parsedCost < 1) {
    return { valid: false, xpCost: 0, reason: "XP Cost is Less Than 1" };
  }
  const xpCost = Math.max(1, parsedCost);
  if (getAvailableXp(state) < xpCost) {
    return { valid: false, xpCost, reason: "Not Enough XP" };
  }
  return { valid: true, xpCost, reason: "Add XP Skill" };
}

function normalizeText(raw) {
  return String(raw || "").trim();
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;");
}

function ensureSkillsState(state) {
  if (!state || typeof state !== "object") return;
  if (!state.skills || typeof state.skills !== "object") {
    state.skills = {
      xpSkills: [],
      jujutsuSkills: [],
    };
  }
  if (!Array.isArray(state.skills.xpSkills)) state.skills.xpSkills = [];
  if (!Array.isArray(state.skills.jujutsuSkills)) state.skills.jujutsuSkills = [];
}

function sortByTitle(a, b) {
  return String(a?.title || "").localeCompare(String(b?.title || ""), undefined, { sensitivity: "base" });
}

function renderInteractivePips(action, current, total) {
  let html = "";
  for (let i = 0; i < total; i += 1) {
    const filled = i < current;
    html += `<button type="button" class="progress-pip${filled ? " filled" : ""}" data-action="${action}" data-value="${i + 1}" aria-label="Set value to ${i + 1} of ${total}" title="${i + 1}/${total}"></button>`;
  }
  return html;
}

function renderXpStackPips(state, skill) {
  const maxStacks = parsePositiveInt(skill?.maxStacks, 1);
  const currentStacks = Math.min(parsePositiveInt(skill?.currentStacks, 1), maxStacks);
  const xpCost = parsePositiveInt(skill?.xpCost, 1);
  const availableXp = getAvailableXp(state);
  const affordableAdds = Math.floor(availableXp / xpCost);
  const maxAffordableStack = Math.min(maxStacks, currentStacks + affordableAdds);

  let html = "";
  for (let i = 1; i <= maxStacks; i += 1) {
    const filled = i <= currentStacks;
    const isDisabled = !filled && i > maxAffordableStack;
    const title = isDisabled ? "Not Enough XP" : `${i}/${maxStacks}`;
    html += `<button type="button" class="progress-pip${filled ? " filled" : ""}${isDisabled ? " is-disabled" : ""}" data-action="setXpStack" data-value="${i}"${isDisabled ? ' data-disabled="true" aria-disabled="true"' : ""} aria-label="Set value to ${i} of ${maxStacks}" title="${title}"></button>`;
  }
  return html;
}

function renderStaticPips(current, total) {
  let html = "";
  for (let i = 0; i < total; i += 1) {
    const filled = i < current;
    html += `<span class="progress-pip skills-readonly-pip${filled ? " filled" : ""}" aria-hidden="true"></span>`;
  }
  return html;
}

function renderSkillActionIcons(skillId, kind) {
  return `
    <button type="button" class="inventory-icon-btn inventory-icon-btn-edit" data-action="editSkill" aria-label="Edit skill" title="Edit skill">✎</button>
    <button type="button" class="inventory-icon-btn danger" data-action="deleteSkill" aria-label="Delete skill" title="Delete skill">
      <svg class="inventory-icon-trash" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path fill="currentColor" d="M9 3h6a1 1 0 0 1 1 1v1h4v2h-1l-1 12a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 7H4V5h4V4a1 1 0 0 1 1-1Zm1 2v0h4V5h-4Zm-1 4h2v9H9V9Zm4 0h2v9h-2V9Z"/>
        <path fill="none" stroke="currentColor" stroke-width="1.5" d="M6 7.5h12"/>
      </svg>
    </button>
  `;
}

function updateSkillCardActions(state, skillId, kind) {
  const panel = document.getElementById("jujutsuSubpanelSkills");
  if (!panel) return;
  const card = panel.querySelector(`.skills-card[data-kind="${kind}"][data-skill-id="${skillId}"]`);
  const actions = card?.querySelector(".skills-card-actions");
  if (!actions) {
    renderSkills(state);
    return;
  }
  actions.innerHTML = renderSkillActionIcons(skillId, kind);
  requestAnimationFrame(() => repositionSkillsFloatingMenus(panel));
}

function renderXpSkillCard(state, skill) {
  const maxStacks = parsePositiveInt(skill.maxStacks, 1);
  const currentStacks = Math.min(parsePositiveInt(skill.currentStacks, 1), maxStacks);
  const xpCost = parsePositiveInt(skill.xpCost, 1);
  const showRefundConfirm = _openStackRefundConfirm && _openStackRefundConfirm.skillId === skill.id;
  return `
    <article class="skills-card" data-kind="xp" data-skill-id="${skill.id}">
      <div class="skills-card-title">${skill.title || "Untitled XP Skill"}</div>
      ${skill.description ? `<div class="skills-card-desc">${skill.description}</div>` : ""}
      <div class="skills-card-meta-row">
        <span class="skills-card-meta">Stacks:</span>
        <div class="skills-pips-wrap">
          <div class="progress-pips skills-progress-pips" aria-label="Stacks ${currentStacks} of ${maxStacks}">
            ${renderXpStackPips(state, skill)}
          </div>
          ${showRefundConfirm ? `<div class="skills-refund-confirm" role="menu">
            <span class="skills-delete-confirm-text">Refund ${_openStackRefundConfirm.refundAmount} XP?</span>
            <button type="button" class="inventory-mini-btn" data-action="confirmRefundStacks">Refund</button>
            <button type="button" class="inventory-mini-btn" data-action="cancelRefundStacks">Cancel</button>
          </div>` : ""}
        </div>
      </div>
      <div class="skills-card-meta-row">
        <span class="skills-card-meta">Cost: ${xpCost} XP per stack</span>
      </div>
      <div class="skills-card-actions">
        ${renderSkillActionIcons(skill.id, "xp")}
      </div>
    </article>
  `;
}

const _SLOT_GRADE_RANK = { "4": 0, "Semi-3": 0.5, "3": 1, "Semi-2": 1.5, "2": 2, "Semi-1": 2.5, "1": 3, "Special Grade": 4 };

function hasAvailableTrainingSlot(state) {
  const grade = String(state?.grade || "").trim();
  const gradeRank = _SLOT_GRADE_RANK[grade] ?? 0;
  let unlockedSlots = 1;
  if (gradeRank >= 2.5) unlockedSlots = 2;
  if (gradeRank >= 4) unlockedSlots = 3;
  const trainingList = Array.isArray(state?.training?.jujutsuSkills) ? state.training.jujutsuSkills : [];
  const incompleteCount = trainingList.filter(s => parsePositiveInt(s?.progress, 0) < parsePositiveInt(s?.requiredMissions, 1)).length;
  return incompleteCount < unlockedSlots;
}

function isSkillCurrentlyInTraining(state, skill) {
  const skillDefId = String(skill?.skillDefId || skill?.id || "").trim();
  if (!skillDefId) return false;
  const trainingList = Array.isArray(state?.training?.jujutsuSkills) ? state.training.jujutsuSkills : [];
  return trainingList.some(entry =>
    String(entry?.skillDefId || entry?.id || "") === skillDefId
    && parsePositiveInt(entry?.progress, 0) < parsePositiveInt(entry?.requiredMissions, 1),
  );
}

function renderJujutsuSkillCard(state, skill) {
  const timesLearned = parsePositiveInt(skill.timesLearned, 1);
  const maxLearnCount = parsePositiveInt(skill.maxLearnCount, 1);
  const inTraining = isSkillCurrentlyInTraining(state, skill);
  const canRelearn = timesLearned < maxLearnCount && !inTraining;
  const slotAvailable = canRelearn ? hasAvailableTrainingSlot(state) : false;
  const relearnTitle = slotAvailable ? "Learn Again" : "No Available Training Slot";
  return `
    <article class="skills-card" data-kind="jujutsu" data-skill-id="${skill.id}">
      <div class="skills-card-title">${skill.title || "Untitled Jujutsu Skill"}</div>
      ${skill.description ? `<div class="skills-card-desc">${skill.description}</div>` : ""}
      <div class="skills-card-meta-row">
        <span class="skills-card-meta">Learned:</span>
        <div class="progress-pips skills-progress-pips" aria-label="Learned ${timesLearned} of ${maxLearnCount}">
          ${renderStaticPips(timesLearned, maxLearnCount)}
        </div>
        ${inTraining ? '<span class="skills-card-meta">(In Training)</span>' : ""}
      </div>
      <div class="skills-card-actions">
        ${canRelearn ? `<button type="button" class="inventory-icon-btn skills-icon-relearn-btn${slotAvailable ? "" : " skills-icon-relearn-disabled"}" data-action="relearnSkill" aria-label="${relearnTitle}" title="${relearnTitle}"${slotAvailable ? "" : " disabled"}>↻</button>` : ""}
        ${renderSkillActionIcons(skill.id, "jujutsu")}
      </div>
    </article>
  `;
}

function renderSkillEditForm(skill, kind) {
  const title = normalizeText(skill?.title);
  const description = normalizeText(skill?.description);
  const maxLearnCount = parsePositiveInt(skill?.maxLearnCount, 1);
  const requirements = normalizeText(skill?.requirements);
  const requiredMissions = parsePositiveInt(skill?.requiredMissions, 1);
  const maxStacks = parsePositiveInt(skill?.maxStacks, 1);
  const currentStacks = Math.min(parsePositiveInt(skill?.currentStacks, 1), maxStacks);
  const xpCost = parsePositiveInt(skill?.xpCost, 1);

  return `
    <div class="skills-edit-card" data-kind="${kind}" data-skill-id="${skill.id}">
      <div class="skill-input-grid">
        <div class="skill-input-field">
          <label class="field-label">Title</label>
          <input type="text" class="skill-input" data-field="title" value="${title}" maxlength="100" />
        </div>
        <div class="skill-input-field full-width">
          <label class="field-label">Description</label>
          <textarea class="skill-textarea" data-field="description" rows="3" maxlength="300">${description}</textarea>
        </div>
        ${kind === "xp" ? `
          <div class="skill-input-field">
            <label class="field-label">Max Stacks</label>
            <input type="number" min="1" class="skill-input" data-field="maxStacks" value="${maxStacks}" />
          </div>
          <div class="skill-input-field">
            <label class="field-label">Current Stacks</label>
            <input type="number" min="1" class="skill-input" data-field="currentStacks" value="${currentStacks}" />
          </div>
          <div class="skill-input-field">
            <label class="field-label">XP Cost</label>
            <input type="number" min="1" class="skill-input" data-field="xpCost" value="${xpCost}" />
          </div>
        ` : ""}
        ${kind === "jujutsu" ? `
          <div class="skill-input-field">
            <label class="field-label">Max Learn Count</label>
            <input type="number" min="1" class="skill-input" data-field="maxLearnCount" value="${maxLearnCount}" />
          </div>
          <div class="skill-input-field">
            <label class="field-label">Requirement</label>
            <select class="skill-input" data-field="requirements">
              <option value=""${requirements === "" ? " selected" : ""}>— Select Grade —</option>
              <option value="Grade 4"${requirements === "Grade 4" ? " selected" : ""}>Grade 4</option>
              <option value="Grade 3"${requirements === "Grade 3" ? " selected" : ""}>Grade 3</option>
              <option value="Grade 2"${requirements === "Grade 2" ? " selected" : ""}>Grade 2</option>
              <option value="Grade 1"${requirements === "Grade 1" ? " selected" : ""}>Grade 1</option>
              <option value="Special Grade"${requirements === "Special Grade" ? " selected" : ""}>Special Grade</option>
            </select>
          </div>
          <div class="skill-input-field">
            <label class="field-label">Missions Required</label>
            <input type="number" min="1" max="20" class="skill-input" data-field="requiredMissions" value="${requiredMissions}" />
          </div>
        ` : ""}
      </div>
      <div class="skill-input-actions">
        <button type="button" class="training-add-skill-btn" data-action="saveSkillEdit">Save</button>
        <button type="button" class="training-cancel-btn" data-action="cancelSkillEdit">Cancel</button>
      </div>
    </div>
  `;
}

function renderAddXpSkillForm(state) {
  const costValidation = validateXpCost(state, 0);
  return `
    <div class="skills-add-form" data-kind="xp">
      <div class="skill-input-grid">
        <div class="skill-input-field">
          <label class="field-label">XP Skill Title</label>
          <input type="text" class="skill-input" data-field="title" maxlength="100" />
        </div>
        <div class="skill-input-field full-width">
          <label class="field-label">Description</label>
          <textarea class="skill-textarea" data-field="description" rows="3" maxlength="300"></textarea>
        </div>
        <div class="skill-input-field">
          <label class="field-label">Max Stacks</label>
          <input type="number" min="1" class="skill-input" data-field="maxStacks" value="1" />
        </div>
        <div class="skill-input-field">
          <label class="field-label">XP Cost</label>
          <input type="number" min="0" class="skill-input" data-field="xpCost" value="0" />
        </div>
      </div>
      <div class="skill-input-actions">
        <button type="button" class="training-add-skill-btn${costValidation.valid ? "" : " is-disabled"}" data-action="saveNewXpSkill" title="${costValidation.reason}"${costValidation.valid ? "" : ' data-disabled="true" aria-disabled="true"'}>Add XP Skill</button>
        <button type="button" class="training-cancel-btn" data-action="cancelNewXpSkill">Cancel</button>
      </div>
    </div>
  `;
}

function updateAddXpSkillButtonState(form, state) {
  const button = form?.querySelector("[data-action='saveNewXpSkill']");
  if (!button) return;
  const rawCost = form?.querySelector("[data-field='xpCost']")?.value;
  const validation = validateXpCost(state, rawCost);
  button.title = validation.reason;
  if (validation.valid) {
    button.classList.remove("is-disabled");
    button.removeAttribute("data-disabled");
    button.removeAttribute("aria-disabled");
  } else {
    button.classList.add("is-disabled");
    button.setAttribute("data-disabled", "true");
    button.setAttribute("aria-disabled", "true");
  }
}

function repositionSkillsFloatingMenus(panel) {
  if (!panel) return;
  const floatingMenus = panel.querySelectorAll(".skills-refund-confirm");
  const viewportPad = 8;
  floatingMenus.forEach(menu => {
    menu.style.position = "";
    menu.style.left = "";
    menu.style.top = "";
    menu.style.right = "";
    menu.style.bottom = "";
    menu.style.marginLeft = "";
    menu.style.transform = "";
    menu.style.transformOrigin = "";
    menu.classList.remove("confirm-below", "confirm-align-left", "confirm-align-right");
    const rect = menu.getBoundingClientRect();
    if (rect.top < viewportPad) menu.classList.add("confirm-below");
    if (rect.right > window.innerWidth - viewportPad) menu.classList.add("confirm-align-left");
    if (rect.left < viewportPad) menu.classList.add("confirm-align-right");
  });
}

function applySearchFilter(skills, search) {
  if (!search) return skills;
  return skills.filter(skill => {
    const title = String(skill?.title || "").toLowerCase();
    const description = String(skill?.description || "").toLowerCase();
    return title.includes(search) || description.includes(search);
  });
}

function renderSkillsPanel(state) {
  ensureSkillsState(state);
  const search = String(_skillsSearchQuery || "").trim().toLowerCase();
  const hasSearch = search.length > 0;

  const xpSkills = applySearchFilter([...state.skills.xpSkills].sort(sortByTitle), search);
  const jujutsuSkills = applySearchFilter([...state.skills.jujutsuSkills].sort(sortByTitle), search);

  const jujutsuEmptyMessage = hasSearch ? "No skills found" : "No learned Jujutsu skills yet.";
  const xpEmptyMessage = hasSearch ? "No skills found" : "No XP skills yet.";

  return `
    <div class="skills-shell">
      <div class="skills-toolbar">
        <input id="skillsSearchInput" class="meta-input" type="text" placeholder="Search XP + Jujutsu skills..." value="${escapeHtml(_skillsSearchQuery)}" />
      </div>

      <div class="training-section">
        <div class="training-section-header">
          <h3 class="training-section-title">Jujutsu Skills</h3>
        </div>
        <div class="skills-grid">
          ${jujutsuSkills.length ? jujutsuSkills.map(skill => renderJujutsuSkillCard(state, skill)).join("") : `<div class="training-muted">${jujutsuEmptyMessage}</div>`}
        </div>
      </div>

      <div class="training-section">
        <div class="training-section-header">
          <h3 class="training-section-title">XP Skills</h3>
          <button type="button" class="training-add-skill-btn" data-action="showNewXpSkillForm">Add XP Skill</button>
        </div>
        ${_showXpSkillForm ? renderAddXpSkillForm(state) : ""}
        <div class="skills-grid">
          ${xpSkills.length ? xpSkills.map(skill => renderXpSkillCard(state, skill)).join("") : `<div class="training-muted">${xpEmptyMessage}</div>`}
        </div>
      </div>
    </div>
  `;
}

function rerenderSkillsPreserveSearchFocus(state, sourceInput = null) {
  const active = sourceInput || document.getElementById("skillsSearchInput");
  const shouldRefocus = Boolean(active && document.activeElement === active);
  const start = shouldRefocus && typeof active.selectionStart === "number" ? active.selectionStart : null;
  const end = shouldRefocus && typeof active.selectionEnd === "number" ? active.selectionEnd : null;

  renderSkills(state);

  if (!shouldRefocus) return;
  const rebuilt = document.getElementById("skillsSearchInput");
  if (!rebuilt) return;
  rebuilt.focus();
  if (start !== null && end !== null) {
    rebuilt.setSelectionRange(start, end);
  }
}

function findSkillById(state, kind, skillId) {
  ensureSkillsState(state);
  const list = kind === "jujutsu" ? state.skills.jujutsuSkills : state.skills.xpSkills;
  const index = list.findIndex(skill => skill.id === skillId);
  if (index < 0) return { list, index, skill: null };
  return { list, index, skill: list[index] };
}

function startJujutsuRelearn(state, skill) {
  if (!state?.training) state.training = { jujutsuSkills: [], aptitudeTraining: { activeTrainings: [] } };
  if (!Array.isArray(state.training.jujutsuSkills)) state.training.jujutsuSkills = [];

  const alreadyQueued = state.training.jujutsuSkills.some(item =>
    item?.skillDefId && skill?.skillDefId && item.skillDefId === skill.skillDefId && item.progress < item.requiredMissions,
  );
  if (alreadyQueued) {
    alert("That skill is already in Training.");
    return false;
  }

  state.training.jujutsuSkills.push({
    id: createId("train-skill"),
    skillDefId: skill.skillDefId || skill.id,
    title: skill.title,
    description: skill.description || "",
    requirements: skill.requirements || "",
    requiredMissions: parsePositiveInt(skill.requiredMissions, 1),
    multiMission: parsePositiveInt(skill.requiredMissions, 1) > 1,
    maxLearnCount: parsePositiveInt(skill.maxLearnCount, 1),
    progress: 0,
  });
  return true;
}

function setupSkillsEventHandlers() {
  const panel = document.getElementById("jujutsuSubpanelSkills");
  if (!panel) return;
  if (panel.dataset.skillsHandlersBound === "true") return;
  panel.dataset.skillsHandlersBound = "true";

  panel.addEventListener("input", e => {
    if (e.target?.id === "skillsSearchInput") {
      const state = getState();
      if (!state) return;
      _skillsSearchQuery = String(e.target.value || "");
      rerenderSkillsPreserveSearchFocus(state, e.target);
      return;
    }

    const addForm = e.target?.closest?.(".skills-add-form[data-kind='xp']");
    if (addForm) {
      const state = getState();
      if (!state) return;
      updateAddXpSkillButtonState(addForm, state);
    }
  });

  panel.addEventListener("click", e => {
    const state = getState();
    if (!state) return;
    ensureSkillsState(state);

    const showXpFormBtn = e.target?.closest?.("[data-action='showNewXpSkillForm']");
    if (showXpFormBtn) {
      _showXpSkillForm = true;
      _openStackRefundConfirm = null;
      renderSkills(state);
      return;
    }

    const cancelNewXpBtn = e.target?.closest?.("[data-action='cancelNewXpSkill']");
    if (cancelNewXpBtn) {
      _showXpSkillForm = false;
      _openStackRefundConfirm = null;
      renderSkills(state);
      return;
    }

    const addXpBtn = e.target?.closest?.("[data-action='saveNewXpSkill']");
    if (addXpBtn) {
      const form = addXpBtn.closest(".skills-add-form");
      if (addXpBtn.dataset.disabled === "true") return;
      const title = normalizeText(form?.querySelector("[data-field='title']")?.value);
      const description = normalizeText(form?.querySelector("[data-field='description']")?.value);
      const maxStacks = parsePositiveInt(form?.querySelector("[data-field='maxStacks']")?.value, 1);
      const rawCost = form?.querySelector("[data-field='xpCost']")?.value;
      const costValidation = validateXpCost(state, rawCost);
      if (!title) {
        alert("Please provide an XP skill title.");
        return;
      }
      if (!costValidation.valid) {
        updateAddXpSkillButtonState(form, state);
        return;
      }
      setAvailableXp(state, getAvailableXp(state) - costValidation.xpCost);
      state.skills.xpSkills.push({ id: createId("xp-skill"), title, description, maxStacks, currentStacks: 1, xpCost: costValidation.xpCost });
      _showXpSkillForm = false;
      _openStackRefundConfirm = null;
      scheduleSave();
      refreshCharacterStats();
      renderSkills(state);
      return;
    }

    const card = e.target?.closest?.("[data-skill-id]");
    if (!card) return;
    const skillId = String(card.dataset.skillId || "");
    const kind = String(card.dataset.kind || "xp");

    const editBtn = e.target?.closest?.("[data-action='editSkill']");
    if (editBtn) {
      const info = findSkillById(state, kind, skillId);
      if (!info.skill) return;
      card.outerHTML = renderSkillEditForm(info.skill, kind);
      return;
    }

    const deleteBtn = e.target?.closest?.("[data-action='deleteSkill']");
    if (deleteBtn) {
      const info = findSkillById(state, kind, skillId);
      _openStackRefundConfirm = null;
      if (info.index < 0) return;
      info.list.splice(info.index, 1);
      scheduleSave();
      renderSkills(state);
      return;
    }

    const setXpStackBtn = e.target?.closest?.("[data-action='setXpStack']");
    if (setXpStackBtn) {
      if (setXpStackBtn.dataset.disabled === "true") return;
      const info = findSkillById(state, "xp", skillId);
      if (!info.skill) return;
      const maxStacks = parsePositiveInt(info.skill.maxStacks, 1);
      const requested = parsePositiveInt(setXpStackBtn.dataset.value, 1);
      const clamped = Math.min(requested, maxStacks);
      const currentStacks = Math.min(parsePositiveInt(info.skill.currentStacks, 1), maxStacks);
      if (clamped === currentStacks) return;
      if (clamped > currentStacks) {
        const xpCost = parsePositiveInt(info.skill.xpCost, 1);
        const totalCost = (clamped - currentStacks) * xpCost;
        if (getAvailableXp(state) < totalCost) {
          renderSkills(state);
          return;
        }
        setAvailableXp(state, getAvailableXp(state) - totalCost);
        _openStackRefundConfirm = null;
        refreshCharacterStats();
      } else {
        const xpCost = parsePositiveInt(info.skill.xpCost, 1);
        const refundAmount = (currentStacks - clamped) * xpCost;
        _openStackRefundConfirm = { skillId, targetStacks: clamped, refundAmount };
        renderSkills(state);
        return;
      }
      info.skill.currentStacks = clamped;
      scheduleSave();
      renderSkills(state);
      return;
    }

    const confirmRefundBtn = e.target?.closest?.("[data-action='confirmRefundStacks']");
    if (confirmRefundBtn) {
      const pending = _openStackRefundConfirm;
      if (!pending || pending.skillId !== skillId) return;
      const info = findSkillById(state, "xp", skillId);
      if (!info.skill) {
        _openStackRefundConfirm = null;
        renderSkills(state);
        return;
      }
      const maxStacks = parsePositiveInt(info.skill.maxStacks, 1);
      const currentStacks = Math.min(parsePositiveInt(info.skill.currentStacks, 1), maxStacks);
      const targetStacks = Math.max(1, Math.min(parsePositiveInt(pending.targetStacks, 1), currentStacks));
      const xpCost = parsePositiveInt(info.skill.xpCost, 1);
      const refundAmount = (currentStacks - targetStacks) * xpCost;
      if (refundAmount > 0) {
        setAvailableXp(state, getAvailableXp(state) + refundAmount);
        info.skill.currentStacks = targetStacks;
        scheduleSave();
        refreshCharacterStats();
      }
      _openStackRefundConfirm = null;
      renderSkills(state);
      return;
    }

    const cancelRefundBtn = e.target?.closest?.("[data-action='cancelRefundStacks']");
    if (cancelRefundBtn) {
      _openStackRefundConfirm = null;
      renderSkills(state);
      return;
    }

    const relearnBtn = e.target?.closest?.("[data-action='relearnSkill']");
    if (relearnBtn) {
      const info = findSkillById(state, "jujutsu", skillId);
      if (!info.skill) return;
      const timesLearned = parsePositiveInt(info.skill.timesLearned, 1);
      const maxLearnCount = parsePositiveInt(info.skill.maxLearnCount, 1);
      if (timesLearned >= maxLearnCount) return;
      if (startJujutsuRelearn(state, info.skill)) {
        scheduleSave();
        refreshTraining();
        renderSkills(state);
      }
      return;
    }

    const saveEditBtn = e.target?.closest?.("[data-action='saveSkillEdit']");
    if (saveEditBtn) {
      const editCard = saveEditBtn.closest(".skills-edit-card");
      const editKind = String(editCard?.dataset.kind || "xp");
      const editId = String(editCard?.dataset.skillId || "");
      const info = findSkillById(state, editKind, editId);
      if (!info.skill) return;

      const title = normalizeText(editCard.querySelector("[data-field='title']")?.value);
      const description = normalizeText(editCard.querySelector("[data-field='description']")?.value);
      if (!title) {
        alert("Title is required.");
        return;
      }

      info.skill.title = title;
      info.skill.description = description;

      if (editKind === "xp") {
        const maxStacks = parsePositiveInt(editCard.querySelector("[data-field='maxStacks']")?.value, 1);
        const currentStacks = parsePositiveInt(editCard.querySelector("[data-field='currentStacks']")?.value, 1);
        const xpCost = parsePositiveInt(editCard.querySelector("[data-field='xpCost']")?.value, 1);
        info.skill.maxStacks = maxStacks;
        info.skill.currentStacks = Math.min(currentStacks, maxStacks);
        info.skill.xpCost = xpCost;
      }

      if (editKind === "jujutsu") {
        info.skill.maxLearnCount = parsePositiveInt(editCard.querySelector("[data-field='maxLearnCount']")?.value, 1);
        info.skill.requirements = normalizeText(editCard.querySelector("[data-field='requirements']")?.value);
        info.skill.requiredMissions = parsePositiveInt(editCard.querySelector("[data-field='requiredMissions']")?.value, 1);
        info.skill.multiMission = info.skill.requiredMissions > 1;
        info.skill.timesLearned = Math.min(
          parsePositiveInt(info.skill.timesLearned, 1),
          parsePositiveInt(info.skill.maxLearnCount, 1),
        );
      }

      scheduleSave();
      renderSkills(state);
      return;
    }

    const cancelEditBtn = e.target?.closest?.("[data-action='cancelSkillEdit']");
    if (cancelEditBtn) {
      renderSkills(state);
    }
  });
}

export function initSkills(deps = {}) {
  _getState = deps.getState || null;
  _scheduleSave = deps.scheduleSave || null;
  _refreshTraining = deps.refreshTraining || null;
  _refreshCharacterStats = deps.refreshCharacterStats || null;
  _initialized = true;
}

export function renderSkills(state) {
  const panel = document.getElementById("jujutsuSubpanelSkills");
  if (!panel) return;
  ensureSkillsState(state);
  panel.innerHTML = renderSkillsPanel(state);
  setupSkillsEventHandlers();
  requestAnimationFrame(() => repositionSkillsFloatingMenus(panel));
}
