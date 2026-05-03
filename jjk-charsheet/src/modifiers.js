import { CENTER_STATS, RIGHT_STATS } from "./state/store.js";

const STAT_DEFS = [...CENTER_STATS, ...RIGHT_STATS];
const STAT_KEYS = new Set(STAT_DEFS.map(def => def.key));
const STAT_LABELS = Object.fromEntries(STAT_DEFS.map(def => [def.key, def.label.charAt(0) + def.label.slice(1).toLowerCase()]));
const SKILLS_BY_STAT = Object.fromEntries(STAT_DEFS.map(def => [def.key, [...def.skills]]));

function parseModifierValue(rawValue) {
  const parsed = parseInt(rawValue, 10);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(-999, Math.min(999, parsed));
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
    acBonus: 0,
    movementBonus: 0,
    extraInventorySlots: 0,
  };
}

export function computeActiveModifierEffects(state) {
  const effects = buildEmptyModifierEffects();
  if (!state?.inventoryItems || !state?.equippedSlots) return effects;

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
      else if (modifier.kind === "skills" && STAT_KEYS.has(modifier.statKey)) effects.skillBonuses[modifier.statKey] += value;
      else if (modifier.kind === "rolls" && STAT_KEYS.has(modifier.statKey)) effects.rollBonuses[modifier.statKey] += value;
      else if (modifier.kind === "skill" && STAT_KEYS.has(modifier.statKey)) {
        const key = `${modifier.statKey}:${modifier.skillIndex}`;
        effects.specificSkillBonuses[key] = (effects.specificSkillBonuses[key] || 0) + value;
      }
    });
  });

  return effects;
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
