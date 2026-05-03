// Data-only archetype rule definitions

export const ARCHETYPE_RULES = {
  acrobat: {
    label: "Acrobat",
    scaleStat: "speed",
    permanentAptitudeStatPicks: [
      "speed",
      "technique",
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
    permanentAptitudeStatPicks: [
      "power",
      "power",
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
    permanentAptitudeStatPicks: [
      "speed",
      "technique",
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
    permanentAptitudeStatPicks: [
      "technique",
      "intelligence",
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
    permanentAptitudeStatPicks: [
      "power",
      "cooperation",
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
    permanentAptitudeStatPicks: [
      "speed",
      "power",
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
    permanentAptitudeStatPicks: [
      "cooperation",
      "cooperation",
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
    permanentAptitudeStatPicks: [
      "technique",
      "power",
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
    permanentAptitudeStatPicks: [
      "intelligence",
      "cooperation",
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
    permanentAptitudeStatPicks: [
      "technique",
      "cooperation",
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
    permanentAptitudeStatPicks: [
      "power",
      "speed",
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
    permanentAptitudeStatPicks: [
      "cooperation",
      "power",
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
    permanentAptitudeStatPicks: [
      "cooperation",
      "speed",
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
    permanentAptitudeStatPicks: [
      "intelligence",
      "intelligence",
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
    permanentAptitudeStatPicks: [
      "intelligence",
      "technique",
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
