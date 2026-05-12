import martialArtsData from './data/martial-arts.json';
import weaponArtsData from './data/weapon-arts.json';
import {
  WEAPON_TYPE_LABELS,
  getWeaponDamageText,
  shouldDisplayWeaponRange,
  getWeaponReachInFeet,
  normalizeWeaponType,
} from "./weapons.js";
import { computeActiveModifierEffects, getCombatAttackModifiers, getCombatAttackBonus, hasCombatAttackModifiers, getEffectiveBlackFlashRange } from "./modifiers.js";
import { getComputedSubskillValue, openRollModeMenu, openModifierContextMenu, openDirectModifierPanel } from "./character.js";

const _pendingAttackEffects = new Map();

const EFFECT_PIPELINE = {
  crit: {
    apply({ total, extraGroups, effect }) {
      const sides = parseInt(String(effect?.meta?.largestDie ?? "d6").replace("d", ""), 10) || 6;
      const roll = rollDice(1, sides)[0];
      extraGroups.push({ summary: false, label: `Crit (${effect?.meta?.largestDie})`, rolls: [roll], total: roll });
      return total + roll;
    }
  },
  imbue: {
    apply({ total, extraGroups, effect, data }) {
      const imbue = rollImbueDie(effect.imbueStr || data.imbue.die);
      extraGroups.push({ summary: false, label: `Imbue`, rolls: imbue.rolls, total: imbue.total });
      return total + imbue.total;
    }
  },
  blackflash: {
    apply({ total, extraGroups }) {
      const newTotal = Math.floor(total * 2.5);
      extraGroups.push({ summary: true, label: "Black Flash ×2.5", rolls: [], total: null, position: "before-total" });
      return newTotal;
    }
  }
};

// ── ROLL WITH MODE ────────────────────────────────────────────────────────────

function rollDicePool(count, sides) {
  return Array.from({ length: count }, () => Math.floor(Math.random() * sides) + 1);
}

function rollWithMode(count, sides, bonus, rollMode = "normal") {
  const rollsA = rollDicePool(count, sides);
  const totalA = rollsA.reduce((a, b) => a + b, 0) + bonus;
  if (rollMode === "normal") {
    return { rolls: rollsA, total: totalA, comparedRolls: null, comparedTotals: null, selectedRollIndex: 0 };
  }
  const rollsB = rollDicePool(count, sides);
  const totalB = rollsB.reduce((a, b) => a + b, 0) + bonus;
  const useA = rollMode === "advantage" ? totalA >= totalB : totalA <= totalB;
  return {
    rolls:             useA ? rollsA : rollsB,
    total:             useA ? totalA : totalB,
    comparedRolls:     [rollsA, rollsB],
    comparedTotals:    [totalA, totalB],
    selectedRollIndex: useA ? 0 : 1,
  };
}

function buildRollBreakdown(base, result, rollMode) {
  const bd = { ...base };
  if (rollMode !== "normal" && result.comparedRolls) {
    bd.rollMode          = rollMode;
    bd.comparedRolls     = result.comparedRolls;
    bd.comparedTotals    = result.comparedTotals;
    bd.selectedRollIndex = result.selectedRollIndex;
  }
  return bd;
}

// ── HELPERS ───────────────────────────────────────────────────────────────────

function applyEffectsPipeline(baseTotal, effect, extraGroups, data) {
  let total = baseTotal;
  for (const step of (effect.steps || [])) {
    const handler = EFFECT_PIPELINE[step];
    if (!handler) continue;
    total = handler.apply({ total, extraGroups, effect, data });
  }
  return total;
}

function createPendingEffect(base = {}) {
  return {
    steps: Array.isArray(base.steps) ? base.steps : [],
    meta: {
      imbueStr:    base.meta?.imbueStr,
      stacks:      base.meta?.stacks,
      largestDie:  base.meta?.largestDie,
      damageParts: base.meta?.damageParts,
      damageBonus: base.meta?.damageBonus,
    }
  };
}

function getPendingEffect(key) {
  const raw = _pendingAttackEffects.get(key);
  return raw ? createPendingEffect(raw) : null;
}

function parseStatScore(rawValue) {
  const parsed = parseInt(rawValue, 10);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

function getEffectiveStatLevel(state, effects, statKey) {
  return parseStatScore(state?.stats?.[statKey]?.score) + (effects?.statBonuses?.[statKey] || 0);
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
  if (!state) return null;
  const effects = computeActiveModifierEffects(state);

  const techniqueLevel  = getEffectiveStatLevel(state, effects, "technique");
  const blackFlashRange = getBlackFlashRange(techniqueLevel);
  const actions         = getActionsForGrade(state?.grade);

  const tempoBonus     = getComputedSubskillValue(state, "speed", 3);
  const combatBonus    = getComputedSubskillValue(state, "power", 1);
  const precisionBonus = getComputedSubskillValue(state, "speed", 0);
  const powerLevel     = getEffectiveStatLevel(state, effects, "power");
  const speedLevel     = getEffectiveStatLevel(state, effects, "speed");
  const imbue          = getImbueDisplay(state?.imbueLevel ?? 1);
  const reactions      = speedLevel;
  const imbueDC        = techniqueLevel * 2;
  const maxImbueStacks = techniqueLevel <= 2 ? 1 : techniqueLevel <= 4 ? 2 : 3;
  const talentBonus    = getComputedSubskillValue(state, "technique", 3);
  const currentCE      = parseInt(state?.ceCurrent, 10) || 0;

  const unarmedAttacks = [
    {
      name: "Punch", type: "Unarmed", rangeText: "Melee",
      damageStr: `1d4 + ${powerLevel}`,
      hitStr: powerLevel > 0 ? `${powerLevel}d6 +${combatBonus}` : `—`,
      diceCount: powerLevel, bonus: combatBonus, statLabel: "Power",
      damageParts: [{ count: 1, die: "d4" }], damageBonus: powerLevel,
    },
    {
      name: "Kick", type: "Unarmed", rangeText: "Melee",
      damageStr: `1d4 + ${techniqueLevel}`,
      hitStr: techniqueLevel > 0 ? `${powerLevel}d6 +${combatBonus}` : `—`,
      diceCount: powerLevel, bonus: combatBonus, statLabel: "Technique",
      damageParts: [{ count: 1, die: "d4" }], damageBonus: techniqueLevel,
    },
  ];

  const equippedSlots   = state?.equippedSlots || {};
  const inventoryItems  = state?.inventoryItems || [];
  const equippedWeapons = ['rightHand', 'leftHand']
    .map(slot => {
      const itemId = equippedSlots[slot];
      return inventoryItems.find(item => item.id === itemId && item.itemType === 'weapon');
    })
    .filter(Boolean);

  function checkStatRequirement(requirement) {
    if (!requirement) return false;
    if (requirement.stat && typeof requirement.value === 'number')
      return getEffectiveStatLevel(state, effects, requirement.stat) >= requirement.value;
    if (requirement.mode === 'any' && Array.isArray(requirement.requirements))
      return requirement.requirements.some(req => checkStatRequirement(req));
    if (requirement.mode === 'all' && Array.isArray(requirement.requirements))
      return requirement.requirements.every(req => checkStatRequirement(req));
    return false;
  }

  const martialArts = martialArtsData.filter(art => checkStatRequirement(art.statRequirement));

  const weaponArts = weaponArtsData.filter(art => {
    const unlockType   = art.unlockType || "standard";
    const hasAnyWeapon = equippedWeapons.length > 0;
    if (unlockType === "any_weapon") return hasAnyWeapon;
    if (unlockType === "weapon_stat_threshold") {
      const threshold = art.weaponStatThreshold ?? 4;
      return hasAnyWeapon && equippedWeapons.some(w => {
        const isRanged  = normalizeWeaponType(w.weaponType) === "ranged";
        const weaponStat = isRanged ? "speed" : (w.weaponStat || "power");
        return getEffectiveStatLevel(state, effects, weaponStat) >= threshold;
      });
    }
    if (unlockType === "polearm_weapon_stat") {
      const threshold = art.statRequirement?.value ?? 1;
      return equippedWeapons.some(w => {
        if (normalizeWeaponType(w.weaponType) !== "polearm") return false;
        const isRanged  = normalizeWeaponType(w.weaponType) === "ranged";
        const weaponStat = isRanged ? "speed" : (w.weaponStat || "power");
        return getEffectiveStatLevel(state, effects, weaponStat) >= threshold;
      });
    }
    const stat = art.statRequirement?.stat;
    const value = art.statRequirement?.value;
    const weaponType = art.weaponTypeRequirement;
    if (!stat || value == null || !weaponType) return false;
    return getEffectiveStatLevel(state, effects, stat) >= value &&
      equippedWeapons.some(w => w.weaponType === weaponType);
  });

  return {
    actions, reactions, tempoBonus, combatBonus, precisionBonus,
    powerLevel, speedLevel, techniqueLevel, imbue,
    unarmedAttacks, martialArts, weaponArts, equippedWeapons,
    imbueDC, maxImbueStacks, talentBonus, currentCE,
    blackFlashRange: blackFlashRange ?? '—',
    blackFlashMin: blackFlashRange,
    state,
  };
}

// ── RENDER ────────────────────────────────────────────────────────────────────

export function renderCombatTabData(data) {
  if (!data) return;
  const set = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.textContent = val ?? "—";
  };

  set("combatActionsValue",   data.actions);
  set("combatReactionsValue", data.reactions);

  // Black flash range — apply directModifiers and show twinkling star badge
  const effectiveBfRange = data.state
    ? getEffectiveBlackFlashRange(data.state, data.blackFlashMin)
    : data.blackFlashMin;
  const bfDisplay = effectiveBfRange !== null ? String(effectiveBfRange) : "—";
  set("combatBlackFlashValue", bfDisplay);

  const bfBox = document.querySelector(".black-flash-box");
  if (bfBox && data.state) {
    const hasBfMod = (data.state.directModifiers || [])
      .some(e => e.targetType === "derived" && e.targetKey === "blackFlashRange");
    let bfBadge = bfBox.querySelector(".direct-modified-badge");
    if (hasBfMod && !bfBadge) {
      bfBadge = document.createElement("span");
      bfBadge.className = "direct-modified-badge vital-mod-badge visible";
      bfBadge.title     = "Modified";
      bfBadge.setAttribute("aria-label", "Modified");
      bfBadge.tabIndex  = 0;
      bfBadge.setAttribute("role", "button");
      bfBadge.addEventListener("click", () => openDirectModifierPanel("derived", "blackFlashRange"));
      bfBox.appendChild(bfBadge);
    } else if (!hasBfMod && bfBadge) {
      bfBadge.remove();
    }
  }

  const initiativeStr = data.tempoBonus !== 0
    ? `${data.speedLevel}d6 ${data.tempoBonus > 0 ? "+" : ""}${data.tempoBonus}`
    : `${data.speedLevel}d6`;
  const initiativeEl = document.getElementById("combatInitiativeValue");
  if (initiativeEl) {
    initiativeEl.textContent     = initiativeStr;
    initiativeEl.style.cursor    = "pointer";
    initiativeEl.title           = "Click to roll — right-click for advantage/disadvantage";
    initiativeEl.onclick         = () => rollInitiative(data);
    initiativeEl.oncontextmenu   = (e) => {
      e.preventDefault();
      openRollModeMenu(e, selectedMode => rollInitiative(data, selectedMode));
    };
  }

  const imbueDieEl  = document.getElementById("combatImbueDie");
  const imbueInput  = document.getElementById("combatImbueInput");
  if (imbueInput) imbueInput.value = data.imbue.level;
  if (imbueDieEl)  imbueDieEl.textContent = data.imbue.die;

  const strikesEl = document.getElementById("combatStrikesList");
  if (strikesEl) strikesEl.innerHTML = data.unarmedAttacks.map((a, i) => renderUnarmedRow(a, i, data.state)).join("");

  const attacksEl = document.getElementById("combatAttacksList");
  if (attacksEl) {
    attacksEl.innerHTML = data.equippedWeapons?.length
      ? data.equippedWeapons.map((w, i) => renderAttackRow(w, i, data)).join("")
      : '<span class="combat-empty">No weapons equipped.</span>';
  }

  filterAndRenderArts(data);
}

function filterAndRenderArts(data) {
  const martialSearch = document.getElementById("combatMartialArtsSearch")?.value.toLowerCase() || "";
  const weaponSearch  = document.getElementById("combatWeaponArtsSearch")?.value.toLowerCase()  || "";

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
    ? `Req: ${art.statRequirement.stat} ${art.statRequirement.value}` : '';
  return `
    <div class="combat-art-item">
      <strong>${escapeHtml(art.title)}</strong>
      <span>${escapeHtml(art.description)}</span>
      <em>${cooldownText}${reqText ? ' &nbsp;·&nbsp; ' + reqText : ''}</em>
    </div>`;
}

function renderWeaponArt(art) {
  const unlockType = art.unlockType || "standard";
  let reqText = "";
  if (unlockType === "any_weapon")              reqText = "Any weapon";
  else if (unlockType === "weapon_stat_threshold") reqText = `Any weapon, WS Lvl ${art.weaponStatThreshold ?? 4}+`;
  else if (unlockType === "polearm_weapon_stat")   reqText = `Polearm, WS Lvl ${art.statRequirement?.value ?? 1}+`;
  else {
    const statReq   = art.statRequirement?.value ? `${art.statRequirement.stat} ${art.statRequirement.value}` : "";
    const weaponReq = art.weaponTypeRequirement || "";
    reqText = [statReq, weaponReq].filter(Boolean).join(", ");
  }
  const usesText     = art.usesPerEncounter != null ? `Uses: ${art.usesPerEncounter}` : "";
  const cooldownText = art.cooldown === 0 ? "No Cooldown"
    : art.cooldown ? `Cooldown: ${art.cooldown} turn${art.cooldown === 1 ? "" : "s"}` : "";
  const metaParts = [usesText, reqText ? `Req: ${reqText}` : "", cooldownText].filter(Boolean);
  return `
    <div class="combat-art-item">
      <strong>${escapeHtml(art.title)}</strong>
      <span>${escapeHtml(art.description)}</span>
      <em>${metaParts.join(" &nbsp;·&nbsp; ")}</em>
    </div>`;
}

function renderUnarmedRow(attack, index, state) {
  const hitStr = attack.diceCount > 0 && attack.bonus !== 0
    ? `${attack.diceCount}d6 ${attack.bonus > 0 ? "+" : ""}${attack.bonus}`
    : attack.diceCount > 0 ? `${attack.diceCount}d6` : "—";

  const attackKey    = getAttackKey("unarmed", index);
  const pendingEffect = _pendingAttackEffects.get(attackKey);

  const damageStr = attack.damageBonus
    ? `${attack.damageParts.map(p => `${p.count}${p.die}`).join(" + ")} + ${attack.damageBonus}`
    : attack.damageParts.map(p => `${p.count}${p.die}`).join(" + ");

  const damageAction = pendingEffect ? "rollPendingDamage" : "rollUnarmedDamage";

  const damageDisplay = pendingEffect ? (() => {
    const steps = pendingEffect.steps || [];
    let label = damageStr;
    if (steps.includes("blackflash")) label = `✦${label}✦`;
    if (steps.includes("crit"))       label += " + CRIT";
    if (steps.includes("imbue"))      label += pendingEffect?.meta?.imbueStr ? ` + ${pendingEffect.meta.imbueStr}` : " + IMBUE";
    return label;
  })() : damageStr;

  // Modifier badges (twinkling star — reuses direct-modified-badge class)
  const hitBadgeHtml    = (state && getCombatAttackModifiers(state, attackKey, "hit").length)
    ? ` <span class="direct-modified-badge visible" style="font-size:0.7em;vertical-align:middle;" title="Hit modifier active">✦</span>` : "";
  const damageBadgeHtml = (state && getCombatAttackModifiers(state, attackKey, "damage").length)
    ? ` <span class="direct-modified-badge visible" style="font-size:0.7em;vertical-align:middle;" title="Damage modifier active">✦</span>` : "";

  return `
    <div class="combat-attack-row combat-attack-row--unarmed">
      <div class="combat-attack-name">${escapeHtml(attack.name)}</div>
      <div class="combat-attack-type">${escapeHtml(attack.type)}</div>
      <div class="combat-attack-range">${escapeHtml(attack.rangeText)}</div>
      <div class="combat-attack-hit combat-attack-rollable"
           data-action="rollUnarmedHit"
           data-unarmed-index="${index}"
           data-attack-key="${attackKey}"
           title="Click to roll — right-click for advantage/disadvantage">
        ${escapeHtml(hitStr)}${hitBadgeHtml}
      </div>
      <div class="combat-attack-damage combat-attack-rollable"
           data-action="${damageAction}"
           data-attack-key="${attackKey}"
           data-unarmed-index="${index}"
           title="Click to roll damage — right-click to add modifiers">
        ${escapeHtml(damageDisplay)}${damageBadgeHtml}
      </div>
      <button type="button"
              class="combat-imbue-btn"
              data-action="imbueAttack"
              data-unarmed-index="${index}"
              title="Click to imbue — right-click for advantage/disadvantage">
        Imbue
      </button>
    </div>`;
}

function renderAttackRow(weapon, index, data) {
  const isRanged  = normalizeWeaponType(weapon.weaponType) === "ranged";
  const isPolearm = normalizeWeaponType(weapon.weaponType) === "polearm";
  const typeLabel = WEAPON_TYPE_LABELS[weapon.weaponType] ?? weapon.weaponType;

  let statKey   = weapon.weaponStat || "power";
  let statLevel = statKey === "speed" ? data.speedLevel
    : statKey === "technique" ? (data.techniqueLevel || 0)
    : data.powerLevel;

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

  const diceCount = isRanged ? data.speedLevel  : data.powerLevel;
  const bonus     = isRanged ? data.precisionBonus : data.combatBonus;
  const hitStr    = bonus !== 0 ? `${diceCount}d6 ${bonus > 0 ? "+" : ""}${bonus}` : `${diceCount}d6`;

  const attackKey    = getAttackKey("weapon", index);
  const pendingEffect = _pendingAttackEffects.get(attackKey);
  const damageAction = pendingEffect ? "rollPendingDamage" : "rollDamage";

  const damageDisplay = pendingEffect ? (() => {
    const steps = pendingEffect.steps || [];
    let label = damageStr;
    if (steps.includes("blackflash")) label = `✦${label}✦`;
    if (steps.includes("crit"))       label += " + CRIT";
    if (steps.includes("imbue"))      label += pendingEffect?.meta?.imbueStr ? ` + ${pendingEffect.meta.imbueStr}` : " + IMBUE";
    return label;
  })() : damageStr;

  const descLine = weapon.description
    ? `<div class="combat-attack-desc">${escapeHtml(weapon.description)}</div>` : "";

  // Modifier badges
  const state = data.state;
  const wHitBadgeHtml    = (state && getCombatAttackModifiers(state, attackKey, "hit").length)
    ? ` <span class="direct-modified-badge visible" style="font-size:0.7em;vertical-align:middle;" title="Hit modifier active">✦</span>` : "";
  const wDamageBadgeHtml = (state && getCombatAttackModifiers(state, attackKey, "damage").length)
    ? ` <span class="direct-modified-badge visible" style="font-size:0.7em;vertical-align:middle;" title="Damage modifier active">✦</span>` : "";

  return `
    <div class="combat-attack-row" data-weapon-index="${index}">
      <div class="combat-attack-name-wrap">
        <div class="combat-attack-name">${escapeHtml(weapon.name)}</div>
        ${descLine}
      </div>
      <div class="combat-attack-type">${escapeHtml(typeLabel)}</div>
      <div class="combat-attack-range">${escapeHtml(rangeText)}</div>
      <div class="combat-attack-hit combat-attack-rollable"
           data-action="rollHit"
           data-weapon-index="${index}"
           data-attack-key="${attackKey}"
           title="Click to roll — right-click for advantage/disadvantage">
        ${escapeHtml(hitStr)}${wHitBadgeHtml}
      </div>
      <div class="combat-attack-damage combat-attack-rollable"
           data-action="${damageAction}"
           data-attack-key="${attackKey}"
           data-weapon-index="${index}"
           title="Click to roll damage — right-click to add modifiers">
        ${escapeHtml(damageDisplay)}${wDamageBadgeHtml}
      </div>
      <button type="button"
              class="combat-imbue-btn"
              data-action="imbueAttack"
              data-weapon-index="${index}"
              title="Click to imbue — right-click for advantage/disadvantage">
        Imbue
      </button>
    </div>`;
}

// ── INIT ──────────────────────────────────────────────────────────────────────

let _getState    = null;
let _scheduleSave = null;
let _showRollToast = null;

export function initCombat({ getState, scheduleSave, showRollToast }) {
  _getState      = getState;
  _scheduleSave  = scheduleSave;
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

  const collapseBtn   = document.getElementById("combatActionsCollapseBtn");
  const collapsePanel = document.getElementById("combatActionsPanel");
  if (collapseBtn && collapsePanel) {
    collapseBtn.addEventListener("click", () => {
      const isOpen = collapseBtn.getAttribute("aria-expanded") === "true";
      collapseBtn.setAttribute("aria-expanded", isOpen ? "false" : "true");
      collapsePanel.classList.toggle("collapsed", isOpen);
    });
  }

  const artsTabs = document.querySelectorAll(".combat-arts-tab");
  artsTabs.forEach(tab => {
    tab.addEventListener("click", () => {
      artsTabs.forEach(t => t.classList.remove("active"));
      tab.classList.add("active");
      const target = tab.dataset.artsTab;
      document.getElementById("combatArtsTabPanelMartial").hidden = target !== "martial";
      document.getElementById("combatArtsTabPanelWeapon").hidden  = target !== "weapon";
    });
  });

  ["combatMartialArtsSearch", "combatWeaponArtsSearch"].forEach(id => {
    document.getElementById(id)?.addEventListener("input", () => {
      const state = _getState();
      if (!state) return;
      filterAndRenderArts(computeCombatTabData(state));
    });
  });

  // ── Click delegation ──────────────────────────────────────────────────────
  const panel = document.getElementById("panel-combat");
  if (panel) {
    panel.addEventListener("click", e => {
      const target = e.target.closest("[data-action]");
      if (!target) return;
      const action = target.dataset.action;
      const state  = _getState();
      if (!state) return;
      const data   = computeCombatTabData(state);

      if (action === "rollHit" || action === "rollDamage") {
        const weaponIndex = parseInt(target.dataset.weaponIndex, 10);
        if (!Number.isInteger(weaponIndex)) return;
        const weapon = data.equippedWeapons[weaponIndex];
        if (!weapon) return;
        if (action === "rollHit")    rollHit(weapon, data, weaponIndex);
        if (action === "rollDamage") rollDamage(weapon, data, weaponIndex);
      }

      if (action === "rollUnarmedHit" || action === "rollUnarmedDamage") {
        const unarmedIndex = parseInt(target.dataset.unarmedIndex, 10);
        if (!Number.isInteger(unarmedIndex)) return;
        const attack = data.unarmedAttacks[unarmedIndex];
        if (!attack) return;
        if (action === "rollUnarmedHit")    rollUnarmedHit(attack, unarmedIndex);
        if (action === "rollUnarmedDamage") rollUnarmedDamage(attack, unarmedIndex);
      }

      if (action === "rollPendingDamage") {
        const key = target.dataset.attackKey;
        if (!key) return;
        rollPendingDamage(key, data, state);
      }

      if (action === "imbueAttack") {
        const weaponIndex  = parseInt(target.dataset.weaponIndex,  10);
        const unarmedIndex = parseInt(target.dataset.unarmedIndex, 10);
        let attackName, damageParts, damageBonus, attackKey;
        if (Number.isInteger(weaponIndex)) {
          const weapon = data.equippedWeapons[weaponIndex];
          if (!weapon) return;
          attackName  = weapon.name;
          damageParts = weapon.weaponDamageParts || [{ count: 1, die: "d6" }];
          const sk    = weapon.weaponStat || "power";
          damageBonus = sk === "speed" ? data.speedLevel : sk === "technique" ? data.techniqueLevel : data.powerLevel;
          attackKey   = getAttackKey("weapon", weaponIndex);
        } else if (Number.isInteger(unarmedIndex)) {
          const attack = data.unarmedAttacks[unarmedIndex];
          if (!attack) return;
          attackName  = attack.name;
          damageParts = attack.damageParts;
          damageBonus = attack.damageBonus;
          attackKey   = getAttackKey("unarmed", unarmedIndex);
        } else return;
        rollImbue(attackName, damageParts, damageBonus, data, state, attackKey);
      }
    });

    // ── Right-click delegation ──────────────────────────────────────────────
    panel.addEventListener("contextmenu", e => {
      e.preventDefault();
      const state = _getState();
      if (!state) return;
      const data = computeCombatTabData(state);

      // Clear pending damage (right-click on glowing damage cell)
      const pendingTarget = e.target.closest("[data-action='rollPendingDamage']");
      if (pendingTarget) {
        const key = pendingTarget.dataset.attackKey;
        if (key) { _pendingAttackEffects.delete(key); renderCombatTabData(computeCombatTabData(state)); }
        return;
      }

      // To Hit — roll mode menu (adv/dis) + Add Modifier option
      const hitTarget = e.target.closest("[data-action='rollHit'],[data-action='rollUnarmedHit']");
      if (hitTarget) {
        const action    = hitTarget.dataset.action;
        const attackKey = hitTarget.dataset.attackKey;
        openRollModeMenu(e,
          selectedMode => {
            if (action === "rollHit") {
              const weaponIndex = parseInt(hitTarget.dataset.weaponIndex, 10);
              const weapon = data.equippedWeapons[weaponIndex];
              if (weapon) rollHit(weapon, data, weaponIndex, selectedMode);
            } else {
              const unarmedIndex = parseInt(hitTarget.dataset.unarmedIndex, 10);
              const attack = data.unarmedAttacks[unarmedIndex];
              if (attack) rollUnarmedHit(attack, unarmedIndex, selectedMode);
            }
          },
          { onAddModifier: () => { if (attackKey) openDirectModifierPanel("combatAttack", attackKey); } }
        );
        return;
      }

      // Damage — modifier panel only (no roll mode for damage)
      const damageTarget = e.target.closest("[data-action='rollDamage'],[data-action='rollUnarmedDamage']");
      if (damageTarget) {
        const attackKey = damageTarget.dataset.attackKey;
        if (attackKey) openDirectModifierPanel("combatAttack", attackKey);
        return;
      }

      // Imbue button — roll mode menu (adv/dis), one-time
      const imbueTarget = e.target.closest("[data-action='imbueAttack']");
      if (imbueTarget) {
        const weaponIndex  = parseInt(imbueTarget.dataset.weaponIndex,  10);
        const unarmedIndex = parseInt(imbueTarget.dataset.unarmedIndex, 10);
        openRollModeMenu(e, selectedMode => {
          let attackName, damageParts, damageBonus, attackKey;
          if (Number.isInteger(weaponIndex)) {
            const weapon = data.equippedWeapons[weaponIndex];
            if (!weapon) return;
            attackName  = weapon.name;
            damageParts = weapon.weaponDamageParts || [{ count: 1, die: "d6" }];
            const sk    = weapon.weaponStat || "power";
            damageBonus = sk === "speed" ? data.speedLevel : sk === "technique" ? data.techniqueLevel : data.powerLevel;
            attackKey   = getAttackKey("weapon", weaponIndex);
          } else if (Number.isInteger(unarmedIndex)) {
            const attack = data.unarmedAttacks[unarmedIndex];
            if (!attack) return;
            attackName  = attack.name;
            damageParts = attack.damageParts;
            damageBonus = attack.damageBonus;
            attackKey   = getAttackKey("unarmed", unarmedIndex);
          } else return;
          rollImbue(attackName, damageParts, damageBonus, data, state, attackKey, selectedMode);
        });
        return;
      }

      // Black Flash box — modifier panel
      const bfTarget = e.target.closest(".black-flash-box");
      if (bfTarget) {
        openDirectModifierPanel("derived", "blackFlashRange");
      }
    });
  }

  ["combatAttacksCollapseBtn", "combatArtsCollapseBtn", "combatBasicActionsCollapseBtn",
   "combatReactionsCollapseBtn", "combatBasicReactionsCollapseBtn"].forEach(btnId => {
    const btn      = document.getElementById(btnId);
    const panelEl  = document.getElementById(btnId.replace("CollapseBtn", "Panel"));
    if (!btn || !panelEl) return;
    btn.addEventListener("click", () => {
      const isOpen = btn.getAttribute("aria-expanded") === "true";
      btn.setAttribute("aria-expanded", isOpen ? "false" : "true");
      panelEl.classList.toggle("collapsed", isOpen);
    });
  });
}

// ── ROLL FUNCTIONS ────────────────────────────────────────────────────────────

function rollDice(count, sides) {
  return Array.from({ length: count }, () => Math.floor(Math.random() * sides) + 1);
}

function getAttackKey(type, index) {
  return `${type}-${index}`;
}

function getLargestDamageDie(parts) {
  if (!Array.isArray(parts) || !parts.length) return "d6";
  let largest = 0;
  for (const part of parts) {
    const sides = parseInt(String(part.die).replace("d", ""), 10) || 6;
    if (sides > largest) largest = sides;
  }
  return `d${largest}`;
}

function rollInitiative(data, rollMode = "normal") {
  if (!_showRollToast) return;
  const diceCount = data.speedLevel;
  if (!diceCount || diceCount < 1) return;
  const bonus   = data.tempoBonus || 0;
  const result  = rollWithMode(diceCount, 6, bonus, rollMode);
  const allOnes = result.rolls.every(r => r === 1);
  const critStatus = allOnes ? "fail" : result.total >= diceCount * 6 + bonus ? "success" : null;
  const breakdown  = buildRollBreakdown({ skillModifier: bonus, die: "d6" }, result, rollMode);
  _showRollToast("Speed", diceCount, result.rolls, result.total, critStatus,
    "Initiative", breakdown, rollMode === "normal" ? null : rollMode);
}

function rollHit(weapon, data, weaponIndex, rollMode = "normal") {
  if (!_showRollToast) return;
  const isRanged   = normalizeWeaponType(weapon.weaponType) === "ranged";
  const diceCount  = isRanged ? data.speedLevel : data.powerLevel;
  const statLabel  = isRanged ? "Speed" : "Power";
  const skillLabel = isRanged ? "Precision" : "Combat";
  if (!diceCount || diceCount < 1) return;

  const attackKey    = getAttackKey("weapon", weaponIndex);
  const state        = _getState();
  const hitModBonus  = state ? getCombatAttackBonus(state, attackKey, "hit") : 0;
  const bonus        = (isRanged ? data.precisionBonus : data.combatBonus) + hitModBonus;

  const result     = rollWithMode(diceCount, 6, bonus, rollMode);
  const allOnes    = result.rolls.every(r => r === 1);
  const critStatus = allOnes ? "fail" : result.total >= diceCount * 6 + bonus ? "success" : null;

  if (critStatus === "success") {
    const existing = _pendingAttackEffects.get(attackKey);
    const steps    = new Set(existing?.steps || []);
    steps.add("crit");
    _pendingAttackEffects.set(attackKey, createPendingEffect({
      steps: [...steps],
      meta:  { ...existing?.meta, largestDie: getLargestDamageDie(weapon.weaponDamageParts || []) },
    }));
    renderCombatTabData(computeCombatTabData(_getState()));
  }

  const breakdown = buildRollBreakdown({ skillModifier: bonus, die: "d6" }, result, rollMode);
  _showRollToast(statLabel, diceCount, result.rolls, result.total, critStatus,
    `${weapon.name} — ${skillLabel}`, breakdown, rollMode === "normal" ? null : rollMode);
}

function rollDamage(weapon, data, weaponIndex) {
  if (!_showRollToast) return;
  const attackKey      = getAttackKey("weapon", weaponIndex ?? 0);
  const state          = _getState();
  const damageModBonus = state ? getCombatAttackBonus(state, attackKey, "damage") : 0;

  const parts = weapon.weaponDamageParts || [{ count: 1, die: "d6" }];
  let total = 0;
  const allRolls = [];
  const dieGroups = [];

  for (const part of parts) {
    const sides    = parseInt(String(part.die).replace("d", ""), 10) || 6;
    const rolls    = rollDice(part.count, sides);
    const partTotal = rolls.reduce((a, b) => a + b, 0);
    total += partTotal;
    allRolls.push(...rolls);
    dieGroups.push({ label: `${part.count}${part.die}`, rolls, total: partTotal });
  }

  let statKey   = weapon.weaponStat || "power";
  let statBonus = statKey === "power" ? data.powerLevel
    : statKey === "speed" ? data.speedLevel
    : statKey === "technique" ? (data.techniqueLevel || 0)
    : data.powerLevel;

  total += statBonus + damageModBonus;

  _showRollToast(
    statKey.charAt(0).toUpperCase() + statKey.slice(1),
    parts[0]?.count || 1, allRolls, total, null,
    `${weapon.name} — Damage`,
    { skillModifier: statBonus + damageModBonus, die: parts[0]?.die || "d6", dieGroups },
    null,
  );
}

function rollUnarmedHit(attack, unarmedIndex, rollMode = "normal") {
  if (!_showRollToast || !attack.diceCount || attack.diceCount < 1) return;
  const attackKey    = getAttackKey("unarmed", unarmedIndex);
  const state        = _getState();
  const hitModBonus  = state ? getCombatAttackBonus(state, attackKey, "hit") : 0;
  const bonus        = attack.bonus + hitModBonus;

  const result     = rollWithMode(attack.diceCount, 6, bonus, rollMode);
  const allOnes    = result.rolls.every(r => r === 1);
  const critStatus = allOnes ? "fail" : result.total >= attack.diceCount * 6 + bonus ? "success" : null;

  if (critStatus === "success") {
    const existing = getPendingEffect(attackKey);
    const steps    = new Set(existing?.steps || []);
    steps.add("crit");
    _pendingAttackEffects.set(attackKey, createPendingEffect({
      steps: [...steps],
      meta:  { ...existing?.meta, largestDie: getLargestDamageDie(attack.damageParts), damageParts: attack.damageParts },
    }));
    renderCombatTabData(computeCombatTabData(_getState()));
  }

  const breakdown = buildRollBreakdown({ skillModifier: bonus, die: "d6" }, result, rollMode);
  _showRollToast(attack.statLabel, attack.diceCount, result.rolls, result.total, critStatus,
    `${attack.name} — Combat`, breakdown, rollMode === "normal" ? null : rollMode);
}

function rollUnarmedDamage(attack, unarmedIndex) {
  if (!_showRollToast) return;
  const attackKey      = getAttackKey("unarmed", unarmedIndex ?? 0);
  const state          = _getState();
  const damageModBonus = state ? getCombatAttackBonus(state, attackKey, "damage") : 0;

  let total = attack.damageBonus + damageModBonus;
  const allRolls = [];
  const dieGroups = [];

  for (const part of attack.damageParts) {
    const sides    = parseInt(String(part.die).replace("d", ""), 10) || 4;
    const rolls    = rollDice(part.count, sides);
    const partTotal = rolls.reduce((a, b) => a + b, 0);
    total += partTotal;
    allRolls.push(...rolls);
    dieGroups.push({ label: `${part.count}${part.die}`, rolls, total: partTotal });
  }

  _showRollToast(
    attack.statLabel, attack.damageParts[0]?.count || 1, allRolls, total, null,
    `${attack.name} — Damage`,
    { skillModifier: attack.damageBonus + damageModBonus, die: attack.damageParts[0]?.die || "d4", dieGroups },
    null,
  );
}

function rollImbue(attackName, damageParts, damageBonus, data, state, attackKey, rollMode = "normal") {
  if (!_showRollToast) return;
  const { techniqueLevel, imbueDC, maxImbueStacks, talentBonus, blackFlashMin } = data;
  const diceCount = techniqueLevel;
  if (!diceCount || diceCount < 1) return;

  const result       = rollWithMode(diceCount, 6, 0, rollMode);
  const rawRolls     = result.rolls;
  const naturalTotal = result.total;
  const totalWithBonus = naturalTotal + talentBonus;
  const isBlackFlash = blackFlashMin !== null && naturalTotal >= blackFlashMin;
  const dcMet        = isBlackFlash || totalWithBonus >= imbueDC;
  const excessOverDC = Math.max(0, totalWithBonus - imbueDC);
  const stacksAvailable = isBlackFlash ? 0 : Math.min(Math.floor(excessOverDC / 2), maxImbueStacks);

  if (isBlackFlash) {
    const existing = getPendingEffect(attackKey);
    const steps    = new Set(existing?.steps || []);
    steps.delete("imbue");
    steps.add("blackflash");
    _pendingAttackEffects.set(attackKey, createPendingEffect({
      steps: [...steps],
      meta:  { ...existing?.meta, damageParts, damageBonus, imbueStr: undefined, stacks: 0 },
    }));
    renderCombatTabData(computeCombatTabData(state));
    const breakdown = buildRollBreakdown({ skillModifier: 0, die: "d6" }, result, rollMode);
    _showRollToast("Technique", diceCount, rawRolls, naturalTotal, "success",
      `${attackName} — ✦ BLACK FLASH ✦`, breakdown, rollMode === "normal" ? null : rollMode);
    return;
  }

  const breakdown = buildRollBreakdown({ skillModifier: talentBonus, die: "d6" }, result, rollMode);
  _showRollToast("Technique", diceCount, rawRolls, totalWithBonus, null,
    `${attackName} — Imbue Success (DC ${imbueDC})`, breakdown, rollMode === "normal" ? null : rollMode);

  promptImbueStacks({
    attackName, damageParts, damageBonus,
    imbueBase: data.imbue.die, stacksAvailable, maxImbueStacks,
    currentCE: parseInt(state?.ceCurrent, 10) || 0,
    state, data, attackKey, rawRolls, totalWithBonus, imbueDC, talentBonus, diceCount,
  });
}

function rollImbueDie(dieStr) {
  const plusMatch  = dieStr.match(/^(\d+)d(\d+)\+(\d+)$/);
  const basicMatch = dieStr.match(/^(\d+)d(\d+)$/);
  if (plusMatch) {
    const count = parseInt(plusMatch[1]), sides = parseInt(plusMatch[2]), bonus = parseInt(plusMatch[3]);
    const rolls = rollDice(count, sides);
    return { total: rolls.reduce((a, b) => a + b, 0) + bonus, rolls, bonus, dieStr };
  }
  if (basicMatch) {
    const count = parseInt(basicMatch[1]), sides = parseInt(basicMatch[2]);
    const rolls = rollDice(count, sides);
    return { total: rolls.reduce((a, b) => a + b, 0), rolls, bonus: 0, dieStr };
  }
  return { total: 0, rolls: [], bonus: 0, dieStr };
}

function promptImbueStacks(ctx) {
  const { attackName, stacksAvailable, maxImbueStacks, currentCE, state, imbueBase, attackKey } = ctx;
  document.getElementById("combatImbuePrompt")?.remove();
  const maxAffordable = Math.min(stacksAvailable, Math.floor(currentCE / 3), maxImbueStacks);

  const prompt = document.createElement("div");
  prompt.id    = "combatImbuePrompt";
  prompt.className = "combat-imbue-prompt";
  prompt.innerHTML = `
    <div class="combat-imbue-prompt-inner">
      <div class="combat-imbue-prompt-title">${escapeHtml(attackName)} — Imbue Successful</div>
      <div class="combat-imbue-prompt-roll">
        Talent: ${ctx.rawRolls.join(", ")} ${ctx.talentBonus !== 0 ? `+ ${ctx.talentBonus}` : ""} = <strong>${ctx.totalWithBonus}</strong> vs DC ${ctx.imbueDC}
      </div>
      ${stacksAvailable > 0 ? `
        <div class="combat-imbue-prompt-stacks">
          <span class="combat-imbue-prompt-label">Add stacks? Beat DC by ${ctx.totalWithBonus - ctx.imbueDC} · ${maxAffordable} available · 3 CE each</span>
          <div class="combat-imbue-stack-btns">
            ${Array.from({ length: maxAffordable }, (_, i) => i + 1).map(n => `
              <button type="button" class="combat-imbue-stack-btn" data-stacks="${n}">+${n} (${n * 3} CE)</button>
            `).join("")}
          </div>
        </div>` : ""}
      <div class="combat-imbue-prompt-actions">
        <button type="button" class="combat-imbue-confirm-btn" data-stacks="0">No stacks</button>
        <button type="button" class="combat-imbue-cancel-btn">Cancel</button>
      </div>
    </div>`;

  const confirm = (stacks) => {
    const ceCost = stacks * 3;
    if (ceCost > 0) {
      const newCE = Math.max(0, (parseInt(state.ceCurrent, 10) || 0) - ceCost);
      state.ceCurrent = String(newCE);
      const ceEl = document.getElementById("ceCurrent");
      if (ceEl) ceEl.value = String(newCE);
      if (typeof _scheduleSave === "function") _scheduleSave();
    }
    const imbueStr = stacks > 0 ? `${imbueBase}+${stacks}d4` : imbueBase;
    const existing = getPendingEffect(attackKey);
    const steps    = new Set(existing?.steps || []);
    steps.add("imbue");
    _pendingAttackEffects.set(attackKey, createPendingEffect({
      steps: [...steps],
      meta:  { ...existing?.meta, imbueStr, stacks },
    }));
    renderCombatTabData(computeCombatTabData(state));
    prompt.remove();
  };

  prompt.querySelectorAll(".combat-imbue-stack-btn").forEach(btn => {
    btn.addEventListener("click", () => confirm(parseInt(btn.dataset.stacks, 10) || 0));
  });
  prompt.querySelector(".combat-imbue-confirm-btn").addEventListener("click", () => confirm(0));
  prompt.querySelector(".combat-imbue-cancel-btn").addEventListener("click",  () => prompt.remove());
  document.getElementById("panel-combat")?.appendChild(prompt);
}

function rollPendingDamage(key, data, state) {
  const effect = _pendingAttackEffects.get(key);
  const [type, indexStr] = key.split("-");
  const index = parseInt(indexStr, 10);

  let attackName, damageParts, damageBonus;
  if (type === "weapon") {
    const weapon = data.equippedWeapons[index];
    if (!weapon) return;
    attackName  = weapon.name;
    damageParts = weapon.weaponDamageParts || [{ count: 1, die: "d6" }];
    const sk    = weapon.weaponStat || "power";
    damageBonus = sk === "speed" ? data.speedLevel : sk === "technique" ? data.techniqueLevel : data.powerLevel;
  } else {
    const attack = data.unarmedAttacks[index];
    if (!attack) return;
    attackName  = attack.name;
    damageParts = attack.damageParts;
    damageBonus = attack.damageBonus;
  }

  const damageModBonus = state ? getCombatAttackBonus(state, key, "damage") : 0;
  let baseTotal = damageBonus + damageModBonus;
  const baseRolls = [];
  const dieGroups = [];

  for (const part of damageParts) {
    const sides    = parseInt(String(part.die).replace("d", ""), 10) || 6;
    const rolls    = rollDice(part.count, sides);
    const partTotal = rolls.reduce((a, b) => a + b, 0);
    baseTotal += partTotal;
    baseRolls.push(...rolls);
    dieGroups.push({ label: `${part.count}${part.die}`, rolls, total: partTotal });
  }

  if (!effect) {
    _showRollToast("Damage", damageParts[0]?.count || 1, baseRolls, baseTotal, null,
      `${attackName} — Damage`, { skillModifier: damageBonus + damageModBonus, dieGroups }, null);
    return;
  }

  const extraGroups = [...dieGroups];
  const finalTotal  = applyEffectsPipeline(baseTotal, effect, extraGroups, data);

  _showRollToast("Damage", damageParts[0]?.count || 1, baseRolls, finalTotal, null,
    `${attackName} — ${effect.steps?.join(" + ") || "Enhanced"} Damage`,
    { skillModifier: damageBonus + damageModBonus, die: damageParts[0]?.die || "d6", dieGroups: extraGroups },
    null);

  _pendingAttackEffects.delete(key);
  renderCombatTabData(computeCombatTabData(state));
}