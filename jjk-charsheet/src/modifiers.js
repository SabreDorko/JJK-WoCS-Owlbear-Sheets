import { CENTER_STATS, RIGHT_STATS } from "./state/store.js";

const STAT_DEFS = [...CENTER_STATS, ...RIGHT_STATS];
const STAT_KEYS = new Set(STAT_DEFS.map(def => def.key));
const STAT_LABELS = Object.fromEntries(STAT_DEFS.map(def => [def.key, def.label.charAt(0) + def.label.slice(1).toLowerCase()]));
const SKILLS_BY_STAT = Object.fromEntries(STAT_DEFS.map(def => [def.key, [...def.skills]]));
const DIRECT_DERIVED_KEYS = new Set(["hpMax", "ceMax", "ac", "movement", "aptitudeBonus"]);

function parseModifierValue(rawValue) {
  const parsed = parseInt(rawValue, 10);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(-999, Math.min(999, parsed));
}

function isValidSubskillKey(subskillKey) {
  const [statKey, rawIndex] = String(subskillKey || "").split(":");
  const skillIndex = parseInt(rawIndex, 10);
  const skills = SKILLS_BY_STAT[statKey] || [];
  return STAT_KEYS.has(statKey) && Number.isInteger(skillIndex) && skillIndex >= 0 && skillIndex < skills.length;
}

export function normalizeDirectModifierList(rawList) {
  if (!Array.isArray(rawList)) return [];

  return rawList
    .map((entry, idx) => {
      const targetType = String(entry?.targetType || "").trim();
      const targetKey = String(entry?.targetKey || "").trim();
      const value = parseModifierValue(entry?.value);
      const source = String(entry?.source || "").trim().slice(0, 120);

      if (!["stat", "subskill", "derived"].includes(targetType)) return null;
      if (!targetKey) return null;
      if (targetType === "stat" && !STAT_KEYS.has(targetKey)) return null;
      if (targetType === "subskill" && !isValidSubskillKey(targetKey)) return null;
      if (targetType === "derived" && !DIRECT_DERIVED_KEYS.has(targetKey)) return null;
      if (value === 0) return null;

      return {
        id: String(entry?.id || `direct_mod_${Date.now()}_${idx}`),
        targetType,
        targetKey,
        value,
        source,
      };
    })
    .filter(Boolean);
}

export function normalizeModifierList(rawList) {
  if (!Array.isArray(rawList)) return [];

  return rawList
    .map((entry, idx) => {
      const rawKind = String(entry?.kind || "").trim();
      const kind = rawKind === "skills" ? "rolls" : rawKind;
      const statKey = String(entry?.statKey || "").trim();
      const skillIndex = Number.isInteger(entry?.skillIndex) ? entry.skillIndex : parseInt(entry?.skillIndex, 10);
      const value = parseModifierValue(entry?.value);

      const normalized = {
        id: String(entry?.id || `mod_${Date.now()}_${idx}`),
        kind,
        value,
      };

      if (["stat", "rolls", "skill"].includes(kind)) {
        if (!STAT_KEYS.has(statKey)) return null;
        normalized.statKey = statKey;
      }

      if (kind === "skill") {
        const skills = SKILLS_BY_STAT[statKey] || [];
        if (!Number.isInteger(skillIndex) || skillIndex < 0 || skillIndex >= skills.length) return null;
        normalized.skillIndex = skillIndex;
      }

      if (!["stat", "rolls", "skill", "ac", "movement", "storage"].includes(kind)) return null;
      if (value === 0) return null;
      return normalized;
    })
    .filter(Boolean);
}

function valueWithSign(value) {
  return value >= 0 ? `+${value}` : `${value}`;
}

function getSkillName(statKey, skillIndex) {
  const skills = SKILLS_BY_STAT[statKey] || [];
  return skills[skillIndex] || "Skill";
}

export function describeModifier(modifier) {
  const value = parseModifierValue(modifier?.value);
  const statKey = modifier?.statKey;
  const statLabel = STAT_LABELS[statKey] || "Stat";

  if (modifier?.kind === "ac") return `${valueWithSign(value)} AC`;
  if (modifier?.kind === "movement") return `${valueWithSign(value)} Movement`;
  if (modifier?.kind === "storage") return `${valueWithSign(value)} Storage Slot${Math.abs(value) === 1 ? "" : "s"}`;
  if (modifier?.kind === "stat") return `${valueWithSign(value)} ${statLabel}`;
  if (modifier?.kind === "rolls") return `${valueWithSign(value)} ${statLabel} Rolls`;
  if (modifier?.kind === "skill") return `${valueWithSign(value)} ${getSkillName(statKey, modifier?.skillIndex)}`;
  return "";
}

export function getItemModifierSummary(item) {
  const descriptions = normalizeModifierList(item?.modifiers).map(describeModifier).filter(Boolean);
  if (item?.modifier) descriptions.unshift(String(item.modifier));
  return descriptions.join(" | ");
}

export function buildEmptyModifierEffects() {
  const statBonuses = {};
  const skillBonuses = {};
  const rollBonuses = {};
  STAT_DEFS.forEach(def => {
    statBonuses[def.key] = 0;
    skillBonuses[def.key] = 0;
    rollBonuses[def.key] = 0;
  });

  return {
    statBonuses,
    skillBonuses,
    rollBonuses,
    specificSkillBonuses: {},
    derivedBonuses: {
      hpMax: 0,
      ceMax: 0,
      aptitudeBonus: 0,
    },
    acBonus: 0,
    movementBonus: 0,
    extraInventorySlots: 0,
  };
}

export function computeActiveModifierEffects(state) {
  const effects = buildEmptyModifierEffects();
  if (!state) return effects;

  if (state.inventoryItems && state.equippedSlots) {
    const equippedIds = [...new Set(Object.values(state.equippedSlots).filter(Boolean))];
    equippedIds.forEach(itemId => {
      const item = state.inventoryItems.find(entry => entry.id === itemId);
      if (!item) return;
      const modifiers = normalizeModifierList(item.modifiers);

      modifiers.forEach(modifier => {
        const value = parseModifierValue(modifier.value);
        if (modifier.kind === "ac") effects.acBonus += value;
        else if (modifier.kind === "movement") effects.movementBonus += value;
        else if (modifier.kind === "storage") effects.extraInventorySlots += value;
        else if (modifier.kind === "stat" && STAT_KEYS.has(modifier.statKey)) effects.statBonuses[modifier.statKey] += value;
        else if (modifier.kind === "rolls" && STAT_KEYS.has(modifier.statKey)) effects.rollBonuses[modifier.statKey] += value;
        else if (modifier.kind === "skill" && STAT_KEYS.has(modifier.statKey)) {
          const key = `${modifier.statKey}:${modifier.skillIndex}`;
          effects.specificSkillBonuses[key] = (effects.specificSkillBonuses[key] || 0) + value;
        }
      });
    });
  }

  normalizeDirectModifierList(state.directModifiers).forEach(modifier => {
    const value = parseModifierValue(modifier.value);
    if (modifier.targetType === "stat" && STAT_KEYS.has(modifier.targetKey)) {
      effects.statBonuses[modifier.targetKey] += value;
      return;
    }

    if (modifier.targetType === "subskill" && isValidSubskillKey(modifier.targetKey)) {
      effects.specificSkillBonuses[modifier.targetKey] = (effects.specificSkillBonuses[modifier.targetKey] || 0) + value;
      return;
    }

    if (modifier.targetType === "derived") {
      if (modifier.targetKey === "ac") effects.acBonus += value;
      else if (modifier.targetKey === "movement") effects.movementBonus += value;
      else if (modifier.targetKey === "hpMax") effects.derivedBonuses.hpMax += value;
      else if (modifier.targetKey === "ceMax") effects.derivedBonuses.ceMax += value;
      else if (modifier.targetKey === "aptitudeBonus") effects.derivedBonuses.aptitudeBonus += value;
    }
  });

  return effects;
}

export function getDirectModifiersForTarget(state, targetType, targetKey) {
  return normalizeDirectModifierList(state?.directModifiers)
    .filter(entry => entry.targetType === targetType && entry.targetKey === targetKey);
}

export function getSkillOptions(statKey) {
  return [...(SKILLS_BY_STAT[statKey] || [])];
}

export function getStatDefinitions() {
  return STAT_DEFS.map(def => ({ key: def.key, label: STAT_LABELS[def.key], skills: [...def.skills] }));
}

export function getRollModifierSources(state, statKey) {
  if (!state?.inventoryItems || !state?.equippedSlots) return [];

  const equippedIds = [...new Set(Object.values(state.equippedSlots).filter(Boolean))];
  const sources = [];

  equippedIds.forEach(itemId => {
    const item = state.inventoryItems.find(entry => entry.id === itemId);
    if (!item) return;

    const amount = normalizeModifierList(item.modifiers)
      .filter(modifier => modifier.kind === "rolls" && modifier.statKey === statKey)
      .reduce((sum, modifier) => sum + parseModifierValue(modifier.value), 0);

    if (amount !== 0) {
      sources.push({
        label: item.name || "Item",
        value: amount,
      });
    }
  });

  return sources;
}
