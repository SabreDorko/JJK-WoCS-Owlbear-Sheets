let _getState = null;
let _scheduleSave = null;
let _showRollToast = null;
let _refreshUI = null;
let _initialized = false;

const GRADE_RANK = { "4": 0, "Semi-3": 0.5, "3": 1, "Semi-2": 1.5, "2": 2, "Semi-1": 2.5, "1": 3, "Special Grade": 4 };

function getState() {
  return _getState ? _getState() : null;
}

function scheduleSave() {
  if (_scheduleSave) _scheduleSave();
}

function refreshUI() {
  if (_refreshUI) _refreshUI();
}

function ensureTrainingState(state) {
  if (!state) return;
  if (!state.training) {
    state.training = {
      jujutsuSkills: [],
      aptitudeTraining: [],
    };
  }
  if (!state.training.jujutsuSkills) state.training.jujutsuSkills = [];
  if (!state.training.aptitudeTraining) state.training.aptitudeTraining = [];
}

function generateUniqueId() {
  return `skill-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

function getCharacterGradeRank(state) {
  const grade = state?.grade || "";
  return GRADE_RANK[grade] ?? -1;
}

function isSlotUnlocked(slotNumber, state) {
  const gradeRank = getCharacterGradeRank(state);
  if (slotNumber === 1) return true; // Always unlocked
  if (slotNumber === 2) return gradeRank >= GRADE_RANK["Semi-1"]; // Semi-1 or better
  if (slotNumber === 3) return gradeRank >= GRADE_RANK["Special Grade"];
  return false;
}

function getSlotLockMessage(slotNumber) {
  if (slotNumber === 2) return "Locked: Reach Semi-Grade 1";
  if (slotNumber === 3) return "Locked: Reach Special Grade";
  return "";
}

function formatProgressPips(progress, required) {
  let html = "";
  for (let i = 0; i < required; i++) {
    html += `<span class="progress-pip${i < progress ? " filled" : ""}"></span>`;
  }
  return html;
}

function renderJujutsuSkillCard(skill) {
  const progressHtml = formatProgressPips(skill.progress, skill.requiredMissions);
  const isComplete = skill.progress >= skill.requiredMissions;
  
  return `
    <div class="training-skill-card" data-skill-id="${skill.id}">
      <div class="skill-card-header">
        <div class="skill-card-title">${skill.title || "Untitled Skill"}</div>
        <button type="button" class="training-skill-delete-btn" data-action="deleteSkill" data-skill-id="${skill.id}" aria-label="Delete skill">
          <svg class="training-icon-trash" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path fill="currentColor" d="M9 3h6a1 1 0 0 1 1 1v1h4v2h-1l-1 12a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 7H4V5h4V4a1 1 0 0 1 1-1Zm1 2v0h4V5h-4Zm-1 4h2v9H9V9Zm4 0h2v9h-2V9Z"/>
            <path fill="none" stroke="currentColor" stroke-width="1.5" d="M6 7.5h12"/>
          </svg>
        </button>
      </div>
      <div class="skill-card-meta">
        <span class="skill-requirement">Requirements: ${skill.requirements || "—"}</span>
        ${skill.multiMission ? '<span class="skill-multi-mission">Multi-Mission</span>' : ''}
      </div>
      ${skill.description ? `<div class="skill-card-description">${skill.description}</div>` : ''}
      <div class="skill-card-progress">
        <div class="progress-pips">${progressHtml}</div>
        <div class="progress-text">${skill.progress}/${skill.requiredMissions} missions</div>
      </div>
      <div class="skill-card-actions">
        <button type="button" class="training-progress-btn" data-action="progressSkill" data-skill-id="${skill.id}" aria-label="Add mission progress">+</button>
        ${skill.progress > 0 ? `<button type="button" class="training-progress-btn minus" data-action="regressSkill" data-skill-id="${skill.id}" aria-label="Remove mission progress">−</button>` : ''}
        ${isComplete ? `<button type="button" class="training-complete-btn" data-action="completeSkill" data-skill-id="${skill.id}" aria-label="Move to Skills tab">Complete</button>` : ''}
      </div>
    </div>
  `;
}

function renderJujutsuSkillInput() {
  return `
    <div class="training-skill-input-card">
      <div class="skill-input-grid">
        <div class="skill-input-field">
          <label for="skillTitleInput" class="field-label">Skill Title</label>
          <input type="text" id="skillTitleInput" class="skill-input" placeholder="e.g., Basic Cursed Energy Control" maxlength="100" />
        </div>
        <div class="skill-input-field">
          <label for="skillRequirementsInput" class="field-label">Requirements</label>
          <select id="skillRequirementsInput" class="skill-input">
            <option value="">— Select Grade —</option>
            <option value="Grade 4">Grade 4</option>
            <option value="Grade 3">Grade 3</option>
            <option value="Grade 2">Grade 2</option>
            <option value="Grade 1">Grade 1</option>
            <option value="Special Grade">Special Grade</option>
          </select>
        </div>
        <div class="skill-input-field">
          <label class="field-label">Multi-Mission</label>
          <div class="checkbox-wrapper">
            <input type="checkbox" id="skillMultiMissionCheckbox" class="checkbox-input" />
            <label for="skillMultiMissionCheckbox" class="checkbox-label">Requires 2 missions</label>
          </div>
        </div>
        <div class="skill-input-field full-width">
          <label for="skillDescriptionInput" class="field-label">Description</label>
          <textarea id="skillDescriptionInput" class="skill-textarea" placeholder="Skill details and notes..." maxlength="300" rows="3"></textarea>
        </div>
      </div>
      <div class="skill-input-actions">
        <button type="button" class="training-add-skill-btn" data-action="addSkill">Add Skill</button>
        <button type="button" class="training-cancel-btn" data-action="cancelAddSkill">Cancel</button>
      </div>
    </div>
  `;
}

function renderLockedSlotCard(lockMessage) {
  return `
    <div class="training-skill-card training-skill-card-locked">
      <div class="training-locked-message">${lockMessage}</div>
    </div>
  `;
}

function renderEmptySlotCard(slotNumber) {
  return `
    <div class="training-skill-card training-skill-card-empty">
      <div class="training-empty-slot">
        <button type="button" class="training-add-btn-large" data-action="showAddSkillForm" data-slot="${slotNumber}" aria-label="Add skill to slot ${slotNumber}">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
            <path fill="currentColor" d="M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6V5z"/>
          </svg>
        </button>
        <div class="training-slot-label">Slot ${slotNumber}</div>
      </div>
    </div>
  `;
}

function renderJujutsuSkills(state) {
  const skills = state?.training?.jujutsuSkills || [];
  const incompleteSkills = skills.filter(s => s.progress < s.requiredMissions);
  
  let html = `
    <div class="training-section jujutsu-skills-section">
      <div class="training-section-header">
        <h3 class="training-section-title">Jujutsu Skills</h3>
      </div>
      <div class="training-skills-container">
  `;
  
  // Render 3 skill slots
  for (let slotNum = 1; slotNum <= 3; slotNum++) {
    const isUnlocked = isSlotUnlocked(slotNum, state);
    const skill = incompleteSkills[slotNum - 1] || null;
    
    html += `<div class="training-slot" data-slot="${slotNum}">`;
    
    if (isUnlocked) {
      if (skill) {
        html += renderJujutsuSkillCard(skill);
      } else {
        html += renderEmptySlotCard(slotNum);
      }
    } else {
      const lockMsg = getSlotLockMessage(slotNum);
      html += renderLockedSlotCard(lockMsg);
    }
    
    html += `</div>`;
  }
  
  html += `
      </div>
      <div id="skillInputContainer"></div>
    </div>
  `;
  
  return html;
}

function renderAptitudeTraining(state) {
  return `
    <div class="training-section aptitude-training-section">
      <div class="training-section-header">
        <h3 class="training-section-title">Aptitude Training</h3>
      </div>
      <div class="training-muted">Aptitude training progress tracking will be implemented here.</div>
    </div>
  `;
}

function renderTrainingPanel(state) {
  return `
    <div class="training-shell">
      ${renderJujutsuSkills(state)}
      ${renderAptitudeTraining(state)}
    </div>
  `;
}

function handleAddSkill() {
  const titleInput = document.getElementById("skillTitleInput");
  const requirementsInput = document.getElementById("skillRequirementsInput");
  const multiMissionCheckbox = document.getElementById("skillMultiMissionCheckbox");
  const descriptionInput = document.getElementById("skillDescriptionInput");
  
  // Debug: verify inputs exist
  if (!titleInput || !requirementsInput) {
    console.error("Form inputs not found in DOM");
    alert("Error: Form elements not found. Please try again.");
    return;
  }
  
  const title = String(titleInput.value || "").trim();
  const requirements = String(requirementsInput.value || "").trim();
  
  if (!title) {
    alert("Please enter a skill title.");
    titleInput.focus();
    return;
  }
  if (!requirements) {
    alert("Please select a requirement grade.");
    requirementsInput.focus();
    return;
  }
  
  const state = getState();
  if (!state) {
    alert("Error: Unable to get character state.");
    return;
  }
  
  ensureTrainingState(state);
  
  const newSkill = {
    id: generateUniqueId(),
    title,
    requirements,
    description: String(descriptionInput?.value || "").trim(),
    multiMission: Boolean(multiMissionCheckbox?.checked),
    requiredMissions: Boolean(multiMissionCheckbox?.checked) ? 2 : 1,
    progress: 0,
  };
  
  state.training.jujutsuSkills.push(newSkill);
  
  // Clear the form container to hide the form and show the updated slots
  const container = document.getElementById("skillInputContainer");
  if (container) {
    container.innerHTML = "";
  }
  
  scheduleSave();
  refreshUI();
}

function handleDeleteSkill(skillId) {
  const state = getState();
  if (!state) return;
  
  ensureTrainingState(state);
  
  const index = state.training.jujutsuSkills.findIndex(s => s.id === skillId);
  if (index >= 0) {
    state.training.jujutsuSkills.splice(index, 1);
    scheduleSave();
    refreshUI();
  }
}

function handleProgressSkill(skillId) {
  const state = getState();
  if (!state) return;
  
  ensureTrainingState(state);
  
  const skill = state.training.jujutsuSkills.find(s => s.id === skillId);
  if (skill && skill.progress < skill.requiredMissions) {
    skill.progress++;
    scheduleSave();
    refreshUI();
  }
}

function handleReggressSkill(skillId) {
  const state = getState();
  if (!state) return;
  
  ensureTrainingState(state);
  
  const skill = state.training.jujutsuSkills.find(s => s.id === skillId);
  if (skill && skill.progress > 0) {
    skill.progress--;
    scheduleSave();
    refreshUI();
  }
}

function handleCompleteSkill(skillId) {
  const state = getState();
  if (!state) return;
  
  ensureTrainingState(state);
  
  const skill = state.training.jujutsuSkills.find(s => s.id === skillId);
  if (skill && skill.progress >= skill.requiredMissions) {
    alert(`Skill "${skill.title}" completed! This will be moved to the Skills tab when we implement it.`);
    
    const index = state.training.jujutsuSkills.findIndex(s => s.id === skillId);
    if (index >= 0) {
      state.training.jujutsuSkills.splice(index, 1);
      scheduleSave();
      refreshUI();
    }
  }
}

function setupTrainingEventHandlers() {
  const trainingPanel = document.getElementById("jujutsuSubpanelTraining");
  if (!trainingPanel) return;
  
  trainingPanel.addEventListener("click", (e) => {
    const addBtn = e.target?.closest?.("[data-action='showAddSkillForm']");
    if (addBtn) {
      const container = document.getElementById("skillInputContainer");
      if (container) {
        container.innerHTML = renderJujutsuSkillInput();
      }
      return;
    }
    
    const cancelBtn = e.target?.closest?.("[data-action='cancelAddSkill']");
    if (cancelBtn) {
      const container = document.getElementById("skillInputContainer");
      if (container) {
        container.innerHTML = "";
      }
      return;
    }
    
    const addSkillBtn = e.target?.closest?.("[data-action='addSkill']");
    if (addSkillBtn) {
      handleAddSkill();
      return;
    }
    
    const deleteBtn = e.target?.closest?.("[data-action='deleteSkill']");
    if (deleteBtn) {
      const skillId = deleteBtn.dataset.skillId;
      if (confirm("Delete this skill?")) {
        handleDeleteSkill(skillId);
      }
      return;
    }
    
    const progressBtn = e.target?.closest?.("[data-action='progressSkill']");
    if (progressBtn) {
      handleProgressSkill(progressBtn.dataset.skillId);
      return;
    }
    
    const reggressBtn = e.target?.closest?.("[data-action='regressSkill']");
    if (reggressBtn) {
      handleReggressSkill(reggressBtn.dataset.skillId);
      return;
    }
    
    const completeBtn = e.target?.closest?.("[data-action='completeSkill']");
    if (completeBtn) {
      handleCompleteSkill(completeBtn.dataset.skillId);
      return;
    }
  });
}

export function initTraining(deps = {}) {
  _getState = deps.getState || null;
  _scheduleSave = deps.scheduleSave || null;
  _showRollToast = deps.showRollToast || null;
  _refreshUI = deps.refreshUI || null;
  _initialized = true;
}

export function renderTraining(state) {
  const panel = document.getElementById("jujutsuSubpanelTraining");
  if (!panel) return;
  
  ensureTrainingState(state);
  panel.innerHTML = renderTrainingPanel(state);
  setupTrainingEventHandlers();
}
