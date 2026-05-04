let _getState = null;
let _scheduleSave = null;
let _refreshTraining = null;
let _initialized = false;

function getState() {
  return _getState ? _getState() : null;
}

function scheduleSave() {
  if (_scheduleSave) _scheduleSave();
}

function refreshTraining() {
  if (_refreshTraining) _refreshTraining();
}

function createId(prefix = "id") {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function parsePositiveInt(raw, fallback = 1) {
  const parsed = parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, parsed);
}

function normalizeText(raw) {
  return String(raw || "").trim();
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

function renderXpSkillCard(skill) {
  return `
    <article class="skills-card" data-kind="xp" data-skill-id="${skill.id}">
      <div class="skills-card-title">${skill.title || "Untitled XP Skill"}</div>
      ${skill.description ? `<div class="skills-card-desc">${skill.description}</div>` : ""}
      <div class="skills-card-actions">
        <button type="button" class="inventory-mini-btn" data-action="editSkill">Edit</button>
        <button type="button" class="inventory-mini-btn danger" data-action="deleteSkill">Delete</button>
      </div>
    </article>
  `;
}

function renderJujutsuSkillCard(skill) {
  const timesLearned = parsePositiveInt(skill.timesLearned, 1);
  const maxLearnCount = parsePositiveInt(skill.maxLearnCount, 1);
  const canRelearn = timesLearned < maxLearnCount;
  return `
    <article class="skills-card" data-kind="jujutsu" data-skill-id="${skill.id}">
      <div class="skills-card-title">${skill.title || "Untitled Jujutsu Skill"}</div>
      ${skill.description ? `<div class="skills-card-desc">${skill.description}</div>` : ""}
      <div class="skills-card-meta">Learned: ${timesLearned}/${maxLearnCount}</div>
      <div class="skills-card-actions">
        ${canRelearn ? '<button type="button" class="inventory-mini-btn" data-action="relearnSkill">Learn Again</button>' : ""}
        <button type="button" class="inventory-mini-btn" data-action="editSkill">Edit</button>
        <button type="button" class="inventory-mini-btn danger" data-action="deleteSkill">Delete</button>
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

function renderAddXpSkillForm() {
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
      </div>
      <div class="skill-input-actions">
        <button type="button" class="training-add-skill-btn" data-action="saveNewXpSkill">Add XP Skill</button>
      </div>
    </div>
  `;
}

function getSearchValue() {
  const input = document.getElementById("skillsSearchInput");
  return String(input?.value || "").trim().toLowerCase();
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
  const search = getSearchValue();

  const xpSkills = applySearchFilter([...state.skills.xpSkills].sort(sortByTitle), search);
  const jujutsuSkills = applySearchFilter([...state.skills.jujutsuSkills].sort(sortByTitle), search);

  return `
    <div class="skills-shell">
      <div class="skills-toolbar">
        <input id="skillsSearchInput" class="meta-input" type="text" placeholder="Search skills..." value="${String(document.getElementById("skillsSearchInput")?.value || "").replace(/"/g, "&quot;")}" />
      </div>

      <div class="training-section">
        <div class="training-section-header">
          <h3 class="training-section-title">Jujutsu Skills</h3>
        </div>
        <div class="skills-grid">
          ${jujutsuSkills.length ? jujutsuSkills.map(renderJujutsuSkillCard).join("") : '<div class="training-muted">No learned Jujutsu skills yet.</div>'}
        </div>
      </div>

      <div class="training-section">
        <div class="training-section-header">
          <h3 class="training-section-title">XP Skills</h3>
        </div>
        ${renderAddXpSkillForm()}
        <div class="skills-grid">
          ${xpSkills.length ? xpSkills.map(renderXpSkillCard).join("") : '<div class="training-muted">No XP skills yet.</div>'}
        </div>
      </div>
    </div>
  `;
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
      renderSkills(state);
    }
  });

  panel.addEventListener("click", e => {
    const state = getState();
    if (!state) return;
    ensureSkillsState(state);

    const addXpBtn = e.target?.closest?.("[data-action='saveNewXpSkill']");
    if (addXpBtn) {
      const form = addXpBtn.closest(".skills-add-form");
      const title = normalizeText(form?.querySelector("[data-field='title']")?.value);
      const description = normalizeText(form?.querySelector("[data-field='description']")?.value);
      if (!title) {
        alert("Please provide an XP skill title.");
        return;
      }
      state.skills.xpSkills.push({ id: createId("xp-skill"), title, description });
      scheduleSave();
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
      if (info.index < 0) return;
      if (!confirm("Delete this skill?")) return;
      info.list.splice(info.index, 1);
      scheduleSave();
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
  _initialized = true;
}

export function renderSkills(state) {
  const panel = document.getElementById("jujutsuSubpanelSkills");
  if (!panel) return;
  ensureSkillsState(state);
  panel.innerHTML = renderSkillsPanel(state);
  setupSkillsEventHandlers();
}
