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

const _pendingAttackEffects = new Map();

const EFFECT_PIPELINE = {
  crit: {
    apply({ total, extraGroups, effect }) {
      const sides = parseInt(String(effect?.meta?.largestDie ?? "d6").replace("d", ""), 10) || 6;
      const roll = rollDice(1, sides)[0];

      extraGroups.push({
        summary: false,
        label: `Crit (${effect?.meta?.largestDie})`,
        rolls: [roll],
        total: roll,
      });

      return total + roll;
    }
  },

  imbue: {
    apply({ total, extraGroups, effect, data }) {
      const imbue = rollImbueDie(effect.imbueStr || data.imbue.die);

      extraGroups.push({
        summary: false,
        label: `Imbue`,
        rolls: imbue.rolls,
        total: imbue.total,
      });

      return total + imbue.total;
    }
  },

  blackflash: {
    apply({ total, extraGroups }) {
      const newTotal = Math.floor(total * 2.5);

      extraGroups.push({
        summary: true,
        label: "Black Flash ×2.5",
        rolls: [],
        total: null,
        position: "before-total"
      });

      return newTotal;
    }
  }
};

// ── HELPERS ───────────────────────────────────────────────────────────────────

function applyEffectsPipeline(baseTotal, effect, extraGroups, data) {
  let total = baseTotal;

  const steps = effect.steps || [];

  for (const step of steps) {
    const handler = EFFECT_PIPELINE[step];
    if (!handler) continue;

    total = handler.apply({
      total,
      extraGroups,
      effect,
      data
    });
  }

  return total;
}

function createPendingEffect(base = {}) {
  return {
    steps: Array.isArray(base.steps) ? base.steps : [],
    meta: {
      imbueStr: base.meta?.imbueStr,
      stacks: base.meta?.stacks,
      largestDie: base.meta?.largestDie,
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
  const reactions = speedLevel;
  const imbueDC = techniqueLevel * 2;
  const maxImbueStacks = techniqueLevel <= 2 ? 1 : techniqueLevel <= 4 ? 2 : 3;
  const talentBonus = getComputedSubskillValue(state, "technique", 3);
  const currentCE = parseInt(state?.ceCurrent, 10) || 0;

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
    const unlockType = art.unlockType || "standard";
    const hasAnyWeapon = equippedWeapons.length > 0;

    if (unlockType === "any_weapon") return hasAnyWeapon;

    if (unlockType === "weapon_stat_threshold") {
      const threshold = art.weaponStatThreshold ?? 4;
      return hasAnyWeapon && equippedWeapons.some(w => {
        const isRanged = normalizeWeaponType(w.weaponType) === "ranged";
        const weaponStat = isRanged ? "speed" : (w.weaponStat || "power");
        return getEffectiveStatLevel(state, effects, weaponStat) >= threshold;
      });
    }

    if (unlockType === "polearm_weapon_stat") {
      const threshold = art.statRequirement?.value ?? 1;
      return equippedWeapons.some(w => {
        if (normalizeWeaponType(w.weaponType) !== "polearm") return false;
        const isRanged = normalizeWeaponType(w.weaponType) === "ranged";
        const weaponStat = isRanged ? "speed" : (w.weaponStat || "power");
        return getEffectiveStatLevel(state, effects, weaponStat) >= threshold;
      });
    }

    // Standard
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
    reactions,
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
    imbueDC,
    maxImbueStacks,
    talentBonus,
    currentCE,
    blackFlashRange: blackFlashRange ?? '—',
    blackFlashMin: blackFlashRange,
  };
}

// ── RENDER ────────────────────────────────────────────────────────────────────

export function renderCombatTabData(data) {
  const set = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.textContent = val ?? "—";
  };

  set("combatActionsValue", data.actions);
  set("combatReactionsValue", data.reactions);
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
  const unlockType = art.unlockType || "standard";

  let reqText = "";
  if (unlockType === "any_weapon") {
    reqText = "Any weapon";
  } else if (unlockType === "weapon_stat_threshold") {
    reqText = `Any weapon, WS Lvl ${art.weaponStatThreshold ?? 4}+`;
  } else if (unlockType === "polearm_weapon_stat") {
    reqText = `Polearm, WS Lvl ${art.statRequirement?.value ?? 1}+`;
  } else {
    const statReq = art.statRequirement?.value
      ? `${art.statRequirement.stat} ${art.statRequirement.value}`
      : "";
    const weaponReq = art.weaponTypeRequirement || "";
    reqText = [statReq, weaponReq].filter(Boolean).join(", ");
  }

  const usesText = art.usesPerEncounter != null ? `Uses: ${art.usesPerEncounter}` : "";
  const cooldownText = art.cooldown === 0
    ? "No Cooldown"
    : art.cooldown
    ? `Cooldown: ${art.cooldown} turn${art.cooldown === 1 ? "" : "s"}`
    : "";

  const metaParts = [usesText, reqText ? `Req: ${reqText}` : "", cooldownText].filter(Boolean);

  return `
    <div class="combat-art-item">
      <strong>${escapeHtml(art.title)}</strong>
      <span>${escapeHtml(art.description)}</span>
      <em>${metaParts.join(" &nbsp;·&nbsp; ")}</em>
    </div>`;
}

function renderUnarmedRow(attack, index) {
  const hitStr =
    attack.diceCount > 0 && attack.bonus !== 0
      ? `${attack.diceCount}d6 ${attack.bonus > 0 ? "+" : ""}${attack.bonus}`
      : attack.diceCount > 0
      ? `${attack.diceCount}d6`
      : "—";

  const attackKey = getAttackKey("unarmed", index);
  const pendingEffect = _pendingAttackEffects.get(attackKey);

  const damageStr =
    attack.damageBonus
      ? `${attack.damageParts.map(p => `${p.count}${p.die}`).join(" + ")} + ${attack.damageBonus}`
      : attack.damageParts.map(p => `${p.count}${p.die}`).join(" + ");

  const damageAction = pendingEffect
    ? "rollPendingDamage"
    : "rollUnarmedDamage";

  const damageDisplay = pendingEffect
    ? (() => {
        const steps = pendingEffect.steps || [];

        let label = damageStr;

        if (steps.includes("blackflash")) {
          label = `✦${label}✦`;
        }

        if (steps.includes("crit")) {
          label += " + CRIT";
        }

        if (steps.includes("imbue")) {
          label += pendingEffect?.meta?.imbueStr
            ? ` + ${pendingEffect?.meta?.imbueStr}`
            : " + IMBUE";
        }

        return label;
      })()
    : damageStr;
    

  return `
    <div class="combat-attack-row combat-attack-row--unarmed">

      <div class="combat-attack-name">${escapeHtml(attack.name)}</div>

      <div class="combat-attack-type">${escapeHtml(attack.type)}</div>

      <div class="combat-attack-range">${escapeHtml(attack.rangeText)}</div>

      <div class="combat-attack-hit combat-attack-rollable"
           data-action="rollUnarmedHit"
           data-unarmed-index="${index}"
           title="Click to roll to hit">
        ${escapeHtml(hitStr)}
      </div>

      <div class="combat-attack-damage combat-attack-rollable"
           data-action="${damageAction}"
           data-attack-key="${attackKey}"
           data-unarmed-index="${index}"
           title="Click to roll damage">
        ${escapeHtml(damageDisplay)}
      </div>

      <button type="button"
              class="combat-imbue-btn"
              data-action="imbueAttack"
              data-unarmed-index="${index}"
              title="Roll to imbue">
        Imbue
      </button>

    </div>
  `;
}

function renderAttackRow(weapon, index, data) {
  const isRanged = normalizeWeaponType(weapon.weaponType) === "ranged";
  const isPolearm = normalizeWeaponType(weapon.weaponType) === "polearm";
  const typeLabel = WEAPON_TYPE_LABELS[weapon.weaponType] ?? weapon.weaponType;

  let statKey = weapon.weaponStat || "power";

  let statLevel =
    statKey === "speed"
      ? data.speedLevel
      : statKey === "technique"
      ? (data.techniqueLevel || 0)
      : data.powerLevel;

  let damageStr = "";

  if (Array.isArray(weapon.weaponDamageParts) && weapon.weaponDamageParts.length > 0) {
    damageStr = weapon.weaponDamageParts
      .map(p => `${p.count}${p.die}`)
      .join(" + ");

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

  const hitStr =
    bonus !== 0
      ? `${diceCount}d6 ${bonus > 0 ? "+" : ""}${bonus}`
      : `${diceCount}d6`;

  const attackKey = getAttackKey("weapon", index);
  const pendingEffect = _pendingAttackEffects.get(attackKey);

  const damageAction = pendingEffect
    ? "rollPendingDamage"
    : "rollDamage";

  const damageDisplay = pendingEffect
    ? (() => {
        const steps = pendingEffect.steps || [];

        let label = damageStr;

        if (steps.includes("blackflash")) {
          label = `✦${label}✦`;
        }

        if (steps.includes("crit")) {
          label += " + CRIT";
        }

        if (steps.includes("imbue")) {
          label += pendingEffect?.meta?.imbueStr
            ? ` + ${pendingEffect?.meta?.imbueStr}`
            : " + IMBUE";
        }

        return label;
      })()
    : damageStr;

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

      <div class="combat-attack-hit combat-attack-rollable"
           data-action="rollHit"
           data-weapon-index="${index}"
           title="Click to roll to hit">
        ${escapeHtml(hitStr)}
      </div>

      <div class="combat-attack-damage combat-attack-rollable"
           data-action="${damageAction}"
           data-attack-key="${attackKey}"
           data-weapon-index="${index}"
           title="Click to roll damage">
        ${escapeHtml(damageDisplay)}
      </div>

      <button type="button"
              class="combat-imbue-btn"
              data-action="imbueAttack"
              data-weapon-index="${index}"
              title="Roll to imbue">
        Imbue
      </button>
    </div>
  `;
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
      if (action === "rollHit") rollHit(weapon, data, weaponIndex);
      if (action === "rollDamage") rollDamage(weapon, data);
    }

    if (action === "rollUnarmedHit" || action === "rollUnarmedDamage") {
      const unarmedIndex = parseInt(target.dataset.unarmedIndex, 10);
      if (!Number.isInteger(unarmedIndex)) return;
      const attack = data.unarmedAttacks[unarmedIndex];
      if (!attack) return;
      if (action === "rollUnarmedHit") rollUnarmedHit(attack, unarmedIndex);
      if (action === "rollUnarmedDamage") rollUnarmedDamage(attack);
    }

    if (action === "rollPendingDamage") {
      const key = target.dataset.attackKey;
      if (!key) return;
      rollPendingDamage(key, data, state);
    }

    if (action === "imbueAttack") {
      const weaponIndex = parseInt(target.dataset.weaponIndex, 10);
      const unarmedIndex = parseInt(target.dataset.unarmedIndex, 10);
      let attackName, damageParts, damageBonus, attackKey;
      if (Number.isInteger(weaponIndex)) {
        const weapon = data.equippedWeapons[weaponIndex];
        if (!weapon) return;
        attackName = weapon.name;
        damageParts = weapon.weaponDamageParts || [{ count: 1, die: "d6" }];
        const statKey = weapon.weaponStat || "power";
        damageBonus = statKey === "speed" ? data.speedLevel
          : statKey === "technique" ? data.techniqueLevel
          : data.powerLevel;
        attackKey = getAttackKey("weapon", weaponIndex);
      } else if (Number.isInteger(unarmedIndex)) {
        const attack = data.unarmedAttacks[unarmedIndex];
        if (!attack) return;
        attackName = attack.name;
        damageParts = attack.damageParts;
        damageBonus = attack.damageBonus;
        attackKey = getAttackKey("unarmed", unarmedIndex);
      } else return;
      rollImbue(attackName, damageParts, damageBonus, data, state, attackKey);
    }
  });

  // Right-click to clear pending effect
  panel.addEventListener("contextmenu", e => {
    const target = e.target.closest("[data-action='rollPendingDamage']");
    if (!target) return;
    e.preventDefault();
    const key = target.dataset.attackKey;
    if (!key) return;
    _pendingAttackEffects.delete(key);
    const state = _getState();
    if (state) renderCombatTabData(computeCombatTabData(state));
  });
}
  
  // Sub-collapse buttons
  ["combatAttacksCollapseBtn", "combatArtsCollapseBtn", "combatBasicActionsCollapseBtn", 
  "combatReactionsCollapseBtn", "combatBasicReactionsCollapseBtn"].forEach(btnId => {
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

function rollHit(weapon, data, weaponIndex) {
  if (!_showRollToast) return;

  const isRanged =
    normalizeWeaponType(weapon.weaponType) === "ranged";

  const diceCount =
    isRanged ? data.speedLevel : data.powerLevel;

  const bonus =
    isRanged ? data.precisionBonus : data.combatBonus;

  const statLabel = isRanged ? "Speed" : "Power";
  const skillLabel = isRanged ? "Precision" : "Combat";

  if (!diceCount || diceCount < 1) return;

  const rolls = rollDice(diceCount, 6);

  const total =
    rolls.reduce((a, b) => a + b, 0) + bonus;

  const allOnes = rolls.every(r => r === 1);

  const critStatus =
    allOnes
      ? "fail"
      : total >= diceCount * 6
      ? "success"
      : null;

  const attackKey = getAttackKey("weapon", weaponIndex);

  if (critStatus === "success") {
    const existing = _pendingAttackEffects.get(attackKey);

    const base = existing || {
      steps: [],
    };

    const steps = new Set(base.steps || []);

    steps.add("crit");

    _pendingAttackEffects.set(attackKey, {
      ...base,
      steps: [...steps],
      largestDie: getLargestDamageDie(attack.damageParts),
    });

    renderCombatTabData(computeCombatTabData(_getState()));
  }

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

  const parts =
    weapon.weaponDamageParts || [{ count: 1, die: "d6" }];

  let total = 0;

  const allRolls = [];
  const dieGroups = [];

  for (const part of parts) {
    const sides =
      parseInt(String(part.die).replace("d", ""), 10) || 6;

    const rolls = rollDice(part.count, sides);

    const partTotal =
      rolls.reduce((a, b) => a + b, 0);

    total += partTotal;

    allRolls.push(...rolls);

    dieGroups.push({
      label: `${part.count}${part.die}`,
      rolls,
      total: partTotal,
    });
  }

  let statKey = weapon.weaponStat || "power";

  let statBonus = 0;

  if (statKey === "power") {
    statBonus = data.powerLevel;
  } else if (statKey === "speed") {
    statBonus = data.speedLevel;
  } else if (statKey === "technique") {
    statBonus = data.techniqueLevel || 0;
  } else {
    statBonus = data.powerLevel;
  }

  total += statBonus;

  _showRollToast(
    statKey.charAt(0).toUpperCase() + statKey.slice(1),
    parts[0]?.count || 1,
    allRolls,
    total,
    null,
    `${weapon.name} — Damage`,
    {
      skillModifier: statBonus,
      die: parts[0]?.die || "d6",
      dieGroups,
    },
    null,
  );
}

function rollUnarmedHit(attack, unarmedIndex) {
  if (!_showRollToast || !attack.diceCount || attack.diceCount < 1) return;

  const rolls = rollDice(attack.diceCount, 6);

  const total =
    rolls.reduce((a, b) => a + b, 0) + attack.bonus;

  const allOnes = rolls.every(r => r === 1);

  const critStatus =
    allOnes
      ? "fail"
      : total >= attack.diceCount * 6
      ? "success"
      : null;

  const attackKey = getAttackKey("unarmed", unarmedIndex);

  if (critStatus === "success") {
    const existing = getPendingEffect(attackKey);

    const steps = new Set(existing?.steps || []);
    steps.add("crit");

    _pendingAttackEffects.set(
      attackKey,
      createPendingEffect({
        steps: [...steps],
        meta: {
          ...existing?.meta,
          largestDie: getLargestDamageDie(attack.damageParts),
          damageParts: attack.damageParts,
        }
      })
    );

    renderCombatTabData(computeCombatTabData(_getState()));
  }

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

  let total = attack.damageBonus;

  const allRolls = [];
  const dieGroups = [];

  for (const part of attack.damageParts) {
    const sides =
      parseInt(String(part.die).replace("d", ""), 10) || 4;

    const rolls = rollDice(part.count, sides);

    const partTotal =
      rolls.reduce((a, b) => a + b, 0);

    total += partTotal;

    allRolls.push(...rolls);

    dieGroups.push({
      label: `${part.count}${part.die}`,
      rolls,
      total: partTotal,
    });
  }

  _showRollToast(
    attack.statLabel,
    attack.damageParts[0]?.count || 1,
    allRolls,
    total,
    null,
    `${attack.name} — Damage`,
    {
      skillModifier: attack.damageBonus,
      die: attack.damageParts[0]?.die || "d4",
      dieGroups,
    },
    null,
  );
}

function rollImbue(attackName, damageParts, damageBonus, data, state, attackKey) {
  if (!_showRollToast) return;
  const { techniqueLevel, imbueDC, maxImbueStacks, talentBonus, blackFlashMin } = data;
  const diceCount = techniqueLevel;
  if (!diceCount || diceCount < 1) return;

  const rawRolls = rollDice(diceCount, 6);
  const naturalTotal = rawRolls.reduce((a, b) => a + b, 0);
  const totalWithBonus = naturalTotal + talentBonus;
  const isBlackFlash = blackFlashMin !== null && naturalTotal >= blackFlashMin;
  const dcMet = isBlackFlash || totalWithBonus >= imbueDC;
  const excessOverDC = Math.max(0, totalWithBonus - imbueDC);
  const stacksAvailable = isBlackFlash ? 0 : Math.min(Math.floor(excessOverDC / 2), maxImbueStacks);

  if (isBlackFlash) {
    const existing = getPendingEffect(attackKey);

    const steps = new Set(existing?.steps || []);

    // Black Flash overrides everything imbue-related
    steps.delete("imbue");
    steps.add("blackflash");

    _pendingAttackEffects.set(
      attackKey,
      createPendingEffect({
        steps: [...steps],
        meta: {
          ...existing?.meta,
          damageParts,
          damageBonus,
          imbueStr: undefined,
          stacks: 0
        }
      })
    );

    renderCombatTabData(computeCombatTabData(state));

    _showRollToast(
      "Technique",
      diceCount,
      rawRolls,
      naturalTotal,
      "success",
      `${attackName} — ✦ BLACK FLASH ✦`,
      { skillModifier: 0, die: "d6" },
      null,
    );

    return;
  }

  // Show success toast then prompt for stacks
  _showRollToast(
    "Technique", diceCount, rawRolls, totalWithBonus, null,
    `${attackName} — Imbue Success (DC ${imbueDC})`,
    { skillModifier: talentBonus, die: "d6" }, null,
  );

  promptImbueStacks({
    attackName, damageParts, damageBonus,
    imbueBase: data.imbue.die,
    stacksAvailable, maxImbueStacks,
    currentCE: parseInt(state?.ceCurrent, 10) || 0,
    state, data, attackKey,
    rawRolls, totalWithBonus, imbueDC, talentBonus, diceCount,
  });
}

function rollImbueDie(dieStr) {
  // Parse "1d4", "1d4+2", "2d4"
  const plusMatch = dieStr.match(/^(\d+)d(\d+)\+(\d+)$/);
  const basicMatch = dieStr.match(/^(\d+)d(\d+)$/);
  if (plusMatch) {
    const count = parseInt(plusMatch[1]);
    const sides = parseInt(plusMatch[2]);
    const bonus = parseInt(plusMatch[3]);
    const rolls = rollDice(count, sides);
    return { total: rolls.reduce((a, b) => a + b, 0) + bonus, rolls, bonus, dieStr };
  }
  if (basicMatch) {
    const count = parseInt(basicMatch[1]);
    const sides = parseInt(basicMatch[2]);
    const rolls = rollDice(count, sides);
    return { total: rolls.reduce((a, b) => a + b, 0), rolls, bonus: 0, dieStr };
  }
  return { total: 0, rolls: [], bonus: 0, dieStr };
}

function promptImbueStacks(ctx) {
  const { attackName, stacksAvailable, maxImbueStacks, currentCE,
          state, imbueBase, attackKey } = ctx;

  document.getElementById("combatImbuePrompt")?.remove();
  const maxAffordable = Math.min(stacksAvailable, Math.floor(currentCE / 3), maxImbueStacks);

  const prompt = document.createElement("div");
  prompt.id = "combatImbuePrompt";
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
              <button type="button" class="combat-imbue-stack-btn" data-stacks="${n}">
                +${n} (${n * 3} CE)
              </button>
            `).join("")}
          </div>
        </div>
      ` : ""}
      <div class="combat-imbue-prompt-actions">
        <button type="button" class="combat-imbue-confirm-btn" data-stacks="0">No stacks</button>
        <button type="button" class="combat-imbue-cancel-btn">Cancel</button>
      </div>
    </div>
  `;

  const confirm = (stacks) => {
    const ceCost = stacks * 3;
    if (ceCost > 0) {
      const newCE = Math.max(0, (parseInt(state.ceCurrent, 10) || 0) - ceCost);
      state.ceCurrent = String(newCE);
      const ceEl = document.getElementById("ceCurrent");
      if (ceEl) ceEl.value = String(newCE);
      if (typeof _scheduleSave === "function") _scheduleSave();
    }

    // Build imbue string for display
    const stackDice = stacks > 0 ? `+${stacks}d4` : "";
    const imbueStr = stacks > 0 ? `${imbueBase}+${stacks}d4` : imbueBase;

    const existing = getPendingEffect(attackKey);

    const steps = new Set(existing?.steps || []);
    steps.add("imbue");

    _pendingAttackEffects.set(
      attackKey,
      createPendingEffect({
        steps: [...steps],
        meta: {
          ...existing?.meta,
          imbueStr,
          stacks,
        }
      })
    );

    renderCombatTabData(computeCombatTabData(state));
    prompt.remove();
  };

  prompt.querySelectorAll(".combat-imbue-stack-btn").forEach(btn => {
    btn.addEventListener("click", () => confirm(parseInt(btn.dataset.stacks, 10) || 0));
  });
  prompt.querySelector(".combat-imbue-confirm-btn").addEventListener("click", () => confirm(0));
  prompt.querySelector(".combat-imbue-cancel-btn").addEventListener("click", () => prompt.remove());

  document.getElementById("panel-combat")?.appendChild(prompt);
}

function finalizeImbue(ctx, stacks) {
  const { attackName, damageParts, damageBonus, imbueRoll, data, diceCount, rawRolls, totalWithBonus, talentBonus } = ctx;

  // Roll stack dice
  let stackTotal = 0;
  const stackRolls = [];
  for (let i = 0; i < stacks; i++) {
    const r = rollDice(1, 4);
    stackRolls.push(...r);
    stackTotal += r[0];
  }

  // Roll weapon damage
  let weaponDamage = damageBonus;
  const weaponRolls = [];
  damageParts.forEach(part => {
    const sides = parseInt(String(part.die).replace("d", ""), 10) || 6;
    const rolls = rollDice(part.count, sides);
    weaponRolls.push(...rolls);
    weaponDamage += rolls.reduce((a, b) => a + b, 0);
  });

  const imbueDamage = imbueRoll.total + stackTotal;
  const total = weaponDamage + imbueDamage;

  const stackStr = stacks > 0
    ? ` + ${stacks} stack${stacks > 1 ? "s" : ""} [${stackRolls.join(", ")}] (${stackTotal})`
    : "";
  const label = `${attackName} — Imbued Damage · Imbue: ${imbueRoll.dieStr} (${imbueRoll.total})${stackStr}`;

  _showRollToast(
    "Damage",
    damageParts[0]?.count || 1,
    weaponRolls,
    total,
    null,
    label,
    { skillModifier: imbueDamage, die: damageParts[0]?.die || "d6" },
    null,
  );
}

function rollPendingDamage(key, data, state) {
  const effect = _pendingAttackEffects.get(key);
  const [type, indexStr] = key.split("-");
  const index = parseInt(indexStr, 10);

  let attackName, damageParts, damageBonus;

  if (type === "weapon") {
    const weapon = data.equippedWeapons[index];
    if (!weapon) return;

    attackName = weapon.name;
    damageParts = weapon.weaponDamageParts || [{ count: 1, die: "d6" }];

    const statKey = weapon.weaponStat || "power";
    damageBonus =
      statKey === "speed"
        ? data.speedLevel
        : statKey === "technique"
        ? data.techniqueLevel
        : data.powerLevel;

  } else {
    const attack = data.unarmedAttacks[index];
    if (!attack) return;

    attackName = attack.name;
    damageParts = attack.damageParts;
    damageBonus = attack.damageBonus;
  }

  // ── BASE ROLL ─────────────────────────────────────────────
  let baseTotal = damageBonus;
  const baseRolls = [];
  const dieGroups = [];

  for (const part of damageParts) {
    const sides = parseInt(String(part.die).replace("d", ""), 10) || 6;
    const rolls = rollDice(part.count, sides);

    const partTotal = rolls.reduce((a, b) => a + b, 0);

    baseTotal += partTotal;
    baseRolls.push(...rolls);

    dieGroups.push({
      label: `${part.count}${part.die}`,
      rolls,
      total: partTotal,
    });
  }

  // ── NO EFFECT ─────────────────────────────────────────────
  if (!effect) {
    _showRollToast(
      "Damage",
      damageParts[0]?.count || 1,
      baseRolls,
      baseTotal,
      null,
      `${attackName} — Damage`,
      { skillModifier: damageBonus, dieGroups },
      null
    );
    return;
  }

  // ── EFFECT PIPELINE (THE ONLY SYSTEM NOW) ────────────────
  const extraGroups = [...dieGroups];

  let finalTotal = applyEffectsPipeline(
    baseTotal,
    effect,
    extraGroups,
    data
  );

  _showRollToast(
    "Damage",
    damageParts[0]?.count || 1,
    baseRolls,
    finalTotal,
    null,
    `${attackName} — ${effect.steps?.join(" + ") || "Enhanced"} Damage`,
    {
      skillModifier: damageBonus,
      die: damageParts[0]?.die || "d6",
      dieGroups: extraGroups,
    },
    null
  );

  _pendingAttackEffects.delete(key);
  renderCombatTabData(computeCombatTabData(state));
}