let _getState = null;
let _scheduleSave = null;
let _initialized = false;
const _expandedAbilityDescriptions = new Set();

const MAX_ABILITY_SLOTS = 5;

const ARCHETYPE_RULES = {
  acrobat: {
    label: "Acrobat",
    scaleStat: "speed",
    permanentAptitudes: [
      "Choose 1 Permanent Aptitude from Speed skills",
      "Choose 1 Permanent Aptitude from Technique skills",
    ],
    startingEquipment: [
      "Dancing Shoes/Running Shoes (Foot Clothing): +1 AC, +1 Tempo, +1 Acrobatics",
      "Tonfa (Weapon): 2d6 + SL",
    ],
    sharedAbilities: [
      {
        tier: 2,
        id: "course-correction",
        name: "Course Correction",
        minStat: 2,
        notes: "When rolling Acrobatics/Athletics (outside of training), you may use Speed instead of Technique/Power Level. (3 uses, refreshes before and after combat)",
      },
      {
        tier: 3,
        id: "ever-nimble",
        name: "Ever Nimble",
        minStat: 3,
        notes: "Temporarily walk up/across walls and move vertically with a limit of SL x 5 ft. in height and distance. Movement is still consumed, and you return to the ground at end of turn.",
      },
      {
        tier: 4,
        id: "shiranui-gata",
        name: "Shiranui-Gata",
        minStat: 4,
        notes: "Use a reaction to take a defensive stance (DC SL x 3 + 2), doubling AC for the turn. If a melee attack misses due to increased AC, you may counter with Punch/Kick by spending another reaction. (2/Encounter)",
      },
    ],
    subclassAbilities: {
      Untouchable: {
        tier1: {
          id: "untouchable",
          name: "Untouchable",
          minStat: 1,
          notes: "Before rolling a Reaction, add half your natural AC (TL + SL only, rounded down) to the final result. Cannot be used with Bullet Time. (1/day)",
        },
        tier5: {
          id: "not-even-close",
          name: "Not Even Close",
          minStat: 5,
          notes: "When successfully dodging an attack, gain +2 AC up to +8 max. Reacting in ways other than dodging reduces this by 2.",
        },
      },
      "Link": {
        tier1: {
          id: "the-link",
          name: "The Link",
          minStat: 1,
          notes: "As a bonus action, use half of your total reactions (rounded down) to give an ally advantage on Dodge checks for the turn.",
        },
        tier5: {
          id: "got-your-back",
          name: "Got Your Back",
          minStat: 5,
          notes: "When performing a Leap reaction, you can also dodge the incoming attack and drag the covered creature with you. (3/Encounter)",
        },
      },
    },
  },
  brawler: {
    label: "Brawler",
    scaleStat: "power",
    permanentAptitudes: [
      "Choose 2 Permanent Aptitudes from Power skills",
    ],
    startingEquipment: [
      "Tearaway Uniform: +1 AC, +1 Strength. (Can be torn off to gain advantage on one Intimidation roll; cannot be put back on for the rest of combat.)",
      "Knuckle Guards: +1 damage to the Punch action",
    ],
    sharedAbilities: [
      {
        tier: 2,
        id: "experimented-hands",
        name: "Experimented Hands",
        minStat: 2,
        notes: "When doing a bare-handed martial arts attack, add a bonus equal to your Power to the roll to hit. (3/Day)",
      },
      {
        tier: 3,
        id: "thicker-skin",
        name: "Thicker Skin",
        minStat: 3,
        notes: "When you take damage from a melee hit, lower the damage by half your PL, rounded down.",
      },
      {
        tier: 4,
        id: "retribution",
        name: "Retribution",
        minStat: 4,
        notes: "Add +1d4 to damage rolls made against a creature who attacked you in the last round. (1/Round)",
      },
    ],
    subclassAbilities: {
      Merciless: {
        tier1: {
          id: "merciless",
          name: "Merciless",
          minStat: 1,
          notes: "When you damage a creature you attacked last round and attack no other creature, add an extra 1d4. Attacking another creature breaks this bonus.",
        },
        tier5: {
          id: "stay-dead",
          name: "Stay Dead",
          minStat: 5,
          notes: "When a creature you hit regains hit points by any means, your next successful attack grants an additional melee attack with the exact same dice they used to heal plus your Power Level. (1/Day)",
        },
      },
      "Pain Glutton": {
        tier1: {
          id: "pain-glutton",
          name: "The Pain Glutton",
          minStat: 1,
          notes: "When rolling to block, add an additional 1d4 to the reaction roll. (3/Day)",
        },
        tier5: {
          id: "pain-addiction",
          name: "Pain Addiction",
          minStat: 5,
          notes: "When a creature you hit last round attempts to attack you a second time in a row, heal yourself by (Power Level - 1)d6 + PL as a reaction. (2/Day)",
        },
      },
    },
  },
};

const KNOWN_ABILITY_IDS = new Set(
  Object.entries(ARCHETYPE_RULES).flatMap(([archetypeKey, rule]) => {
    const shared = rule.sharedAbilities.map(ability => `${archetypeKey}:${ability.id}`);
    const subclass = Object.values(rule.subclassAbilities).flatMap(def => [
      `${archetypeKey}:${def.tier1.id}`,
      `${archetypeKey}:${def.tier5.id}`,
    ]);
    return [...shared, ...subclass];
  })
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

function ensureArchetypeState(state) {
  if (!state || typeof state !== "object") return;
  if (!state.archetypeProgress || typeof state.archetypeProgress !== "object") {
    state.archetypeProgress = {};
  }

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

function abilityGlobalId(archetypeKey, abilityId) {
  return `${archetypeKey}:${abilityId}`;
}

function hasUnlocked(state, globalId) {
  return state.archetypeProgress.unlockedAbilityIds.includes(globalId);
}

function getSlotSummary(state) {
  const usedSlots = Array.isArray(state?.archetypeProgress?.unlockedAbilityIds)
    ? state.archetypeProgress.unlockedAbilityIds.length
    : 0;
  const unlockedSlots = MAX_ABILITY_SLOTS;
  return {
    unlockedSlots,
    usedSlots: Math.min(unlockedSlots, usedSlots),
    openSlots: Math.max(0, unlockedSlots - usedSlots),
  };
}

function selectedArchetypeEntries(state) {
  const entries = [];
  if (state.archetype) entries.push({ key: state.archetype, type: "primary" });
  if (state.hasSecondArchetype && state.archetype2) entries.push({ key: state.archetype2, type: "secondary" });
  return entries;
}

function getAbilityDefinition(archetypeKey, abilityId) {
  const rule = ARCHETYPE_RULES[archetypeKey];
  if (!rule) return null;

  const shared = rule.sharedAbilities.find(item => item.id === abilityId);
  if (shared) return { ...shared, source: "shared" };

  for (const [subName, subDef] of Object.entries(rule.subclassAbilities || {})) {
    if (subDef?.tier1?.id === abilityId) return { ...subDef.tier1, tier: 1, source: `sub:${subName}` };
    if (subDef?.tier5?.id === abilityId) return { ...subDef.tier5, tier: 5, source: `sub:${subName}` };
  }

  return null;
}

function hasHigherTierInSlots(unlockedSet, archetypeKey, tier) {
  return [...unlockedSet].some(globalId => {
    const [archKey, abilityId] = String(globalId || "").split(":");
    if (archKey !== archetypeKey) return false;
    const def = getAbilityDefinition(archKey, abilityId);
    if (!def || !Number.isFinite(def.tier)) return false;
    return def.tier > tier;
  });
}

function getTieredAbilities(archetypeKey, selectedSub) {
  const rule = ARCHETYPE_RULES[archetypeKey];
  if (!rule) return [];

  const byTier = new Map();
  rule.sharedAbilities.forEach(ability => {
    byTier.set(ability.tier, { ...ability, subLocked: false, tier: ability.tier });
  });

  const subRule = rule.subclassAbilities[selectedSub] || null;
  byTier.set(1, subRule ? { ...subRule.tier1, tier: 1, subLocked: false } : {
    id: "",
    name: "Subclass Tier 1 Ability",
    minStat: 1,
    notes: "Choose a sub-archetype to unlock this tier.",
    tier: 1,
    subLocked: true,
  });
  byTier.set(5, subRule ? { ...subRule.tier5, tier: 5, subLocked: false } : {
    id: "",
    name: "Subclass Tier 5 Ability",
    minStat: 5,
    notes: "Choose a sub-archetype to unlock this tier.",
    tier: 5,
    subLocked: true,
  });

  return [1, 2, 3, 4, 5].map(tier => byTier.get(tier)).filter(Boolean);
}

function hasHigherTierUnlocked(state, archetypeKey, selectedSub, tier) {
  const abilities = getTieredAbilities(archetypeKey, selectedSub);
  return abilities.some(ability => {
    if (ability.tier <= tier || !ability.id) return false;
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
    const slotSummary = getSlotSummary(state);
    rulesSummary.innerHTML = `
      <div class="archetype-slot-pill">Ability Slots: ${slotSummary.usedSlots}/${slotSummary.unlockedSlots} used (${slotSummary.openSlots} open)</div>
      <div class="archetype-rule-note">You have 5 base slots. Add abilities in tier order (1-5) within each archetype tree.</div>
    `;
  }
}

function renderBenefits(state) {
  const benefitsList = document.getElementById("archetypeBenefitsList");
  if (!benefitsList) return;

  if (!state.archetype) {
    benefitsList.innerHTML = '<div class="techniques-app-empty">Pick archetypes on this tab to view permanent aptitudes and starting equipment.</div>';
    return;
  }

  const rule = ARCHETYPE_RULES[state.archetype];
  if (!rule) {
    benefitsList.innerHTML = `
      <article class="archetype-benefit-card">
        <div class="archetype-benefit-title">${getArchetypeLabel(state.archetype)}</div>
        <div class="techniques-muted">No predefined data yet. Add this archetype to ARCHETYPE_RULES in archetype.js.</div>
      </article>
    `;
    return;
  }

  const aptitudes = rule.permanentAptitudes.map(item => `<li>${item}</li>`).join("");
  const equipment = rule.startingEquipment.map(item => `<li>${item}</li>`).join("");

  benefitsList.innerHTML = `
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
      <div class="techniques-muted">Only your first archetype grants starting aptitudes and starting equipment.</div>
    </article>
  `;
}

function renderAbilitySlots(state) {
  const grid = document.getElementById("archetypeAbilitySlots");
  if (!grid) return;

  const unlocked = Array.isArray(state?.archetypeProgress?.unlockedAbilityIds)
    ? state.archetypeProgress.unlockedAbilityIds
    : [];

  const cards = [];
  for (let i = 0; i < MAX_ABILITY_SLOTS; i += 1) {
    const globalId = unlocked[i] || "";
    if (!globalId) {
      cards.push(`
        <article class="archetype-slot-item archetype-slot-item--empty">
          <div class="archetype-slot-index">Slot ${i + 1}</div>
          <div class="techniques-muted">Empty</div>
        </article>
      `);
      continue;
    }

    const [archKey, abilityId] = globalId.split(":");
    const rule = ARCHETYPE_RULES[archKey];
    const def = getAbilityDefinition(archKey, abilityId);
    const canRemove = def ? !hasHigherTierInSlots(new Set(unlocked), archKey, def.tier) : true;

    cards.push(`
      <article class="archetype-slot-item">
        <div class="archetype-slot-index">Slot ${i + 1}</div>
        <div class="archetype-slot-name">${def?.name || abilityId}</div>
        <div class="archetype-slot-meta">${rule?.label || toTitleCase(archKey)} · Tier ${def?.tier || "?"}</div>
        <button type="button" class="inventory-secondary-btn archetype-slot-remove" data-slot-remove="${globalId}"${canRemove ? "" : " disabled"}>Remove</button>
      </article>
    `);
  }

  grid.innerHTML = cards.join("");
}

function renderAbilityTree(state) {
  const list = document.getElementById("archetypeAbilityTreeList");
  if (!list) return;

  const selected = selectedArchetypeEntries(state);
  if (!selected.length) {
    list.innerHTML = '<div class="techniques-app-empty">No archetype selected yet.</div>';
    return;
  }

  const slotSummary = getSlotSummary(state);

  list.innerHTML = selected.map(entry => {
    const rule = ARCHETYPE_RULES[entry.key];
    if (!rule) {
      return `
        <article class="archetype-ability-item">
          <div class="archetype-ability-title">${getArchetypeLabel(entry.key)}</div>
          <div class="techniques-muted">No predefined ability tree yet. Add this archetype in archetype.js.</div>
        </article>
      `;
    }

    const selectedSub = entry.type === "primary" ? state.subArchetype : state.subArchetype2;
    const currentStat = statScore(state, rule.scaleStat);
    const abilities = getTieredAbilities(entry.key, selectedSub);

    const rows = abilities.map((ability, idx) => {
      const globalId = ability.id ? abilityGlobalId(entry.key, ability.id) : "";
      const added = ability.id ? hasUnlocked(state, globalId) : false;
      const previous = idx > 0 ? abilities[idx - 1] : null;
      const previousMet = idx === 0
        ? true
        : Boolean(previous?.id) && hasUnlocked(state, abilityGlobalId(entry.key, previous.id));
      const statMet = currentStat >= (ability.minStat || 0);
      const slotsMet = added || slotSummary.openSlots > 0;
      const canAdd = ability.id && !added && previousMet && statMet && slotsMet;
      const descKey = ability.id
        ? `${entry.key}:${ability.id}`
        : `${entry.key}:tier-${ability.tier}:${selectedSub || "none"}`;
      const isExpanded = _expandedAbilityDescriptions.has(descKey);

      const statusText = ability.subLocked
        ? "Locked: choose a sub-archetype"
        : !previousMet
          ? "Locked: unlock previous tier first"
          : !statMet
            ? `Locked: need ${toTitleCase(rule.scaleStat)} ${ability.minStat}`
            : !slotsMet
              ? "Locked: no open ability slot"
              : added
                ? "Added"
                : "Ready to add";

      return `
        <div class="archetype-ability-row${added ? " unlocked" : ""}">
          <div class="archetype-ability-row-head">
            <div>
              <div class="archetype-ability-name">Tier ${ability.tier}: ${ability.name}</div>
              <div class="archetype-ability-meta">${toTitleCase(rule.scaleStat)} ${ability.minStat}+${ability.tier === 1 || ability.tier === 5 ? " · Sub-Archetype" : " · Shared"}</div>
            </div>
            <div class="archetype-ability-controls">
              ${added
                ? `<button type="button" class="inventory-secondary-btn" disabled>Added</button>`
                : `<button type="button" class="meta-toggle-btn" data-ability-add="${globalId}"${canAdd ? "" : " disabled"}>Add</button>`}
            </div>
          </div>
          <div class="archetype-ability-status">${statusText}</div>
          <button type="button" class="archetype-desc-toggle" data-ability-desc-toggle="${descKey}" aria-expanded="${isExpanded ? "true" : "false"}">
            <span class="archetype-desc-chevron">${isExpanded ? "▾" : "▸"}</span>
            <span>Description</span>
          </button>
          <div class="archetype-ability-notes${isExpanded ? " open" : ""}">${ability.notes || ""}</div>
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

function addAbilityToSlots(globalId) {
  const state = getState();
  if (!state) return;
  ensureArchetypeState(state);

  const [archetypeKey, abilityId] = String(globalId || "").split(":");
  if (!archetypeKey || !abilityId) return;

  const selectedEntries = selectedArchetypeEntries(state);
  const entry = selectedEntries.find(item => item.key === archetypeKey);
  if (!entry) return;

  const selectedSub = entry.type === "primary" ? state.subArchetype : state.subArchetype2;
  const abilities = getTieredAbilities(archetypeKey, selectedSub);
  const ability = abilities.find(item => item.id === abilityId);
  if (!ability) return;

  const unlockedSet = new Set(state.archetypeProgress.unlockedAbilityIds);
  if (unlockedSet.has(globalId)) return;

  const slotSummary = getSlotSummary(state);
  const abilityIndex = abilities.findIndex(item => item.id === abilityId);
  if (abilityIndex < 0) return;

  const previous = abilityIndex > 0 ? abilities[abilityIndex - 1] : null;
  const previousMet = abilityIndex === 0
    ? true
    : Boolean(previous?.id) && unlockedSet.has(abilityGlobalId(archetypeKey, previous.id));
  const statMet = statScore(state, ARCHETYPE_RULES[archetypeKey].scaleStat) >= (ability.minStat || 0);

  if (!previousMet || !statMet || slotSummary.openSlots <= 0) return;
  unlockedSet.add(globalId);

  state.archetypeProgress.unlockedAbilityIds = [...unlockedSet].filter(value => KNOWN_ABILITY_IDS.has(value));
  renderArchetypeSummary(state);
  renderAbilitySlots(state);
  renderAbilityTree(state);
  scheduleSave();
}

function removeAbilityFromSlots(globalId) {
  const state = getState();
  if (!state) return;
  ensureArchetypeState(state);

  const [archetypeKey, abilityId] = String(globalId || "").split(":");
  if (!archetypeKey || !abilityId) return;

  const def = getAbilityDefinition(archetypeKey, abilityId);
  const unlockedSet = new Set(state.archetypeProgress.unlockedAbilityIds);
  if (!unlockedSet.has(globalId)) return;
  if (def && hasHigherTierInSlots(unlockedSet, archetypeKey, def.tier)) return;

  unlockedSet.delete(globalId);
  state.archetypeProgress.unlockedAbilityIds = [...unlockedSet].filter(value => KNOWN_ABILITY_IDS.has(value));
  renderArchetypeSummary(state);
  renderAbilitySlots(state);
  renderAbilityTree(state);
  scheduleSave();
}

function refreshFromArchetypeSelectors() {
  const state = getState();
  if (!state) return;
  setTimeout(() => applyArchetypeStateToUI(), 0);
}

export function applyArchetypeStateToUI() {
  const state = getState();
  if (!state) return;
  ensureArchetypeState(state);
  renderArchetypeSummary(state);
  renderBenefits(state);
  renderAbilitySlots(state);
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
      const addTrigger = e.target?.closest?.("[data-ability-add]");
      if (addTrigger) {
        addAbilityToSlots(addTrigger.dataset.abilityAdd);
        return;
      }

      const descTrigger = e.target?.closest?.("[data-ability-desc-toggle]");
      if (!descTrigger) return;
      const key = String(descTrigger.dataset.abilityDescToggle || "");
      if (!key) return;
      if (_expandedAbilityDescriptions.has(key)) _expandedAbilityDescriptions.delete(key);
      else _expandedAbilityDescriptions.add(key);
      renderAbilityTree(getState());
    });
  }

  const slotGrid = document.getElementById("archetypeAbilitySlots");
  if (slotGrid) {
    slotGrid.addEventListener("click", e => {
      const removeTrigger = e.target?.closest?.("[data-slot-remove]");
      if (!removeTrigger) return;
      removeAbilityFromSlots(removeTrigger.dataset.slotRemove);
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
