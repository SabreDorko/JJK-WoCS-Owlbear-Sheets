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
  "chest",
  "back",
  "legs",
  "feet",
  "rightHand",
  "leftHand",
  "accessory",
];

export const BODY_SLOT_LABELS = {
  head: "Head",
  chest: "Chest",
  back: "Back",
  legs: "Legs",
  feet: "Feet",
  rightHand: "Right Hand",
  leftHand: "Left Hand",
  accessory: "Accessory",
};

// ── DEFAULT STATE ─────────────────────────────────────────────────────────────
export function defaultState() {
  const stats = {};
  [...CENTER_STATS, ...RIGHT_STATS].forEach(s => {
    stats[s.key] = { score: "", skills: s.skills.map(() => ({ dot: false, bonus: "" })) };
  });
  return {
    charName: "", archetype: "", subArchetype: "", age: "",
    grade: "", ct: "", playerName: "",
    archetype2: "", subArchetype2: "", hasSecondArchetype: false,
    ac: "", hpCurrent: "", hpMax: "",
    movement: "", ceCurrent: "", ceMax: "", ceNote: "",
    rollHistory: [],
    inventoryItems: [],
    inventorySlots: [null, null, null, null, null],
    dormItemIds: [],
    equippedSlots: {
      head: null,
      chest: null,
      back: null,
      legs: null,
      feet: null,
      rightHand: null,
      leftHand: null,
      accessory: null,
    },
    stats,
  };
}
