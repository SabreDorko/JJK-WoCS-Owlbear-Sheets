import { ARCHETYPES, CENTER_STATS, RIGHT_STATS } from "./state/store.js";
import { computeActiveModifierEffects, getRollModifierSources } from "./modifiers.js";
import { updateTechniquesDerivedUI } from "./techniques.js";

let _getState = null;
let _scheduleSave = null;
let _showRollToast = null;
let _initialized = false;
let _isOverrideMode = false;

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

function getNextAptitudeActionLabel(currentAptitude) {
  if (currentAptitude <= 0) return "Set as Aptitude";
  if (currentAptitude === 1) return "Set as Permanent Aptitude";
  return "Clear Aptitude";
}

function showRollToast(statLabel, diceCount, rolls, total, critStatus, skillName, breakdown) {
  if (_showRollToast) {
    _showRollToast(statLabel, diceCount, rolls, total, critStatus, skillName, breakdown);
  }
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

function getArchetypePermanentAptitudeSource(state, statKey, skillIndex) {
  const picks = state?.archetypeProgress?.permanentAptitudeSelections;
  if (!Array.isArray(picks)) return null;
  return picks.find(entry => entry?.sourceArchetype === state.archetype
    && entry?.statKey === statKey
    && parseInt(entry?.skillIndex, 10) === skillIndex) || null;
}

function formatSignedValue(value) {
  return value >= 0 ? `+${value}` : `${value}`;
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
  return parseStatScore(state?.stats?.[statKey]?.score) + (effects?.statBonuses?.[statKey] || 0);
}

function getSubskillValue(state, effects, statKey, skillIndex) {
  const overridden = getSubskillOverride(state, statKey, skillIndex);
  if (Number.isFinite(overridden)) return overridden;
  const statLevel = getEffectiveStatLevel(state, effects, statKey);
  const skillState = state?.stats?.[statKey]?.skills?.[skillIndex] || {};
  const lockedFromArchetype = getArchetypePermanentAptitudeSource(state, statKey, skillIndex);
  const aptitudeBonus = (lockedFromArchetype || getAptitudeState(skillState) > 0) ? 2 : 0;
  const statSkillBonus = effects?.skillBonuses?.[statKey] || 0;
  const specificSkillBonus = effects?.specificSkillBonuses?.[`${statKey}:${skillIndex}`] || 0;
  return statLevel + aptitudeBonus + statSkillBonus + specificSkillBonus;
}

function applyDerivedCharacterFields({ preserveCurrent = true } = {}) {
  const state = getState();
  if (!state) return;

  const effects = computeActiveModifierEffects(state);
  const powerLevel = getEffectiveStatLevel(state, effects, "power");
  const techniqueLevel = getEffectiveStatLevel(state, effects, "technique");
  const speedLevel = getEffectiveStatLevel(state, effects, "speed");
  const domainCtBonus = state?.techniques?.mode === "domain" ? 10 : 0;

  const nextHpMax = Math.max(1, 10 + (powerLevel * 5));
  const nextCeMax = Math.max(1, 15 + (techniqueLevel * 5) + domainCtBonus);
  const nextAc = Math.max(0, techniqueLevel + speedLevel + (effects.acBonus || 0));
  const nextMovement = Math.max(0, 30 + (speedLevel * 5) + (effects.movementBonus || 0));

  const finalHpMax = Math.max(1, getDerivedOverride(state, "hpMax") ?? nextHpMax);
  const finalCeMax = Math.max(1, getDerivedOverride(state, "ceMax") ?? nextCeMax);
  const finalAc = Math.max(0, getDerivedOverride(state, "ac") ?? nextAc);
  const finalMovement = Math.max(0, getDerivedOverride(state, "movement") ?? nextMovement);

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
  const tech = (parseInt(techRaw, 10) || 0) + (effects.statBonuses.technique || 0);
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
    scoreSide.innerHTML = `
      <div class="stat-label">${def.label}</div>
      <input class="stat-score-input" type="number" placeholder="—"
             id="score_${def.key}" value="${sd.score}" min="0" />
      <button class="roll-btn" type="button" title="Roll ${def.label.charAt(0).toUpperCase() + def.label.slice(1).toLowerCase()}">Roll</button>
    `;
    scoreSide.querySelector(".roll-btn").addEventListener("click", () => {
      const currentEffects = computeActiveModifierEffects(state);
      const n = getEffectiveStatLevel(state, currentEffects, def.key);
      if (!n || n < 1) return;
      const rolls = Array.from({ length: n }, () => Math.floor(Math.random() * 6) + 1);
      const rollBonus = currentEffects.rollBonuses[def.key] || 0;
      const total = rolls.reduce((a, b) => a + b, 0) + rollBonus;
      showRollToast(def.label, n, rolls, total, null, null, {
        equipmentBonuses: getRollModifierSources(state, def.key),
      });
    });

    const skillsSide = document.createElement("div");
    skillsSide.className = "skills-side";
    def.skills.forEach((skill, i) => {
      const sk = sd.skills[i];
      const lockedAptitudeSource = getArchetypePermanentAptitudeSource(state, def.key, i);
      const aptitudeState = lockedAptitudeSource ? 2 : getAptitudeState(sk);
      const subskillValue = getSubskillValue(state, effects, def.key, i);
      const aptitudeLabel = aptitudeState === 2 ? "Permanent Aptitude" : aptitudeState === 1 ? "Aptitude" : "No Aptitude";
      const sourceLabel = lockedAptitudeSource?.sourceLabel || (lockedAptitudeSource?.sourceArchetype
        ? lockedAptitudeSource.sourceArchetype.charAt(0).toUpperCase() + lockedAptitudeSource.sourceArchetype.slice(1)
        : "");
      const nextAptitudeAction = lockedAptitudeSource
        ? (_isOverrideMode ? "Override lock: cycle aptitude" : `Permanent Aptitude (${sourceLabel || "Archetype"})`)
        : getNextAptitudeActionLabel(aptitudeState);
      const hasOverride = Number.isFinite(getSubskillOverride(state, def.key, i));
      const row = document.createElement("div");
      row.className = "skill-row";
      row.innerHTML = `
        <div class="skill-dot${aptitudeState > 0 ? " filled" : ""}${aptitudeState === 2 ? " permanent" : ""}${lockedAptitudeSource ? " locked-by-archetype" : ""}"
             id="dot_${def.key}_${i}" role="checkbox" aria-label="${skill} ${aptitudeLabel}" title="${nextAptitudeAction}"></div>
        <input class="skill-bonus-input" type="text"
               id="bonus_${def.key}_${i}" value="${formatSignedValue(subskillValue)}" ${_isOverrideMode ? "" : "readonly tabindex=\"-1\""} title="${hasOverride ? "Overridden" : "Auto-calculated"}" />
        <button type="button" class="override-marker-btn${hasOverride ? " visible" : ""}" data-subskill-override-clear="${def.key}:${i}" title="${_isOverrideMode ? "Click to clear override" : "Overridden"}" ${_isOverrideMode ? "" : "tabindex=\"-1\""}>*</button>
        <span class="skill-name">${skill}</span>
        <button class="skill-roll-btn" type="button" title="Roll ${skill}"></button>
      `;
      skillsSide.appendChild(row);

      row.querySelector(".skill-dot").addEventListener("click", () => {
        if (lockedAptitudeSource && !_isOverrideMode) return;
        const skillState = state.stats[def.key].skills[i] || { aptitude: 0 };
        const nextAptitude = (getAptitudeState(skillState) + 1) % 3;
        state.stats[def.key].skills[i] = { aptitude: nextAptitude };
        const dot = row.querySelector(".skill-dot");
        dot.classList.toggle("filled", nextAptitude > 0);
        dot.classList.toggle("permanent", nextAptitude === 2);
        dot.classList.toggle("locked-by-archetype", Boolean(lockedAptitudeSource));
        const nextLabel = nextAptitude === 2 ? "Permanent Aptitude" : nextAptitude === 1 ? "Aptitude" : "No Aptitude";
        dot.setAttribute("title", lockedAptitudeSource
          ? (_isOverrideMode ? "Override lock: cycle aptitude" : `Permanent Aptitude (${sourceLabel || "Archetype"})`)
          : getNextAptitudeActionLabel(nextAptitude));
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
      row.querySelector(".skill-roll-btn").addEventListener("click", () => {
        const currentEffects = computeActiveModifierEffects(state);
        const n = getEffectiveStatLevel(state, currentEffects, def.key);
        if (!n || n < 1) return;
        const rolls = Array.from({ length: n }, () => Math.floor(Math.random() * 6) + 1);
        const rawTotal = rolls.reduce((a, b) => a + b, 0);
        const subskillBonus = getSubskillValue(state, currentEffects, def.key, i);
        const statRollBonus = currentEffects.rollBonuses[def.key] || 0;
        const total = rawTotal + subskillBonus + statRollBonus;
        const maxPossible = n * 6;
        const allOnes = rolls.every(r => r === 1);
        const critStatus = allOnes ? "fail" : total >= maxPossible ? "success" : null;
        showRollToast(def.label, n, rolls, total, critStatus, skill, {
          skillModifier: subskillBonus,
          equipmentBonuses: getRollModifierSources(state, def.key),
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
  const editableWhenOverride = ["acInput", "hpMax", "ceMax", "moveInput"];
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
  applyDerivedCharacterFields({ preserveCurrent: true });

  document.getElementById("charName").value = state.charName || "";
  document.getElementById("ageInput").value = state.age || "";
  document.getElementById("ctInput").value = state.ct || "";
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
  bindField("hpCurrent", "hpCurrent");
  bindField("ceCurrent", "ceCurrent");
  bindField("ceNote", "ceNote");
  bindField("subArchetypeSelect", "subArchetype");
  bindField("subArchetypeSelect2", "subArchetype2");

  wireDerivedOverrideInput("acInput", "ac");
  wireDerivedOverrideInput("hpMax", "hpMax");
  wireDerivedOverrideInput("ceMax", "ceMax");
  wireDerivedOverrideInput("moveInput", "movement");

  const overrideBtn = document.getElementById("overrideModeBtn");
  if (overrideBtn) {
    overrideBtn.addEventListener("click", () => {
      _isOverrideMode = !_isOverrideMode;
      applyCharacterStateToUI();
    });
  }

  document.getElementById("addSecondArchetypeBtn").addEventListener("click", toggleSecondArchetype);
  document.getElementById("removeSecondArchetypeBtn").addEventListener("click", toggleSecondArchetype);

  _initialized = true;
  applyCharacterStateToUI();
}
