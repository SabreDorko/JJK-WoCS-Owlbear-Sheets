import martialArtsData from './data/martial-arts.json';
import weaponArtsData from './data/weapon-arts.json';
import {
  WEAPON_TYPE_LABELS,
  getWeaponDamageText,
  shouldDisplayWeaponRange,
  getWeaponReachInFeet,
  normalizeWeaponType,
} from "./weapons.js";
import { computeActiveModifierEffects } from "./modifiers.js";
import { getComputedSubskillValue } from "./character.js";

// ── HELPERS ───────────────────────────────────────────────────────────────────

function parseStatScore(rawValue) {
  const parsed = parseInt(rawValue, 10);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

function getEffectiveStatLevel(state, effects, statKey) {
  return parseStatScore(state?.stats?.[statKey]?.score) + (effects?.statBonuses?.[statKey] || 0);
}

function getSubskillValue(state, effects, statKey, skillIndex) {
  const skillState = state?.stats?.[statKey]?.skills?.[skillIndex] || {};
  const aptitude = parseInt(skillState.aptitude, 10) || 0;
  const aptitudeBonus = aptitude > 0 ? (parseInt(state?.aptitudeBonus, 10) || 2) : 0;
  const statSkillBonus = effects?.skillBonuses?.[statKey] || 0;
  const specificBonus = effects?.specificSkillBonuses?.[`${statKey}:${skillIndex}`] || 0;
  return aptitudeBonus + statSkillBonus + specificBonus;
}

function getBlackFlashRange(techniqueLevel) {
  if (!Number.isFinite(techniqueLevel) || techniqueLevel < 2 || techniqueLevel > 7) return null;
  return (techniqueLevel * 4) + 4;
}

function getActionsForGrade(grade) {
  if (grade === "Semi-1" || grade === "1" || grade === "Special Grade") return 2;
  return 1;
}

function getImbueDisplay(level) {
  const parsed = Math.max(1, Math.min(3, parseInt(level, 10) || 1));
  if (parsed === 1) return { level: 1, die: "1d4" };
  if (parsed === 2) return { level: 2, die: "1d4+2" };
  return { level: 3, die: "2d4" };
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

// ── COMPUTE ───────────────────────────────────────────────────────────────────

export function computeCombatTabData(state) {
  const effects = computeActiveModifierEffects(state);

  const techniqueLevel = getEffectiveStatLevel(state, effects, "technique");
  const blackFlashRange = getBlackFlashRange(techniqueLevel);
  const actions = getActionsForGrade(state?.grade);

  const tempoBonus = getComputedSubskillValue(state, "speed", 3);
  const combatBonus = getComputedSubskillValue(state, "power", 1);
  const precisionBonus = getComputedSubskillValue(state, "speed", 0);
  const powerLevel = getEffectiveStatLevel(state, effects, "power");
  const speedLevel = getEffectiveStatLevel(state, effects, "speed");
  const imbue = getImbueDisplay(state?.imbueLevel ?? 1);

  // Default unarmed attacks
    const unarmedAttacks = [
      {
        name: "Punch",
        type: "Unarmed",
        rangeText: "Melee",
        damageStr: `${powerLevel}d4 + ${powerLevel} (PL)`,
        hitStr: powerLevel > 0
          ? `${powerLevel}d6 +${combatBonus} (Combat)`
          : `—`,
        diceCount: powerLevel,
        bonus: combatBonus,
        statLabel: "Power",
        damageParts: [{ count: powerLevel || 1, die: "d4" }],
        damageBonus: powerLevel,
      },
      {
        name: "Kick",
        type: "Unarmed",
        rangeText: "Melee",
        damageStr: `${techniqueLevel}d4 + ${techniqueLevel} (TL)`,
        hitStr: techniqueLevel > 0
          ? `${powerLevel}d6 +${combatBonus} (Combat)`
          : `—`,
        diceCount: powerLevel,
        bonus: combatBonus,
        statLabel: "Power",
        damageParts: [{ count: techniqueLevel || 1, die: "d4" }],
        damageBonus: techniqueLevel,
      },
    ];

  const equippedSlots = state?.equippedSlots || {};
  const inventoryItems = state?.inventoryItems || [];
  const equippedWeapons = ['rightHand', 'leftHand']
    .map(slot => {
      const itemId = equippedSlots[slot];
      return inventoryItems.find(item => item.id === itemId && item.itemType === 'weapon');
    })
    .filter(Boolean);

  const martialArts = martialArtsData.filter(art => {
    const stat = art.statRequirement?.stat;
    const value = art.statRequirement?.value;
    if (!stat || value == null) return false;
    return getEffectiveStatLevel(state, effects, stat) >= value;
  });

  const weaponArts = weaponArtsData.filter(art => {
    const stat = art.statRequirement?.stat;
    const value = art.statRequirement?.value;
    const weaponType = art.weaponTypeRequirement;
    if (!stat || value == null || !weaponType) return false;
    const hasStat = getEffectiveStatLevel(state, effects, stat) >= value;
    const hasWeapon = equippedWeapons.some(w => w.weaponType === weaponType);
    return hasStat && hasWeapon;
  });

  return {
    actions,
    blackFlashRange: blackFlashRange ?? '—',
    tempoBonus,
    combatBonus,
    precisionBonus,
    powerLevel,
    speedLevel,
    imbue,
    unarmedAttacks,
    martialArts,
    weaponArts,
    equippedWeapons,
  };
}

// ── RENDER ────────────────────────────────────────────────────────────────────

export function renderCombatTabData(data) {
  const set = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.textContent = val ?? "—";
  };

  set("combatActionsValue", data.actions);
  set("combatBlackFlashValue", data.blackFlashRange);

  const initiativeStr = data.tempoBonus !== 0
    ? `${data.speedLevel}d6 ${data.tempoBonus > 0 ? "+" : ""}${data.tempoBonus}`
    : `${data.speedLevel}d6`;
  set("combatInitiativeValue", initiativeStr);

  const imbueDieEl = document.getElementById("combatImbueDie");
  const imbueInput = document.getElementById("combatImbueInput");
  if (imbueInput) imbueInput.value = data.imbue.level;
  if (imbueDieEl) imbueDieEl.textContent = data.imbue.die;

  const attacksEl = document.getElementById("combatAttacksList");
  if (attacksEl) {
    const unarmedRows = data.unarmedAttacks.map((a, i) => renderUnarmedRow(a, i, data)).join("");
    const weaponRows = data.equippedWeapons?.length
      ? data.equippedWeapons.map((w, i) => renderAttackRow(w, i, data)).join("")
      : "";
    attacksEl.innerHTML = unarmedRows + weaponRows
      || '<span class="combat-empty">No attacks available.</span>';
  }

  const martialArtsEl = document.getElementById("combatMartialArtsList");
  if (martialArtsEl) martialArtsEl.innerHTML = data.martialArts?.length
    ? data.martialArts.map(renderMartialArt).join("")
    : '<span class="combat-empty">No martial arts available.</span>';

  const weaponArtsEl = document.getElementById("combatWeaponArtsList");
  if (weaponArtsEl) weaponArtsEl.innerHTML = data.weaponArts?.length
    ? data.weaponArts.map(renderWeaponArt).join("")
    : '<span class="combat-empty">No weapon arts available.</span>';
}

function renderMartialArt(art) {
  return `
    <div class="combat-art-item">
      <strong>${escapeHtml(art.title)}</strong>
      <span>${escapeHtml(art.description)}</span>
      <em>Cooldown: ${art.cooldown} turn${art.cooldown === 1 ? '' : 's'} &nbsp;·&nbsp; Req: ${art.statRequirement.stat} ${art.statRequirement.value}</em>
    </div>`;
}

function renderWeaponArt(art) {
  return `
    <div class="combat-art-item">
      <strong>${escapeHtml(art.title)}</strong>
      <span>${escapeHtml(art.description)}</span>
      <em>Uses: ${art.usesPerEncounter} &nbsp;·&nbsp; Req: ${art.statRequirement.stat} ${art.statRequirement.value}, ${art.weaponTypeRequirement}</em>
    </div>`;
}

function renderUnarmedRow(attack, index) {
  const hitStr = attack.diceCount > 0 && attack.bonus !== 0
    ? `${attack.diceCount}d6 ${attack.bonus > 0 ? "+" : ""}${attack.bonus} (Combat)`
    : attack.diceCount > 0
    ? `${attack.diceCount}d6 (Combat)`
    : "—";

  return `
    <div class="combat-attack-row combat-attack-row--unarmed">
      <div class="combat-attack-name">${escapeHtml(attack.name)}</div>
      <div class="combat-attack-type">${escapeHtml(attack.type)}</div>
      <div class="combat-attack-range">${escapeHtml(attack.rangeText)}</div>
      <div class="combat-attack-damage combat-attack-rollable" data-action="rollUnarmedDamage" data-unarmed-index="${index}" title="Click to roll damage">${escapeHtml(attack.damageStr)}</div>
      <div class="combat-attack-hit combat-attack-rollable" data-action="rollUnarmedHit" data-unarmed-index="${index}" title="Click to roll to hit">${escapeHtml(hitStr)}</div>
    </div>`;
}

function renderAttackRow(weapon, index, data) {
  const isRanged = normalizeWeaponType(weapon.weaponType) === "ranged";
  const isPolearm = normalizeWeaponType(weapon.weaponType) === "polearm";
  const typeLabel = WEAPON_TYPE_LABELS[weapon.weaponType] ?? weapon.weaponType;
  const damage = getWeaponDamageText(weapon);

  let rangeText = "Melee";
  if (isPolearm) {
    const reach = getWeaponReachInFeet(weapon);
    rangeText = reach && reach > 5 ? `Reach (${reach} ft)` : "Reach";
  } else if (isRanged) {
    const reach = getWeaponReachInFeet(weapon);
    rangeText = reach ? `${reach} ft` : "Ranged";
  }

  const diceCount = isRanged ? data.speedLevel : data.powerLevel;
  const bonus = isRanged ? data.precisionBonus : data.combatBonus;
  const skillLabel = isRanged ? "Precision" : "Combat";
  const hitStr = bonus !== 0
    ? `${diceCount}d6 ${bonus > 0 ? "+" : ""}${bonus} (${skillLabel})`
    : `${diceCount}d6 (${skillLabel})`;

  return `
    <div class="combat-attack-row" data-weapon-index="${index}">
      <div class="combat-attack-name">${escapeHtml(weapon.name)}</div>
      <div class="combat-attack-type">${escapeHtml(typeLabel)}</div>
      <div class="combat-attack-range">${escapeHtml(rangeText)}</div>
      <div class="combat-attack-damage combat-attack-rollable" data-action="rollDamage" data-weapon-index="${index}" title="Click to roll damage">${escapeHtml(damage)}</div>
      <div class="combat-attack-hit combat-attack-rollable" data-action="rollHit" data-weapon-index="${index}" title="Click to roll to hit">${escapeHtml(hitStr)}</div>
    </div>`;
}

// ── INIT ──────────────────────────────────────────────────────────────────────

let _getState = null;
let _scheduleSave = null;
let _showRollToast = null;

export function initCombat({ getState, scheduleSave, showRollToast }) {
  _getState = getState;
  _scheduleSave = scheduleSave;
  _showRollToast = showRollToast;

  const imbueInput = document.getElementById("combatImbueInput");
  if (imbueInput) {
    imbueInput.addEventListener("change", () => {
      const state = _getState();
      if (!state) return;
      const val = Math.max(1, Math.min(3, parseInt(imbueInput.value, 10) || 1));
      state.imbueLevel = val;
      renderCombatTabData(computeCombatTabData(state));
      _scheduleSave();
    });
  }

  const panel = document.getElementById("panel-combat");
  if (panel) {
    panel.addEventListener("click", e => {
      const target = e.target.closest("[data-action]");
      if (!target) return;
      const action = target.dataset.action;

      const state = _getState();
      if (!state) return;
      const data = computeCombatTabData(state);

      if (action === "rollHit" || action === "rollDamage") {
        const weaponIndex = parseInt(target.dataset.weaponIndex, 10);
        if (!Number.isInteger(weaponIndex)) return;
        const weapon = data.equippedWeapons[weaponIndex];
        if (!weapon) return;
        if (action === "rollHit") rollHit(weapon, data);
        if (action === "rollDamage") rollDamage(weapon, data);
      }

      if (action === "rollUnarmedHit" || action === "rollUnarmedDamage") {
        const unarmedIndex = parseInt(target.dataset.unarmedIndex, 10);
        if (!Number.isInteger(unarmedIndex)) return;
        const attack = data.unarmedAttacks[unarmedIndex];
        if (!attack) return;
        if (action === "rollUnarmedHit") rollUnarmedHit(attack, data);
        if (action === "rollUnarmedDamage") rollUnarmedDamage(attack);
      }
    });
  }
}

function rollDice(count, sides) {
  return Array.from({ length: count }, () => Math.floor(Math.random() * sides) + 1);
}

function rollHit(weapon, data) {
  if (!_showRollToast) return;
  const isRanged = normalizeWeaponType(weapon.weaponType) === "ranged";
  const diceCount = isRanged ? data.speedLevel : data.powerLevel;
  const bonus = isRanged ? data.precisionBonus : data.combatBonus;
  const statLabel = isRanged ? "Speed" : "Power";
  const skillLabel = isRanged ? "Precision" : "Combat";

  if (!diceCount || diceCount < 1) return;
  const rolls = rollDice(diceCount, 6);
  const total = rolls.reduce((a, b) => a + b, 0) + bonus;
  const allOnes = rolls.every(r => r === 1);
  const critStatus = allOnes ? "fail" : total >= diceCount * 6 ? "success" : null;

  _showRollToast(
    statLabel,
    diceCount,
    rolls,
    total,
    critStatus,
    `${weapon.name} — ${skillLabel}`,
    { skillModifier: bonus },
    null,
  );
}

function rollDamage(weapon, data) {
  if (!_showRollToast) return;
  const parts = weapon.weaponDamageParts || [{ count: 1, die: "d6" }];

  let total = 0;
  const rollDetails = [];
  parts.forEach(part => {
    const sides = parseInt(String(part.die).replace("d", ""), 10) || 6;
    const rolls = rollDice(part.count, sides);
    const partTotal = rolls.reduce((a, b) => a + b, 0);
    total += partTotal;
    rollDetails.push(`${part.count}${part.die}: [${rolls.join(", ")}]`);
  });

  // Stat level bonus (Power or Speed level as flat damage bonus)
  const isRanged = normalizeWeaponType(weapon.weaponType) === "ranged";
  const statBonus = isRanged ? data.speedLevel : data.powerLevel;
  total += statBonus;

  _showRollToast(
    "Damage",
    0,
    [],
    total,
    null,
    `${weapon.name} — ${rollDetails.join(" + ")} + ${statBonus}`,
    {},
    null,
  );
}

function rollUnarmedHit(attack, data) {
  if (!_showRollToast || !attack.diceCount || attack.diceCount < 1) return;
  const rolls = rollDice(attack.diceCount, 6);
  const total = rolls.reduce((a, b) => a + b, 0) + attack.bonus;
  const allOnes = rolls.every(r => r === 1);
  const critStatus = allOnes ? "fail" : total >= attack.diceCount * 6 ? "success" : null;
  _showRollToast(
    "Power",
    attack.diceCount,
    rolls,
    total,
    critStatus,
    `${attack.name} — Combat`,
    { skillModifier: attack.bonus },
    null,
  );
}

function rollUnarmedDamage(attack) {
  if (!_showRollToast) return;
  const count = attack.damageParts[0]?.count || 1;
  const rolls = rollDice(count, 4);
  const total = rolls.reduce((a, b) => a + b, 0) + attack.damageBonus;
  _showRollToast(
    "Damage",
    0,
    [],
    total,
    null,
    `${attack.name} — ${count}d4 [${rolls.join(", ")}] + ${attack.damageBonus}`,
    {},
    null,
  );
}