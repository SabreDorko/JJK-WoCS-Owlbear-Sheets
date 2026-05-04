let _getState = null;
let _scheduleSave = null;
let _showRollToast = null;
let _refreshUI = null;
let _initialized = false;

function getState() {
  return _getState ? _getState() : null;
}

function scheduleSave() {
  if (_scheduleSave) _scheduleSave();
}

function refreshUI() {
  if (_refreshUI) _refreshUI();
}

function generateUniqueId() {
  return `skill-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
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
          <input type="text" id="skillRequirementsInput" class="skill-input" placeholder="e.g., Grade 3 Mission" maxlength="100" />
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

function renderJujutsuSkills(state) {
  const skills = state?.training?.jujutsuSkills || [];
  const incompleteSkills = skills.filter(s => s.progress < s.requiredMissions);
  
  let html = `
    <div class="training-section jujutsu-skills-section">
      <div class="training-section-header">
        <h3 class="training-section-title">Jujutsu Skills</h3>
        <button type="button" class="training-add-btn" data-action="showAddSkillForm" aria-label="Add new skill">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
            <path fill="currentColor" d="M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6V5z"/>
          </svg>
        </button>
      </div>
  `;
  
  if (incompleteSkills.length === 0) {
    html += `<div class="training-empty">No active jujutsu skills. Add one to get started.</div>`;
  } else {
    incompleteSkills.forEach(skill => {
      html += renderJujutsuSkillCard(skill);
    });
  }
  
  html += `<div id="skillInputContainer"></div></div>`;
  
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
  
  const title = titleInput?.value?.trim() || "";
  if (!title) {
    alert("Please enter a skill title.");
    return;
  }
  
  const state = getState();
  if (!state) return;
  
  const newSkill = {
    id: generateUniqueId(),
    title,
    requirements: requirementsInput?.value?.trim() || "",
    description: descriptionInput?.value?.trim() || "",
    multiMission: multiMissionCheckbox?.checked || false,
    requiredMissions: multiMissionCheckbox?.checked ? 2 : 1,
    progress: 0,
  };
  
  state.training.jujutsuSkills.push(newSkill);
  scheduleSave();
  refreshUI();
}

function handleDeleteSkill(skillId) {
  const state = getState();
  if (!state) return;
  
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
  
  const skill = state.training.jujutsuSkills.find(s => s.id === skillId);
  if (skill && skill.progress >= skill.requiredMissions) {
    // For now, show a message and remove from jujutsu skills
    alert(`Skill "${skill.title}" completed! This will be moved to the Skills tab when we implement it.`);
    
    // Remove from incomplete skills
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
    
    const reggressBtn = e.target?.closest?.("[data-action='reggressSkill']");
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

export function initTraining(getStateFn, scheduleSaveFn, showRollToastFn, refreshUIFn) {
  _getState = getStateFn;
  _scheduleSave = scheduleSaveFn;
  _showRollToast = showRollToastFn;
  _refreshUI = refreshUIFn;
  _initialized = true;
}

export function renderTraining(state) {
  const panel = document.getElementById("jujutsuSubpanelTraining");
  if (!panel) return;
  
  panel.innerHTML = renderTrainingPanel(state);
  setupTrainingEventHandlers();
}
