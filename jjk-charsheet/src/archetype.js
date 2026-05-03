let _getState = null;
let _scheduleSave = null;
let _initialized = false;

const MAX_ABILITY_SLOTS = 5;
const BASE_ABILITY_SLOTS = 2;

// Seeded with two archetypes so the user can extend this object one-by-one.
const ARCHETYPE_RULES = {
  brawler: {
    label: "Brawler",
    scaleStat: "power",
    permanentAptitudes: [
      "Combat (Permanent Aptitude)",
      "Strength (Permanent Aptitude)",
    ],
    startingEquipment: [
      "Weighted Hand Wraps",
      "Training Gi",
    ],
    abilities: [
      {
        id: "experienced-hands",
        name: "Experienced Hands",
        minStat: 1,
        notes: "Your hands are trained to strike, clinch, and counter under pressure.",
        requires: [],
      },
      {
        id: "thicker-skin",
        name: "Thicker Skin",
        minStat: 2,
        notes: "Reduces how quickly repeated hits wear you down in close combat.",
        requires: ["experienced-hands"],
      },
      {
        id: "iron-pressure",
        name: "Iron Pressure",
        minStat: 3,
        notes: "Your pressure and grappling control spike once contact is established.",
        requires: ["thicker-skin"],
      },
    ],
  },
  unbreakable: {
    label: "Unbreakable",
    scaleStat: "power",
    permanentAptitudes: [
      "Fortitude (Permanent Aptitude)",
      "Athletics (Permanent Aptitude)",
    ],
    startingEquipment: [
      "Reinforced Protective Vest",
      "Recovery Wrap Kit",
    ],
    abilities: [
      {
        id: "steady-core",
        name: "Steady Core",
        minStat: 1,
        notes: "You maintain posture and breathing under sustained pressure.",
        requires: [],
      },
      {
        id: "damage-soak",
        name: "Damage Soak",
        minStat: 2,
        notes: "Converts brute hits into manageable strain with improved resilience.",
        requires: ["steady-core"],
      },
      {
        id: "last-one-standing",
        name: "Last One Standing",
        minStat: 3,
        notes: "Your recovery tempo and refusal to drop outpace normal limits.",
        requires: ["damage-soak"],
      },
    ],
  },
};

const KNOWN_ABILITY_IDS = new Set(
  Object.entries(ARCHETYPE_RULES).flatMap(([archKey, rule]) =>
    rule.abilities.map(ability => `${archKey}:${ability.id}`)
  )
);

function getState() {
  return _getState ? _getState() : null;
}

function scheduleSave() {
  if (_scheduleSave) _scheduleSave();
}

function toTitleCase(value) {
  return String(value || "")
    .replace(/_/g, " ")
    .split(" ")
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function getArchetypeLabel(archetypeKey) {
  if (!archetypeKey) return "Unselected";
  return ARCHETYPE_RULES[archetypeKey]?.label || toTitleCase(archetypeKey);
}

function statScore(state, statKey) {
  return parseInt(state?.stats?.[statKey]?.score, 10) || 0;
}

function getOpenSlotSummary(state) {
  const scoreList = ["power", "speed", "technique", "intelligence", "cooperation"];
  const leveledStatCount = scoreList.filter(key => statScore(state, key) > 0).length;
  const unlockedSlots = Math.min(MAX_ABILITY_SLOTS, BASE_ABILITY_SLOTS + leveledStatCount);
  const unlockedAbilityCount = Array.isArray(state?.archetypeProgress?.unlockedAbilityIds)
    ? state.archetypeProgress.unlockedAbilityIds.length
    : 0;
  const usedSlots = Math.min(unlockedSlots, unlockedAbilityCount);
  return {
    unlockedSlots,
    usedSlots,
    openSlots: Math.max(0, unlockedSlots - usedSlots),
  };
}

function ensureArchetypeState(state) {
  if (!state || typeof state !== "object") return;
  if (!state.archetypeProgress || typeof state.archetypeProgress !== "object") {
    state.archetypeProgress = {};
  }

  // Migration from old freeform tracker.
  if (!Array.isArray(state.archetypeProgress.unlockedAbilityIds)) {
    const legacyUnlocked = Array.isArray(state.archetypeGrantedAbilities)
      ? state.archetypeGrantedAbilities
        .filter(entry => entry?.unlocked)
        .map(entry => String(entry?.name || "").trim())
        .filter(Boolean)
      : [];
    state.archetypeProgress.unlockedAbilityIds = legacyUnlocked;
  }

  state.archetypeProgress.unlockedAbilityIds = state.archetypeProgress.unlockedAbilityIds
    .map(value => String(value || "").trim())
    .filter(value => KNOWN_ABILITY_IDS.has(value));
}

function selectedArchetypeEntries(state) {
  const entries = [];
  if (state.archetype) entries.push({ key: state.archetype, type: "primary" });
  if (state.hasSecondArchetype && state.archetype2) entries.push({ key: state.archetype2, type: "secondary" });
  return entries;
}

function abilityGlobalId(archetypeKey, abilityId) {
  return `${archetypeKey}:${abilityId}`;
}

function hasUnlocked(state, globalId) {
  return state.archetypeProgress.unlockedAbilityIds.includes(globalId);
}

function canUseSecondaryArchetype(state) {
  return !state.hasSecondArchetype || state.grade === "Special Grade";
}

function hasDependentUnlocked(state, archetypeKey, abilityId) {
  const rule = ARCHETYPE_RULES[archetypeKey];
  if (!rule) return false;
  return rule.abilities.some(ability => {
    const needed = Array.isArray(ability.requires) ? ability.requires : [];
    if (!needed.includes(abilityId)) return false;
    return hasUnlocked(state, abilityGlobalId(archetypeKey, ability.id));
  });
}

function renderArchetypeSummary(state) {
  const primaryArch = document.getElementById("archetypePrimaryValue");
  const primarySub = document.getElementById("archetypePrimarySubValue");
  const secondaryArch = document.getElementById("archetypeSecondaryValue");
  const secondarySub = document.getElementById("archetypeSecondarySubValue");
  const secondaryRow = document.getElementById("archetypeSecondaryRow");
  const secondarySubRow = document.getElementById("archetypeSecondarySubRow");

  if (primaryArch) primaryArch.textContent = getArchetypeLabel(state.archetype);
  if (primarySub) primarySub.textContent = state.subArchetype || "Unselected";

  const showSecondary = Boolean(state.hasSecondArchetype);
  if (secondaryRow) secondaryRow.style.display = showSecondary ? "" : "none";
  if (secondarySubRow) secondarySubRow.style.display = showSecondary ? "" : "none";
  if (secondaryArch) secondaryArch.textContent = getArchetypeLabel(state.archetype2);
  if (secondarySub) secondarySub.textContent = state.subArchetype2 || "Unselected";

  const selectedPaths = document.getElementById("archetypeSelectedPaths");
  if (selectedPaths) {
    const chips = [];
    if (state.subArchetype) chips.push(state.subArchetype);
    if (state.hasSecondArchetype && state.subArchetype2) chips.push(state.subArchetype2);
    selectedPaths.innerHTML = chips.length
      ? chips.map(path => `<span class="archetype-path-chip">${path}</span>`).join("")
      : '<span class="techniques-muted">No sub-archetypes selected yet.</span>';
  }

  const rulesSummary = document.getElementById("archetypeRulesSummary");
  if (rulesSummary) {
    const slotSummary = getOpenSlotSummary(state);
    const multiclassWarning = state.hasSecondArchetype && !canUseSecondaryArchetype(state)
      ? '<div class="archetype-warning">Second archetype abilities are locked until Grade is Special Grade.</div>'
      : "";
    rulesSummary.innerHTML = `
      <div class="archetype-slot-pill">Ability Slots: ${slotSummary.usedSlots}/${slotSummary.unlockedSlots} used (${slotSummary.openSlots} open)</div>
      <div class="archetype-rule-note">Start with 2 slots. Additional slots unlock when you level any stat, up to ${MAX_ABILITY_SLOTS} total.</div>
      ${multiclassWarning}
    `;
  }
}

function renderBenefits(state) {
  const benefitsList = document.getElementById("archetypeBenefitsList");
  if (!benefitsList) return;

  const selected = selectedArchetypeEntries(state);
  if (!selected.length) {
    benefitsList.innerHTML = '<div class="techniques-app-empty">Pick an archetype on the Character tab to view permanent aptitudes and starting equipment.</div>';
    return;
  }

  benefitsList.innerHTML = selected.map(entry => {
    const rule = ARCHETYPE_RULES[entry.key];
    if (!rule) {
      return `
        <article class="archetype-benefit-card">
          <div class="archetype-benefit-title">${getArchetypeLabel(entry.key)}</div>
          <div class="techniques-muted">No predefined data yet. Add this archetype to ARCHETYPE_RULES in archetype.js.</div>
        </article>
      `;
    }

    const aptitudes = rule.permanentAptitudes
      .map(item => `<li>${item}</li>`)
      .join("");
    const equipment = rule.startingEquipment
      .map(item => `<li>${item}</li>`)
      .join("");

    return `
      <article class="archetype-benefit-card">
        <div class="archetype-benefit-title">${rule.label}</div>
        <div class="archetype-benefit-sub">Scales with ${toTitleCase(rule.scaleStat)}</div>
        <div class="archetype-benefit-grid">
          <div>
            <div class="field-label">Permanent Aptitudes</div>
            <ul class="archetype-mini-list">${aptitudes}</ul>
          </div>
          <div>
            <div class="field-label">Starting Equipment</div>
            <ul class="archetype-mini-list">${equipment}</ul>
          </div>
        </div>
      </article>
    `;
  }).join("");
}

function renderAbilityTree(state) {
  const list = document.getElementById("archetypeAbilityTreeList");
  if (!list) return;

  const selected = selectedArchetypeEntries(state);
  if (!selected.length) {
    list.innerHTML = '<div class="techniques-app-empty">No archetype selected yet.</div>';
    return;
  }

  const slotSummary = getOpenSlotSummary(state);

  list.innerHTML = selected.map(entry => {
    const rule = ARCHETYPE_RULES[entry.key];
    if (!rule) {
      return `
        <article class="archetype-ability-item">
          <div class="archetype-ability-title">${getArchetypeLabel(entry.key)}</div>
          <div class="techniques-muted">No predefined ability tree yet. You can add this archetype in archetype.js.</div>
        </article>
      `;
    }

    const currentStat = statScore(state, rule.scaleStat);
    const secondBlocked = entry.type === "secondary" && !canUseSecondaryArchetype(state);

    const rows = rule.abilities.map(ability => {
      const globalId = abilityGlobalId(entry.key, ability.id);
      const unlocked = hasUnlocked(state, globalId);
      const requires = Array.isArray(ability.requires) ? ability.requires : [];
      const missingReqs = requires.filter(reqId => !hasUnlocked(state, abilityGlobalId(entry.key, reqId)));
      const statMet = currentStat >= ability.minStat;
      const slotsMet = unlocked || slotSummary.openSlots > 0;
      const canUnlock = !unlocked && !secondBlocked && statMet && missingReqs.length === 0 && slotsMet;
      const canRelock = unlocked && !hasDependentUnlocked(state, entry.key, ability.id);

      const reqText = requires.length
        ? `Requires: ${requires.map(req => rule.abilities.find(a => a.id === req)?.name || req).join(", ")}`
        : "No prerequisite ability";
      const statusText = secondBlocked
        ? "Locked: multiclass archetype requires Special Grade"
        : !statMet
          ? `Locked: need ${toTitleCase(rule.scaleStat)} ${ability.minStat}`
          : missingReqs.length
            ? `Locked: unlock previous ability first`
            : !slotsMet
              ? "Locked: no open ability slot"
              : unlocked
                ? "Unlocked"
                : "Ready to unlock";

      return `
        <div class="archetype-ability-row${unlocked ? " unlocked" : ""}">
          <div class="archetype-ability-row-head">
            <div>
              <div class="archetype-ability-name">${ability.name}</div>
              <div class="archetype-ability-meta">${toTitleCase(rule.scaleStat)} ${ability.minStat}+ · ${reqText}</div>
            </div>
            <div class="archetype-ability-controls">
              ${unlocked
                ? `<button type="button" class="inventory-secondary-btn" data-ability-toggle="${globalId}"${canRelock ? "" : " disabled"}>Relock</button>`
                : `<button type="button" class="meta-toggle-btn" data-ability-toggle="${globalId}"${canUnlock ? "" : " disabled"}>Unlock</button>`
              }
            </div>
          </div>
          <div class="archetype-ability-status">${statusText}</div>
          <div class="archetype-ability-notes">${ability.notes || ""}</div>
        </div>
      `;
    }).join("");

    return `
      <article class="archetype-ability-item">
        <div class="archetype-ability-title">${rule.label}</div>
        <div class="archetype-ability-sub">Scale Stat: ${toTitleCase(rule.scaleStat)} · Current: ${currentStat}</div>
        <div class="archetype-ability-tree">${rows}</div>
      </article>
    `;
  }).join("");
}

function toggleAbility(globalId) {
  const state = getState();
  if (!state) return;
  ensureArchetypeState(state);

  const [archetypeKey, abilityId] = String(globalId || "").split(":");
  const rule = ARCHETYPE_RULES[archetypeKey];
  if (!rule) return;
  const ability = rule.abilities.find(item => item.id === abilityId);
  if (!ability) return;

  const unlockedSet = new Set(state.archetypeProgress.unlockedAbilityIds);
  const currentlyUnlocked = unlockedSet.has(globalId);

  if (currentlyUnlocked) {
    if (hasDependentUnlocked(state, archetypeKey, abilityId)) return;
    unlockedSet.delete(globalId);
  } else {
    const slotSummary = getOpenSlotSummary(state);
    const secondBlocked = state.hasSecondArchetype && state.archetype2 === archetypeKey && !canUseSecondaryArchetype(state);
    const reqsMet = (ability.requires || []).every(reqId => unlockedSet.has(abilityGlobalId(archetypeKey, reqId)));
    const statMet = statScore(state, rule.scaleStat) >= ability.minStat;
    if (secondBlocked || !reqsMet || !statMet || slotSummary.openSlots <= 0) return;
    unlockedSet.add(globalId);
  }

  state.archetypeProgress.unlockedAbilityIds = [...unlockedSet];
  renderArchetypeSummary(state);
  renderAbilityTree(state);
  scheduleSave();
}

function refreshFromArchetypeSelectors() {
  const state = getState();
  if (!state) return;
  // Defer so inline onchange handlers on the character tab update state first.
  setTimeout(() => applyArchetypeStateToUI(), 0);
}

export function applyArchetypeStateToUI() {
  const state = getState();
  if (!state) return;
  ensureArchetypeState(state);
  renderArchetypeSummary(state);
  renderBenefits(state);
  renderAbilityTree(state);
}

export function initArchetype({ getState: getStateFn, scheduleSave: scheduleSaveFn }) {
  _getState = getStateFn;
  _scheduleSave = scheduleSaveFn;

  if (_initialized) {
    applyArchetypeStateToUI();
    return;
  }

  const abilityTree = document.getElementById("archetypeAbilityTreeList");
  if (abilityTree) {
    abilityTree.addEventListener("click", e => {
      const toggleTrigger = e.target?.closest?.("[data-ability-toggle]");
      if (!toggleTrigger) return;
      toggleAbility(toggleTrigger.dataset.abilityToggle);
    });
  }

  [
    "archetypeSelect",
    "subArchetypeSelect",
    "archetypeSelect2",
    "subArchetypeSelect2",
    "addSecondArchetypeBtn",
    "removeSecondArchetypeBtn",
    "gradeSelect",
  ].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener("change", refreshFromArchetypeSelectors);
    el.addEventListener("input", refreshFromArchetypeSelectors);
    el.addEventListener("click", refreshFromArchetypeSelectors);
  });

  const statContainers = [
    document.getElementById("centerStats"),
    document.getElementById("rightStats"),
  ].filter(Boolean);

  statContainers.forEach(container => {
    container.addEventListener("input", e => {
      if (e.target?.classList?.contains("stat-score-input")) refreshFromArchetypeSelectors();
    });
    container.addEventListener("change", e => {
      if (e.target?.classList?.contains("stat-score-input")) refreshFromArchetypeSelectors();
    });
  });

  _initialized = true;
  applyArchetypeStateToUI();
}
