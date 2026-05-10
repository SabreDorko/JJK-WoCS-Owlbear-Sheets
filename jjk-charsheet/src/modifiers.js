import { CENTER_STATS, RIGHT_STATS } from "./state/store.js";

const STAT_DEFS = [...CENTER_STATS, ...RIGHT_STATS];
const STAT_KEYS = new Set(STAT_DEFS.map(def => def.key));
const STAT_LABELS = Object.fromEntries(STAT_DEFS.map(def => [def.key, def.label.charAt(0) + def.label.slice(1).toLowerCase()]));
const SKILLS_BY_STAT = Object.fromEntries(STAT_DEFS.map(def => [def.key, [...def.skills]]));
const DIRECT_DERIVED_KEYS = new Set(["hpMax", "ceMax", "ac", "movement", "aptitudeBonus", "xpThreshold", "techniqueRollBonus"]);
const DIRECT_OPERATIONS = new Set(["add", "multiply", "divide"]);

// Valid source tags for techniqueApp modifiers.
// "advantage" and "disadvantage" are boolean flags (value always 1).
export const TECHNIQUE_APP_SOURCES = new Set([
  "ceCost",
  "dc",
  "rollBonus",
  "advantage",
  "disadvantage",
]);

function parseModifierValue(rawValue) {
  const parsed = parseInt(rawValue, 10);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(-999, Math.min(999, parsed));
}

function parseDirectModifierValue(rawValue, operation) {
  const parsed = parseFloat(rawValue);
  if (!Number.isFinite(parsed)) return null;

  if (operation === "add") {
    const limited = Math.max(-999, Math.min(999, parsed));
    if (limited === 0) return null;
    return Math.round(limited * 1000) / 1000;
  }
  if (operation === "multiply") {
    const limited = Math.max(-50, Math.min(50, parsed));
    return Math.round(limited * 1000) / 1000;
  }
  if (operation === "divide") {
    const limited = Math.max(-50, Math.min(50, parsed));
    if (limited === 0) return null;
    return Math.round(limited * 1000) / 1000;
  }
  return null;
}

function isValidSubskillKey(subskillKey) {
  const [statKey, rawIndex] = String(subskillKey || "").split(":");
  const skillIndex = parseInt(rawIndex, 10);
  const skills = SKILLS_BY_STAT[statKey] || [];
  return STAT_KEYS.has(statKey) && Number.isInteger(skillIndex) && skillIndex >= 0 && skillIndex < skills.length;
}

// techniqueApp targetKey is a non-negative integer string ("0", "1", …)
function isValidTechniqueAppKey(targetKey) {
  const n = parseInt(targetKey, 10);
  return Number.isInteger(n) && n >= 0 && String(n) === String(targetKey).trim();
}

export function normalizeDirectModifierList(rawList) {
  if (!Array.isArray(rawList)) return [];

  return rawList
    .map((entry, idx) => {
      const targetType = String(entry?.targetType || "").trim();
      const targetKey  = String(entry?.targetKey  || "").trim();
      const operation  = DIRECT_OPERATIONS.has(String(entry?.operation || "").trim())
        ? String(entry.operation).trim()
        : "add";
      const source = String(entry?.source || "").trim().slice(0, 120);

      const validTypes = ["stat", "statRoll", "subskill", "derived", "techniqueApp"];
      if (!validTypes.includes(targetType))                                    return null;
      if (!targetKey)                                                          return null;
      if (targetType === "stat"         && !STAT_KEYS.has(targetKey))          return null;
      if (targetType === "statRoll"     && !STAT_KEYS.has(targetKey))          return null;
      if (targetType === "subskill"     && !isValidSubskillKey(targetKey))     return null;
      if (targetType === "derived"      && !DIRECT_DERIVED_KEYS.has(targetKey))return null;
      if (targetType === "techniqueApp" && !isValidTechniqueAppKey(targetKey)) return null;

      // advantage / disadvantage are boolean flags — bypass the zero-rejection
      // inside parseDirectModifierValue and always store value: 1.
      const isBoolFlag = targetType === "techniqueApp" &&
        (source === "advantage" || source === "disadvantage");

      const value = isBoolFlag ? 1 : parseDirectModifierValue(entry?.value, operation);
      if (!Number.isFinite(value)) return null;

      return {
        id: String(entry?.id || `direct_mod_${Date.now()}_${idx}`),
        targetType,
        targetKey,
        operation,
        value,
        source,
      };
    })
    .filter(Boolean);
}

export function applyDirectModifiers(baseValue, modifiers) {
  return normalizeDirectModifierList(modifiers).reduce((current, modifier) => {
    const value = Number(modifier.value);
    if (!Number.isFinite(value)) return current;
    if (modifier.operation === "multiply") return current * value;
    if (modifier.operation === "divide")   return value === 0 ? current : current / value;
    return current + value;
  }, Number.isFinite(baseValue) ? baseValue : 0);
}

export function normalizeModifierList(rawList) {
  if (!Array.isArray(rawList)) return [];

  return rawList
    .map((entry, idx) => {
      const rawKind    = String(entry?.kind || "").trim();
      const kind       = rawKind === "skills" ? "rolls" : rawKind;
      const statKey    = String(entry?.statKey || "").trim();
      const skillIndex = Number.isInteger(entry?.skillIndex)
        ? entry.skillIndex
        : parseInt(entry?.skillIndex, 10);
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
  const value     = parseModifierValue(modifier?.value);
  const statKey   = modifier?.statKey;
  const statLabel = STAT_LABELS[statKey] || "Stat";

  if (modifier?.kind === "ac")       return `${valueWithSign(value)} AC`;
  if (modifier?.kind === "movement") return `${valueWithSign(value)} Movement`;
  if (modifier?.kind === "storage")  return `${valueWithSign(value)} Storage Slot${Math.abs(value) === 1 ? "" : "s"}`;
  if (modifier?.kind === "stat")     return `${valueWithSign(value)} ${statLabel}`;
  if (modifier?.kind === "rolls")    return `${valueWithSign(value)} ${statLabel} Rolls`;
  if (modifier?.kind === "skill")    return `${valueWithSign(value)} ${getSkillName(statKey, modifier?.skillIndex)}`;
  return "";
}

export function getItemModifierSummary(item) {
  const descriptions = normalizeModifierList(item?.modifiers).map(describeModifier).filter(Boolean);
  if (item?.modifier) descriptions.unshift(String(item.modifier));
  return descriptions.join(" | ");
}

export function buildEmptyModifierEffects() {
  const statBonuses  = {};
  const skillBonuses = {};
  const rollBonuses  = {};
  STAT_DEFS.forEach(def => {
    statBonuses[def.key]  = 0;
    skillBonuses[def.key] = 0;
    rollBonuses[def.key]  = 0;
  });
  return { statBonuses, skillBonuses, rollBonuses, specificSkillBonuses: {}, acBonus: 0, movementBonus: 0, extraInventorySlots: 0 };
}

export function computeActiveModifierEffects(state) {
  const effects = buildEmptyModifierEffects();
  if (!state) return effects;

  if (state.inventoryItems && state.equippedSlots) {
    const equippedIds = [...new Set(Object.values(state.equippedSlots).filter(Boolean))];
    equippedIds.forEach(itemId => {
      const item = state.inventoryItems.find(entry => entry.id === itemId);
      if (!item) return;
      normalizeModifierList(item.modifiers).forEach(modifier => {
        const value = parseModifierValue(modifier.value);
        if      (modifier.kind === "ac")                                   effects.acBonus              += value;
        else if (modifier.kind === "movement")                             effects.movementBonus         += value;
        else if (modifier.kind === "storage")                              effects.extraInventorySlots   += value;
        else if (modifier.kind === "stat"  && STAT_KEYS.has(modifier.statKey)) effects.statBonuses[modifier.statKey]  += value;
        else if (modifier.kind === "rolls" && STAT_KEYS.has(modifier.statKey)) effects.rollBonuses[modifier.statKey]  += value;
        else if (modifier.kind === "skill" && STAT_KEYS.has(modifier.statKey)) {
          const key = `${modifier.statKey}:${modifier.skillIndex}`;
          effects.specificSkillBonuses[key] = (effects.specificSkillBonuses[key] || 0) + value;
        }
      });
    });
  }

  // Direct stat roll modifiers affect the flat bonus after dice are rolled.
  const directList = normalizeDirectModifierList(state.directModifiers);
  STAT_DEFS.forEach(def => {
    const directRollMods = directList.filter(e => e.targetType === "statRoll" && e.targetKey === def.key);
    if (!directRollMods.length) return;
    effects.rollBonuses[def.key] = Math.round(applyDirectModifiers(effects.rollBonuses[def.key], directRollMods));
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
      .filter(m => m.kind === "rolls" && m.statKey === statKey)
      .reduce((sum, m) => sum + parseModifierValue(m.value), 0);
    if (amount !== 0) sources.push({ label: item.name || "Item", value: amount });
  });

  return sources;
}

// ── Technique App modifier helpers ────────────────────────────────────────────

/**
 * All persisted direct modifiers for a specific technique application index.
 */
export function getTechniqueAppModifiers(state, appIndex) {
  return normalizeDirectModifierList(state?.directModifiers || [])
    .filter(e => e.targetType === "techniqueApp" && e.targetKey === String(appIndex));
}

/**
 * First modifier matching a source tag for an application, or null.
 */
export function getTechniqueAppModifierBySource(state, appIndex, source) {
  return getTechniqueAppModifiers(state, appIndex).find(e => e.source === source) || null;
}

/**
 * True if the application has any active direct modifiers (used for badge display).
 */
export function hasTechniqueAppModifiers(state, appIndex) {
  return getTechniqueAppModifiers(state, appIndex).length > 0;
}

/**
 * Computes the effective XP threshold incorporating derived/xpThreshold
 * direct modifiers on top of the base techScore × 2.
 */
export function getEffectiveXpThreshold(state, techScore) {
  const base = Math.max(0, techScore * 2);
  const mods = normalizeDirectModifierList(state?.directModifiers || [])
    .filter(e => e.targetType === "derived" && e.targetKey === "xpThreshold");
  return Math.max(0, Math.round(applyDirectModifiers(base, mods)));
}

/**
 * Computes the effective flat roll bonus that applies to ALL CT application
 * talent checks, incorporating derived/techniqueRollBonus direct modifiers.
 * This is separate from statRoll/technique so it only affects CT casts.
 */
export function getEffectiveTechniqueRollBonus(state) {
  const mods = normalizeDirectModifierList(state?.directModifiers || [])
    .filter(e => e.targetType === "derived" && e.targetKey === "techniqueRollBonus");
  return Math.round(applyDirectModifiers(0, mods));
}