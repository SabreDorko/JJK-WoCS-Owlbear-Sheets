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

  // Tempo: Speed skill index 3
  const tempoBonus = getSubskillValue(state, effects, "speed", 3);
  const initiative = tempoBonus >= 0 ? `+${tempoBonus}` : `${tempoBonus}`;

  // Combat (Power:1) and Precision (Speed:0) for hit rolls
  const combatBonus = getSubskillValue(state, effects, "power", 1);
  const precisionBonus = getSubskillValue(state, effects, "speed", 0);
  const powerLevel = getEffectiveStatLevel(state, effects, "power");
  const speedLevel = getEffectiveStatLevel(state, effects, "speed");

  // Imbue
  const imbue = getImbueDisplay(state?.imbueLevel ?? 1);

  // Equipped weapons
  const equippedSlots = state?.equippedSlots || {};
  const inventoryItems = state?.inventoryItems || [];
  const equippedWeapons = ['rightHand', 'leftHand']
    .map(slot => {
      const itemId = equippedSlots[slot];
      return inventoryItems.find(item => item.id === itemId && item.itemType === 'weapon');
    })
    .filter(Boolean);

  // Martial arts
  const martialArts = martialArtsData.filter(art => {
    const stat = art.statRequirement?.stat;
    const value = art.statRequirement?.value;
    if (!stat || value == null) return false;
    return getEffectiveStatLevel(state, effects, stat) >= value;
  });

  // Weapon arts
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
    initiative,
    combatBonus,
    precisionBonus,
    powerLevel,
    speedLevel,
    imbue,
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
  set("combatInitiativeValue", data.initiative);

  // Imbue
  const imbueLevelEl = document.getElementById("combatImbueLevel");
  const imbueDieEl = document.getElementById("combatImbueDie");
  const imbueInput = document.getElementById("combatImbueInput");
  if (imbueInput) imbueInput.value = data.imbue.level;
  if (imbueDieEl) imbueDieEl.textContent = data.imbue.die;

  const martialArtsEl = document.getElementById("combatMartialArtsList");
  if (martialArtsEl) martialArtsEl.innerHTML = data.martialArts?.length
    ? data.martialArts.map(renderMartialArt).join("")
    : '<span class="combat-empty">No martial arts available.</span>';

  const weaponArtsEl = document.getElementById("combatWeaponArtsList");
  if (weaponArtsEl) weaponArtsEl.innerHTML = data.weaponArts?.length
    ? data.weaponArts.map(renderWeaponArt).join("")
    : '<span class="combat-empty">No weapon arts available.</span>';

  const weaponsEl = document.getElementById("combatEquippedWeaponsList");
  if (weaponsEl) weaponsEl.innerHTML = data.equippedWeapons?.length
    ? data.equippedWeapons.map((w, i) => renderEquippedWeapon(w, i, data)).join("")
    : '<span class="combat-empty">No weapons equipped.</span>';
}

function renderMartialArt(art) {
  return `
    <div class="combat-art-item">
      <strong>${escapeHtml(art.title)}</strong>
      <span>${escapeHtml(art.description)}</span>
      <em>Uses: ${art.usesPerEncounter} &nbsp;·&nbsp; Req: ${art.statRequirement.stat} ${art.statRequirement.value}</em>
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

function renderEquippedWeapon(weapon, index, data) {
  const typeLabel = WEAPON_TYPE_LABELS[weapon.weaponType] ?? weapon.weaponType;
  const grip = weapon.weaponGrip === "twoHanded" ? "Two-Handed" : "One-Handed";
  const damage = getWeaponDamageText(weapon);
  const isRanged = normalizeWeaponType(weapon.weaponType) === "ranged";
  const hitBonus = isRanged ? data.precisionBonus : data.combatBonus;
  const hitStat = isRanged ? "Speed" : "Power";
  const diceCount = isRanged ? data.speedLevel : data.powerLevel;
  const hitBonusStr = hitBonus >= 0 ? `+${hitBonus}` : `${hitBonus}`;

  let reachLine = "";
  if (shouldDisplayWeaponRange(weapon)) {
    const reach = getWeaponReachInFeet(weapon);
    const label = isRanged ? "Range" : "Reach";
    if (reach != null) reachLine = `<span class="combat-weapon-stat">${label}: ${reach} ft</span>`;
  }

  return `
    <div class="combat-weapon-card" data-weapon-index="${index}">
      <div class="combat-weapon-header">
        <span class="combat-weapon-name">${escapeHtml(weapon.name)}</span>
        <span class="combat-weapon-type">${escapeHtml(typeLabel)} · ${escapeHtml(grip)}</span>
      </div>
      <div class="combat-weapon-stats">
        <span class="combat-weapon-stat">Damage: ${escapeHtml(damage)}</span>
        <span class="combat-weapon-stat">To Hit: ${hitBonusStr} (${diceCount}d6, ${hitStat})</span>
        ${reachLine}
      </div>
      <div class="combat-weapon-actions">
        <button type="button" class="combat-roll-btn" data-action="rollHit" data-weapon-index="${index}">Roll to Hit</button>
        <button type="button" class="combat-roll-btn" data-action="rollDamage" data-weapon-index="${index}">Roll Damage</button>
      </div>
      ${weapon.description ? `<div class="combat-weapon-desc">${escapeHtml(weapon.description)}</div>` : ""}
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

  // Imbue input
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

  // Roll buttons (delegated — weapons re-render so we use the panel)
  const panel = document.getElementById("panel-combat");
  if (panel) {
    panel.addEventListener("click", e => {
      const btn = e.target.closest("button[data-action]");
      if (!btn) return;
      const action = btn.dataset.action;
      const weaponIndex = parseInt(btn.dataset.weaponIndex, 10);
      if (!Number.isInteger(weaponIndex)) return;

      const state = _getState();
      if (!state) return;
      const data = computeCombatTabData(state);
      const weapon = data.equippedWeapons[weaponIndex];
      if (!weapon) return;

      if (action === "rollHit") rollHit(weapon, data);
      if (action === "rollDamage") rollDamage(weapon, data);
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