import { ARCHETYPES, CENTER_STATS, RIGHT_STATS } from "./state/store.js";
import { ARCHETYPE_RULES } from "./data/archetype-rules.js";
import { resolveBaseItemTemplateByStartingEquipmentLine } from "./data/base-items.js";
import { applyCharacterStateToUI } from "./character.js";
import { renderInventory } from "./inventory.js";

let _getState = null;
let _scheduleSave = null;
let _initialized = false;
let _lastPrimaryArchetype = null;
const _expandedAbilityDescriptions = new Set();
const _collapsedArchetypeSections = {
  benefits: false,
  permanentAptitudes: false,
};

const MAX_ABILITY_SLOTS = 5;
// Temporary feature gate: keep starter grant logic in place but disabled until catalog/store flow is finalized.
const ENABLE_STARTER_ITEM_AUTO_GRANT = false;

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

const STAT_KEYS = ["power", "speed", "technique", "intelligence", "cooperation"];
const SKILL_LABELS_BY_STAT = [...CENTER_STATS, ...RIGHT_STATS].reduce((acc, stat) => {
  acc[stat.key] = [...stat.skills];
  return acc;
}, {});

function getState() {
  return _getState ? _getState() : null;
}

function scheduleSave() {
  if (_scheduleSave) _scheduleSave();
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function makeStarterItemId() {
  return `starter_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function buildInventoryItemFromBaseTemplate(template) {
  const itemType = String(template?.itemType || "item");
  return {
    id: makeStarterItemId(),
    name: String(template?.name || "Starter Item"),
    modifier: "",
    modifiers: Array.isArray(template?.modifiers) ? template.modifiers : [],
    description: String(template?.description || ""),
    itemType,
    weaponGrip: template?.weaponGrip || null,
    weaponType: template?.weaponType || null,
    weaponStat: template?.weaponStat || null,
    weaponDamageParts: Array.isArray(template?.weaponDamageParts) ? template.weaponDamageParts : [],
    weaponRange: parseInt(template?.weaponRange, 10) || null,
    weaponPolearmReach: Boolean(template?.weaponPolearmReach),
    allowedSlots: Array.isArray(template?.allowedSlots) ? [...template.allowedSlots] : [],
    slotsNeeded: parseInt(template?.slotsNeeded, 10) || 1,
    stackable: Boolean(template?.stackable),
    quantity: parseInt(template?.quantity, 10) || 1,
    location: "dorm",
    inventorySlot: null,
    equippedSlots: [],
    baseItemId: String(template?.id || ""),
  };
}

function ensureStarterItemGrantState(state) {
  if (!state.archetypeProgress || typeof state.archetypeProgress !== "object") state.archetypeProgress = {};
  if (!Array.isArray(state.archetypeProgress.starterItemGrantHistory)) {
    state.archetypeProgress.starterItemGrantHistory = [];
  }
  if (!state.archetypeProgress.startingEquipmentSelections || typeof state.archetypeProgress.startingEquipmentSelections !== "object") {
    state.archetypeProgress.startingEquipmentSelections = {};
  }
  if (!state.archetypeProgress.grantedStarterItems || typeof state.archetypeProgress.grantedStarterItems !== "object") {
    state.archetypeProgress.grantedStarterItems = {};
  }
}

function parseStartingEquipmentChoices(line) {
  const sourceLine = String(line || "").trim();
  if (!sourceLine) return { sourceLine: "", detail: "", options: [] };

  const [headPart, ...detailParts] = sourceLine.split(":");
  const detail = detailParts.join(":").trim();
  const head = String(headPart || "").trim();
  const sharedSuffixMatch = head.match(/^(.*?)(\s*\([^)]*\))$/);
  const baseLabel = sharedSuffixMatch && sharedSuffixMatch[1].includes("/")
    ? sharedSuffixMatch[1].trim()
    : head;
  const sharedSuffix = sharedSuffixMatch && sharedSuffixMatch[1].includes("/")
    ? sharedSuffixMatch[2].trim()
    : "";

  const rawOptions = baseLabel.split("/").map(option => option.trim()).filter(Boolean);
  const options = (rawOptions.length ? rawOptions : [head]).map(option => {
    const label = `${option}${sharedSuffix ? ` ${sharedSuffix}` : ""}`.trim();
    return {
      label,
      line: detail ? `${label}: ${detail}` : label,
    };
  });

  return { sourceLine, detail, options };
}

function getStarterItemDisplayName(line, fallbackName = "Starter Item") {
  const rawLabel = String(line || "").split(":")[0].trim();
  if (!rawLabel) return fallbackName;

  const withoutSuffix = rawLabel.replace(/\s*\([^)]*\)\s*$/, "").trim();
  return withoutSuffix || rawLabel || fallbackName;
}

function buildStarterItemFromLine(line) {
  const template = resolveBaseItemTemplateByStartingEquipmentLine(line);
  if (template) {
    const item = buildInventoryItemFromBaseTemplate(template);
    item.name = getStarterItemDisplayName(line, item.name);
    return item;
  }

  const [namePart, ...detailParts] = String(line || "").split(":");
  return {
    id: makeStarterItemId(),
    name: getStarterItemDisplayName(namePart, "Starter Item"),
    modifier: "",
    modifiers: [],
    description: detailParts.join(":").trim(),
    itemType: "item",
    weaponGrip: null,
    weaponType: null,
    weaponStat: null,
    weaponDamageParts: [],
    weaponRange: null,
    weaponPolearmReach: false,
    allowedSlots: ["rightHand", "leftHand"],
    slotsNeeded: 1,
    stackable: false,
    quantity: 1,
    location: "dorm",
    inventorySlot: null,
    equippedSlots: [],
    baseItemId: "",
  };
}

function getStartingEquipmentSelections(state, archetypeKey, rule) {
  ensureStarterItemGrantState(state);
  const key = String(archetypeKey || "").trim();
  const lines = Array.isArray(rule?.startingEquipment) ? rule.startingEquipment : [];
  const saved = Array.isArray(state.archetypeProgress.startingEquipmentSelections[key])
    ? state.archetypeProgress.startingEquipmentSelections[key]
    : [];

  const normalized = lines.map((line, index) => {
    const parsed = parseStartingEquipmentChoices(line);
    const selectedIndex = Math.max(0, Math.min(parsed.options.length - 1, parseInt(saved[index], 10) || 0));
    return Number.isFinite(selectedIndex) ? selectedIndex : 0;
  });

  state.archetypeProgress.startingEquipmentSelections[key] = normalized;
  return normalized;
}

function getSelectedStartingEquipmentLines(state, archetypeKey, rule) {
  const lines = Array.isArray(rule?.startingEquipment) ? rule.startingEquipment : [];
  const selections = getStartingEquipmentSelections(state, archetypeKey, rule);
  return lines
    .map((line, index) => {
      const parsed = parseStartingEquipmentChoices(line);
      const selected = parsed.options[selections[index]] || parsed.options[0];
      return selected?.line || line;
    })
    .filter(Boolean);
}

function getGrantedStarterItems(state, archetypeKey) {
  ensureStarterItemGrantState(state);
  const key = String(archetypeKey || "").trim();
  const records = Array.isArray(state.archetypeProgress.grantedStarterItems[key])
    ? state.archetypeProgress.grantedStarterItems[key]
    : [];

  const normalized = records
    .map(record => ({
      slotIndex: parseInt(record?.slotIndex, 10),
      itemId: String(record?.itemId || "").trim(),
      selectedLine: String(record?.selectedLine || "").trim(),
    }))
    .filter(record => Number.isFinite(record.slotIndex) && record.slotIndex >= 0 && record.itemId);

  state.archetypeProgress.grantedStarterItems[key] = normalized;
  return normalized;
}

function getStarterGrantStatus(state, archetypeKey, rule) {
  const selectedLines = getSelectedStartingEquipmentLines(state, archetypeKey, rule);
  const records = getGrantedStarterItems(state, archetypeKey);
  const inventoryIds = new Set(Array.isArray(state?.inventoryItems) ? state.inventoryItems.map(item => item?.id).filter(Boolean) : []);
  const bySlot = new Map(records.map(record => [record.slotIndex, record]));

  const pendingSlots = selectedLines
    .map((line, slotIndex) => {
      const record = bySlot.get(slotIndex) || null;
      const isPresent = Boolean(record && inventoryIds.has(record.itemId));
      const isMismatched = Boolean(record && isPresent && record.selectedLine && record.selectedLine !== line);
      return {
        line,
        slotIndex,
        record,
        isPresent,
        isMismatched,
      };
    })
    .filter(entry => !entry.record || !entry.isPresent || entry.isMismatched);

  return {
    records,
    selectedLines,
    pendingSlots,
    missingSlots: pendingSlots.filter(entry => !entry.record || !entry.isPresent),
    replaceableSlots: pendingSlots.filter(entry => entry.isMismatched),
    hasAnyPresent: records.some(record => inventoryIds.has(record.itemId)),
  };
}

function upsertGrantedStarterRecord(state, archetypeKey, slotIndex, itemId, selectedLine) {
  const records = getGrantedStarterItems(state, archetypeKey).filter(record => record.slotIndex !== slotIndex);
  records.push({ slotIndex, itemId, selectedLine: String(selectedLine || "").trim() });
  state.archetypeProgress.grantedStarterItems[archetypeKey] = records.sort((a, b) => a.slotIndex - b.slotIndex);
}

function removeStarterItemsFromState(state, itemIds) {
  const toRemove = new Set((itemIds || []).map(value => String(value || "").trim()).filter(Boolean));
  if (!toRemove.size) return;

  state.inventoryItems = (state.inventoryItems || []).filter(item => !toRemove.has(item.id));
  state.inventorySlots = (state.inventorySlots || []).map(id => (toRemove.has(id) ? null : id));
  state.dormItemIds = (state.dormItemIds || []).filter(id => !toRemove.has(id));

  if (state.equippedSlots && typeof state.equippedSlots === "object") {
    Object.keys(state.equippedSlots).forEach(slot => {
      if (toRemove.has(state.equippedSlots[slot])) state.equippedSlots[slot] = null;
    });
  }
}

function addStarterItemsForPrimaryArchetype() {
  const state = getState();
  if (!state?.archetype) return;

  const rule = getArchetypeRule(state, state.archetype);
  if (!rule) return;

  if (!Array.isArray(state.inventoryItems)) state.inventoryItems = [];
  if (!Array.isArray(state.dormItemIds)) state.dormItemIds = [];

  const status = getStarterGrantStatus(state, state.archetype, rule);
  if (!status.pendingSlots.length) return;

  status.pendingSlots.forEach(({ line, slotIndex, record, isMismatched }) => {
    if (isMismatched && record?.itemId) removeStarterItemsFromState(state, [record.itemId]);
    const item = buildStarterItemFromLine(line);
    state.inventoryItems.push(item);
    if (!state.dormItemIds.includes(item.id)) state.dormItemIds.push(item.id);
    upsertGrantedStarterRecord(state, state.archetype, slotIndex, item.id, line);
  });

  applyArchetypeStateToUI();
  renderInventory();
  scheduleSave();
}

function removeStarterItemsForPrimaryArchetype() {
  const state = getState();
  if (!state?.archetype) return;

  const records = getGrantedStarterItems(state, state.archetype);
  if (!records.length) return;

  removeStarterItemsFromState(state, records.map(record => record.itemId));
  state.archetypeProgress.grantedStarterItems[state.archetype] = [];
  applyArchetypeStateToUI();
  renderInventory();
  scheduleSave();
}

function maybeGrantStarterItemsForPrimaryArchetype(state, archetypeKey) {
  if (!ENABLE_STARTER_ITEM_AUTO_GRANT) return false;
  if (!state || !archetypeKey || archetypeKey === "custom") return false;
  const rule = getArchetypeRule(state, archetypeKey);
  if (!rule) return false;

  ensureStarterItemGrantState(state);
  const status = getStarterGrantStatus(state, archetypeKey, rule);
  if (!status.pendingSlots.length) return false;

  if (!Array.isArray(state.inventoryItems)) state.inventoryItems = [];
  if (!Array.isArray(state.dormItemIds)) state.dormItemIds = [];

  status.pendingSlots.forEach(({ line, slotIndex, record, isMismatched }) => {
    if (isMismatched && record?.itemId) removeStarterItemsFromState(state, [record.itemId]);
    const item = buildStarterItemFromLine(line);
    state.inventoryItems.push(item);
    if (!state.dormItemIds.includes(item.id)) state.dormItemIds.push(item.id);
    upsertGrantedStarterRecord(state, archetypeKey, slotIndex, item.id, line);
  });

  return true;
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
  const state = getState();
  return getArchetypeRule(state, archetypeKey)?.label || toTitleCase(archetypeKey);
}

function normalizeStatKey(rawValue) {
  const key = String(rawValue || "").trim().toLowerCase();
  if (["power", "speed", "technique", "intelligence", "cooperation"].includes(key)) return key;
  return key;
}

function normalizeSubLabel(rawValue) {
  return String(rawValue || "")
    .trim()
    .replace(/^the\s+/i, "")
    .toLowerCase();
}

function resolveSubclassRule(rule, selectedSub) {
  if (!rule || !rule.subclassAbilities || !selectedSub) return null;

  if (rule.subclassAbilities[selectedSub]) return rule.subclassAbilities[selectedSub];

  const selectedNormalized = normalizeSubLabel(selectedSub);
  for (const [subKey, subDef] of Object.entries(rule.subclassAbilities)) {
    if (normalizeSubLabel(subKey) === selectedNormalized) return subDef;
  }

  return null;
}

function validateArchetypeMappings() {
  const warnings = [];
  const archetypeKeys = Object.keys(ARCHETYPES || {});

  archetypeKeys.forEach(archKey => {
    if (archKey === "custom") return;
    const rule = ARCHETYPE_RULES[archKey];
    if (!rule) {
      warnings.push(`Missing ARCHETYPE_RULES entry for '${archKey}'.`);
      return;
    }

    const expectedSubs = (ARCHETYPES[archKey] || []).map(normalizeSubLabel);
    const definedSubs = Object.keys(rule.subclassAbilities || {}).map(normalizeSubLabel);

    expectedSubs.forEach(sub => {
      if (!definedSubs.includes(sub)) {
        warnings.push(`Archetype '${archKey}' is missing subclass mapping for '${sub}'.`);
      }
    });

    const normalizedStat = normalizeStatKey(rule.scaleStat);
    if (!["power", "speed", "technique", "intelligence", "cooperation"].includes(normalizedStat)) {
      warnings.push(`Archetype '${archKey}' has unrecognized scaleStat '${rule.scaleStat}'.`);
    }
  });

  Object.keys(ARCHETYPE_RULES).forEach(archKey => {
    if (!archetypeKeys.includes(archKey)) {
      warnings.push(`ARCHETYPE_RULES includes '${archKey}' but it is not present in store ARCHETYPES.`);
    }
  });

  if (warnings.length) {
    console.warn("[Archetype Mapping Validation]\n" + warnings.map(w => `- ${w}`).join("\n"));
  }
}

function statScore(state, statKey) {
  const normalizedKey = normalizeStatKey(statKey);
  return parseInt(state?.stats?.[normalizedKey]?.score, 10) || 0;
}

function sanitizeAbilityId(rawValue, fallbackId) {
  const sanitized = String(rawValue || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return sanitized || fallbackId;
}

function ensureCustomArchetypeState(state) {
  if (!state || typeof state !== "object") return;
  if (!state.customArchetype || typeof state.customArchetype !== "object") state.customArchetype = {};

  const custom = state.customArchetype;
  if (!custom.name) custom.name = "Custom Archetype";
  if (!STAT_KEYS.includes(normalizeStatKey(custom.scaleStat))) custom.scaleStat = "power";
  if (!custom.subArchetypeA) custom.subArchetypeA = "Custom A";
  if (!custom.subArchetypeB) custom.subArchetypeB = "Custom B";
  if (!Array.isArray(custom.permanentAptitudeStatPicks)) {
    const legacyStats = Array.isArray(custom.permanentAptitudeRules)
      ? custom.permanentAptitudeRules
        .map(line => normalizeStatKey(String(line || "").match(/power|speed|technique|intelligence|cooperation/i)?.[0] || ""))
        .filter(stat => STAT_KEYS.includes(stat))
      : [];
    custom.permanentAptitudeStatPicks = [legacyStats[0] || "power", legacyStats[1] || "technique"];
  }
  while (custom.permanentAptitudeStatPicks.length < 2) custom.permanentAptitudeStatPicks.push("power");
  custom.permanentAptitudeStatPicks = custom.permanentAptitudeStatPicks
    .slice(0, 2)
    .map(stat => STAT_KEYS.includes(normalizeStatKey(stat)) ? normalizeStatKey(stat) : "power");

  if (!Array.isArray(custom.permanentAptitudeRules)) {
    custom.permanentAptitudeRules = [
      "Choose 1 permanent aptitude from Power",
      "Choose 1 permanent aptitude from Technique",
    ];
  }
  while (custom.permanentAptitudeRules.length < 2) custom.permanentAptitudeRules.push("");

  if (!Array.isArray(custom.startingEquipment)) custom.startingEquipment = ["", ""];
  while (custom.startingEquipment.length < 2) custom.startingEquipment.push("");

  if (!custom.abilities || typeof custom.abilities !== "object") custom.abilities = {};
  const defaults = {
    tier1A: { id: "custom-tier1-a", name: "Tier 1A", notes: "", minStat: 1 },
    tier1B: { id: "custom-tier1-b", name: "Tier 1B", notes: "", minStat: 1 },
    tier2: { id: "custom-tier2", name: "Tier 2", notes: "", minStat: 2 },
    tier3: { id: "custom-tier3", name: "Tier 3", notes: "", minStat: 3 },
    tier4: { id: "custom-tier4", name: "Tier 4", notes: "", minStat: 4 },
    tier5A: { id: "custom-tier5-a", name: "Tier 5A", notes: "", minStat: 5 },
    tier5B: { id: "custom-tier5-b", name: "Tier 5B", notes: "", minStat: 5 },
  };

  Object.entries(defaults).forEach(([key, def]) => {
    if (!custom.abilities[key] || typeof custom.abilities[key] !== "object") custom.abilities[key] = { ...def };
    if (!custom.abilities[key].name) custom.abilities[key].name = def.name;
    custom.abilities[key].id = sanitizeAbilityId(custom.abilities[key].name, def.id);
    custom.abilities[key].notes = String(custom.abilities[key].notes || "");
    custom.abilities[key].minStat = parseInt(custom.abilities[key].minStat, 10) || def.minStat;
  });
}

function sanitizePermanentAptitudeStatPicks(rawPicks) {
  if (!Array.isArray(rawPicks)) return [];
  return rawPicks
    .map(value => normalizeStatKey(value))
    .filter(stat => STAT_KEYS.includes(stat));
}

function parsePermanentAptitudeStatPicksFromRules(rawRules) {
  if (!Array.isArray(rawRules)) return [];
  const picks = [];
  rawRules.forEach(line => {
    const text = String(line || "");
    const stats = [...new Set((text.match(/power|speed|technique|intelligence|cooperation/gi) || []).map(normalizeStatKey))]
      .filter(stat => STAT_KEYS.includes(stat));
    if (stats.length !== 1) return;

    const countMatch = text.match(/choose\s+(\d+)/i);
    const count = Math.max(1, parseInt(countMatch?.[1] || "1", 10) || 1);
    const stat = stats[0];
    for (let i = 0; i < count; i += 1) picks.push(stat);
  });
  return picks;
}

function buildPermanentAptitudeRulesFromPicks(rawPicks) {
  const picks = sanitizePermanentAptitudeStatPicks(rawPicks);
  if (!picks.length) return [];

  const counts = new Map();
  picks.forEach(stat => counts.set(stat, (counts.get(stat) || 0) + 1));
  return [...counts.entries()].map(([stat, count]) => {
    const noun = count === 1 ? "aptitude" : "aptitudes";
    return `Choose ${count} permanent ${noun} from ${toTitleCase(stat)}`;
  });
}

function getPermanentAptitudeStatPicks(rule) {
  if (!rule || typeof rule !== "object") return [];
  const explicitPicks = sanitizePermanentAptitudeStatPicks(rule.permanentAptitudeStatPicks);
  if (explicitPicks.length) return explicitPicks;
  return parsePermanentAptitudeStatPicksFromRules(rule.permanentAptitudes);
}

function getPermanentAptitudeRuleLines(rule) {
  const picks = getPermanentAptitudeStatPicks(rule);
  if (picks.length) return buildPermanentAptitudeRulesFromPicks(picks);
  return Array.isArray(rule?.permanentAptitudes) ? rule.permanentAptitudes.filter(Boolean) : [];
}

function normalizeRulePermanentAptitudes(rule) {
  if (!rule || typeof rule !== "object") return;
  const picks = getPermanentAptitudeStatPicks(rule);
  if (!picks.length) {
    if (!Array.isArray(rule.permanentAptitudes)) rule.permanentAptitudes = [];
    return;
  }

  rule.permanentAptitudeStatPicks = picks;
  rule.permanentAptitudes = buildPermanentAptitudeRulesFromPicks(picks);
}

function buildCustomPermanentAptitudeRules(custom) {
  const validPicks = sanitizePermanentAptitudeStatPicks(
    Array.isArray(custom?.permanentAptitudeStatPicks)
      ? custom.permanentAptitudeStatPicks.slice(0, 2)
      : []
  );
  if (!validPicks.length) return ["Choose 1 permanent aptitude from Power", "Choose 1 permanent aptitude from Technique"];
  return buildPermanentAptitudeRulesFromPicks(validPicks);
}

function getCustomRule(state) {
  ensureCustomArchetypeState(state);
  const custom = state?.customArchetype;
  if (!custom) return null;

  const subA = String(custom.subArchetypeA || "Custom A").trim() || "Custom A";
  const subB = String(custom.subArchetypeB || "Custom B").trim() || "Custom B";
  const generatedPermanentAptitudes = buildCustomPermanentAptitudeRules(custom);
  const permanentAptitudeStatPicks = sanitizePermanentAptitudeStatPicks(
    Array.isArray(custom.permanentAptitudeStatPicks)
      ? custom.permanentAptitudeStatPicks.slice(0, 2)
      : []
  );
  const abilities = custom.abilities || {};
  return {
    label: String(custom.name || "Custom Archetype"),
    scaleStat: normalizeStatKey(custom.scaleStat || "power"),
    permanentAptitudeStatPicks,
    permanentAptitudes: generatedPermanentAptitudes,
    startingEquipment: [...(custom.startingEquipment || [])].filter(Boolean),
    sharedAbilities: [
      { tier: 2, ...abilities.tier2 },
      { tier: 3, ...abilities.tier3 },
      { tier: 4, ...abilities.tier4 },
    ],
    subclassAbilities: {
      [subA]: {
        tier1: { ...abilities.tier1A, minStat: 1 },
        tier5: { ...abilities.tier5A, minStat: 5 },
      },
      [subB]: {
        tier1: { ...abilities.tier1B, minStat: 1 },
        tier5: { ...abilities.tier5B, minStat: 5 },
      },
    },
  };
}

function getArchetypeRule(state, archetypeKey) {
  if (!archetypeKey) return null;
  if (archetypeKey === "custom") return getCustomRule(state);
  const rule = ARCHETYPE_RULES[archetypeKey] || null;
  normalizeRulePermanentAptitudes(rule);
  return rule;
}

function getKnownAbilityIdsForState(state) {
  const ids = new Set(KNOWN_ABILITY_IDS);
  const customRule = getArchetypeRule(state, "custom");
  if (customRule) {
    customRule.sharedAbilities.forEach(ability => {
      if (ability?.id) ids.add(`custom:${ability.id}`);
    });
    Object.values(customRule.subclassAbilities || {}).forEach(def => {
      if (def?.tier1?.id) ids.add(`custom:${def.tier1.id}`);
      if (def?.tier5?.id) ids.add(`custom:${def.tier5.id}`);
    });
  }
  return ids;
}

function getPermanentAptitudeRequirementSlots(rule) {
  if (!rule) return [];
  const picks = getPermanentAptitudeStatPicks(rule);
  if (picks.length) {
    const byStatRuleText = Object.fromEntries(
      buildPermanentAptitudeRulesFromPicks(picks).map(line => {
        const stat = normalizeStatKey(String(line || "").match(/power|speed|technique|intelligence|cooperation/i)?.[0] || "");
        return [stat, line];
      })
    );

    return picks.map(stat => ({
      allowedStats: [stat],
      ruleText: byStatRuleText[stat] || `Choose 1 permanent aptitude from ${toTitleCase(stat)}`,
    }));
  }

  const slots = [];
  (rule.permanentAptitudes || []).forEach(rawLine => {
    const line = String(rawLine || "").trim();
    if (!line) return;
    const stats = [...new Set((line.match(/power|speed|technique|intelligence|cooperation/gi) || []).map(normalizeStatKey))];
    const countMatch = line.match(/choose\s+(\d+)/i);
    const count = Math.max(1, parseInt(countMatch?.[1] || "1", 10) || 1);
    for (let i = 0; i < count; i += 1) {
      slots.push({ allowedStats: stats.length ? stats : [...STAT_KEYS], ruleText: line });
    }
  });
  return slots;
}

function ensurePermanentAptitudeState(state) {
  if (!state.archetypeProgress || typeof state.archetypeProgress !== "object") state.archetypeProgress = {};
  if (!Array.isArray(state.archetypeProgress.permanentAptitudeSelections)) {
    state.archetypeProgress.permanentAptitudeSelections = [];
  }
}

function aptitudeSelectionSignature(selection) {
  if (!selection) return "";
  return `${selection.statKey}:${parseInt(selection.skillIndex, 10) || 0}`;
}

function findFirstNonDuplicateSkillIndex(selections, currentIndex, statKey, preferredIndex = 0) {
  const skills = SKILL_LABELS_BY_STAT[statKey] || [];
  if (!skills.length) return 0;

  const hasCollision = candidateIndex => {
    const signature = `${statKey}:${candidateIndex}`;
    return selections.some((entry, idx) => idx !== currentIndex && aptitudeSelectionSignature(entry) === signature);
  };

  if (!hasCollision(preferredIndex)) return preferredIndex;
  for (let i = 0; i < skills.length; i += 1) {
    if (!hasCollision(i)) return i;
  }
  return preferredIndex;
}

function ensureArchetypeState(state) {
  if (!state || typeof state !== "object") return;
  ensureCustomArchetypeState(state);
  if (!state.archetypeProgress || typeof state.archetypeProgress !== "object") {
    state.archetypeProgress = {};
  }
  ensurePermanentAptitudeState(state);
  ensureStarterItemGrantState(state);

  if (!Array.isArray(state.archetypeProgress.unlockedAbilityIds)) {
    const legacyUnlocked = Array.isArray(state.archetypeGrantedAbilities)
      ? state.archetypeGrantedAbilities
        .filter(entry => entry?.unlocked)
        .map(entry => String(entry?.name || "").trim())
        .filter(Boolean)
      : [];
    state.archetypeProgress.unlockedAbilityIds = legacyUnlocked;
  }

  const parsedExtraSlots = parseInt(state.archetypeProgress.extraSlots, 10);
  state.archetypeProgress.extraSlots = Number.isFinite(parsedExtraSlots)
    ? Math.max(0, parsedExtraSlots)
    : 0;

  const knownIds = getKnownAbilityIdsForState(state);
  state.archetypeProgress.unlockedAbilityIds = state.archetypeProgress.unlockedAbilityIds
    .map(value => String(value || "").trim())
    .filter(value => knownIds.has(value));

  state.archetypeProgress.starterItemGrantHistory = state.archetypeProgress.starterItemGrantHistory
    .map(value => String(value || "").trim())
    .filter(Boolean);
  Object.keys(state.archetypeProgress.grantedStarterItems).forEach(key => {
    state.archetypeProgress.grantedStarterItems[key] = getGrantedStarterItems(state, key);
  });

  if (!state.archetypeProgress.collapsedSections || typeof state.archetypeProgress.collapsedSections !== "object") {
    state.archetypeProgress.collapsedSections = {
      benefits: false,
      permanentAptitudes: false,
    };
  }
  state.archetypeProgress.collapsedSections.benefits = Boolean(state.archetypeProgress.collapsedSections.benefits);
  state.archetypeProgress.collapsedSections.permanentAptitudes = Boolean(state.archetypeProgress.collapsedSections.permanentAptitudes);
}

function syncCollapsedSectionsFromState(state) {
  ensureArchetypeState(state);
  const collapsed = state.archetypeProgress.collapsedSections || {};
  _collapsedArchetypeSections.benefits = Boolean(collapsed.benefits);
  _collapsedArchetypeSections.permanentAptitudes = Boolean(collapsed.permanentAptitudes);
}

function persistCollapsedSectionsToState(state) {
  ensureArchetypeState(state);
  state.archetypeProgress.collapsedSections = {
    benefits: Boolean(_collapsedArchetypeSections.benefits),
    permanentAptitudes: Boolean(_collapsedArchetypeSections.permanentAptitudes),
  };
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
  const extraSlots = parseInt(state?.archetypeProgress?.extraSlots, 10) || 0;
  const unlockedSlots = MAX_ABILITY_SLOTS + Math.max(0, extraSlots);
  return {
    unlockedSlots,
    usedSlots: Math.min(unlockedSlots, usedSlots),
    openSlots: Math.max(0, unlockedSlots - usedSlots),
  };
}

function getAllowedAbilityIdsForCurrentSelections(state) {
  const allowed = new Set();
  selectedArchetypeEntries(state).forEach(entry => {
    const selectedSub = entry.type === "primary" ? state.subArchetype : state.subArchetype2;
    getTieredAbilities(entry.key, selectedSub, state).forEach(ability => {
      if (ability?.id) allowed.add(abilityGlobalId(entry.key, ability.id));
    });
  });
  return allowed;
}

function cleanupArchetypeSelections(state) {
  ensureArchetypeState(state);

  const allowed = getAllowedAbilityIdsForCurrentSelections(state);
  state.archetypeProgress.unlockedAbilityIds = state.archetypeProgress.unlockedAbilityIds.filter(value => allowed.has(value));

  if (!state.archetype) {
    state.archetypeProgress.permanentAptitudeSelections = [];
    return;
  }

  const rule = getArchetypeRule(state, state.archetype);
  const maxSlots = getPermanentAptitudeRequirementSlots(rule).length;
  state.archetypeProgress.permanentAptitudeSelections = (state.archetypeProgress.permanentAptitudeSelections || [])
    .filter(selection => selection?.sourceArchetype === state.archetype || !selection?.sourceArchetype)
    .slice(0, maxSlots);
}

function isExtraAbilitySlot(state, slotIndex) {
  const slotSummary = getSlotSummary(state);
  return slotIndex >= MAX_ABILITY_SLOTS && slotIndex < slotSummary.unlockedSlots;
}

function canRemoveAbilityByGlobalId(state, unlockedList, globalId) {
  const [archKey, abilityId] = String(globalId || "").split(":");
  if (!archKey || !abilityId) return false;
  const def = getAbilityDefinition(state, archKey, abilityId);
  if (!def) return true;
  return !hasHigherTierInSlots(new Set(unlockedList), archKey, def.tier);
}

function selectedArchetypeEntries(state) {
  const entries = [];
  if (state.archetype) entries.push({ key: state.archetype, type: "primary" });
  if (state.hasSecondArchetype && state.archetype2) entries.push({ key: state.archetype2, type: "secondary" });
  return entries;
}

function getAbilityDefinition(state, archetypeKey, abilityId) {
  const rule = getArchetypeRule(state, archetypeKey);
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
  const state = getState();
  return [...unlockedSet].some(globalId => {
    const [archKey, abilityId] = String(globalId || "").split(":");
    if (archKey !== archetypeKey) return false;
    const def = getAbilityDefinition(state, archKey, abilityId);
    if (!def || !Number.isFinite(def.tier)) return false;
    return def.tier > tier;
  });
}

function getTieredAbilities(archetypeKey, selectedSub, state = getState()) {
  const rule = getArchetypeRule(state, archetypeKey);
  if (!rule) return [];

  const byTier = new Map();
  rule.sharedAbilities.forEach(ability => {
    byTier.set(ability.tier, { ...ability, subLocked: false, tier: ability.tier });
  });

  const subRule = resolveSubclassRule(rule, selectedSub);
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
      <div class="archetype-rule-note">You have 5 base slots. Add abilities in tier order (1-5) within each archetype tree. Extra slots can be added below your slot list.</div>
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

  const rule = getArchetypeRule(state, state.archetype);
  if (!rule) {
    benefitsList.innerHTML = `
      <article class="archetype-benefit-card">
        <div class="archetype-benefit-title">${getArchetypeLabel(state.archetype)}</div>
        <div class="techniques-muted">No predefined data yet. Add this archetype to ARCHETYPE_RULES in archetype.js.</div>
      </article>
    `;
    return;
  }

  const slots = getPermanentAptitudeRequirementSlots(rule);
  ensurePermanentAptitudeState(state);
  const previous = state.archetypeProgress.permanentAptitudeSelections || [];
  const nextSelections = slots.map((slot, index) => {
    const current = previous[index] || {};
    const fallbackStat = slot.allowedStats[0] || "power";
    const statKey = slot.allowedStats.includes(current.statKey) ? current.statKey : fallbackStat;
    const skills = SKILL_LABELS_BY_STAT[statKey] || [];
    const skillIndex = Number.isInteger(current.skillIndex) && current.skillIndex >= 0 && current.skillIndex < skills.length
      ? current.skillIndex
      : 0;
    return {
      slotIndex: index,
      statKey,
      skillIndex,
      sourceArchetype: state.archetype,
      sourceLabel: rule.label,
    };
  });
  const seen = new Map();
  nextSelections.forEach(entry => {
    const signature = aptitudeSelectionSignature(entry);
    seen.set(signature, (seen.get(signature) || 0) + 1);
  });
  state.archetypeProgress.permanentAptitudeSelections = nextSelections;

  const aptitudeInstructionLines = [...new Set(slots.map(slot => String(slot?.ruleText || "").trim()).filter(Boolean))];
  const aptitudeInstructionMarkup = aptitudeInstructionLines.length
    ? `<div class="techniques-muted">${aptitudeInstructionLines.map(line => escapeHtml(line)).join("<br>")}</div>`
    : "";

  const aptitudeMarkup = slots.length
    ? `<div class="archetype-aptitude-picks">
        <div class="meta-grid archetype-picker-grid">
        ${slots.map((slot, index) => {
          const entry = nextSelections[index];
          const isDuplicate = (seen.get(aptitudeSelectionSignature(entry)) || 0) > 1;
          const skills = SKILL_LABELS_BY_STAT[entry.statKey] || [];
          const skillOptions = skills
            .map((label, skillIndex) => `<option value="${skillIndex}"${entry.skillIndex === skillIndex ? " selected" : ""}>${escapeHtml(label)}</option>`)
            .join("");
          const selectedSkillLabel = skills[entry.skillIndex] || "Unknown";
          const statTitle = slot.allowedStats.length === 1
            ? `${toTitleCase(slot.allowedStats[0])} Aptitude`
            : `Permanent Aptitude ${index + 1}`;
          const statControl = slot.allowedStats.length > 1
            ? `<select class="meta-select" data-perm-apt-stat="${index}">${slot.allowedStats.map(stat => `<option value="${stat}"${entry.statKey === stat ? " selected" : ""}>${toTitleCase(stat)}</option>`).join("")}</select>`
            : "";

          return `
            <div class="meta-field${isDuplicate ? " archetype-aptitude-row--warning" : ""}">
              <div class="archetype-aptitude-row-label">${escapeHtml(statTitle)}</div>
              ${statControl}
              <select class="meta-select" data-perm-apt-skill="${index}">${skillOptions}</select>
              <div class="archetype-aptitude-preview">Selected: ${escapeHtml(selectedSkillLabel)}</div>
              ${isDuplicate ? '<div class="archetype-aptitude-warning">Duplicate pick detected. Choose a different skill.</div>' : ""}
            </div>
          `;
        }).join("")}
        </div>
      </div>`
    : '<div class="techniques-app-empty">This archetype has no permanent aptitude requirements.</div>';

  const equipmentLines = Array.isArray(rule.startingEquipment) ? rule.startingEquipment : [];
  const selections = getStartingEquipmentSelections(state, state.archetype, rule);
  const starterStatus = getStarterGrantStatus(state, state.archetype, rule);
  const equipmentButtonLabel = starterStatus.records.length
    ? (starterStatus.replaceableSlots.length
      ? "Replace Equipment"
      : starterStatus.missingSlots.length
        ? "Add Missing Equipment"
        : "Equipment Added")
    : "Add Equipment";
  const equipmentMarkup = equipmentLines.length
    ? `
      <div class="archetype-aptitude-picks">
        <div class="meta-grid archetype-picker-grid">
        ${equipmentLines.map((line, index) => {
          const parsed = parseStartingEquipmentChoices(line);
          const selectedIndex = selections[index] || 0;
          const selected = parsed.options[selectedIndex] || parsed.options[0] || null;
          const selectMarkup = parsed.options.length > 1
            ? `<select class="meta-select" data-starting-equipment-choice="${index}">
                ${parsed.options.map((option, optionIndex) => `<option value="${optionIndex}"${optionIndex === selectedIndex ? " selected" : ""}>${escapeHtml(option.label)}</option>`).join("")}
              </select>`
            : `<div class="archetype-aptitude-preview">${escapeHtml(selected?.label || line)}</div>`;

          return `
            <div class="meta-field">
              <div class="archetype-aptitude-row-label">Equipment ${index + 1}</div>
              ${selectMarkup}
              ${parsed.detail ? `<div class="techniques-muted">${escapeHtml(parsed.detail)}</div>` : ""}
            </div>
          `;
        }).join("")}
        </div>
        <div class="inventory-form-actions">
          <button type="button" class="meta-toggle-btn" data-add-starting-equipment="true"${starterStatus.pendingSlots.length ? "" : " disabled"}>${equipmentButtonLabel}</button>
          <button type="button" class="inventory-secondary-btn" data-remove-starting-equipment="true"${starterStatus.hasAnyPresent ? "" : " disabled"}>Remove Granted Equipment</button>
        </div>
      </div>
    `
    : '<div class="techniques-app-empty">This archetype has no starting equipment configured.</div>';

  benefitsList.innerHTML = `
    <article class="archetype-benefit-card">
      <div class="archetype-benefit-title">${rule.label}</div>
      <div class="archetype-benefit-sub">Scales with ${toTitleCase(rule.scaleStat)}</div>
      <div class="archetype-benefit-grid">
        <div>
          <div class="field-label">Permanent Aptitudes</div>
          ${aptitudeInstructionMarkup}
          ${aptitudeMarkup}
        </div>
        <div>
          <div class="field-label">Starting Equipment</div>
          <div class="techniques-muted">Choose your starting equipment options, then add or replace the granted gear below.</div>
          ${equipmentMarkup}
        </div>
      </div>
      <div class="techniques-muted">Only your first archetype grants starting aptitudes and starting equipment.</div>
    </article>
  `;
}

function renderPermanentAptitudePicker(state) {
  const container = document.getElementById("archetypePermanentAptitudes");
  const panel = document.getElementById("archetypePermanentAptitudesPanel");
  const toggle = document.getElementById("archetypePermanentAptitudesToggleBtn");
  if (container) container.innerHTML = "";
  if (panel) panel.style.display = "none";
  if (toggle) toggle.style.display = "none";
}

function renderCustomBuilder(state) {
  const card = document.getElementById("customArchetypeBuilder");
  const body = document.getElementById("customArchetypeBuilderBody");
  if (!card || !body) return;

  const show = state.archetype === "custom" || (state.hasSecondArchetype && state.archetype2 === "custom");
  card.style.display = show ? "" : "none";
  if (!show) return;

  ensureCustomArchetypeState(state);
  const custom = state.customArchetype;
  const generatedPermanentAptitudes = buildCustomPermanentAptitudeRules(custom);
  const abilityFields = [
    ["tier1A", "Tier 1 (Sub A)"],
    ["tier1B", "Tier 1 (Sub B)"],
    ["tier2", "Tier 2"],
    ["tier3", "Tier 3"],
    ["tier4", "Tier 4"],
    ["tier5A", "Tier 5 (Sub A)"],
    ["tier5B", "Tier 5 (Sub B)"],
  ];

  body.innerHTML = `
    <div class="techniques-muted">Custom values here drive both the Benefits card and the Ability Tree in real time.</div>
    <div class="meta-grid archetype-picker-grid">
      <div class="meta-field">
        <div class="field-label">Archetype Name</div>
        <input class="meta-input" data-custom-field="name" value="${custom.name || ""}" />
      </div>
      <div class="meta-field">
        <div class="field-label">Scale Stat</div>
        <select class="meta-select" data-custom-field="scaleStat">
          ${STAT_KEYS.map(key => `<option value="${key}"${normalizeStatKey(custom.scaleStat) === key ? " selected" : ""}>${toTitleCase(key)}</option>`).join("")}
        </select>
      </div>
      <div class="meta-field">
        <div class="field-label">Sub-Archetype A</div>
        <input class="meta-input" data-custom-field="subArchetypeA" value="${custom.subArchetypeA || ""}" />
      </div>
      <div class="meta-field">
        <div class="field-label">Sub-Archetype B</div>
        <input class="meta-input" data-custom-field="subArchetypeB" value="${custom.subArchetypeB || ""}" />
      </div>
      <div class="meta-field">
        <div class="field-label">Permanent Aptitude Stat 1</div>
        <select class="meta-select" data-custom-field="permanentAptitudeStatPicks.0">
          ${STAT_KEYS.map(key => `<option value="${key}"${normalizeStatKey(custom.permanentAptitudeStatPicks?.[0]) === key ? " selected" : ""}>${toTitleCase(key)}</option>`).join("")}
        </select>
      </div>
      <div class="meta-field">
        <div class="field-label">Permanent Aptitude Stat 2</div>
        <select class="meta-select" data-custom-field="permanentAptitudeStatPicks.1">
          ${STAT_KEYS.map(key => `<option value="${key}"${normalizeStatKey(custom.permanentAptitudeStatPicks?.[1]) === key ? " selected" : ""}>${toTitleCase(key)}</option>`).join("")}
        </select>
      </div>
      <div class="meta-field" style="grid-column:1/-1;">
        <div class="field-label">Generated Permanent Aptitude Rule</div>
        <ul class="archetype-mini-list">${generatedPermanentAptitudes.map(line => `<li>${line}</li>`).join("")}</ul>
      </div>
      <div class="meta-field">
        <div class="field-label">Starting Equipment 1</div>
        <input class="meta-input" data-custom-field="startingEquipment.0" value="${custom.startingEquipment?.[0] || ""}" />
      </div>
      <div class="meta-field">
        <div class="field-label">Starting Equipment 2</div>
        <input class="meta-input" data-custom-field="startingEquipment.1" value="${custom.startingEquipment?.[1] || ""}" />
      </div>
    </div>
    <div class="archetype-custom-abilities">
      ${abilityFields.map(([key, label]) => `
        <div class="archetype-aptitude-row">
          <div class="archetype-aptitude-row-label">${label}</div>
          <input class="meta-input" data-custom-ability="${key}" data-custom-prop="name" value="${custom.abilities?.[key]?.name || ""}" placeholder="Ability name" />
          <textarea class="inventory-textarea" data-custom-ability="${key}" data-custom-prop="notes" rows="2" placeholder="Ability notes">${custom.abilities?.[key]?.notes || ""}</textarea>
        </div>
      `).join("")}
    </div>
  `;
}

function renderAbilitySlots(state) {
  const grid = document.getElementById("archetypeAbilitySlots");
  if (!grid) return;

  const unlocked = Array.isArray(state?.archetypeProgress?.unlockedAbilityIds)
    ? state.archetypeProgress.unlockedAbilityIds
    : [];
  const slotSummary = getSlotSummary(state);

  const cards = [];
  for (let i = 0; i < slotSummary.unlockedSlots; i += 1) {
    const globalId = unlocked[i] || "";
    if (!globalId) {
      const canRemoveExtraSlot = isExtraAbilitySlot(state, i);
      cards.push(`
        <article class="archetype-slot-item archetype-slot-item--empty">
          ${canRemoveExtraSlot
            ? `<button type="button" class="inventory-plus-btn archetype-add-btn archetype-remove-btn archetype-slot-trash" data-slot-remove-extra="${i}" aria-label="Remove extra slot" title="Remove extra slot">
                <svg class="inventory-plus-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                  <path class="inventory-plus-icon-line inventory-plus-icon-line-horizontal" fill="currentColor" d="M5 11h14v2H5z"/>
                </svg>
              </button>`
            : ""}
          <div class="archetype-slot-index">Slot ${i + 1}</div>
          <div class="techniques-muted">Empty</div>
        </article>
      `);
      continue;
    }

    const [archKey, abilityId] = globalId.split(":");
    const rule = getArchetypeRule(state, archKey);
    const def = getAbilityDefinition(state, archKey, abilityId);
    const canRemove = canRemoveAbilityByGlobalId(state, unlocked, globalId);
    const descKey = `slot:${globalId}`;
    const isExpanded = _expandedAbilityDescriptions.has(descKey);
    const canRemoveExtraSlot = isExtraAbilitySlot(state, i) && canRemove;

    cards.push(`
      <article class="archetype-slot-item">
        ${canRemove
          ? `<button type="button" class="inventory-plus-btn archetype-add-btn archetype-remove-btn archetype-slot-trash" data-slot-remove="${globalId}" aria-label="Remove ability" title="Remove ability">
              <svg class="inventory-plus-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <path class="inventory-plus-icon-line inventory-plus-icon-line-horizontal" fill="currentColor" d="M5 11h14v2H5z"/>
              </svg>
            </button>`
          : ""}
        ${canRemoveExtraSlot
          ? `<button type="button" class="inventory-plus-btn archetype-add-btn archetype-remove-btn archetype-slot-extra-remove" data-slot-remove-extra="${i}" aria-label="Remove extra slot" title="Remove extra slot">
              <svg class="inventory-plus-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <path class="inventory-plus-icon-line inventory-plus-icon-line-horizontal" fill="currentColor" d="M5 11h14v2H5z"/>
              </svg>
            </button>`
          : ""}
        <div class="archetype-slot-index">Slot ${i + 1}</div>
        <div class="archetype-slot-name">${def?.name || abilityId}</div>
        <div class="archetype-slot-meta">${rule?.label || toTitleCase(archKey)} · Tier ${def?.tier || "?"}</div>
        <button type="button" class="archetype-desc-toggle" data-slot-desc-toggle="${descKey}" aria-expanded="${isExpanded ? "true" : "false"}">
          <span class="archetype-desc-chevron"></span>
          <span>Description</span>
        </button>
        <div class="archetype-ability-notes${isExpanded ? " open" : ""}">${def?.notes || ""}</div>
      </article>
    `);
  }

  cards.push(`
    <button type="button" class="archetype-slot-control" data-slot-add="true" aria-label="Add ability slot" title="Add ability slot">
      <span class="field-label">+ Add Slot</span>
    </button>
  `);

  grid.innerHTML = cards.join("");
}

function addAbilitySlot() {
  const state = getState();
  if (!state) return;
  ensureArchetypeState(state);
  state.archetypeProgress.extraSlots = (parseInt(state.archetypeProgress.extraSlots, 10) || 0) + 1;
  renderArchetypeSummary(state);
  renderAbilitySlots(state);
  renderAbilityTree(state);
  scheduleSave();
}

function removeAbilitySlot(slotIndexRaw) {
  const state = getState();
  if (!state) return;
  ensureArchetypeState(state);

  const slotIndex = parseInt(slotIndexRaw, 10);
  if (!Number.isFinite(slotIndex)) return;
  if (!isExtraAbilitySlot(state, slotIndex)) return;

  const unlocked = Array.isArray(state.archetypeProgress.unlockedAbilityIds)
    ? [...state.archetypeProgress.unlockedAbilityIds]
    : [];
  const globalId = unlocked[slotIndex] || "";
  if (globalId && !canRemoveAbilityByGlobalId(state, unlocked, globalId)) return;

  if (slotIndex < unlocked.length) unlocked.splice(slotIndex, 1);
  state.archetypeProgress.extraSlots = Math.max(0, (parseInt(state.archetypeProgress.extraSlots, 10) || 0) - 1);

  const maxSlotsAfter = MAX_ABILITY_SLOTS + state.archetypeProgress.extraSlots;
  while (unlocked.length > maxSlotsAfter) unlocked.pop();

  const knownIds = getKnownAbilityIdsForState(state);
  state.archetypeProgress.unlockedAbilityIds = unlocked.filter(value => knownIds.has(value));

  renderArchetypeSummary(state);
  renderAbilitySlots(state);
  renderAbilityTree(state);
  scheduleSave();
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
    const rule = getArchetypeRule(state, entry.key);
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
    const abilities = getTieredAbilities(entry.key, selectedSub, state);

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
      const canRemove = ability.id && added && !hasHigherTierUnlocked(state, entry.key, selectedSub, ability.tier);
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
                : "";

      return `
        <div class="archetype-ability-row${added ? " unlocked" : ""}">
          <div class="archetype-ability-row-head">
            <div>
              <div class="archetype-ability-name">Tier ${ability.tier}: ${ability.name}</div>
              <div class="archetype-ability-meta">${toTitleCase(rule.scaleStat)} ${ability.minStat}+${ability.tier === 1 || ability.tier === 5 ? " · Sub-Archetype" : " · Shared"}</div>
            </div>
            <div class="archetype-ability-controls">
              ${canAdd
                ? `<button type="button" class="inventory-plus-btn archetype-add-btn" data-ability-add="${globalId}" aria-label="Add ability" title="Add ability">
                  <svg class="inventory-plus-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                    <path class="inventory-plus-icon-line inventory-plus-icon-line-horizontal" fill="currentColor" d="M5 11h14v2H5z"/>
                    <path class="inventory-plus-icon-line inventory-plus-icon-line-vertical" fill="currentColor" d="M11 5h2v14h-2z"/>
                  </svg>
                </button>`
                : canRemove
                  ? `<button type="button" class="inventory-plus-btn archetype-add-btn archetype-remove-btn" data-ability-remove="${globalId}" aria-label="Remove ability" title="Remove ability">
                    <svg class="inventory-plus-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                      <path class="inventory-plus-icon-line inventory-plus-icon-line-horizontal" fill="currentColor" d="M5 11h14v2H5z"/>
                    </svg>
                  </button>`
                  : ``}
            </div>
          </div>
          ${statusText ? `<div class="archetype-ability-status">${statusText}</div>` : ""}
          <button type="button" class="archetype-desc-toggle" data-ability-desc-toggle="${descKey}" aria-expanded="${isExpanded ? "true" : "false"}">
            <span class="archetype-desc-chevron"></span>
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
  const abilities = getTieredAbilities(archetypeKey, selectedSub, state);
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
  const rule = getArchetypeRule(state, archetypeKey);
  if (!rule) return;
  const statMet = statScore(state, rule.scaleStat) >= (ability.minStat || 0);

  if (!previousMet || !statMet || slotSummary.openSlots <= 0) return;
  unlockedSet.add(globalId);

  const knownIds = getKnownAbilityIdsForState(state);
  state.archetypeProgress.unlockedAbilityIds = [...unlockedSet].filter(value => knownIds.has(value));
  renderArchetypeSummary(state);
  renderBenefits(state);
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

  const def = getAbilityDefinition(state, archetypeKey, abilityId);
  const unlockedSet = new Set(state.archetypeProgress.unlockedAbilityIds);
  if (!unlockedSet.has(globalId)) return;
  if (def && hasHigherTierInSlots(unlockedSet, archetypeKey, def.tier)) return;

  unlockedSet.delete(globalId);
  const knownIds = getKnownAbilityIdsForState(state);
  state.archetypeProgress.unlockedAbilityIds = [...unlockedSet].filter(value => knownIds.has(value));
  renderArchetypeSummary(state);
  renderBenefits(state);
  renderAbilitySlots(state);
  renderAbilityTree(state);
  scheduleSave();
}

function refreshFromArchetypeSelectors() {
  const state = getState();
  if (!state) return;
  setTimeout(() => {
    cleanupArchetypeSelections(state);
    applyArchetypeStateToUI();
  }, 0);
}

function setCustomFieldValue(state, fieldPath, value) {
  ensureCustomArchetypeState(state);
  if (!fieldPath) return;
  const path = String(fieldPath).split(".");
  let target = state.customArchetype;
  for (let i = 0; i < path.length - 1; i += 1) {
    const key = path[i];
    if (!target[key] || typeof target[key] !== "object") {
      target[key] = Number.isInteger(parseInt(path[i + 1], 10)) ? [] : {};
    }
    target = target[key];
  }
  target[path[path.length - 1]] = value;
}

function rerenderPreservingCustomInput(inputEl) {
  if (!inputEl) {
    applyArchetypeStateToUI();
    return;
  }

  const fieldPath = inputEl.dataset.customField || "";
  const abilityKey = inputEl.dataset.customAbility || "";
  const abilityProp = inputEl.dataset.customProp || "";
  const selectionStart = typeof inputEl.selectionStart === "number" ? inputEl.selectionStart : null;
  const selectionEnd = typeof inputEl.selectionEnd === "number" ? inputEl.selectionEnd : null;

  applyArchetypeStateToUI();

  const rebuilt = fieldPath
    ? document.querySelector(`#customArchetypeBuilderBody [data-custom-field="${fieldPath}"]`)
    : document.querySelector(`#customArchetypeBuilderBody [data-custom-ability="${abilityKey}"][data-custom-prop="${abilityProp}"]`);

  if (!rebuilt) return;
  rebuilt.focus();
  if (selectionStart !== null && selectionEnd !== null && typeof rebuilt.setSelectionRange === "function") {
    rebuilt.setSelectionRange(selectionStart, selectionEnd);
  }
}

function applyCollapseState(buttonId, panelId, collapsed) {
  const button = document.getElementById(buttonId);
  const panel = document.getElementById(panelId);
  if (!button || !panel) return;
  button.setAttribute("aria-expanded", collapsed ? "false" : "true");
  panel.classList.toggle("collapsed", collapsed);
}

function syncArchetypeCollapseUI() {
  applyCollapseState("archetypeBenefitsToggleBtn", "archetypeBenefitsPanel", _collapsedArchetypeSections.benefits);
  applyCollapseState("archetypePermanentAptitudesToggleBtn", "archetypePermanentAptitudesPanel", _collapsedArchetypeSections.permanentAptitudes);
}

export function applyArchetypeStateToUI() {
  const state = getState();
  if (!state) return;
  ensureArchetypeState(state);
  syncCollapsedSectionsFromState(state);

  const currentPrimaryArchetype = String(state.archetype || "");
  let grantedStarterItems = false;
  if (_lastPrimaryArchetype === null) {
    _lastPrimaryArchetype = currentPrimaryArchetype;
  } else if (currentPrimaryArchetype && currentPrimaryArchetype !== _lastPrimaryArchetype) {
    grantedStarterItems = maybeGrantStarterItemsForPrimaryArchetype(state, currentPrimaryArchetype);
    _lastPrimaryArchetype = currentPrimaryArchetype;
  } else {
    _lastPrimaryArchetype = currentPrimaryArchetype;
  }

  if (state.archetype === "custom") {
    state.subArchetype = state.subArchetype || state.customArchetype.subArchetypeA;
  }
  if (state.hasSecondArchetype && state.archetype2 === "custom") {
    state.subArchetype2 = state.subArchetype2 || state.customArchetype.subArchetypeA;
  }

  renderArchetypeSummary(state);
  renderBenefits(state);
  renderPermanentAptitudePicker(state);
  renderCustomBuilder(state);
  renderAbilitySlots(state);
  renderAbilityTree(state);
  syncArchetypeCollapseUI();
  applyCharacterStateToUI();
  if (grantedStarterItems) renderInventory();
  if (grantedStarterItems) scheduleSave();
}

export function initArchetype({ getState: getStateFn, scheduleSave: scheduleSaveFn }) {
  _getState = getStateFn;
  _scheduleSave = scheduleSaveFn;

  validateArchetypeMappings();

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

      const removeTrigger = e.target?.closest?.("[data-ability-remove]");
      if (removeTrigger) {
        removeAbilityFromSlots(removeTrigger.dataset.abilityRemove);
        return;
      }

      const descTrigger = e.target?.closest?.("[data-ability-desc-toggle]");
      if (!descTrigger) return;
      const key = String(descTrigger.dataset.abilityDescToggle || "");
      if (!key) return;
      if (_expandedAbilityDescriptions.has(key)) _expandedAbilityDescriptions.delete(key);
      else _expandedAbilityDescriptions.add(key);
      const isExpanded = _expandedAbilityDescriptions.has(key);
      descTrigger.setAttribute("aria-expanded", isExpanded ? "true" : "false");
      const notesEl = descTrigger.nextElementSibling;
      if (notesEl?.classList.contains("archetype-ability-notes")) {
        notesEl.classList.toggle("open", isExpanded);
      }
    });
  }

  const slotGrid = document.getElementById("archetypeAbilitySlots");
  if (slotGrid) {
    slotGrid.addEventListener("click", e => {
      const addSlotTrigger = e.target?.closest?.("[data-slot-add]");
      if (addSlotTrigger) {
        addAbilitySlot();
        return;
      }

      const removeSlotTrigger = e.target?.closest?.("[data-slot-remove-extra]");
      if (removeSlotTrigger) {
        removeAbilitySlot(removeSlotTrigger.dataset.slotRemoveExtra);
        return;
      }

      const removeTrigger = e.target?.closest?.("[data-slot-remove]");
      if (removeTrigger) {
        removeAbilityFromSlots(removeTrigger.dataset.slotRemove);
        return;
      }

      const descTrigger = e.target?.closest?.("[data-slot-desc-toggle]");
      if (!descTrigger) return;
      const key = String(descTrigger.dataset.slotDescToggle || "");
      if (!key) return;
      if (_expandedAbilityDescriptions.has(key)) _expandedAbilityDescriptions.delete(key);
      else _expandedAbilityDescriptions.add(key);
      const isExpanded = _expandedAbilityDescriptions.has(key);
      descTrigger.setAttribute("aria-expanded", isExpanded ? "true" : "false");
      const notesEl = descTrigger.nextElementSibling;
      if (notesEl?.classList.contains("archetype-ability-notes")) {
        notesEl.classList.toggle("open", isExpanded);
      }
    });
  }

  const benefitsList = document.getElementById("archetypeBenefitsList");
  if (benefitsList) {
    benefitsList.addEventListener("change", e => {
      const state = getState();
      if (!state) return;
      ensureArchetypeState(state);

      const statSelect = e.target?.closest?.("[data-perm-apt-stat]");
      if (statSelect) {
        const index = parseInt(statSelect.dataset.permAptStat, 10);
        const nextStat = normalizeStatKey(statSelect.value);
        const selections = state.archetypeProgress.permanentAptitudeSelections || [];
        const current = selections[index] || {};
        const nextSkill = findFirstNonDuplicateSkillIndex(selections, index, nextStat, 0);
        selections[index] = {
          ...current,
          statKey: nextStat,
          skillIndex: nextSkill,
          sourceArchetype: state.archetype,
          sourceLabel: getArchetypeLabel(state.archetype),
        };
        state.archetypeProgress.permanentAptitudeSelections = selections;
        applyArchetypeStateToUI();
        scheduleSave();
        return;
      }

      const skillSelect = e.target?.closest?.("[data-perm-apt-skill]");
      if (skillSelect) {
        const index = parseInt(skillSelect.dataset.permAptSkill, 10);
        const nextSkill = parseInt(skillSelect.value, 10) || 0;
        const selections = state.archetypeProgress.permanentAptitudeSelections || [];
        const current = selections[index] || {};
        const statKey = current.statKey || "power";
        const resolvedSkill = findFirstNonDuplicateSkillIndex(selections, index, statKey, nextSkill);
        selections[index] = {
          ...current,
          skillIndex: resolvedSkill,
          sourceArchetype: state.archetype,
          sourceLabel: getArchetypeLabel(state.archetype),
        };
        state.archetypeProgress.permanentAptitudeSelections = selections;
        applyArchetypeStateToUI();
        scheduleSave();
        return;
      }

      if (!state.archetype) return;
      ensureStarterItemGrantState(state);

      const equipmentSelect = e.target?.closest?.("[data-starting-equipment-choice]");
      if (!equipmentSelect) return;
      const rule = getArchetypeRule(state, state.archetype);
      if (!rule) return;

      const index = parseInt(equipmentSelect.dataset.startingEquipmentChoice, 10);
      const selections = getStartingEquipmentSelections(state, state.archetype, rule);
      selections[index] = Math.max(0, parseInt(equipmentSelect.value, 10) || 0);
      state.archetypeProgress.startingEquipmentSelections[state.archetype] = selections;
      applyArchetypeStateToUI();
      scheduleSave();
    });

    benefitsList.addEventListener("click", e => {
      const addEquipmentTrigger = e.target?.closest?.("[data-add-starting-equipment]");
      if (addEquipmentTrigger) {
        addStarterItemsForPrimaryArchetype();
        return;
      }

      const removeEquipmentTrigger = e.target?.closest?.("[data-remove-starting-equipment]");
      if (removeEquipmentTrigger) removeStarterItemsForPrimaryArchetype();
    });
  }

  const customBuilder = document.getElementById("customArchetypeBuilderBody");
  if (customBuilder) {
    customBuilder.addEventListener("input", e => {
      const state = getState();
      if (!state) return;
      ensureArchetypeState(state);

      const fieldEl = e.target?.closest?.("[data-custom-field]");
      if (fieldEl) {
        setCustomFieldValue(state, fieldEl.dataset.customField, fieldEl.value);
        if (fieldEl.dataset.customField === "name") {
          rerenderPreservingCustomInput(fieldEl);
        }
        scheduleSave();
        return;
      }

      const abilityEl = e.target?.closest?.("[data-custom-ability][data-custom-prop]");
      if (!abilityEl) return;
      const abilityKey = abilityEl.dataset.customAbility;
      const prop = abilityEl.dataset.customProp;
      ensureCustomArchetypeState(state);
      if (!state.customArchetype.abilities[abilityKey]) state.customArchetype.abilities[abilityKey] = {};
      state.customArchetype.abilities[abilityKey][prop] = abilityEl.value;
      scheduleSave();
    });

    customBuilder.addEventListener("change", e => {
      const state = getState();
      if (!state) return;

      const fieldEl = e.target?.closest?.("[data-custom-field]");
      if (fieldEl) {
        setCustomFieldValue(state, fieldEl.dataset.customField, fieldEl.value);
        applyArchetypeStateToUI();
        scheduleSave();
        return;
      }

      const abilityEl = e.target?.closest?.("[data-custom-ability][data-custom-prop]");
      if (!abilityEl) return;
      const abilityKey = abilityEl.dataset.customAbility;
      const prop = abilityEl.dataset.customProp;
      ensureCustomArchetypeState(state);
      if (!state.customArchetype.abilities[abilityKey]) state.customArchetype.abilities[abilityKey] = {};
      state.customArchetype.abilities[abilityKey][prop] = abilityEl.value;
      applyArchetypeStateToUI();
      scheduleSave();
    });
  }

  const benefitsToggle = document.getElementById("archetypeBenefitsToggleBtn");
  if (benefitsToggle) {
    benefitsToggle.addEventListener("click", () => {
      const state = getState();
      if (!state) return;
      ensureArchetypeState(state);
      _collapsedArchetypeSections.benefits = !_collapsedArchetypeSections.benefits;
      persistCollapsedSectionsToState(state);
      syncArchetypeCollapseUI();
      scheduleSave();
    });
  }

  const permanentAptitudesToggle = document.getElementById("archetypePermanentAptitudesToggleBtn");
  if (permanentAptitudesToggle) {
    permanentAptitudesToggle.addEventListener("click", () => {
      const state = getState();
      if (!state) return;
      ensureArchetypeState(state);
      _collapsedArchetypeSections.permanentAptitudes = !_collapsedArchetypeSections.permanentAptitudes;
      persistCollapsedSectionsToState(state);
      syncArchetypeCollapseUI();
      scheduleSave();
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
