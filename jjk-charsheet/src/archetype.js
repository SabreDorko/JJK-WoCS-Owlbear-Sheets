import { ARCHETYPES, CENTER_STATS, RIGHT_STATS } from "./state/store.js";
import { applyCharacterStateToUI } from "./character.js";

let _getState = null;
let _scheduleSave = null;
let _initialized = false;
const _expandedAbilityDescriptions = new Set();
const _collapsedArchetypeSections = {
  benefits: false,
  permanentAptitudes: false,
};

const MAX_ABILITY_SLOTS = 5;

const ARCHETYPE_RULES = {
  acrobat: {
    label: "Acrobat",
    scaleStat: "speed",
    permanentAptitudes: [
      "Choose 1 Permanent Aptitude from Speed",
      "Choose 1 Permanent Aptitude from Technique",
    ],
    startingEquipment: [
      "Dancing Shoes/Running Shoes (Feet): +1 AC, +1 Tempo, +1 Acrobatics",
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
      "The Untouchable": {
        tier1: {
          id: "the-untouchable",
          name: "The Untouchable",
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
      "The Link": {
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
      "Choose 2 Permanent Aptitudes from Power",
    ],
    startingEquipment: [
      "Tearaway Uniform (Body): +1 AC, +1 Strength. (Can be torn off to gain advantage on one Intimidation roll; cannot be put back on for the rest of combat.)",
      "Knuckle Guards (Hands): +1 damage to the Punch action",
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
      "The Merciless": {
        tier1: {
          id: "the-merciless",
          name: "The Merciless",
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
  brutalizer: {
    label: "Brutalizer",
    scaleStat: "speed",
    permanentAptitudes: [
      "Choose 1 permanent aptitude from Speed",
      "Choose 1 permanent aptitude from Technique",
    ],
    startingEquipment: [
      "Hunting Knife (Weapon): 1d8 + TL + Bleed",
      "Camouflage Paint: +2 to Stealth checks for Two Turns. (2/day)",
    ],
    sharedAbilities: [
      {
        tier: 2,
        id: "first-move",
        name: "First Move",
        minStat: 2,
        notes: "When rolling (or rerolling) Initiative, you may add a bonus equal to half of your Technique or Power Stat (your choice), and have +10 ft. of movement on your first turn (this bonus movement speed refreshes upon killing/knocking out an opponent)",
      },
      {
        tier: 3,
        id: "overwhelming-force",
        name: "Overwhelming Force",
        minStat: 3,
        notes: "Once per encounter, when dealing damage in the first round or with a sneak attack, add your SL to the damage. Refreshes after knocking out/killing an opponent in that encounter.",
      },
      {
        tier: 4,
        id: "instant-obliteration",
        name: "Instant Obliteration",
        minStat: 4,
        notes: "When in your first turn on combat, choose to hit or damage rolls. You gain advantage on the selected rolls until the start of your next turn, and if you already have advantage by other sources, add a +2 instead. This effect can carry over to your next turn should you knock out/kill an opponent, and can be chained indefinitely thusly. Immediately ends if conditions aren’t met. Can be reactivated upon knocking out/killing a target, consuming another use. (2/Day)",
      },
    ],
    subclassAbilities: {
      "The Cannibal": {
        tier1: {
          id: "the-cannibal",
          name: "The Cannibal",
          minStat: 1,
          notes: "Whenever you kill a creature in combat, you gain a +1 to all non-hit or damage rolls, stacking up to +3.",
        },
        tier5: {
          id: "slaughterhouse",
          name: "Slaughterhouse",
          minStat: 5,
          notes: "When you kill a creature and there is any leftover damage, this damage carries over to another creature within reach, assuming the original attack hits the target as well. The carried damage can be dodged or blocked.",
        },
      },
      "The Hitman": {
        tier1: {
          id: "the-hitman",
          name: "The Hitman",
          minStat: 1,
          notes: "You can add your full modifier of Technique or Power to the bonus of First Move, instead of half.",
        },
        tier5: {
          id: "jobs-done",
          name: "Job's Done",
          minStat: 5,
          notes: "After performing a Sneak Attack from Stealth, you may choose to remain in stealth. (3/encounter)",
        },
      },
    },
  },
  caster: {
    label: "Caster",
    scaleStat: "Technique",
    permanentAptitudes: [
      "Choose 1 permanent aptitude from Technique",
      "Choose 1 permanent aptitude from Intelligence",
    ],
    startingEquipment: [
      "Gun (Weapon): 1d8 + SL, range 40 ft. and unlimited ammo",
      "Incendiary Rounds: If you load this bullet into your gun (bonus action) the attack causes singe (DC save (TL X 3). (5 bullets)"
    ],
    sharedAbilities: [
      {
        tier: 2,
        id: "sweet-spot",
        name: "Sweet Spot",
        minStat: 2,
        notes: "When you target a creature with your CE abilities (including imbuing)/CT abilities that is at least 30 feet away from you or inside your domain, add +1 to the roll to hit and damage.",
      },
      {
        tier: 3,
        id: "guarded-perimeter",
        name: "Guarded Perimeter",
        minStat: 3,
        notes: "When a creature within 5 feet attempts to attack you and you attempt to react to it, whether you succeed or fail, you may move up to half your movement away from the attacker. (2/Encounter)",
      },
      {
        tier: 4,
        id: "mastered-distance",
        name: "Mastered Distance",
        minStat: 4,
        notes: "When you use a CE Technique (this includes CTs) with at least 30 feet of range or inside your domain, add your Technique Level to the damage (again, if needed). If the Technique hits multiple people, add this damage to only 1 target. (3/ Day)",
      },
    ],
    subclassAbilities: {
      "The Sniper": {
        tier1: {
          id: "the-sniper",
          name: "The Sniper",
          minStat: 1,
          notes: "When targeting a creature at least 40 feet away from you or inside your domain with any of your CE/CT abilities (including imbuing), replace the bonus from Sweet Spot and instead, get a +2 to both hit and damage roll.",
        },
        tier5: {
          id: "deadshot",
          name: "Deadshot",
          minStat: 5,
          notes: "When rolling a Talent Check to activate your CE/CT and roll TLx4+2 or higher, you may double the amount of damage dice of the attack. (Can’t stack with Black Flash.) (1/Day)",
        },
      },
      "The Zoner": {
        tier1: {
          id: "the-zoner",
          name: "The Zoner",
          minStat: 1,
          notes: "Once per turn, when you hit a creature with one of your CE/CT abilities, you can push one enemy up to 10 feet away from you. A creature that successfully blocks or nullifies the damage is immune to this effect.",
        },
        tier5: {
          id: "hold-the-line",
          name: "Hold the Line",
          minStat: 5,
          notes: "Now, you can push up to 20 feet with your CE/CT attacks. You may also choose to affect multiple creatures in one turn with this ability.",
        },
      },
    },
  },
  unbreakable: {
    label: "Unbreakable",
    scaleStat: "Power",
    permanentAptitudes: [
      "Choose 1 permanent aptitude from Power",
      "Choose 1 permanent aptitude from Cooperation",
    ],
    startingEquipment: [
      "Body Armor (Chest): Reduce damage taken by 2.",
      "Motorcycle Goggles (Accessory): Take -2 damage to wind or dust based projectile attacks."
    ],
    sharedAbilities: [
      {
        tier: 2,
        id: "like-hitting-a-wall",
        name: "Like Hitting a Wall",
        minStat: 2,
        notes: "When blocking an attack, you can choose to take no damage instead. If targeted by a domain sure-hit, this reduces damage by 75% instead. (1/Encounter)",
      },
      {
        tier: 3,
        id: "unending-stamina",
        name: "Unending Stamina",
        minStat: 3,
        notes: "When at 10 CE or below, you may “freeze it” for a number of rounds equal to your PL, acting as if you had CE equal to your PL without using any. Once this effect ends/is dispelled, return to your original CE value. (1/Day)",
      },
      {
        tier: 4,
        id: "still-standing",
        name: "Still Standing",
        minStat: 4,
        notes: "When reaching 0 HP, you now have the ability to continue fighting even at negative HP. At the start of every turn and after each attack you take, you must make a check with any substat other than talent of DC (PL X 3 + 3 per roll) to keep on fighting. Reaching your negative max HP still results in immediate death, and to return back to normal you must make up for the deficit in HP. (1/Day)",
      },
    ],
    subclassAbilities: {
      "The Everlasting": {
        tier1: {
          id: "the-everlasting",
          name: "The Everlasting",
          minStat: 1,
          notes: "When resting, treat the effects of the rest taken as the next level (I.E.: Quick Rests > Short Rests, Short Rests > Long Rests)",
        },
        tier5: {
          id: "indomitable-spirit",
          name: "Indomitable Spirit",
          minStat: 5,
          notes: "You now have 1 additional use of Like Hitting a Wall and Unending Stamina, and the fortitude rolls of Still Standing now only begin at the start of your next turn after activating it.",
        },
      },
      "The Resilient": {
        tier1: {
          id: "the-resilient",
          name: "The Resilient",
          minStat: 1,
          notes: "When you successfully block an attack, you can reduce the damage by 1d10. (2/Encounter)",
        },
        tier5: {
          id: "if-its-only-pain",
          name: "If It's Only Pain...",
          minStat: 5,
          notes: "When you you are subject to a status effect like Stun, Poisoned, etc, you can decide to not be affected. (2/Day)",
        },
      },
    },
  },
  speedster: {
    label: "Speedster",
    scaleStat: "Speed",
    permanentAptitudes: [
      "Choose 1 permanent aptitude from Speed",
      "Choose 1 permanent aptitude from Power",
    ],
    startingEquipment: [
      "Running Gear (Legs): +1 Tempo, +1 Acrobatics, and +5 to movement speed.",
      "Switchblade (Weapon): A sleek black blade that you can unfold in a moments notice. 1d6 + SL+ Bleed."
    ],
    sharedAbilities: [
      {
        tier: 2,
        id: "heightened-senses",
        name: "Heightened Senses",
        minStat: 2,
        notes: "When rolling a Perception, Acrobatics or Athletics check (other than for training), you may add a bonus equal to your SL to the check. (3/Day)",
      },
      {
        tier: 3,
        id: "lightning-reflexes",
        name: "Lightning Reflexes",
        minStat: 3,
        notes: "As a bonus action, you can grant yourself advantage on one check made with your Speed (outside of training). (2/Encounter)",
      },
      {
        tier: 4,
        id: "speeding-bullet",
        name: "Speeding Bullet",
        minStat: 4,
        notes: "When you damage a creature with a melee attack after moving for at least 30 feet in a straight line, you can add your SL to the damage.",
      },
    ],
    subclassAbilities: {
      "The Distance Runner": {
        tier1: {
          id: "the-distance-runner",
          name: "The Distance Runner",
          minStat: 1,
          notes: "Everytime you use up all your movement speed by not moving back and forth (if possible, you must be at least 30 ft. away from your starting position this turn), gain an extra +5 ft. movement speed. At the end of combat, return your speed to normal. Can only be stacked 5 times (for a total of 25 ft.).",
        },
        tier5: {
          id: "built-up-speed",
          name: "Built-Up Speed",
          minStat: 5,
          notes: "You now gain +10 movement speed from Distance Runner. At the start of your turn, you may remove 20 FT from your movement speed that you gained from Distance Runner to do an extra 3d6 of damage on your next damage roll (1/turn).",
        },
      },
      "The Bolt": {
        tier1: {
          id: "the-bolt",
          name: "The Bolt",
          minStat: 1,
          notes: "Twice per day, you may Dash as a bonus action.",
        },
        tier5: {
          id: "turn-up-the-volume",
          name: "Turn Up the Volume",
          minStat: 5,
          notes: "If you fail a dodge roll, on your next turn, gain advantage on rolls to hit, damage rolls, and the next time you fail a dodge roll you take full damage not 1.5 times. Twice per encounter, failing two dodge rolls turns your next attack into a Pseudo Sure Hit (ala New Shadow Style) as well.",
        },
      },
    },
  },
  mastermind: {
    label: "Mastermind",
    scaleStat: "Cooperation",
    permanentAptitudes: [
      "Choose 2 permanent aptitudes from Cooperation",
    ],
    startingEquipment: [
      "A Token From The Past: When rolling for any check, reroll the lowest dice. This property recharges with a successful deception roll. (3/day)",
      "Notebook: You can write your dastardly plans down giving you +1 to general education and jujutsu education."
    ],
    sharedAbilities: [
      {
        tier: 2,
        id: "tomfoolery",
        name: "Tomfoolery",
        minStat: 2,
        notes: "When rolling for deception, if your target does not have any sort of heightened senses (I.e, Non-Jujutsu Sorcerers and simple minded Shikigami/Curses (I.E.: 3 and below IL, to DM’s discretion)), all your deception checks are made at advantage against the creature.",
      },
      {
        tier: 3,
        id: "pulling-strings",
        name: "Pulling Strings",
        minStat: 3,
        notes: "When you or a creature within 45 feet of you gets attacked, you may use your reaction to taunt an enemy, reducing their damage roll by your CL + 3. (CL/Encounter)",
      },
      {
        tier: 4,
        id: "know-their-core",
        name: "Know Their Core",
        minStat: 4,
        notes: "Once every week, you may choose one creature you have met at least once. You can gain 1 important insight into the creatures inner thought, if they have any, to the DM’s discretion. When you obtain this insight, you can use this fact to your advantage.",
      },
    ],
    subclassAbilities: {
      "The Trickster": {
        tier1: {
          id: "the-trickster",
          name: "The Trickster",
          minStat: 1,
          notes: "When you use deception to try and activate a Sneak Attack, grant yourself advantage on the roll. (1/Encounter)",
        },
        tier5: {
          id: "killers-mischief",
          name: "Killer's Mischief",
          minStat: 5,
          notes: "When you successfully hit a Sneak Attack, you may add (CL/2, rounded down) to all rolls until the end of your first action on the next turn. If you sneak attack once more on said action, you may chain this effect indefinitely until you don’t. (1/Encounter)",
        },
      },
      "The Manipulator": {
        tier1: {
          id: "the-manipulator",
          name: "The Manipulator",
          minStat: 1,
          notes: "When rolling persuasion, charisma or intimidation (other than for training), you may add a bonus equal to your Intelligence Level.",
        },
        tier5: {
          id: "die-for-me-please",
          name: "Die For Me, Please?",
          minStat: 5,
          notes: "As an action, you may perform a persuasion check of (CLx3+2) and target one creature within 60 feet of you to demoralize. Then, roll CLd6+3. Until the end of the combat, you may take the result from that roll and treat it as a pool, subtracting as much as you want from their rolls to hit until it runs out. (1/Day)",
        },
      },
    },
  },
  swordsman: {
    label: "Swordsman",
    scaleStat: "Technique",
    permanentAptitudes: [
      "Choose 1 permanent aptitude from Technique",
      "Choose 1 permanent aptitude from Power",
    ],
    startingEquipment: [
      "Katana (Weapon): A nice (if simple) standard katana. deals 2d6 + TL damage.",
      "Sword Polish: At the start of the day, you may polish your sword. After being applied, the first attack of the day with it gets a +1 to hit. (5 uses)"
    ],
    sharedAbilities: [
      {
        tier: 2,
        id: "quick-stroke",
        name: "Quick Stroke",
        minStat: 2,
        notes: "When you enter combat with your weapon in hand, you gain advantage on the initiative roll.",
      },
      {
        tier: 3,
        id: "edger",
        name: "Edger",
        minStat: 3,
        notes: "When you successfully block or dodge an attack, the attacker takes 1d4 unreactable and unmitigatable damage.",
      },
      {
        tier: 4,
        id: "double-stroke",
        name: "Double Stroke",
        minStat: 4,
        notes: "After hitting a creature with a melee weapon attack, you may attack them with it one more time (this second attack cannot be imbued). (2/Day)",
      },
    ],
    subclassAbilities: {
      "The Lazy": {
        tier1: {
          id: "the-lazy",
          name: "The Lazy",
          minStat: 1,
          notes: "When rolling for damage with a melee weapon, you may instead choose to deal the average damage of the weapon twice in a row. (2/day)",
        },
        tier5: {
          id: "rushing-the-end",
          name: "Rushing the End",
          minStat: 5,
          notes: "In combat, at the start of your fourth turn, you gain a +2 to all rolls to hit and damage. This ends after 3 turns, and triggers again after 4 more.",
        },
      },
      "The Upstart": {
        tier1: {
          id: "the-upstart",
          name: "The Upstart",
          minStat: 1,
          notes: "Choose one substat from the Intelligence Stat. You now have a permanent aptitude in said substat.",
        },
        tier5: {
          id: "rise-to-the-challenge",
          name: "Rise to the Challenge",
          minStat: 5,
          notes: "When entering a fight with a target who has higher stats than you, you may freely add the difference in stat total to your stats (max 2 per stat). Lasts for one turn, then grants exhaustion for one turn. When someone has the same stats as you, increase a stat of your choice by 1 point for 1 turn. This version does not grant exhaustion.",
        },
      },
    },
  },
  shaman: {
    label: "Shaman",
    scaleStat: "Intelligence",
    permanentAptitudes: [
      "Choose 1 permanent aptitude from Intelligence",
      "Choose 1 permanent aptitude from Cooperation",
    ],
    startingEquipment: [
      "First Aid Kit: Heals 1d12+IL+Med Ed (2 Uses)",
      "Cigarettes: As a bonus action, you can light and hit a cig, regain 4 CE. You must roll fortitude (DC 10) for the first 4 uses. If you fail, take 1d4 damage. (10 uses)"
    ],
    sharedAbilities: [
      {
        tier: 2,
        id: "better-support",
        name: "Better Support",
        minStat: 2,
        notes: "When attempting to use a healing item in combat, you can choose to do so as a bonus action, instead of an action. (3/Day)",
      },
      {
        tier: 3,
        id: "watch-it",
        name: "Watch It!",
        minStat: 3,
        notes: "When an ally within view fails a dice roll, you can use a reaction to force a reroll, using the new result. Furthermore, you may instead force an enemy to reroll even if they succeeded on the roll, consuming 2 uses of this ability. (2/Day)",
      },
      {
        tier: 4,
        id: "battle-medic",
        name: "Battle Medic",
        minStat: 4,
        notes: "When making any non-RCT healing rolls, you may add +1 of the highest dice in the roll. Furthermore, once per day, you may also forgo a roll to heal, instead taking the maximum amount.",
      },
    ],
    subclassAbilities: {
      "The Physician": {
        tier1: {
          id: "the-physician",
          name: "The Physician",
          minStat: 1,
          notes: "As a bonus action, you can give 1 ally within 60 feet of you a bonus d6 on their next check (using this skill prohibits black flash). (3/Day)",
        },
        tier5: {
          id: "surgical-precision",
          name: "Surgical Precision",
          minStat: 5,
          notes: "+1 use of Watch It!. When using Watch It!, you also gain the ability to add or subtract up to two times your intelligence level as a pool of points that refreshes weekly. (I.E.: add or subtract up to ILx2 points from the reroll).",
        },
      },
      "The Mystic": {
        tier1: {
          id: "the-mystic",
          name: "The Mystic",
          minStat: 1,
          notes: "When attempting to learn Reverse Cursed Technique related skills, you may treat the mission amount/grade level as one less then it is. (I.E. RCT is two grade 2s, improved RCT is a grade 3, etc.)",
        },
        tier5: {
          id: "positive-savant",
          name: "Positive Savant",
          minStat: 5,
          notes: "Automatically gain the Non-Self Targeting RCT skill. If you already had it or gain it later, you can now use it at half cost 3 times a day and use self-targeting for no cost twice a day.",
        },
      },
    },
  },
  prodigy: {
    label: "Prodigy",
    scaleStat: "Technique",
    permanentAptitudes: [
      "Choose 1 permanent aptitude from Technique",
      "Choose 1 permanent aptitude from Cooperation",
    ],
    startingEquipment: [
      "Sentimental Possession: It allows you to gain advantage to a CT based roll. But once you’ve used it, the item loses its power and it takes a week to be recharged. (1/week)",
      "Potential: Once in the campaign, you may succeed one check with the minimum needed to do so (does not take up an item slot)."
    ],
    sharedAbilities: [
      {
        tier: 2,
        id: "pure-instincts",
        name: "Pure Instincts",
        minStat: 2,
        notes: "When rolling a check in which you don’t have Aptitude, treat that roll as if you had it (outside of training). (4/Day)",
      },
      {
        tier: 3,
        id: "easy-as-breathing",
        name: "Easy as Breathing",
        minStat: 3,
        notes: "Your crit range regarding CE/CT activations (excluding training) is now permanently reduced by TL. If you hit a “true crit” (I.E. TLx6), then you may make the skill’s cost 0, as opposed to reduced by -2. (2/Day)",
      },
      {
        tier: 4,
        id: "potential-of-the-honered-one",
        name: "Potential of the Honered One",
        minStat: 4,
        notes: "Choose one of the categories in the Jujutsu Skill Legend Table (other than Black Flash). Those Jujutsu Skills take missions of 1 grade lower to learn.",
      },
    ],
    subclassAbilities: {
      "The Divine": {
        tier1: {
          id: "the-divine",
          name: "The Divine",
          minStat: 1,
          notes: "When rolling a check for an action you have not performed before in the day (excluding imbue/output), you may do so at advantage. (1/Day)",
        },
        tier5: {
          id: "eye-of-the-heavens",
          name: "Eye of the Heavens",
          minStat: 5,
          notes: "When activating Philosophy of a Sorcerer, gain 20 Temp CE, +TL to any CE/CT activation rolls and +1d8 damage for 2 rounds.",
        },
      },
      "The Damned": {
        tier1: {
          id: "the-damned",
          name: "The Damned",
          minStat: 1,
          notes: "When an ally does a roll of any type, you may grant them a bonus of anywhere between 1 and your TL, on the condition that your next roll of the same type has that bonus as a penalty instead. (TL/Encounter)",
        },
        tier5: {
          id: "beast-of-burden",
          name: "Beast of Burden",
          minStat: 5,
          notes: "When activating this skill, gain an extra action for every party member at or under 0 HP, lasting until your party members are back at 1 or more HP (losing an action for everyone who has met this requirement) or until 3 rounds elapse. (1/day)",
        },
      },
    },
  },
  rebel: {
    label: "Rebel",
    scaleStat: "Power",
    permanentAptitudes: [
      "Choose 1 permanent aptitude from Power",
      "Choose 1 permanent aptitude from Speed",
    ],
    startingEquipment: [
      "Hammer/Sledge Hammer (Weapon): 2d6 + PL, blunt.",
      "Punk Boots (Feet): +5 feet of movement"
    ],
    sharedAbilities: [
      {
        tier: 2,
        id: "one-man-team",
        name: "One Man Team",
        minStat: 2,
        notes: "When attacking a foe that has not been hit by anyone else, you may roll to hit with advantage. Only activates on your first attack against them, but can be re-triggered on any other enemies that meet the condition.",
      },
      {
        tier: 3,
        id: "will-of-the-one",
        name: "Will of the One",
        minStat: 3,
        notes: "Once combat starts select one currently active opponent. Until either of you is taken out, reduce any damage taken from them by 1d6. Should they be incapacitated, you may select another target for this effect.",
      },
      {
        tier: 4,
        id: "higher-than-all",
        name: "Higher Than All",
        minStat: 4,
        notes: "At the start of an encounter, select any target and perform a contest of your intimidation and their charisma. If you win, you and this target now swap places in the initiative order, “stealing” their place.",
      },
    ],
    subclassAbilities: {
      "The Revolutionary": {
        tier1: {
          id: "the-revolutionary",
          name: "The Revolutionary",
          minStat: 1,
          notes: "Thrice per week, you may use your intimidation to roll for cooperation checks to the same effect (I.E. Characters will be wooed, not frightened).",
        },
        tier5: {
          id: "stoke-the-flame",
          name: "Stoke the Flame",
          minStat: 5,
          notes: "Once per week, you may use your action to scream and call to action for all of your allies in a 25 ft. range. For 3 turns, all allies that could hear you gain one extra action. After the 3 turns, all affected must skip their turn due to exhaustion.",
        },
      },
      "The Black Sheep": {
        tier1: {
          id: "the-black-sheep",
          name: "The Black Sheep",
          minStat: 1,
          notes: "When creating/training new CT abilities by yourself, roll with advantage.",
        },
        tier5: {
          id: "versus-the-world",
          name: "Versus the World",
          minStat: 5,
          notes: "When entering combat outnumbered, then you can choose the number difference of members as “challengers”. When attacking a target, gain + 2 to all rolls to hit and reduce your black flash range by -1.",
        },
      },
    },
  },
  confidant: {
    label: "Confidant",
    scaleStat: "Cooperation",
    permanentAptitudes: [
      "Choose 1 permanent aptitude from Cooperation",
      "Choose 1 permanent aptitude from Power",
    ],
    startingEquipment: [
      "Hero/Business Suit (Body): This high class or heroic suit grants you +1 AC and +1 Fortitude.",
      "Professional Glasses (Accessory): These fashionable glasses give +2 Insight."
    ],
    sharedAbilities: [
      {
        tier: 2,
        id: "natural-charisma",
        name: "Natural Charisma",
        minStat: 2,
        notes: "Add up to a + 2 to any cooperation roll other than training rolls for the stat. (3/Day, 1/Roll)",
      },
      {
        tier: 3,
        id: "social-link",
        name: "Social Link",
        minStat: 3,
        notes: "When performing a combo with an ally, you may add  or subtract up to +2 to their combo checks. (3/Day)",
      },
      {
        tier: 4,
        id: "strength-by-bonds",
        name: "Strength by Bonds",
        minStat: 4,
        notes: "When you fail a check other than training, you may give yourself a bonus equal to twice the amount of allies that are within 60 feet of you. (Minimum of +2, Maximum of CLx2, CL/day)",
      },
    ],
    subclassAbilities: {
      "The Comedian": {
        tier1: {
          id: "the-comedian",
          name: "The Comedian",
          minStat: 1,
          notes: "If a creature is about to roll at disadvantage, you may choose to remove that disadvantage and have them roll normally. (1/day)",
        },
        tier5: {
          id: "never-ending-show",
          name: "Never Ending Show",
          minStat: 5,
          notes: "By telling a joke (succeeding on a charisma roll and telling an actual joke) you may add your CL to a creature’s roll. Doing this will also force 1 enemy within 10 ft. of the user to target them. (2/day)",
        },
      },
      "The Mentor": {
        tier1: {
          id: "the-mentor",
          name: "The Mentor",
          minStat: 1,
          notes: "When attacking a creature, the next ally to attack it on the same turn deals +2 damage with their first attack against it. (CL/encounter)",
        },
        tier5: {
          id: "be-the-standard",
          name: "Be the Standard",
          minStat: 5,
          notes: "When attacking a creature, the next ally to attack it on the same turn deals +2 damage with their first attack against it. (CL/encounter)",
        },
      },
    },
  },
  thrill_seeker: {
    label: "Thrill Seeker",
    scaleStat: "Cooperation",
    permanentAptitudes: [
      "Choose 1 permanent aptitude from Cooperation",
      "Choose 1 permanent aptitude from Speed",
    ],
    startingEquipment: [
      "Lucky Dice: You may add 1d6 to any roll you make of your choice (excluding a black flash or training), but to recharge it you have to roll -1d6 on a roll of your choice twice. (3/day)",
      "Skateboard: You can use this as a vehicle. It gives you an extra 10 FT of movement speed when you ride on it. Can’t be used on rough/unstable terrain."
    ],
    sharedAbilities: [
      {
        tier: 2,
        id: "lucky-7",
        name: "Lucky 7",
        minStat: 2,
        notes: "After making a roll, you may choose to add +1 to it per every die whose result was a 6. The +1 (s) do not affect training or imbue/output rolls. (CL+2 uses, refreshes before and after combat)",
      },
      {
        tier: 3,
        id: "restless-thrill",
        name: "Restless Thrill",
        minStat: 3,
        notes: "Before you roll, you may attempt to call the result. If the number you called is within a range of 2 numbers of the result, then your result is changed to the number you called (May make your roll worse!). (Counts as a roll modifier I.E. Cannot be used to Black Flash.) (3/day)",
      },
      {
        tier: 4,
        id: "double-or-nothing",
        name: "Double or Nothing",
        minStat: 4,
        notes: "When you make a d6 roll, you can choose any number of 2,3,4 and 5 die results and reroll them. When rerolled this way, any result of 3 or lower becomes a 1, and any roll of 4 or higher becomes a 6. You cannot Black Flash if you use this skill. (2/Day)",
      },
    ],
    subclassAbilities: {
      "The Easygoing": {
        tier1: {
          id: "the-easygoing",
          name: "The Easygoing",
          minStat: 1,
          notes: "At the start of your turn, you may choose to instead skip it. Then, during your next turn, make all rolls other than imbue/output at advantage. (2/day)",
        },
        tier5: {
          id: "getting-serious",
          name: "Getting Serious",
          minStat: 5,
          notes: "Once per day, you may choose to “get serious”, adding your Cooperation level to ALL of your rolls until the start of your next turn. The turn after, ALL of your rolls will have half your Cooperation level (rounded down) subtracted from them.",
        },
      },
      "The Gambler": {
        tier1: {
          id: "the-gambler",
          name: "The Gambler",
          minStat: 1,
          notes: "Lucky 7 now also gives a +1 whenever rolling any die’s max roll.",
        },
        tier5: {
          id: "jackpot",
          name: "Jackpot",
          minStat: 5,
          notes: "At the start of each day, you may roll CLxd6s (no bonuses can be added to this). In any roll except imbue and output, you may replace any of the dice on the original roll for one you rolled with JACKPOT.",
        },
      },
    },
  },
  tinkerer: {
    label: "Tinkerer",
    scaleStat: "Intelligence",
    permanentAptitudes: [
      "Choose 2 permanent aptitudes from Intelligence",
    ],
    startingEquipment: [
      "Tinker’s Kit: It gives you general tools used for tinkering (cannot be used as weapons) and they give you +2 to tech ed.",
      "Caffeine Patch: By putting this patch on, you surge with energy and can add another day of making cursed tools/cursed corpse/puppets by working through the night however in the morning you will have a level of exhaustion. (5 uses before you run out)"
    ],
    sharedAbilities: [
      {
        tier: 2,
        id: "incredible-mind",
        name: "Incredible Mind",
        minStat: 2,
        notes: "When rolling any intelligence check, you may add a +2 to the roll, this can only be done before you know if you failed the roll. (3/day)",
      },
      {
        tier: 3,
        id: "weapon-savant",
        name: "Weapon Savant",
        minStat: 3,
        notes: "When using a weapon you created, fixed or modified, add half your intelligence level (rounded down) as a bonus to hit.",
      },
      {
        tier: 4,
        id: "flash-of-genius",
        name: "",
        minStat: 4,
        notes: "For 1 hour, all intelligence rolls (other than training the stat) add your intelligence level to the rolls. (2/day)",
      },
    ],
    subclassAbilities: {
      "The Technician": {
        tier1: {
          id: "the-technician",
          name: "The Technician",
          minStat: 1,
          notes: "You may give yourself advantage on rolls that involve creating, fixing or modifying objects. (1/day)",
        },
        tier5: {
          id: "god-of-the-forge",
          name: "God of the Forge",
          minStat: 5,
          notes: "You can create a makeshift weapon in the middle of combat until its end, either by taking materials you have or found or by combining parts of other weapons to make a new one that will help you in this situation. (3/week) (Cannot be used with special grade cursed tools)",
        },
      },
      "The Engineer": {
        tier1: {
          id: "the-engineer",
          name: "The Engineer",
          minStat: 1,
          notes: "Attaching add-ons or reworks to cursed corpses takes 1 less day to do. (Cannot take less than 1 day)",
        },
        tier5: {
          id: "puppet-artificer",
          name: "Puppet Artificer",
          minStat: 5,
          notes: "You may now give your cursed corpses jujutsu skills. You can give the creation skills that are at a grade level equal to or below it’s grade level and you can only give them a number of skills equal to their IL. Giving a creation a jujutsu skill will add an extra 4 days ÷ grade level of the skill (rounded down) to the time it takes to build it (so a grade 2 skill would take 2 days).",
        },
      },
    },
  },
  toxicologist: {
    label: "Toxicologist",
    scaleStat: "Intelligence",
    permanentAptitudes: [
      "Choose 1 permanent aptitude from Intelligence",
      "Choose 1 permanent aptitude from Technique",
    ],
    startingEquipment: [
      "3 Mysterious Herbs: Consume or apply to discover the effects set by the DM (the herbs must have positive, negative and neutral effects, respectively).",
      "Poison Vial: You can use this to coat a weapon for 1 attack or poison someone with it. 2d4 damage with a Fortitude DC (ILx3). (5 uses)"
    ],
    sharedAbilities: [
      {
        tier: 2,
        id: "calculated-dose",
        name: "Calculated Dose",
        minStat: 2,
        notes: "When doing a sneak attack, opponents roll at disadvantage to resist your status conditions (2/Encounter). Once per day, roll medicine making checks with advantage.",
      },
      {
        tier: 3,
        id: "extended-procedure",
        name: "Extended Procedure",
        minStat: 3,
        notes: "Gain half your intelligence level (rounded down) as a bonus to hit targets who suffer from a status condition you afflicted them with. Gain your intelligence level when rolling to cure an ally’s status conditions.",
      },
      {
        tier: 4,
        id: "pick-their-poison",
        name: "Pick Their Poison",
        minStat: 4,
        notes: "When applying a status condition on a target, choose between increasing its saving throw DC by your intelligence level or increasing its damage over time by 1d6, even if it ordinarily dealt no damage. (1/Encounter)",
      },
    ],
    subclassAbilities: {
      "The Plague": {
        tier1: {
          id: "the-plague",
          name: "The Plague",
          minStat: 1,
          notes: "Allies who are suffering from a status condition applied by you cannot be statused by any other enemies.",
        },
        tier5: {
          id: "slow-and-painful",
          name: "Slow and Painful",
          minStat: 5,
          notes: "Any enemies who suffer from a status condition applied by you subtract half your intelligence level (rounded up) from all of their reaction rolls.",
        },
      },
      "The Herbalist": {
        tier1: {
          id: "the-herbalist",
          name: "The Herbalist",
          minStat: 1,
          notes: "Add your intelligence level to all healing rolls from items, even if it would be added more than once.",
        },
        tier5: {
          id: "angel-powder",
          name: "Angel Powder",
          minStat: 5,
          notes: "You can spend three training slots that work like training a CT to craft two Angel Powder, a medicine that heals 3d10 + Intelligence. Using it on someone more than once in a day will add one level of exhaustion per use.",
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

function buildCustomPermanentAptitudeRules(custom) {
  const picks = Array.isArray(custom?.permanentAptitudeStatPicks)
    ? custom.permanentAptitudeStatPicks.slice(0, 2).map(value => normalizeStatKey(value))
    : [];
  const validPicks = picks.filter(stat => STAT_KEYS.includes(stat));
  if (!validPicks.length) return ["Choose 1 permanent aptitude from Power", "Choose 1 permanent aptitude from Technique"];

  const counts = new Map();
  validPicks.forEach(stat => counts.set(stat, (counts.get(stat) || 0) + 1));
  return [...counts.entries()].map(([stat, count]) => {
    const noun = count === 1 ? "aptitude" : "aptitudes";
    return `Choose ${count} permanent ${noun} from ${toTitleCase(stat)}`;
  });
}

function getCustomRule(state) {
  ensureCustomArchetypeState(state);
  const custom = state?.customArchetype;
  if (!custom) return null;

  const subA = String(custom.subArchetypeA || "Custom A").trim() || "Custom A";
  const subB = String(custom.subArchetypeB || "Custom B").trim() || "Custom B";
  const generatedPermanentAptitudes = buildCustomPermanentAptitudeRules(custom);
  const abilities = custom.abilities || {};
  return {
    label: String(custom.name || "Custom Archetype"),
    scaleStat: normalizeStatKey(custom.scaleStat || "power"),
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
  return ARCHETYPE_RULES[archetypeKey] || null;
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

  if (!Array.isArray(state.archetypeProgress.unlockedAbilityIds)) {
    const legacyUnlocked = Array.isArray(state.archetypeGrantedAbilities)
      ? state.archetypeGrantedAbilities
        .filter(entry => entry?.unlocked)
        .map(entry => String(entry?.name || "").trim())
        .filter(Boolean)
      : [];
    state.archetypeProgress.unlockedAbilityIds = legacyUnlocked;
  }

  const knownIds = getKnownAbilityIdsForState(state);
  state.archetypeProgress.unlockedAbilityIds = state.archetypeProgress.unlockedAbilityIds
    .map(value => String(value || "").trim())
    .filter(value => knownIds.has(value));
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

function renderPermanentAptitudePicker(state) {
  const container = document.getElementById("archetypePermanentAptitudes");
  if (!container) return;

  if (!state.archetype) {
    container.innerHTML = '<div class="techniques-app-empty">Pick a primary archetype to configure permanent aptitude skills.</div>';
    return;
  }

  const rule = getArchetypeRule(state, state.archetype);
  if (!rule) {
    container.innerHTML = '<div class="techniques-app-empty">No permanent aptitude rule is defined for this archetype.</div>';
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

  container.innerHTML = slots.length
    ? `
      <div class="techniques-muted">Selections here immediately become Permanent Aptitudes on the main sheet and stay locked unless Override mode is enabled.</div>
      <div class="archetype-aptitude-picks">
        ${slots.map((slot, index) => {
          const entry = nextSelections[index];
          const isDuplicate = (seen.get(aptitudeSelectionSignature(entry)) || 0) > 1;
          const statOptions = slot.allowedStats
            .map(stat => `<option value="${stat}"${entry.statKey === stat ? " selected" : ""}>${toTitleCase(stat)}</option>`)
            .join("");
          const skills = SKILL_LABELS_BY_STAT[entry.statKey] || [];
          const skillOptions = skills
            .map((label, skillIndex) => `<option value="${skillIndex}"${entry.skillIndex === skillIndex ? " selected" : ""}>${label}</option>`)
            .join("");
          const selectedSkillLabel = skills[entry.skillIndex] || "Unknown";
          return `
            <div class="archetype-aptitude-row${isDuplicate ? " archetype-aptitude-row--warning" : ""}">
              <div class="archetype-aptitude-row-label">Pick ${index + 1}</div>
              <select class="meta-select" data-perm-apt-stat="${index}">${statOptions}</select>
              <select class="meta-select" data-perm-apt-skill="${index}">${skillOptions}</select>
              <div class="archetype-aptitude-preview">Selected: ${selectedSkillLabel}</div>
              <div class="techniques-muted">${slot.ruleText}</div>
              ${isDuplicate ? '<div class="archetype-aptitude-warning">Duplicate pick detected. Choose a different skill.</div>' : ""}
            </div>
          `;
        }).join("")}
      </div>
    `
    : '<div class="techniques-app-empty">This archetype has no permanent aptitude requirements.</div>';
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
    const rule = getArchetypeRule(state, archKey);
    const def = getAbilityDefinition(state, archKey, abilityId);
    const canRemove = def ? !hasHigherTierInSlots(new Set(unlocked), archKey, def.tier) : true;
    const descKey = `slot:${globalId}`;
    const isExpanded = _expandedAbilityDescriptions.has(descKey);

    cards.push(`
      <article class="archetype-slot-item">
        <button type="button" class="inventory-mini-btn inventory-icon-btn danger archetype-slot-trash" data-slot-remove="${globalId}" aria-label="Remove ability" title="Remove ability"${canRemove ? "" : " disabled"}>
          <svg class="inventory-icon-trash" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path fill="currentColor" d="M9 3h6a1 1 0 0 1 1 1v1h4v2h-1l-1 12a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 7H4V5h4V4a1 1 0 0 1 1-1Zm1 2v0h4V5h-4Zm-1 4h2v9H9V9Zm4 0h2v9h-2V9Z"/>
            <path fill="none" stroke="currentColor" stroke-width="1.5" d="M6 7.5h12"/>
          </svg>
        </button>
        <div class="archetype-slot-index">Slot ${i + 1}</div>
        <div class="archetype-slot-name">${def?.name || abilityId}</div>
        <div class="archetype-slot-meta">${rule?.label || toTitleCase(archKey)} · Tier ${def?.tier || "?"}</div>
        <button type="button" class="archetype-desc-toggle" data-slot-desc-toggle="${descKey}" aria-expanded="${isExpanded ? "true" : "false"}">
          <span class="archetype-desc-chevron">${isExpanded ? "▾" : "▸"}</span>
          <span>Description</span>
        </button>
        <div class="archetype-ability-notes${isExpanded ? " open" : ""}">${def?.notes || ""}</div>
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
  setTimeout(() => applyArchetypeStateToUI(), 0);
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
      renderAbilityTree(getState());
    });
  }

  const slotGrid = document.getElementById("archetypeAbilitySlots");
  if (slotGrid) {
    slotGrid.addEventListener("click", e => {
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
      renderAbilitySlots(getState());
    });
  }

  const aptitudePicker = document.getElementById("archetypePermanentAptitudes");
  if (aptitudePicker) {
    aptitudePicker.addEventListener("change", e => {
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
      if (!skillSelect) return;
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
      _collapsedArchetypeSections.benefits = !_collapsedArchetypeSections.benefits;
      syncArchetypeCollapseUI();
    });
  }

  const permanentAptitudesToggle = document.getElementById("archetypePermanentAptitudesToggleBtn");
  if (permanentAptitudesToggle) {
    permanentAptitudesToggle.addEventListener("click", () => {
      _collapsedArchetypeSections.permanentAptitudes = !_collapsedArchetypeSections.permanentAptitudes;
      syncArchetypeCollapseUI();
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
