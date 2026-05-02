import { ARCHETYPES, CENTER_STATS, RIGHT_STATS } from "./state/store.js";

let _getState = null;
let _scheduleSave = null;
let _showRollToast = null;
let _initialized = false;

function getState() {
  return _getState ? _getState() : null;
}

function scheduleSave() {
  if (_scheduleSave) _scheduleSave();
}

function showRollToast(statLabel, diceCount, rolls, total, critStatus, skillName) {
  if (_showRollToast) {
    _showRollToast(statLabel, diceCount, rolls, total, critStatus, skillName);
  }
}

function getBlackFlashRange(techniqueScore) {
  if (!Number.isFinite(techniqueScore) || techniqueScore < 2) return null;
  if (techniqueScore > 7) return null;
  return (techniqueScore * 4) + 4;
}

export function updateBlackFlashRangeDisplay() {
  const state = getState();
  const valueEl = document.getElementById("blackFlashRangeValue");
  const noteEl = document.getElementById("blackFlashRangeNote");
  if (!valueEl || !noteEl || !state) return;

  const techRaw = state?.stats?.technique?.score;
  const tech = parseInt(techRaw, 10);
  const range = getBlackFlashRange(tech);

  if (range === null) {
    valueEl.textContent = "—";
    noteEl.textContent = "Requires Technique 2-7";
    return;
  }

  valueEl.textContent = String(range);
  noteEl.textContent = `Technique ${tech}`;
}

export function renderStats() {
  buildStatBlocks(CENTER_STATS, document.getElementById("centerStats"));
  buildStatBlocks(RIGHT_STATS, document.getElementById("rightStats"));
}

function buildStatBlocks(defs, container) {
  const state = getState();
  if (!container || !state) return;

  container.innerHTML = "";
  defs.forEach(def => {
    const sd = state.stats[def.key];
    const block = document.createElement("div");
    block.className = "stat-block";

    const scoreSide = document.createElement("div");
    scoreSide.className = "stat-score-side";
    scoreSide.innerHTML = `
      <div class="stat-label">${def.label}</div>
      <input class="stat-score-input" type="number" placeholder="—"
             id="score_${def.key}" value="${sd.score}" min="0" />
      <button class="roll-btn" type="button" title="Roll ${def.label.charAt(0).toUpperCase() + def.label.slice(1).toLowerCase()}">Roll</button>
    `;
    scoreSide.querySelector(".roll-btn").addEventListener("click", () => {
      const n = parseInt(document.getElementById("score_" + def.key).value, 10);
      if (!n || n < 1) return;
      const rolls = Array.from({ length: n }, () => Math.floor(Math.random() * 6) + 1);
      showRollToast(def.label, n, rolls, rolls.reduce((a, b) => a + b, 0));
    });

    const skillsSide = document.createElement("div");
    skillsSide.className = "skills-side";
    def.skills.forEach((skill, i) => {
      const sk = sd.skills[i];
      const row = document.createElement("div");
      row.className = "skill-row";
      row.innerHTML = `
        <div class="skill-dot${sk.dot ? " filled" : ""}"
             id="dot_${def.key}_${i}" role="checkbox" aria-label="${skill} proficiency"></div>
        <input class="skill-bonus-input" type="text"
               id="bonus_${def.key}_${i}" value="${sk.bonus}" placeholder="+0" maxlength="4" />
        <span class="skill-name">${skill}</span>
        <button class="skill-roll-btn" type="button" title="Roll ${skill}"></button>
      `;
      skillsSide.appendChild(row);

      row.querySelector(".skill-dot").addEventListener("click", () => {
        state.stats[def.key].skills[i].dot = !state.stats[def.key].skills[i].dot;
        row.querySelector(".skill-dot").classList.toggle("filled");
        scheduleSave();
      });
      row.querySelector(".skill-bonus-input").addEventListener("input", e => {
        state.stats[def.key].skills[i].bonus = e.target.value;
        scheduleSave();
      });
      row.querySelector(".skill-roll-btn").addEventListener("click", () => {
        const n = parseInt(state.stats[def.key].score, 10);
        if (!n || n < 1) return;
        const rolls = Array.from({ length: n }, () => Math.floor(Math.random() * 6) + 1);
        const rawTotal = rolls.reduce((a, b) => a + b, 0);
        const bonusVal = parseInt(state.stats[def.key].skills[i].bonus, 10) || 0;
        const total = rawTotal + bonusVal;
        const maxPossible = n * 6;
        const allOnes = rolls.every(r => r === 1);
        const critStatus = allOnes ? "fail" : total >= maxPossible ? "success" : null;
        showRollToast(def.label, n, rolls, total, critStatus, skill);
      });
    });

    block.appendChild(scoreSide);
    block.appendChild(skillsSide);
    container.appendChild(block);

    block.querySelector(`#score_${def.key}`).addEventListener("input", e => {
      state.stats[def.key].score = e.target.value;
      if (def.key === "technique") updateBlackFlashRangeDisplay();
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
  const opts = ARCHETYPES[arc] || [];
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
  const state = getState();
  const max = document.getElementById("hpMax").value;
  const cur = document.getElementById("hpCurrent");
  if (!cur.value) {
    cur.value = max;
    state.hpCurrent = max;
  }
  state.hpMax = max;
  scheduleSave();
}

export function applyCharacterStateToUI() {
  const state = getState();
  if (!state) return;

  document.getElementById("charName").value = state.charName || "";
  document.getElementById("ageInput").value = state.age || "";
  document.getElementById("ctInput").value = state.ct || "";
  document.getElementById("playerName").value = state.playerName || "";
  document.getElementById("acInput").value = state.ac || "";
  document.getElementById("hpCurrent").value = state.hpCurrent || "";
  document.getElementById("hpMax").value = state.hpMax || "";
  document.getElementById("moveInput").value = state.movement || "";
  document.getElementById("ceCurrent").value = state.ceCurrent || "";
  document.getElementById("ceMax").value = state.ceMax || "";
  document.getElementById("ceNote").value = state.ceNote || "";

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
}

export function initCharacter({ getState: getStateFn, scheduleSave: scheduleSaveFn, showRollToast: showRollToastFn }) {
  _getState = getStateFn;
  _scheduleSave = scheduleSaveFn;
  _showRollToast = showRollToastFn;

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
  bindField("ctInput", "ct");
  bindField("playerName", "playerName");
  bindField("acInput", "ac");
  bindField("hpCurrent", "hpCurrent");
  bindField("hpMax", "hpMax");
  bindField("moveInput", "movement");
  bindField("ceCurrent", "ceCurrent");
  bindField("ceMax", "ceMax");
  bindField("ceNote", "ceNote");
  bindField("subArchetypeSelect", "subArchetype");
  bindField("subArchetypeSelect2", "subArchetype2");

  document.getElementById("addSecondArchetypeBtn").addEventListener("click", toggleSecondArchetype);
  document.getElementById("removeSecondArchetypeBtn").addEventListener("click", toggleSecondArchetype);

  _initialized = true;
  applyCharacterStateToUI();
}
