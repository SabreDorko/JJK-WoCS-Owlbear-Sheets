// ── CHANNEL / STORAGE CONSTANTS ───────────────────────────────────────────────
export const STORAGE_KEY_BASE           = "jjk-charsheet-v1";
export const ROLL_BROADCAST_CHANNEL     = "jjk-roll-v1";
export const PARTY_BROADCAST_CHANNEL    = "jjk-party-v1";
export const PARTY_SYNC_REQUEST_CHANNEL = "jjk-party-sync-v1";

// ── ARCHETYPES ────────────────────────────────────────────────────────────────
export const ARCHETYPES = {
  acrobat:       ["Untouchable", "Link"],
  brawler:       ["Merciless", "Pain Glutton"],
  brutalizer:    ["Cannibal", "Hitman"],
  caster:        ["Sniper", "Zoner"],
  speedster:     ["Distance Runner", "Bolt"],
  unbreakable:   ["Everlasting", "Resilient"],
  mastermind:    ["Trickster", "Manipulator"],
  swordsman:     ["Lazy", "Upstart"],
  shaman:        ["Physician", "Mystic"],
  prodigy:       ["Divine", "Damned"],
  rebel:         ["Revolutionary", "Black Sheep"],
  confidant:     ["Comedian", "Mentor"],
  thrill_seeker: ["Easygoing", "Gambler"],
  tinkerer:      ["Technician", "Engineer"],
  toxicologist:  ["Plague", "Herbalist"],
  custom:        ["Custom A", "Custom B"],
};

// ── STAT DEFINITIONS ──────────────────────────────────────────────────────────
export const CENTER_STATS = [
  { key: "power",     label: "POWER",     skills: ["Athletics", "Combat", "Fortitude", "Intimidation", "Strength"] },
  { key: "speed",     label: "SPEED",     skills: ["Precision", "Reaction", "Stealth", "Tempo"] },
  { key: "technique", label: "TECHNIQUE", skills: ["Acrobatics", "Control", "Survival", "Talent"] },
];

export const RIGHT_STATS = [
  { key: "intelligence", label: "INTELLIGENCE", skills: ["Cursed Technique Education", "General Education", "Medical Education", "Perception", "Tech Education"] },
  { key: "cooperation",  label: "COOPERATION",  skills: ["Charisma", "Combo", "Deception", "Insight", "Persuasion"] },
];

export const BODY_SLOT_KEYS = [
  "head",
  "body",
  "legs",
  "feet",
  "rightHand",
  "leftHand",
  "accessory1",
  "accessory2",
];

export const BODY_SLOT_LABELS = {
  head: "Head",
  body: "Body",
  legs: "Legs",
  feet: "Feet",
  rightHand: "Right Hand",
  leftHand: "Left Hand",
  accessory1: "Accessory 1",
  accessory2: "Accessory 2",
};

// ── DEFAULT STATE ─────────────────────────────────────────────────────────────
export function defaultState() {
  const stats = {};
  [...CENTER_STATS, ...RIGHT_STATS].forEach(s => {
    stats[s.key] = { score: "", skills: s.skills.map(() => ({ aptitude: 0 })) };
  });
  return {
    charName: "", archetype: "", subArchetype: "", age: "",
    grade: "", ct: "", playerName: "",
    techniques: {
      mode: "none",
      activeSubtab: "technique",
      applications: [],
      bindingVows: [],
      noCtPath: "",
      notes: "",
      bindingVowsNotes: "",
    },
    archetypeProgress: {
      unlockedAbilityIds: [],
      permanentAptitudeSelections: [],
    },
    customArchetype: {
      name: "Custom Archetype",
      scaleStat: "power",
      subArchetypeA: "Custom A",
      subArchetypeB: "Custom B",
      permanentAptitudeStatPicks: ["power", "technique"],
      permanentAptitudeRules: [
        "Choose 1 permanent aptitude from Power",
        "Choose 1 permanent aptitude from Technique",
      ],
      startingEquipment: ["", ""],
      abilities: {
        tier1A: { id: "custom-tier1-a", name: "Tier 1A", notes: "", minStat: 1 },
        tier1B: { id: "custom-tier1-b", name: "Tier 1B", notes: "", minStat: 1 },
        tier2: { id: "custom-tier2", name: "Tier 2", notes: "", minStat: 2 },
        tier3: { id: "custom-tier3", name: "Tier 3", notes: "", minStat: 3 },
        tier4: { id: "custom-tier4", name: "Tier 4", notes: "", minStat: 4 },
        tier5A: { id: "custom-tier5-a", name: "Tier 5A", notes: "", minStat: 5 },
        tier5B: { id: "custom-tier5-b", name: "Tier 5B", notes: "", minStat: 5 },
      },
    },
    archetypeGrantedAbilities: [],
    archetype2: "", subArchetype2: "", hasSecondArchetype: false,
    ac: "", hpCurrent: "", hpMax: "",
    movement: "", ceCurrent: "", ceMax: "", ceNote: "",
    yen: "",
    rollHistory: [],
    inventoryItems: [],
    inventorySlots: [null, null, null, null, null],
    dormItemIds: [],
    equippedSlots: {
      head: null,
      body: null,
      legs: null,
      feet: null,
      rightHand: null,
      leftHand: null,
      accessory1: null,
      accessory2: null,
    },
    overrides: {
      derived: {},
      subskills: {},
    },
    stats,
  };
}
