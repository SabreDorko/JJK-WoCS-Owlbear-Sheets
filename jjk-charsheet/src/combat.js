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
        damageStr: `1d4 + ${powerLevel}`,
        hitStr: powerLevel > 0
          ? `${powerLevel}d6 +${combatBonus}`
          : `—`,
        diceCount: powerLevel,
        bonus: combatBonus,
        statLabel: "Power",
        damageParts: [{ count: 1, die: "d4" }],
        damageBonus: powerLevel,
      },
      {
        name: "Kick",
        type: "Unarmed",
        rangeText: "Melee",
        damageStr: `1d4 + ${techniqueLevel}`,
        hitStr: techniqueLevel > 0
          ? `${powerLevel}d6 +${combatBonus}`
          : `—`,
        diceCount: powerLevel,
        bonus: combatBonus,
        statLabel: "Technique",
        damageParts: [{ count: 1, die: "d4" }],
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

  // Support for single, any, or all stat requirements
  function checkStatRequirement(requirement) {
    if (!requirement) return false;
    // Legacy: single stat
    if (requirement.stat && typeof requirement.value === 'number') {
      return getEffectiveStatLevel(state, effects, requirement.stat) >= requirement.value;
    }
    // New: any/all mode
    if (requirement.mode === 'any' && Array.isArray(requirement.requirements)) {
      return requirement.requirements.some(req => checkStatRequirement(req));
    }
    if (requirement.mode === 'all' && Array.isArray(requirement.requirements)) {
      return requirement.requirements.every(req => checkStatRequirement(req));
    }
    return false;
  }

  const martialArts = martialArtsData.filter(art => checkStatRequirement(art.statRequirement));

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
    techniqueLevel,
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
  const initiativeEl = document.getElementById("combatInitiativeValue");
  if (initiativeEl) {
    initiativeEl.textContent = initiativeStr;
    initiativeEl.style.cursor = "pointer";
    initiativeEl.title = "Click to roll initiative";
    initiativeEl.onclick = () => rollInitiative(data);
  }

  const imbueDieEl = document.getElementById("combatImbueDie");
  const imbueInput = document.getElementById("combatImbueInput");
  if (imbueInput) imbueInput.value = data.imbue.level;
  if (imbueDieEl) imbueDieEl.textContent = data.imbue.die;

  // Strikes (unarmed)
  const strikesEl = document.getElementById("combatStrikesList");
  if (strikesEl) {
    strikesEl.innerHTML = data.unarmedAttacks.map((a, i) => renderUnarmedRow(a, i)).join("");
  }

  // Weapons
  const attacksEl = document.getElementById("combatAttacksList");
  if (attacksEl) {
    attacksEl.innerHTML = data.equippedWeapons?.length
      ? data.equippedWeapons.map((w, i) => renderAttackRow(w, i, data)).join("")
      : '<span class="combat-empty">No weapons equipped.</span>';
  }

  // Arts — apply search filters
  filterAndRenderArts(data);
}

function filterAndRenderArts(data) {
  const martialSearch = document.getElementById("combatMartialArtsSearch")?.value.toLowerCase() || "";
  const weaponSearch = document.getElementById("combatWeaponArtsSearch")?.value.toLowerCase() || "";

  const filteredMartial = data.martialArts.filter(art =>
    !martialSearch || art.title.toLowerCase().includes(martialSearch) || art.description.toLowerCase().includes(martialSearch)
  );
  const filteredWeapon = data.weaponArts.filter(art =>
    !weaponSearch || art.title.toLowerCase().includes(weaponSearch) || art.description.toLowerCase().includes(weaponSearch)
  );

  const martialArtsEl = document.getElementById("combatMartialArtsList");
  if (martialArtsEl) martialArtsEl.innerHTML = filteredMartial.length
    ? filteredMartial.map(renderMartialArt).join("")
    : '<span class="combat-empty">No martial arts available.</span>';

  const weaponArtsEl = document.getElementById("combatWeaponArtsList");
  if (weaponArtsEl) weaponArtsEl.innerHTML = filteredWeapon.length
    ? filteredWeapon.map(renderWeaponArt).join("")
    : '<span class="combat-empty">No weapon arts available.</span>';
}

function renderMartialArt(art) {
  const cooldownText = art.cooldown === 0 ? 'No Cooldown' : `Cooldown: ${art.cooldown} turn${art.cooldown === 1 ? '' : 's'}`;
  const reqText = (art.statRequirement.value && art.statRequirement.value !== 0)
    ? `Req: ${art.statRequirement.stat} ${art.statRequirement.value}`
    : '';
  return `
    <div class="combat-art-item">
      <strong>${escapeHtml(art.title)}</strong>
      <span>${escapeHtml(art.description)}</span>
      <em>${cooldownText}${reqText ? ' &nbsp;·&nbsp; ' + reqText : ''}</em>
    </div>`;
}

function renderWeaponArt(art) {
  const usesText = `Uses: ${art.usesPerEncounter}`;
  const reqText = (art.statRequirement.value && art.statRequirement.value !== 0)
    ? `Req: ${art.statRequirement.stat} ${art.statRequirement.value}, ${art.weaponTypeRequirement}`
    : `Req: ${art.weaponTypeRequirement}`;
  const cooldownText = art.cooldown === 0 ? 'No Cooldown' : (art.cooldown ? `Cooldown: ${art.cooldown} turn${art.cooldown === 1 ? '' : 's'}` : '');
  return `
    <div class="combat-art-item">
      <strong>${escapeHtml(art.title)}</strong>
      <span>${escapeHtml(art.description)}</span>
      <em>${usesText} &nbsp;·&nbsp; ${reqText}${cooldownText ? ' &nbsp;·&nbsp; ' + cooldownText : ''}</em>
    </div>`;
}

function renderUnarmedRow(attack, index) {
  const hitStr = attack.diceCount > 0 && attack.bonus !== 0
    ? `${attack.diceCount}d6 ${attack.bonus > 0 ? "+" : ""}${attack.bonus}`
    : attack.diceCount > 0 ? `${attack.diceCount}d6` : "—";

  return `
    <div class="combat-attack-row combat-attack-row--unarmed">
      <div class="combat-attack-name">${escapeHtml(attack.name)}</div>
      <div class="combat-attack-type">${escapeHtml(attack.type)}</div>
      <div class="combat-attack-range">${escapeHtml(attack.rangeText)}</div>
      <div class="combat-attack-hit combat-attack-rollable" data-action="rollUnarmedHit" data-unarmed-index="${index}" title="Click to roll to hit">${escapeHtml(hitStr)}</div>
      <div class="combat-attack-damage combat-attack-rollable" data-action="rollUnarmedDamage" data-unarmed-index="${index}" title="Click to roll damage">${escapeHtml(attack.damageStr)}</div>
    </div>`;
}

function renderAttackRow(weapon, index, data) {
  const isRanged = normalizeWeaponType(weapon.weaponType) === "ranged";
  const isPolearm = normalizeWeaponType(weapon.weaponType) === "polearm";
  const typeLabel = WEAPON_TYPE_LABELS[weapon.weaponType] ?? weapon.weaponType;

  let statKey = weapon.weaponStat || "power";
  let statLevel = statKey === "speed" ? data.speedLevel : statKey === "technique" ? (data.techniqueLevel || 0) : data.powerLevel;

  let damageStr = "";
  if (Array.isArray(weapon.weaponDamageParts) && weapon.weaponDamageParts.length > 0) {
    damageStr = weapon.weaponDamageParts.map(p => `${p.count}${p.die}`).join(" + ");
    if (statLevel) damageStr += ` + ${statLevel}`;
  } else {
    damageStr = statLevel ? `+${statLevel}` : "—";
  }

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
  const hitStr = bonus !== 0
    ? `${diceCount}d6 ${bonus > 0 ? "+" : ""}${bonus}`
    : `${diceCount}d6`;

  const descLine = weapon.description
    ? `<div class="combat-attack-desc">${escapeHtml(weapon.description)}</div>`
    : "";

  return `
    <div class="combat-attack-row" data-weapon-index="${index}">
      <div class="combat-attack-name-wrap">
        <div class="combat-attack-name">${escapeHtml(weapon.name)}</div>
        ${descLine}
      </div>
      <div class="combat-attack-type">${escapeHtml(typeLabel)}</div>
      <div class="combat-attack-range">${escapeHtml(rangeText)}</div>
      <div class="combat-attack-hit combat-attack-rollable" data-action="rollHit" data-weapon-index="${index}" title="Click to roll to hit">${escapeHtml(hitStr)}</div>
      <div class="combat-attack-damage combat-attack-rollable" data-action="rollDamage" data-weapon-index="${index}" title="Click to roll damage">${escapeHtml(damageStr)}</div>
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

  // Collapse button
  const collapseBtn = document.getElementById("combatActionsCollapseBtn");
  const collapsePanel = document.getElementById("combatActionsPanel");
  if (collapseBtn && collapsePanel) {
    collapseBtn.addEventListener("click", () => {
      const isOpen = collapseBtn.getAttribute("aria-expanded") === "true";
      collapseBtn.setAttribute("aria-expanded", isOpen ? "false" : "true");
      collapsePanel.classList.toggle("collapsed", isOpen);
    });
  }

  // Arts tabs
  const artsTabs = document.querySelectorAll(".combat-arts-tab");
  artsTabs.forEach(tab => {
    tab.addEventListener("click", () => {
      artsTabs.forEach(t => t.classList.remove("active"));
      tab.classList.add("active");
      const target = tab.dataset.artsTab;
      document.getElementById("combatArtsTabPanelMartial").hidden = target !== "martial";
      document.getElementById("combatArtsTabPanelWeapon").hidden = target !== "weapon";
    });
  });

  // Search bars — re-filter on input without full re-render
  ["combatMartialArtsSearch", "combatWeaponArtsSearch"].forEach(id => {
    document.getElementById(id)?.addEventListener("input", () => {
      const state = _getState();
      if (!state) return;
      filterAndRenderArts(computeCombatTabData(state));
    });
  });

  // Roll delegation
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
        if (action === "rollUnarmedHit") rollUnarmedHit(attack);
        if (action === "rollUnarmedDamage") rollUnarmedDamage(attack);
      }
    });
  }
  
  // Sub-collapse buttons
  ["combatAttacksCollapseBtn", "combatBasicActionsCollapseBtn"].forEach(btnId => {
    const btn = document.getElementById(btnId);
    const panelId = btnId.replace("CollapseBtn", "Panel");
    const panel = document.getElementById(panelId);
    if (!btn || !panel) return;
    btn.addEventListener("click", () => {
      const isOpen = btn.getAttribute("aria-expanded") === "true";
      btn.setAttribute("aria-expanded", isOpen ? "false" : "true");
      panel.classList.toggle("collapsed", isOpen);
    });
  });
}
function rollDice(count, sides) {
  return Array.from({ length: count }, () => Math.floor(Math.random() * sides) + 1);
}

function rollInitiative(data) {
  if (!_showRollToast) return;
  const diceCount = data.speedLevel;
  if (!diceCount || diceCount < 1) return;
  const bonus = data.tempoBonus || 0;
  const rolls = rollDice(diceCount, 6);
  const total = rolls.reduce((a, b) => a + b, 0) + bonus;
  const allOnes = rolls.every(r => r === 1);
  const critStatus = allOnes ? "fail" : total >= diceCount * 6 ? "success" : null;
  _showRollToast(
    "Speed",
    diceCount,
    rolls,
    total,
    critStatus,
    "Initiative",
    { skillModifier: bonus },
    null,
  );
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
  const allRolls = [];
  const rollDetails = [];
  parts.forEach(part => {
    const sides = parseInt(String(part.die).replace("d", ""), 10) || 6;
    const rolls = rollDice(part.count, sides);
    allRolls.push(...rolls);
    const partTotal = rolls.reduce((a, b) => a + b, 0);
    total += partTotal;
    rollDetails.push(`${part.count}${part.die}: [${rolls.join(", ")}]`);
  });


  // Use weaponStat for stat bonus
  let statKey = weapon.weaponStat || "power";
  let statBonus = 0;
  if (statKey === "power") statBonus = data.powerLevel;
  else if (statKey === "speed") statBonus = data.speedLevel;
  else if (statKey === "technique") statBonus = data.techniqueLevel || 0;
  else statBonus = data.powerLevel; // fallback
  total += statBonus;

  _showRollToast(
    statKey.charAt(0).toUpperCase() + statKey.slice(1),
    weapon.weaponDamageParts[0]?.count || 1,
    allRolls,
    total,
    null,
    `${weapon.name} — Damage`,
    { skillModifier: statBonus, die: weapon.weaponDamageParts[0]?.die || "d6" },
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
    attack.statLabel,
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
  const die = attack.damageParts[0]?.die || "d4";
  const dieNum = Number(die.replace("d", "")) || 4;
  const rolls = rollDice(count, dieNum);
  const total = rolls.reduce((a, b) => a + b, 0) + attack.damageBonus;
  _showRollToast(
    attack.statLabel,
    count,
    rolls,
    total,
    null,
    `${attack.name} — Damage`,
    { skillModifier: attack.damageBonus, die },
    null
  );
}