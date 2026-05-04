import { BODY_SLOT_KEYS, BODY_SLOT_LABELS } from "./state/store.js";
import {
  computeActiveModifierEffects,
  describeModifier,
  getItemModifierSummary,
  getSkillOptions,
  getStatDefinitions,
  normalizeModifierList,
} from "./modifiers.js";

let _getState = null;
let _scheduleSave = null;
let _refreshCharacterStats = null;
let editingItemId = null;
let isInitialized = false;
let draggingItemId = null;
let dragGhostEl = null;
const expandedDescriptionIds = new Set();
let openEquipPickerItemId = null;
let openMovePickerItemId = null;
let openYenAdjustMode = null;
let openOverflowChoice = null;
let draftItemModifiers = [];
let editingModifierIndex = null;
let isModifierEditMode = false;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function getState() {
  return _getState ? _getState() : null;
}

function scheduleSave() {
  if (_scheduleSave) _scheduleSave();
}

const HAND_SLOT_KEYS = ["rightHand", "leftHand"];
const CLOTHING_SELECTABLE_SLOT_KEYS = ["head", "body", "legs", "feet", "accessory"];
const ITEM_TYPES = ["clothing", "weapon", "item"];
const WEAPON_TYPES = ["bludgeoning", "slashing", "ranged", "polearm"];
const WEAPON_TYPE_LABELS = {
  bludgeoning: "Bludgeoning",
  slashing: "Slashing",
  ranged: "Ranged",
  polearm: "Polearm",
};
const WEAPON_STAT_OPTIONS = ["power", "speed", "technique"];
const WEAPON_STAT_LABELS = {
  power: "Power",
  speed: "Speed",
  technique: "Tech",
};
const WEAPON_DAMAGE_DICE = ["d4", "d6", "d8", "d10", "d12"];

function normalizeItemType(rawType) {
  return ITEM_TYPES.includes(rawType) ? rawType : "clothing";
}

function normalizeWeaponType(rawType) {
  return WEAPON_TYPES.includes(rawType) ? rawType : "bludgeoning";
}

function normalizeWeaponStat(rawStat) {
  if (rawStat === "tech") return "technique";
  return WEAPON_STAT_OPTIONS.includes(rawStat) ? rawStat : "power";
}

function parseWeaponRange(rawValue) {
  const parsed = parseInt(rawValue, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return clamp(parsed, 1, 9999);
}

function parseWeaponPolearmReach(rawValue) {
  return rawValue === true || rawValue === "true" || rawValue === 1;
}

function getWeaponReachInFeet(item) {
  const weaponType = normalizeWeaponType(item?.weaponType);
  if (weaponType === "ranged") return parseWeaponRange(item?.weaponRange);
  if (weaponType === "slashing" || weaponType === "bludgeoning") return 5;
  if (weaponType === "polearm") return parseWeaponPolearmReach(item?.weaponPolearmReach) ? 10 : 5;
  return null;
}

function shouldDisplayWeaponRange(item) {
  const weaponType = normalizeWeaponType(item?.weaponType);
  return weaponType === "ranged" || weaponType === "polearm";
}

function parseWeaponDamageCount(rawValue) {
  const parsed = parseInt(rawValue, 10);
  if (!Number.isFinite(parsed)) return 1;
  return clamp(parsed, 1, 99);
}

function normalizeWeaponDamageDie(rawDie) {
  const normalized = String(rawDie || "").toLowerCase();
  if (WEAPON_DAMAGE_DICE.includes(normalized)) return normalized;
  return "d6";
}

function normalizeWeaponDamageParts(rawParts) {
  if (!Array.isArray(rawParts)) return [{ count: 1, die: "d6" }];

  const parsed = rawParts
    .map(part => ({
      count: parseWeaponDamageCount(part?.count),
      die: normalizeWeaponDamageDie(part?.die),
    }))
    .filter(part => Number.isFinite(part.count) && part.count > 0);

  return parsed.length ? parsed : [{ count: 1, die: "d6" }];
}

function formatWeaponDamageParts(parts) {
  return normalizeWeaponDamageParts(parts)
    .map(part => `${part.count}${part.die}`)
    .join(" + ");
}

function normalizeWeaponGrip(rawGrip, slotsNeeded) {
  if (rawGrip === "twoHanded" || rawGrip === "oneHanded") return rawGrip;
  return clamp(parseInt(slotsNeeded, 10) || 1, 1, 3) >= 2 ? "twoHanded" : "oneHanded";
}

function getItemTypeLabel(itemType) {
  if (itemType === "weapon") return "Weapon";
  if (itemType === "item") return "Item";
  return "Clothing/Accessory";
}

function isItemTypeDormRestricted(item) {
  return false;
}

function getInternalAllowedSlots(item) {
  return [...new Set((item.allowedSlots || []).flatMap(toInternalEquipSlots))].filter(slot => BODY_SLOT_KEYS.includes(slot));
}

function applyItemTypeDefaults(item) {
  const itemType = normalizeItemType(item.itemType);
  item.itemType = itemType;

  if (itemType === "weapon") {
    item.weaponGrip = normalizeWeaponGrip(item.weaponGrip, item.slotsNeeded);
    item.allowedSlots = ["rightHand", "leftHand"];
    item.slotsNeeded = item.weaponGrip === "twoHanded" ? 2 : 1;
    item.weaponType = normalizeWeaponType(item.weaponType);
    item.weaponStat = normalizeWeaponStat(item.weaponStat);
    item.weaponDamageParts = normalizeWeaponDamageParts(item.weaponDamageParts);
    item.weaponRange = item.weaponType === "ranged" ? parseWeaponRange(item.weaponRange) : null;
    item.weaponPolearmReach = item.weaponType === "polearm" ? parseWeaponPolearmReach(item.weaponPolearmReach) : false;
    item.stackable = false;
    item.quantity = 1;
    return;
  }

  if (itemType === "item") {
    item.weaponGrip = null;
    item.weaponType = null;
    item.weaponStat = null;
    item.weaponDamageParts = [];
    item.weaponRange = null;
    item.weaponPolearmReach = false;
    item.allowedSlots = ["rightHand", "leftHand"];
    item.slotsNeeded = 1;
    item.stackable = parseStackableValue(item.stackable);
    item.quantity = item.stackable ? parseItemQuantity(item.quantity) : 1;
    return;
  }

  item.weaponGrip = null;
  item.weaponType = null;
  item.weaponStat = null;
  item.weaponDamageParts = [];
  item.weaponRange = null;
  item.weaponPolearmReach = false;
  item.allowedSlots = normalizeAllowedSlots(item.allowedSlots).filter(slot => CLOTHING_SELECTABLE_SLOT_KEYS.includes(slot));
  item.slotsNeeded = clamp(parseInt(item.slotsNeeded, 10) || 1, 1, 3);
  item.stackable = false;
  item.quantity = 1;
}

function inferLegacyItemType(item) {
  const allowed = normalizeAllowedSlots(item?.allowedSlots);
  const internalAllowed = [...new Set(allowed.flatMap(toInternalEquipSlots))];
  const onlyHands = internalAllowed.length > 0 && internalAllowed.every(slot => HAND_SLOT_KEYS.includes(slot));
  return onlyHands ? "weapon" : "clothing";
}

function toInternalEquipSlots(slot) {
  if (slot === "accessory") return ["accessory1", "accessory2"];
  if (slot === "chest" || slot === "back") return ["body"];
  return BODY_SLOT_KEYS.includes(slot) ? [slot] : [];
}

function normalizeAllowedSlots(rawSlots) {
  if (!Array.isArray(rawSlots)) return [];

  const normalized = [];
  rawSlots.forEach(slot => {
    // Legacy support: accessory/accessory1/accessory2 all map to one selectable key.
    if (slot === "accessory" || slot === "accessory1" || slot === "accessory2") {
      normalized.push("accessory");
      return;
    }
    if (slot === "chest" || slot === "back") {
      normalized.push("body");
      return;
    }
    if (BODY_SLOT_KEYS.includes(slot)) normalized.push(slot);
  });

  return [...new Set(normalized)];
}

function countInternalAllowedSlots(allowedSlots) {
  return [...new Set((allowedSlots || []).flatMap(toInternalEquipSlots))].length;
}

function getAllowedSlotLabel(slot) {
  if (slot === "accessory") return "Accessory";
  return BODY_SLOT_LABELS[slot] || slot;
}

function getInventoryItemById(itemId) {
  const state = getState();
  return state?.inventoryItems?.find(item => item.id === itemId) || null;
}

function parseYenValue(rawValue) {
  const parsed = parseInt(rawValue, 10);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, parsed);
}

function parseItemQuantity(rawValue) {
  const parsed = parseInt(rawValue, 10);
  if (!Number.isFinite(parsed)) return 1;
  return clamp(parsed, 1, 999);
}

function parseStackableValue(rawValue) {
  return rawValue === true || rawValue === "true" || rawValue === 1;
}

function parseYenInputText(rawValue) {
  const digitsOnly = String(rawValue ?? "").replace(/[^\d]/g, "");
  if (!digitsOnly) return 0;
  return parseYenValue(digitsOnly);
}

function formatYenValue(value) {
  return parseYenValue(value).toLocaleString("en-US");
}

function setYenInputDisplay(value) {
  const yenInput = document.getElementById("yenInput");
  if (!yenInput) return;
  yenInput.value = formatYenValue(value);
}

function closeYenAdjustPopover() {
  const popover = document.getElementById("yenAdjustPopover");
  if (!popover) return;
  openYenAdjustMode = null;
  popover.hidden = true;
}

function openYenAdjustPopoverFor(mode) {
  const popover = document.getElementById("yenAdjustPopover");
  const title = document.getElementById("yenAdjustTitle");
  const amountInput = document.getElementById("yenAdjustAmountInput");
  if (!popover || !title || !amountInput) return;

  openYenAdjustMode = mode;
  title.textContent = mode === "add" ? "Add Yen" : "Deduct Yen";
  amountInput.value = "";
  popover.hidden = false;
  amountInput.focus();
}

function applyYenAdjustFromPopover() {
  if (!openYenAdjustMode) return;

  const amountInput = document.getElementById("yenAdjustAmountInput");
  const state = getState();
  if (!amountInput || !state) return;

  const amount = parseYenInputText(amountInput.value);
  if (amount <= 0) {
    closeYenAdjustPopover();
    return;
  }

  const currentYen = parseYenValue(state.yen);
  const nextYen = openYenAdjustMode === "add"
    ? currentYen + amount
    : Math.max(0, currentYen - amount);

  state.yen = nextYen;
  setYenInputDisplay(nextYen);
  closeYenAdjustPopover();
  scheduleSave();
}

function makeItemId() {
  return `item_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function setItemFormError(message) {
  const el = document.getElementById("itemFormError");
  if (!el) return;
  el.textContent = message || "";
}

function cloneDraftModifiers(modifiers) {
  return normalizeModifierList(modifiers).map(entry => ({ ...entry }));
}

function getDraftModifierSummary() {
  if (!draftItemModifiers.length) return "No modifiers added.";
  return draftItemModifiers.map(describeModifier).filter(Boolean).join(" | ");
}

function refreshModifierSummary() {
  const summaryEl = document.getElementById("itemModifiersSummary");
  if (!summaryEl) return;
  summaryEl.textContent = getDraftModifierSummary();
}

function renderDraftModifierList() {
  const listEl = document.getElementById("itemModifiersList");
  if (!listEl) return;

  if (!draftItemModifiers.length) {
    listEl.innerHTML = '<div class="inventory-modifier-empty">No modifiers yet.</div>';
    return;
  }

  listEl.innerHTML = draftItemModifiers.map((modifier, index) => `
    <div class="inventory-modifier-row" data-modifier-index="${index}">
      <div class="inventory-modifier-row-text">${escapeHtml(describeModifier(modifier))}</div>
      ${isModifierEditMode ? `
      <div class="inventory-modifier-row-actions">
        <button type="button" class="inventory-mini-btn" data-action="editDraftModifier" data-index="${index}">Edit</button>
        <button type="button" class="inventory-mini-btn danger" data-action="removeDraftModifier" data-index="${index}">Remove</button>
      </div>
      ` : ""}
    </div>
  `).join("");
}

function setModifierEditMode(isEditing) {
  isModifierEditMode = Boolean(isEditing);
  const editBtn = document.getElementById("itemEditModifiersBtn");
  const addBtn = document.getElementById("itemAddModifierBtn");
  const editor = document.getElementById("itemModifiersEditor");
  if (editBtn) editBtn.textContent = isModifierEditMode ? "Done" : "Edit";
  if (addBtn) addBtn.hidden = !isModifierEditMode;
  if (editor) editor.hidden = false;
  if (!isModifierEditMode) editingModifierIndex = null;
  // Keep the Type/Stat/Substat/Value form hidden unless Add/Edit action explicitly opens it.
  setModifierFormVisibility(false);
  renderDraftModifierList();
}

function setModifierFormVisibility(isVisible) {
  const form = document.getElementById("itemModifierForm");
  if (!form) return;
  form.hidden = !isVisible;
  form.style.display = isVisible ? "grid" : "none";
}

function syncModifierSkillOptions() {
  const statSelect = document.getElementById("itemModifierStatSelect");
  const skillSelect = document.getElementById("itemModifierSkillSelect");
  if (!statSelect || !skillSelect) return;

  const skills = getSkillOptions(statSelect.value);
  skillSelect.innerHTML = skills.map((skill, index) => `<option value="${index}">${escapeHtml(skill)}</option>`).join("");
}

function syncModifierFieldVisibility() {
  const kindSelect = document.getElementById("itemModifierKindSelect");
  const statField = document.getElementById("itemModifierStatField");
  const skillField = document.getElementById("itemModifierSkillField");
  if (!kindSelect || !statField || !skillField) return;

  const kind = kindSelect.value;
  const needsStat = ["stat", "rolls", "skill"].includes(kind);
  const needsSkill = kind === "skill";
  statField.hidden = !needsStat;
  skillField.hidden = !needsSkill;
  statField.style.display = needsStat ? "flex" : "none";
  skillField.style.display = needsSkill ? "flex" : "none";
  syncModifierSkillOptions();
}

function resetModifierDraftForm() {
  editingModifierIndex = null;
  const kindSelect = document.getElementById("itemModifierKindSelect");
  const statSelect = document.getElementById("itemModifierStatSelect");
  const valueInput = document.getElementById("itemModifierValueInput");
  if (kindSelect) kindSelect.value = "stat";
  if (statSelect) statSelect.value = getStatDefinitions()[0]?.key || "power";
  if (valueInput) valueInput.value = "1";
  syncModifierSkillOptions();
  const skillSelect = document.getElementById("itemModifierSkillSelect");
  if (skillSelect) skillSelect.value = "0";
  syncModifierFieldVisibility();
}

function getModifierDraftFromForm() {
  const kind = document.getElementById("itemModifierKindSelect")?.value || "stat";
  const statKey = document.getElementById("itemModifierStatSelect")?.value || "power";
  const skillIndex = parseInt(document.getElementById("itemModifierSkillSelect")?.value, 10) || 0;
  const value = parseInt(document.getElementById("itemModifierValueInput")?.value, 10) || 0;

  const draft = {
    id: `mod_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    kind,
    value,
  };

  if (["stat", "rolls", "skill"].includes(kind)) draft.statKey = statKey;
  if (kind === "skill") draft.skillIndex = skillIndex;
  return normalizeModifierList([draft])[0] || null;
}

function openModifierEditor() {
  setModifierEditMode(true);
  refreshModifierSummary();
}

function closeModifierEditor() {
  setModifierEditMode(false);
}

function handleDraftModifierListClick(event) {
  if (!isModifierEditMode) return;
  const button = event.target.closest("button[data-action]");
  if (!button) return;

  const index = parseInt(button.dataset.index, 10);
  if (!Number.isInteger(index) || !draftItemModifiers[index]) return;

  if (button.dataset.action === "removeDraftModifier") {
    draftItemModifiers.splice(index, 1);
    editingModifierIndex = null;
    renderDraftModifierList();
    refreshModifierSummary();
    setModifierFormVisibility(false);
    return;
  }

  if (button.dataset.action === "editDraftModifier") {
    const modifier = draftItemModifiers[index];
    editingModifierIndex = index;
    setModifierFormVisibility(true);
    document.getElementById("itemModifierKindSelect").value = modifier.kind;
    document.getElementById("itemModifierStatSelect").value = modifier.statKey || getStatDefinitions()[0]?.key || "power";
    syncModifierSkillOptions();
    document.getElementById("itemModifierSkillSelect").value = String(Number.isInteger(modifier.skillIndex) ? modifier.skillIndex : 0);
    document.getElementById("itemModifierValueInput").value = String(modifier.value);
    syncModifierFieldVisibility();
  }
}

function initModifierEditorUI() {
  const editBtn = document.getElementById("itemEditModifiersBtn");
  const addBtn = document.getElementById("itemAddModifierBtn");
  const list = document.getElementById("itemModifiersList");
  const kindSelect = document.getElementById("itemModifierKindSelect");
  const statSelect = document.getElementById("itemModifierStatSelect");
  const saveBtn = document.getElementById("itemModifierSaveBtn");
  const cancelBtn = document.getElementById("itemModifierCancelBtn");
  if (!editBtn || !addBtn || !list || !kindSelect || !statSelect || !saveBtn || !cancelBtn) return;

  const editor = document.getElementById("itemModifiersEditor");
  const statDefinitions = getStatDefinitions();
  statSelect.innerHTML = statDefinitions.map(def => `<option value="${def.key}">${escapeHtml(def.label)}</option>`).join("");
  if (editor) editor.hidden = false;
  resetModifierDraftForm();
  renderDraftModifierList();
  refreshModifierSummary();
  setModifierEditMode(false);

  editBtn.addEventListener("click", () => {
    if (!isModifierEditMode) openModifierEditor();
    else closeModifierEditor();
  });

  addBtn.addEventListener("click", () => {
    if (!isModifierEditMode) return;
    editingModifierIndex = null;
    resetModifierDraftForm();
    setModifierFormVisibility(true);
  });

  list.addEventListener("click", handleDraftModifierListClick);
  kindSelect.addEventListener("change", syncModifierFieldVisibility);
  statSelect.addEventListener("change", syncModifierSkillOptions);

  saveBtn.addEventListener("click", () => {
    const nextModifier = getModifierDraftFromForm();
    if (!nextModifier) {
      setItemFormError("Modifier value must be non-zero.");
      return;
    }
    setItemFormError("");

    if (Number.isInteger(editingModifierIndex) && draftItemModifiers[editingModifierIndex]) {
      nextModifier.id = draftItemModifiers[editingModifierIndex].id;
      draftItemModifiers[editingModifierIndex] = nextModifier;
    } else {
      draftItemModifiers.push(nextModifier);
    }

    editingModifierIndex = null;
    setModifierFormVisibility(false);
    renderDraftModifierList();
    refreshModifierSummary();
  });

  cancelBtn.addEventListener("click", () => {
    editingModifierIndex = null;
    setModifierFormVisibility(false);
  });
}

function setItemEditorOpen(isOpen) {
  const panel = document.getElementById("itemEditorPanel");
  const toggleBtn = document.getElementById("toggleItemEditorBtn");
  const toolbar = document.getElementById("itemEditorToolbar");
  const typeToolbar = document.getElementById("itemTypeField");
  if (!panel || !toggleBtn) return;
  panel.classList.toggle("collapsed", !isOpen);
  panel.setAttribute("aria-hidden", isOpen ? "false" : "true");
  toggleBtn.setAttribute("aria-expanded", isOpen ? "true" : "false");
  toggleBtn.setAttribute("aria-label", isOpen ? "Close item editor" : "Create item");
  toggleBtn.setAttribute("title", isOpen ? "Close item editor" : "Create item");
  toggleBtn.classList.toggle("is-open", isOpen);
  toolbar?.classList.toggle("is-open", isOpen);
  typeToolbar?.setAttribute("aria-hidden", isOpen ? "false" : "true");
}

function setActiveItemType(itemType) {
  const normalizedType = normalizeItemType(itemType);
  const input = document.getElementById("itemTypeSelect");
  if (!input) return normalizedType;

  input.value = normalizedType;
  document.querySelectorAll(".inventory-type-tab").forEach(button => {
    const isActive = button.dataset.itemType === normalizedType;
    button.classList.toggle("active", isActive);
    button.setAttribute("aria-selected", isActive ? "true" : "false");
    button.setAttribute("tabindex", isActive ? "0" : "-1");
  });
  return normalizedType;
}

function setDormOpen(isOpen) {
  const panel = document.getElementById("dormPanel");
  const toggleBtn = document.getElementById("dormToggleBtn");
  if (!panel || !toggleBtn) return;
  panel.classList.toggle("collapsed", !isOpen);
  toggleBtn.setAttribute("aria-expanded", isOpen ? "true" : "false");
}

function removeItemFromContainers(item) {
  const state = getState();
  state.inventorySlots = state.inventorySlots.map(id => (id === item.id ? null : id));
  state.dormItemIds = state.dormItemIds.filter(id => id !== item.id);
  BODY_SLOT_KEYS.forEach(slot => {
    if (state.equippedSlots[slot] === item.id) state.equippedSlots[slot] = null;
  });
  item.inventorySlot = null;
  item.equippedSlots = [];
}

function placeItemInInventorySlot(item, slotIndex) {
  const state = getState();
  if (slotIndex < 0 || slotIndex >= state.inventorySlots.length) return false;
  if (state.inventorySlots[slotIndex]) return false;
  removeItemFromContainers(item);
  state.inventorySlots[slotIndex] = item.id;
  item.location = "inventory";
  item.inventorySlot = slotIndex;
  return true;
}

function placeItemInFirstFreeInventorySlot(item) {
  const state = getState();
  const slotIndex = state.inventorySlots.findIndex(id => !id);
  if (slotIndex === -1) return false;
  return placeItemInInventorySlot(item, slotIndex);
}

function placeItemInDorm(item) {
  if (isItemTypeDormRestricted(item)) return false;
  const state = getState();
  removeItemFromContainers(item);
  item.location = "dorm";
  if (!state.dormItemIds.includes(item.id)) state.dormItemIds.push(item.id);
  return true;
}

function moveItemToDestination(item, destination) {
  if (destination === "inventory") {
    if (item.location === "inventory") return { ok: true };
    return placeItemInFirstFreeInventorySlot(item)
      ? { ok: true }
      : { ok: false, message: "Active inventory is full. Free a slot first." };
  }

  if (destination === "dorm") {
    if (item.location === "dorm") return { ok: true };
    if (isItemTypeDormRestricted(item)) {
      return { ok: false, message: "Items cannot be sent to storage." };
    }
    return placeItemInDorm(item)
      ? { ok: true }
      : { ok: false, message: "Could not move item to storage." };
  }

  return { ok: false, message: "Move target not recognized." };
}

function getEquipSlotsForItem(item, preferredPrimarySlot) {
  const state = getState();
  const allowed = getInternalAllowedSlots(item);
  if (!allowed.length) return { ok: false, message: "This item has no equip slots selected." };

  const slotsNeeded = clamp(parseInt(item.slotsNeeded, 10) || 1, 1, 3);
  if (slotsNeeded > allowed.length) {
    return { ok: false, message: "Body slots needed is greater than selected allowed slots." };
  }

  const isSlotUsable = (slot) => {
    const occupant = state.equippedSlots[slot];
    return !occupant || occupant === item.id;
  };

  // If the item must consume all of its allowed slots (ex: kimono chest+legs),
  // use that exact set rather than trying to derive a subset.
  if (slotsNeeded === allowed.length) {
    const blocked = allowed.filter(slot => !isSlotUsable(slot));
    if (!blocked.length) {
      return { ok: true, slots: allowed };
    }
    const blockedNames = blocked.map(slot => BODY_SLOT_LABELS[slot]).join(", ");
    return { ok: false, message: `Required slot(s) occupied: ${blockedNames}.` };
  }

  const tryPrimary = (primary) => {
    if (primary && !allowed.includes(primary)) return null;
    if (primary && !isSlotUsable(primary)) return null;

    const chosen = [];
    if (primary) chosen.push(primary);
    if (chosen.length === slotsNeeded) return chosen;

    for (const slot of allowed) {
      if (chosen.includes(slot)) continue;
      if (!isSlotUsable(slot)) continue;
      chosen.push(slot);
      if (chosen.length === slotsNeeded) break;
    }
    return chosen.length === slotsNeeded ? chosen : null;
  };

  if (preferredPrimarySlot) {
    const preferredCandidates = preferredPrimarySlot === "accessory"
      ? ["accessory1", "accessory2"]
      : [preferredPrimarySlot];
    for (const candidate of preferredCandidates) {
      const preferred = tryPrimary(candidate);
      if (preferred) return { ok: true, slots: preferred };
    }
  }

  for (const slot of allowed) {
    const result = tryPrimary(slot);
    if (result) return { ok: true, slots: result };
  }

  const blocked = allowed.filter(slot => !isSlotUsable(slot));
  if (blocked.length) {
    const blockedNames = blocked.map(slot => BODY_SLOT_LABELS[slot]).join(", ");
    return { ok: false, message: `No valid combination. Occupied slot(s): ${blockedNames}.` };
  }
  return { ok: false, message: "No valid free body slot combination available for this item." };
}

function chooseEquipSlotsIgnoringOccupancy(item, preferredPrimarySlot) {
  const allowed = getInternalAllowedSlots(item);
  if (!allowed.length) return null;

  const slotsNeeded = clamp(parseInt(item.slotsNeeded, 10) || 1, 1, 3);
  if (slotsNeeded > allowed.length) return null;

  if (slotsNeeded === allowed.length) return allowed;

  const tryPrimary = (primary) => {
    if (primary && !allowed.includes(primary)) return null;

    const chosen = [];
    if (primary) chosen.push(primary);
    if (chosen.length === slotsNeeded) return chosen;

    for (const slot of allowed) {
      if (chosen.includes(slot)) continue;
      chosen.push(slot);
      if (chosen.length === slotsNeeded) break;
    }

    return chosen.length === slotsNeeded ? chosen : null;
  };

  if (preferredPrimarySlot) {
    const preferredCandidates = preferredPrimarySlot === "accessory"
      ? ["accessory1", "accessory2"]
      : [preferredPrimarySlot];
    for (const candidate of preferredCandidates) {
      const preferred = tryPrimary(candidate);
      if (preferred) return preferred;
    }
  }

  for (const slot of allowed) {
    const result = tryPrimary(slot);
    if (result) return result;
  }

  return null;
}

function placeItemEquipped(item, preferredPrimarySlot) {
  const state = getState();
  const snapshot = {
    inventorySlots: [...state.inventorySlots],
    dormItemIds: [...state.dormItemIds],
    equippedSlots: { ...state.equippedSlots },
    location: item.location,
    inventorySlot: item.inventorySlot,
    equippedItemSlots: [...item.equippedSlots],
  };

  removeItemFromContainers(item);
  const plan = getEquipSlotsForItem(item, preferredPrimarySlot);
  if (!plan.ok) {
    state.inventorySlots = snapshot.inventorySlots;
    state.dormItemIds = snapshot.dormItemIds;
    state.equippedSlots = snapshot.equippedSlots;
    item.location = snapshot.location;
    item.inventorySlot = snapshot.inventorySlot;
    item.equippedSlots = snapshot.equippedItemSlots;
    return plan;
  }

  plan.slots.forEach(slot => {
    state.equippedSlots[slot] = item.id;
  });
  item.location = "equipped";
  item.inventorySlot = null;
  item.equippedSlots = plan.slots;
  return { ok: true };
}

function snapshotInventoryPlacementState() {
  const state = getState();
  return {
    inventorySlots: [...state.inventorySlots],
    dormItemIds: [...state.dormItemIds],
    equippedSlots: { ...state.equippedSlots },
    itemPlacements: new Map(state.inventoryItems.map(item => [
      item.id,
      {
        location: item.location,
        inventorySlot: item.inventorySlot,
        equippedSlots: [...item.equippedSlots],
      },
    ])),
  };
}

function restoreInventoryPlacementState(snapshot) {
  const state = getState();
  state.inventorySlots = [...snapshot.inventorySlots];
  state.dormItemIds = [...snapshot.dormItemIds];
  state.equippedSlots = { ...snapshot.equippedSlots };

  state.inventoryItems.forEach(item => {
    const placement = snapshot.itemPlacements.get(item.id);
    if (!placement) return;
    item.location = placement.location;
    item.inventorySlot = placement.inventorySlot;
    item.equippedSlots = [...placement.equippedSlots];
  });
}

function moveItemToEquippedSlot(item, slotKey, options = {}) {
  const {
    dryRun = false,
    strictTarget = false,
    allowOverflowToStorage = false,
    forcedTargetSlots = null,
  } = options;
  const state = getState();

  // Generic accessory target should try both concrete accessory slots.
  if (slotKey === "accessory") {
    const candidates = ["accessory1", "accessory2"];
    for (const candidate of candidates) {
      if (!state.equippedSlots[candidate]) {
        return moveItemToEquippedSlot(item, candidate, options);
      }
    }

    let lastFailure = { ok: false, message: "No accessory slot available." };
    for (const candidate of candidates) {
      const attempt = moveItemToEquippedSlot(item, candidate, options);
      if (attempt.ok) return attempt;
      lastFailure = attempt;
    }
    return lastFailure;
  }

  const snapshot = snapshotInventoryPlacementState();

  const finalize = (result) => {
    if (!result.ok || dryRun) restoreInventoryPlacementState(snapshot);
    return result;
  };

  const targetOccupantId = slotKey ? state.equippedSlots[slotKey] : null;
  const slotsNeeded = clamp(parseInt(item.slotsNeeded, 10) || 1, 1, 3);

  if (slotsNeeded > 1) {
    const plannedSlots = Array.isArray(forcedTargetSlots) && forcedTargetSlots.length
      ? [...forcedTargetSlots]
      : chooseEquipSlotsIgnoringOccupancy(item, slotKey || null);

    if (plannedSlots?.length === slotsNeeded) {
      const displacedIds = [...new Set(plannedSlots
        .map(targetSlot => state.equippedSlots[targetSlot])
        .filter(targetId => targetId && targetId !== item.id))];

      if (displacedIds.length) {
        if (dryRun) return finalize({ ok: true });

        const displacedItems = displacedIds.map(getInventoryItemById).filter(Boolean);
        if (displacedItems.length !== displacedIds.length) {
          return finalize({ ok: false, message: "Target slot item was not found." });
        }

        displacedItems.forEach(displacedItem => removeItemFromContainers(displacedItem));
        removeItemFromContainers(item);

        plannedSlots.forEach(targetSlot => {
          state.equippedSlots[targetSlot] = item.id;
        });
        item.location = "equipped";
        item.inventorySlot = null;
        item.equippedSlots = [...plannedSlots];

        const overflowItems = [];
        displacedItems.forEach(displacedItem => {
          if (!placeItemInFirstFreeInventorySlot(displacedItem)) overflowItems.push(displacedItem);
        });

        if (overflowItems.length) {
          if (!allowOverflowToStorage) {
            const overflowNames = overflowItems.map(entry => entry.name).join(", ");
            return finalize({
              ok: false,
              requiresOverflowChoice: true,
              message: `Inventory is full for: ${overflowNames}. Move overflow items to storage?`,
              targetSlots: [...plannedSlots],
              targetSlotKey: slotKey || plannedSlots[0],
            });
          }

          for (const overflowItem of overflowItems) {
            if (!placeItemInDorm(overflowItem)) {
              return finalize({ ok: false, message: `${overflowItem.name} could not be moved to storage.` });
            }
          }
        }

        if (strictTarget && slotKey && !plannedSlots.includes(slotKey)) {
          return finalize({ ok: false, message: `Cannot equip to ${BODY_SLOT_LABELS[slotKey] || slotKey}.` });
        }

        return finalize({ ok: true });
      }
    }
  }

  // Normal equip when target slot is empty (or already occupied by this item).
  if (!slotKey || !targetOccupantId || targetOccupantId === item.id) {
    const equipResult = placeItemEquipped(item, slotKey || null);
    if (!equipResult.ok) return finalize(equipResult);
    if (!strictTarget || !slotKey || item.equippedSlots.includes(slotKey)) return finalize(equipResult);
    return finalize({ ok: false, message: `Cannot equip to ${BODY_SLOT_LABELS[slotKey] || slotKey}.` });
  }

  const displacedItem = getInventoryItemById(targetOccupantId);
  if (!displacedItem) {
    return finalize({ ok: false, message: "Target slot item was not found." });
  }

  const sourcePlacement = {
    location: item.location,
    inventorySlot: item.inventorySlot,
    preferredSlot: item.equippedSlots?.[0] || null,
  };

  removeItemFromContainers(displacedItem);

  let equipResult = placeItemEquipped(item, slotKey);
  if (!equipResult.ok) {
    const internalAllowed = [...new Set((item.allowedSlots || []).flatMap(toInternalEquipSlots))].filter(slot => BODY_SLOT_KEYS.includes(slot));
    const slotsNeeded = clamp(parseInt(item.slotsNeeded, 10) || 1, 1, 3);
    const canDirectEquipToTarget = slotsNeeded === 1
      && Boolean(slotKey)
      && internalAllowed.includes(slotKey)
      && (!state.equippedSlots[slotKey] || state.equippedSlots[slotKey] === item.id);

    if (!canDirectEquipToTarget) return finalize(equipResult);

    // Fallback: directly place single-slot items on the explicit drop slot.
    removeItemFromContainers(item);
    state.equippedSlots[slotKey] = item.id;
    item.location = "equipped";
    item.inventorySlot = null;
    item.equippedSlots = [slotKey];
    equipResult = { ok: true };
  }

  let displacedPlacementResult = { ok: false, message: "Could not place swapped item." };
  if (sourcePlacement.location === "inventory" && Number.isInteger(sourcePlacement.inventorySlot)) {
    displacedPlacementResult = placeItemInInventorySlot(displacedItem, sourcePlacement.inventorySlot)
      ? { ok: true, message: `${displacedItem.name} moved to Inventory Slot ${sourcePlacement.inventorySlot + 1}.` }
      : { ok: false, message: "Could not place swapped item into original inventory slot." };
  } else if (sourcePlacement.location === "dorm") {
    displacedPlacementResult = placeItemInDorm(displacedItem)
      ? { ok: true, message: `${displacedItem.name} moved to Storage.` }
      : { ok: false, message: "Could not place swapped item into storage." };
  } else if (sourcePlacement.location === "equipped") {
    if (placeItemEquipped(displacedItem, sourcePlacement.preferredSlot).ok) {
      displacedPlacementResult = { ok: true };
    } else if (placeItemInFirstFreeInventorySlot(displacedItem)) {
      displacedPlacementResult = {
        ok: true,
        message: `${displacedItem.name} moved to Inventory Slot ${displacedItem.inventorySlot + 1} (original slot unavailable).`,
      };
    } else if (placeItemInDorm(displacedItem)) {
      displacedPlacementResult = {
        ok: true,
        message: `${displacedItem.name} moved to Storage (original slot unavailable).`,
      };
    } else {
      displacedPlacementResult = { ok: false, message: "Swapped item cannot be moved from target slot." };
    }
  }

  if (!displacedPlacementResult.ok) {
    if (placeItemInFirstFreeInventorySlot(displacedItem)) {
      displacedPlacementResult = {
        ok: true,
        message: `${displacedItem.name} moved to Inventory Slot ${displacedItem.inventorySlot + 1}.`,
      };
    } else if (placeItemInDorm(displacedItem)) {
      displacedPlacementResult = {
        ok: true,
        message: `${displacedItem.name} moved to Storage.`,
      };
    }
  }

  if (displacedPlacementResult.ok && strictTarget && slotKey && !item.equippedSlots.includes(slotKey)) {
    return finalize({ ok: false, message: `Cannot equip to ${BODY_SLOT_LABELS[slotKey] || slotKey}.` });
  }

  return finalize(displacedPlacementResult.ok ? { ok: true } : displacedPlacementResult);
}

function deleteInventoryItem(itemId) {
  const state = getState();
  const item = getInventoryItemById(itemId);
  if (!item) return;

  expandedDescriptionIds.delete(itemId);
  if (openEquipPickerItemId === itemId) openEquipPickerItemId = null;
  if (openMovePickerItemId === itemId) openMovePickerItemId = null;
  removeItemFromContainers(item);
  state.inventoryItems = state.inventoryItems.filter(entry => entry.id !== itemId);
  if (editingItemId === itemId) resetItemEditor();
  renderInventory();
  scheduleSave();
}

function shouldShowEquipTargetSelect(item) {
  const allowed = normalizeAllowedSlots(item?.allowedSlots);
  if (allowed.length <= 1) return false;
  const slotsNeeded = clamp(parseInt(item?.slotsNeeded, 10) || 1, 1, 3);
  return slotsNeeded < countInternalAllowedSlots(allowed);
}

function renderDescriptionToggleButton(isDescriptionExpanded) {
  const ariaLabel = isDescriptionExpanded ? "Collapse description" : "Expand description";
  return `<button type="button" class="inventory-desc-toggle-btn" data-action="toggleDescription" aria-label="${ariaLabel}" title="${ariaLabel}" aria-expanded="${isDescriptionExpanded ? "true" : "false"}"></button>`;
}

function renderEditButton() {
  return '<button type="button" class="inventory-mini-btn inventory-icon-btn inventory-icon-btn-edit" data-action="editItem" aria-label="Edit item" title="Edit item">&#9998;</button>';
}

function renderDeleteButton(itemId, forceAlignLeft = false) {
  return `<button type="button" class="inventory-mini-btn inventory-icon-btn danger" data-action="deleteItem" aria-label="Delete item" title="Delete item">
    <svg class="inventory-icon-trash" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path fill="currentColor" d="M9 3h6a1 1 0 0 1 1 1v1h4v2h-1l-1 12a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 7H4V5h4V4a1 1 0 0 1 1-1Zm1 2v0h4V5h-4Zm-1 4h2v9H9V9Zm4 0h2v9h-2V9Z"/>
      <path fill="none" stroke="currentColor" stroke-width="1.5" d="M6 7.5h12"/>
    </svg>
  </button>`;
}

function renderMoveButton() {
  return '<button type="button" class="inventory-mini-btn inventory-icon-btn inventory-icon-btn-move" data-action="moveItem" aria-label="Move item" title="Move item">&#8644;</button>';
}

function renderQuantityControls(item) {
  if (normalizeItemType(item.itemType) !== "item" || !parseStackableValue(item.stackable)) return "";
  return `
    <button type="button" class="inventory-mini-btn inventory-amount-adjust-btn" data-action="decreaseQuantity" aria-label="Decrease amount" title="Decrease amount">
      <svg class="inventory-yen-adjust-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path fill="currentColor" d="M5 11h14v2H5z"/>
      </svg>
    </button>
    <button type="button" class="inventory-mini-btn inventory-amount-adjust-btn" data-action="increaseQuantity" aria-label="Increase amount" title="Increase amount">
      <svg class="inventory-yen-adjust-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path fill="currentColor" d="M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6V5z"/>
      </svg>
    </button>
  `;
}

function renderEquipPickerMenu(item) {
  if (!shouldShowEquipTargetSelect(item) || openEquipPickerItemId !== item.id) return "";

  const options = item.allowedSlots.map(slot => `
    <button type="button" class="inventory-mini-btn" data-action="equipToSlot" data-slot-key="${slot}">${getAllowedSlotLabel(slot)}</button>
  `).join("");

  return `
    <div class="inventory-equip-picker" role="menu" aria-label="Choose equip slot">
      ${options}
    </div>
  `;
}

function getMoveDestinationOptions(item) {
  const options = [];
  if (item.location !== "inventory") options.push({ key: "inventory", label: "Inventory" });
  if (!isItemTypeDormRestricted(item) && item.location !== "dorm") options.push({ key: "dorm", label: "Storage" });
  return options;
}

function renderMovePickerMenu(item, anchorSlotKey = null) {
  if (openMovePickerItemId !== item.id) return "";

  if (item.location === "equipped" && anchorSlotKey) {
    const primarySlot = item.equippedSlots?.[0] || null;
    if (primarySlot && primarySlot !== anchorSlotKey) return "";
  }

  const options = getMoveDestinationOptions(item);
  if (!options.length) return "";

  return `
    <div class="inventory-equip-picker inventory-move-picker" role="menu" aria-label="Choose destination">
      ${options.map(option => `<button type="button" class="inventory-mini-btn" data-action="moveToDestination" data-destination="${option.key}">${option.label}</button>`).join("")}
    </div>
  `;
}

function renderOverflowChoiceMenu(item) {
  if (!openOverflowChoice || openOverflowChoice.itemId !== item.id) return "";

  return `
    <div class="inventory-equip-picker inventory-overflow-picker" role="menu" aria-label="Inventory overflow options">
      <div class="inventory-overflow-text">${escapeHtml(openOverflowChoice.message || "Inventory is full. Move overflow to storage?")}</div>
      <button type="button" class="inventory-mini-btn" data-action="confirmOverflowToStorage">Move Overflow to Storage</button>
      <button type="button" class="inventory-mini-btn" data-action="cancelOverflowChoice">Cancel</button>
    </div>
  `;
}

function closeEquipPicker() {
  if (!openEquipPickerItemId) return;
  openEquipPickerItemId = null;
  renderInventory();
}

function closeMovePicker() {
  if (!openMovePickerItemId) return;
  openMovePickerItemId = null;
  renderInventory();
}

function closeOverflowChoice() {
  if (!openOverflowChoice) return;
  openOverflowChoice = null;
  renderInventory();
}

function collectAllowedSlotsFromForm() {
  return Array.from(document.querySelectorAll("#itemAllowedSlots input[type='checkbox']:checked"))
    .map(input => input.value)
    .filter(slot => CLOTHING_SELECTABLE_SLOT_KEYS.includes(slot));
}

function renderWeaponDamageRows(parts) {
  const list = document.getElementById("itemWeaponDamageList");
  if (!list) return;

  const normalizedParts = normalizeWeaponDamageParts(parts);
  list.innerHTML = normalizedParts.map((part, index) => `
    <div class="inventory-weapon-damage-row" data-damage-index="${index}">
      <input
        id="itemWeaponDamageCount_${index}"
        type="number"
        class="meta-input inventory-weapon-damage-count"
        min="1"
        max="99"
        value="${part.count}"
        aria-label="Damage dice count ${index + 1}"
      />
      <select
        id="itemWeaponDamageDie_${index}"
        class="meta-select inventory-weapon-damage-die"
        aria-label="Damage die type ${index + 1}"
      >
        ${WEAPON_DAMAGE_DICE.map(die => `<option value="${die}" ${die === part.die ? "selected" : ""}>${die.toUpperCase()}</option>`).join("")}
      </select>
      <button
        type="button"
        class="inventory-mini-btn danger"
        data-action="removeWeaponDamagePart"
        data-index="${index}"
        aria-label="Remove damage part"
        title="Remove damage part"
        ${normalizedParts.length <= 1 ? "disabled" : ""}
      >Remove</button>
    </div>
  `).join("");
}

function getWeaponDamagePartsFromForm() {
  const list = document.getElementById("itemWeaponDamageList");
  if (!list) return [{ count: 1, die: "d6" }];

  const rows = Array.from(list.querySelectorAll("[data-damage-index]"));
  const parts = rows.map(row => {
    const countInput = row.querySelector(".inventory-weapon-damage-count");
    const dieSelect = row.querySelector(".inventory-weapon-damage-die");
    return {
      count: parseWeaponDamageCount(countInput?.value),
      die: normalizeWeaponDamageDie(dieSelect?.value),
    };
  });

  return normalizeWeaponDamageParts(parts);
}

function ensureWeaponEditorFields() {
  const formGrid = document.querySelector("#itemEditorPanel .inventory-form-grid");
  if (!formGrid) return;

  if (!document.getElementById("itemWeaponTypeField")) {
    const field = document.createElement("div");
    field.className = "inventory-field";
    field.id = "itemWeaponTypeField";
    field.hidden = true;
    field.style.display = "none";
    field.innerHTML = `
      <label class="field-label" for="itemWeaponTypeSelect">Weapon Type</label>
      <select id="itemWeaponTypeSelect" class="meta-select">
        ${WEAPON_TYPES.map(type => `<option value="${type}">${WEAPON_TYPE_LABELS[type]}</option>`).join("")}
      </select>
    `;
    formGrid.appendChild(field);
  }

  if (!document.getElementById("itemWeaponStatField")) {
    const field = document.createElement("div");
    field.className = "inventory-field";
    field.id = "itemWeaponStatField";
    field.hidden = true;
    field.style.display = "none";
    field.innerHTML = `
      <label class="field-label" for="itemWeaponStatSelect">Weapon Stat</label>
      <select id="itemWeaponStatSelect" class="meta-select">
        ${WEAPON_STAT_OPTIONS.map(stat => `<option value="${stat}">${WEAPON_STAT_LABELS[stat]}</option>`).join("")}
      </select>
    `;
    formGrid.appendChild(field);
  }

  if (!document.getElementById("itemWeaponRangeField")) {
    const field = document.createElement("div");
    field.className = "inventory-field";
    field.id = "itemWeaponRangeField";
    field.hidden = true;
    field.style.display = "none";
    field.innerHTML = `
      <label class="field-label" for="itemWeaponRangeInput">Range (ft)</label>
      <input id="itemWeaponRangeInput" class="meta-input" type="number" min="1" max="9999" step="1" placeholder="e.g. 60" />
    `;
    formGrid.appendChild(field);
  }

  if (!document.getElementById("itemWeaponPolearmReachField")) {
    const field = document.createElement("div");
    field.className = "inventory-field";
    field.id = "itemWeaponPolearmReachField";
    field.hidden = true;
    field.style.display = "none";
    field.innerHTML = `
      <label class="field-label" for="itemWeaponPolearmReachToggle">Polearm Reach</label>
      <label><input id="itemWeaponPolearmReachToggle" class="inventory-stackable-toggle" type="checkbox" /> Add +5 ft reach</label>
    `;
    formGrid.appendChild(field);
  }

  if (!document.getElementById("itemWeaponDamageField")) {
    const field = document.createElement("div");
    field.className = "inventory-field inventory-field-full";
    field.id = "itemWeaponDamageField";
    field.hidden = true;
    field.style.display = "none";
    field.innerHTML = `
      <label class="field-label" for="itemWeaponDamageList">Damage Dice</label>
      <div id="itemWeaponDamageList" class="inventory-weapon-damage-list"></div>
      <button type="button" id="itemWeaponDamageAddBtn" class="inventory-secondary-btn inventory-weapon-damage-add">Add Damage Part</button>
    `;
    formGrid.appendChild(field);
  }

  // Keep action buttons anchored under dynamic weapon fields.
  const actionsRow = formGrid.querySelector(".inventory-form-actions");
  if (actionsRow) formGrid.appendChild(actionsRow);
}

function initWeaponDamageEditorUI() {
  const addBtn = document.getElementById("itemWeaponDamageAddBtn");
  const list = document.getElementById("itemWeaponDamageList");
  if (!addBtn || !list) return;

  addBtn.addEventListener("click", () => {
    const parts = getWeaponDamagePartsFromForm();
    parts.push({ count: 1, die: "d6" });
    renderWeaponDamageRows(parts);
  });

  list.addEventListener("click", event => {
    const button = event.target.closest("button[data-action='removeWeaponDamagePart']");
    if (!button) return;
    const index = parseInt(button.dataset.index, 10);
    if (!Number.isInteger(index)) return;

    const parts = getWeaponDamagePartsFromForm();
    if (parts.length <= 1) return;
    parts.splice(index, 1);
    renderWeaponDamageRows(parts);
  });

  renderWeaponDamageRows([{ count: 1, die: "d6" }]);
}

function setItemTypeFieldsVisibility(itemType) {
  const slotsNeededField = document.getElementById("itemSlotsNeededField");
  const slotsNeededLabel = document.getElementById("itemSlotsNeededLabel");
  const allowedSlotsField = document.getElementById("itemAllowedSlotsField");
  const weaponGripField = document.getElementById("itemWeaponGripField");
  const weaponTypeField = document.getElementById("itemWeaponTypeField");
  const weaponStatField = document.getElementById("itemWeaponStatField");
  const weaponRangeField = document.getElementById("itemWeaponRangeField");
  const weaponPolearmReachField = document.getElementById("itemWeaponPolearmReachField");
  const weaponDamageField = document.getElementById("itemWeaponDamageField");
  const stackableField = document.getElementById("itemStackableField");
  const stackableToggle = document.getElementById("itemStackableToggle");
  const quantityField = document.getElementById("itemQuantityField");
  const preferredLocation = document.getElementById("itemPreferredLocation");
  if (!slotsNeededField || !slotsNeededLabel || !allowedSlotsField || !weaponGripField || !stackableField || !stackableToggle || !quantityField || !preferredLocation) return;

  const isClothing = itemType === "clothing";
  const isWeapon = itemType === "weapon";
  const isItem = itemType === "item";

  const setVisible = (el, visible) => {
    el.hidden = !visible;
    el.style.display = visible ? "" : "none";
  };

  slotsNeededLabel.textContent = "Body Slots Needed";
  setVisible(slotsNeededField, isClothing);
  setVisible(allowedSlotsField, isClothing);
  setVisible(weaponGripField, isWeapon);
  if (weaponTypeField) setVisible(weaponTypeField, isWeapon);
  if (weaponStatField) setVisible(weaponStatField, isWeapon);
  if (weaponRangeField) setVisible(weaponRangeField, false);
  if (weaponPolearmReachField) setVisible(weaponPolearmReachField, false);
  if (weaponDamageField) setVisible(weaponDamageField, isWeapon);
  setVisible(stackableField, isItem);
  if (!isItem) stackableToggle.checked = false;
  setVisible(quantityField, isItem && stackableToggle.checked);

  const dormOption = preferredLocation.querySelector("option[value='dorm']");
  if (dormOption) {
    dormOption.disabled = false;
    dormOption.hidden = false;
  }

  syncWeaponSubtypeFields();
}

function syncWeaponSubtypeFields() {
  const itemType = getItemTypeFromForm();
  const weaponTypeSelect = document.getElementById("itemWeaponTypeSelect");
  const weaponRangeField = document.getElementById("itemWeaponRangeField");
  const weaponRangeInput = document.getElementById("itemWeaponRangeInput");
  const weaponPolearmReachField = document.getElementById("itemWeaponPolearmReachField");
  const weaponPolearmReachToggle = document.getElementById("itemWeaponPolearmReachToggle");
  if (!weaponRangeField || !weaponRangeInput || !weaponPolearmReachField || !weaponPolearmReachToggle) return;

  const isWeapon = itemType === "weapon";
  const weaponType = normalizeWeaponType(weaponTypeSelect?.value);
  const isRanged = weaponType === "ranged";
  const isPolearm = weaponType === "polearm";
  const shouldShowRange = isWeapon && isRanged;
  const shouldShowPolearmReach = isWeapon && isPolearm;

  weaponRangeField.hidden = !shouldShowRange;
  weaponRangeField.style.display = shouldShowRange ? "" : "none";
  if (!shouldShowRange) weaponRangeInput.value = "";

  weaponPolearmReachField.hidden = !shouldShowPolearmReach;
  weaponPolearmReachField.style.display = shouldShowPolearmReach ? "" : "none";
  if (!shouldShowPolearmReach) weaponPolearmReachToggle.checked = false;
}

function getItemTypeFromForm() {
  const input = document.getElementById("itemTypeSelect");
  return normalizeItemType(input?.value);
}

function getItemConfigFromForm() {
  const itemType = getItemTypeFromForm();
  if (itemType === "weapon") {
    const gripSelect = document.getElementById("itemWeaponGripSelect");
    const weaponGrip = normalizeWeaponGrip(gripSelect?.value, 1);
    const weaponTypeSelect = document.getElementById("itemWeaponTypeSelect");
    const weaponStatSelect = document.getElementById("itemWeaponStatSelect");
    const weaponType = normalizeWeaponType(weaponTypeSelect?.value);
    return {
      itemType,
      weaponGrip,
      weaponType,
      weaponStat: normalizeWeaponStat(weaponStatSelect?.value),
      weaponDamageParts: getWeaponDamagePartsFromForm(),
      weaponRange: weaponType === "ranged" ? parseWeaponRange(document.getElementById("itemWeaponRangeInput")?.value) : null,
      weaponPolearmReach: weaponType === "polearm" ? Boolean(document.getElementById("itemWeaponPolearmReachToggle")?.checked) : false,
      allowedSlots: ["rightHand", "leftHand"],
      slotsNeeded: weaponGrip === "twoHanded" ? 2 : 1,
    };
  }

  if (itemType === "item") {
    const stackable = Boolean(document.getElementById("itemStackableToggle")?.checked);
    return {
      itemType,
      weaponGrip: null,
      weaponType: null,
      weaponStat: null,
      weaponDamageParts: [],
      weaponRange: null,
      weaponPolearmReach: false,
      allowedSlots: ["rightHand", "leftHand"],
      slotsNeeded: 1,
      stackable,
      quantity: stackable ? parseItemQuantity(document.getElementById("itemQuantityInput")?.value) : 1,
    };
  }

  return {
    itemType,
    weaponGrip: null,
    weaponType: null,
    weaponStat: null,
    weaponDamageParts: [],
    weaponRange: null,
    weaponPolearmReach: false,
    allowedSlots: collectAllowedSlotsFromForm(),
    slotsNeeded: clamp(parseInt(document.getElementById("itemSlotsNeededSelect")?.value, 10) || 1, 1, 3),
    stackable: false,
    quantity: 1,
  };
}

function resetItemEditor() {
  editingItemId = null;
  draftItemModifiers = [];
  editingModifierIndex = null;
  const title = document.getElementById("itemEditorTitle");
  if (!title) return;

  document.getElementById("itemEditorTitle").textContent = "Create Item";
  document.getElementById("itemNameInput").value = "";
  document.getElementById("itemDescriptionInput").value = "";
  setActiveItemType("clothing");
  document.getElementById("itemWeaponGripSelect").value = "oneHanded";
  if (document.getElementById("itemWeaponTypeSelect")) document.getElementById("itemWeaponTypeSelect").value = "bludgeoning";
  if (document.getElementById("itemWeaponStatSelect")) document.getElementById("itemWeaponStatSelect").value = "power";
  if (document.getElementById("itemWeaponRangeInput")) document.getElementById("itemWeaponRangeInput").value = "";
  if (document.getElementById("itemWeaponPolearmReachToggle")) document.getElementById("itemWeaponPolearmReachToggle").checked = false;
  renderWeaponDamageRows([{ count: 1, die: "d6" }]);
  document.getElementById("itemSlotsNeededSelect").value = "1";
  document.getElementById("itemStackableToggle").checked = false;
  document.getElementById("itemQuantityInput").value = "1";
  document.getElementById("itemPreferredLocation").value = "inventory";
  document.querySelectorAll("#itemAllowedSlots input[type='checkbox']").forEach(input => {
    input.checked = false;
  });
  setItemTypeFieldsVisibility("clothing");
  document.getElementById("saveItemBtn").textContent = "Save Item";
  document.getElementById("cancelEditItemBtn").style.display = "none";
  document.getElementById("itemModifiersEditor").hidden = false;
  resetModifierDraftForm();
  setModifierEditMode(false);
  renderDraftModifierList();
  refreshModifierSummary();
  setItemFormError("");
  setItemEditorOpen(false);
}

function startItemEdit(itemId) {
  const item = getInventoryItemById(itemId);
  if (!item) return;
  editingItemId = itemId;

  document.getElementById("itemEditorTitle").textContent = "Edit Item";
  document.getElementById("itemNameInput").value = item.name;
  document.getElementById("itemDescriptionInput").value = item.description;
  draftItemModifiers = cloneDraftModifiers(item.modifiers);
  editingModifierIndex = null;
  document.getElementById("itemModifiersEditor").hidden = false;
  resetModifierDraftForm();
  setModifierEditMode(false);
  renderDraftModifierList();
  refreshModifierSummary();
  setActiveItemType(normalizeItemType(item.itemType));
  document.getElementById("itemWeaponGripSelect").value = normalizeWeaponGrip(item.weaponGrip, item.slotsNeeded);
  if (document.getElementById("itemWeaponTypeSelect")) {
    document.getElementById("itemWeaponTypeSelect").value = normalizeWeaponType(item.weaponType);
  }
  if (document.getElementById("itemWeaponStatSelect")) {
    document.getElementById("itemWeaponStatSelect").value = normalizeWeaponStat(item.weaponStat);
  }
  if (document.getElementById("itemWeaponRangeInput")) {
    const range = parseWeaponRange(item.weaponRange);
    document.getElementById("itemWeaponRangeInput").value = Number.isFinite(range) ? String(range) : "";
  }
  if (document.getElementById("itemWeaponPolearmReachToggle")) {
    document.getElementById("itemWeaponPolearmReachToggle").checked = parseWeaponPolearmReach(item.weaponPolearmReach);
  }
  renderWeaponDamageRows(normalizeWeaponDamageParts(item.weaponDamageParts));
  document.getElementById("itemSlotsNeededSelect").value = String(item.slotsNeeded || 1);
  document.getElementById("itemStackableToggle").checked = parseStackableValue(item.stackable);
  document.getElementById("itemQuantityInput").value = String(parseItemQuantity(item.quantity));
  document.getElementById("itemPreferredLocation").value = item.location === "equipped" ? "equipped" : item.location;
  document.querySelectorAll("#itemAllowedSlots input[type='checkbox']").forEach(input => {
    input.checked = item.allowedSlots.includes(input.value);
  });
  setItemTypeFieldsVisibility(normalizeItemType(item.itemType));
  document.getElementById("saveItemBtn").textContent = "Update Item";
  document.getElementById("cancelEditItemBtn").style.display = "";
  setItemFormError("");
  setItemEditorOpen(true);
}

function saveItemFromForm() {
  const state = getState();
  const name = document.getElementById("itemNameInput").value.trim();
  const description = document.getElementById("itemDescriptionInput").value.trim();
  const itemConfig = getItemConfigFromForm();
  const modifiers = cloneDraftModifiers(draftItemModifiers);
  const slotsNeeded = itemConfig.slotsNeeded;
  const preferredLocation = document.getElementById("itemPreferredLocation").value;
  const allowedSlots = itemConfig.allowedSlots;

  if (!name) {
    setItemFormError("Item name is required.");
    return;
  }
  if (slotsNeeded > countInternalAllowedSlots(allowedSlots)) {
    setItemFormError("Body slots needed cannot be greater than selected allowed slots.");
    return;
  }

  let item = editingItemId ? getInventoryItemById(editingItemId) : null;
  if (!item) {
    item = {
      id: makeItemId(),
      name,
      modifier: "",
      modifiers,
      description,
      itemType: itemConfig.itemType,
      weaponGrip: itemConfig.weaponGrip,
      weaponType: itemConfig.weaponType,
      weaponStat: itemConfig.weaponStat,
      weaponDamageParts: normalizeWeaponDamageParts(itemConfig.weaponDamageParts),
      weaponRange: parseWeaponRange(itemConfig.weaponRange),
      weaponPolearmReach: parseWeaponPolearmReach(itemConfig.weaponPolearmReach),
      allowedSlots,
      slotsNeeded,
      stackable: itemConfig.stackable,
      quantity: itemConfig.quantity,
      location: "dorm",
      inventorySlot: null,
      equippedSlots: [],
    };
    state.inventoryItems.push(item);
  } else {
    item.name = name;
    item.modifier = "";
    item.modifiers = modifiers;
    item.description = description;
    item.itemType = itemConfig.itemType;
    item.weaponGrip = itemConfig.weaponGrip;
    item.weaponType = itemConfig.weaponType;
    item.weaponStat = itemConfig.weaponStat;
    item.weaponDamageParts = normalizeWeaponDamageParts(itemConfig.weaponDamageParts);
    item.weaponRange = parseWeaponRange(itemConfig.weaponRange);
    item.weaponPolearmReach = parseWeaponPolearmReach(itemConfig.weaponPolearmReach);
    item.allowedSlots = allowedSlots;
    item.slotsNeeded = slotsNeeded;
    item.stackable = itemConfig.stackable;
    item.quantity = itemConfig.quantity;
  }

  applyItemTypeDefaults(item);

  let placementResult = { ok: true };
  if (preferredLocation === "equipped") {
    placementResult = placeItemEquipped(item);
    if (!placementResult.ok) {
      if (!placeItemInFirstFreeInventorySlot(item)) {
        if (!placeItemInDorm(item)) {
          placementResult = { ok: false, message: "No valid space found. Free an inventory slot or hand slot." };
        }
      }
    }
  } else if (preferredLocation === "inventory") {
    if (!placeItemInFirstFreeInventorySlot(item)) {
      if (placeItemInDorm(item)) {
        placementResult = { ok: false, message: "Active inventory is full. Item sent to storage." };
      } else {
        placementResult = { ok: false, message: "Active inventory is full. Free a slot first." };
      }
    }
  } else {
    if (!placeItemInDorm(item)) {
      placementResult = { ok: false, message: "This item group cannot be stored in storage." };
    }
  }

  renderInventory();
  scheduleSave();
  resetItemEditor();
  if (!placementResult.ok && placementResult.message) setItemFormError(placementResult.message);
}

function renderInventoryItemCard(item, controlsHtml, locationTag) {
  const modifierPrefix = locationTag === "Stored" ? "Inactive: " : "";
  const modifierSummary = getItemModifierSummary(item);
  const modifier = modifierSummary
    ? `<div class="inventory-item-modifier">${modifierPrefix}${escapeHtml(modifierSummary)}</div>`
    : "";
  const hasDescription = Boolean(item.description);
  const isDescriptionExpanded = expandedDescriptionIds.has(item.id);
  const description = hasDescription
    ? `<div class="inventory-item-desc${isDescriptionExpanded ? "" : " collapsed"}">${escapeHtml(item.description)}</div>`
    : "";
  const descriptionToggle = hasDescription
    ? renderDescriptionToggleButton(isDescriptionExpanded)
    : "";
  const normalizedType = normalizeItemType(item.itemType);
  const typeLabel = getItemTypeLabel(normalizedType);
  const quantityText = normalizedType === "item" && parseStackableValue(item.stackable)
  ? `<div class="inventory-item-amount-row"><div class="inventory-item-amount">Amount: ${parseItemQuantity(item.quantity)}</div>${renderQuantityControls(item)}</div>`
    : "";
  const equipText = item.allowedSlots.map(slot => getAllowedSlotLabel(slot)).join(", ");
  const details = [];

  if (normalizedType === "weapon") {
    const gripLabel = normalizeWeaponGrip(item.weaponGrip, item.slotsNeeded) === "twoHanded" ? "Two-Handed" : "One-Handed";
    const weaponTypeLabel = WEAPON_TYPE_LABELS[normalizeWeaponType(item.weaponType)] || "Weapon";
    const weaponStatLabel = WEAPON_STAT_LABELS[normalizeWeaponStat(item.weaponStat)] || "Power";
    const damageText = formatWeaponDamageParts(item.weaponDamageParts);
    const rangeText = getWeaponReachInFeet(item);
    details.push(`${gripLabel} | ${weaponTypeLabel}`);
    details.push(`Damage: ${damageText} + ${weaponStatLabel} Level`);
    if (shouldDisplayWeaponRange(item) && Number.isFinite(rangeText)) {
      details.push(`Range: ${rangeText} ft`);
    }
  } else {
    if (normalizedType === "clothing" && equipText) details.push(`Equip: ${equipText}`);
    if ((parseInt(item.slotsNeeded, 10) || 1) > 1) {
      details.push(`${item.slotsNeeded} Slots`);
    }
  }

  const slotsMeta = [typeLabel, ...details].join(" | ");

  return `
    <div class="inventory-item-card" data-item-id="${item.id}" draggable="true">
      <div class="inventory-item-top">
        <div class="inventory-item-name-wrap">
          <div class="inventory-item-name">${escapeHtml(item.name)}</div>
          ${descriptionToggle}
        </div>
        <div class="inventory-item-location">${escapeHtml(locationTag)}</div>
      </div>
      ${modifier}
      ${quantityText}
      ${description}
      <div class="inventory-item-slots">${slotsMeta}</div>
      <div class="inventory-item-actions">${controlsHtml}</div>
    </div>
  `;
}

function renderEquippedSlots() {
  const state = getState();
  const grid = document.getElementById("equippedSlotsGrid");
  if (!grid) return;

  grid.innerHTML = BODY_SLOT_KEYS.map(slot => {
    const itemId = state.equippedSlots[slot];
    const item = itemId ? getInventoryItemById(itemId) : null;

    if (!item) {
      return `
        <div class="equipped-slot-card" data-drop-zone="equipped-slot" data-slot-key="${slot}">
          <div class="equipped-slot-label">${BODY_SLOT_LABELS[slot]}</div>
          <div class="equipped-slot-empty">Empty</div>
        </div>
      `;
    }

    const normalizedType = normalizeItemType(item.itemType);
    const primarySlot = item.equippedSlots?.[0] || slot;
    const isSecondarySlot = item.equippedSlots.length > 1 && slot !== primarySlot;
    const occupyingSlotsText = item.equippedSlots.map(key => BODY_SLOT_LABELS[key]).join(", ");
    const secondarySlotMetaText = normalizedType === "weapon" && normalizeWeaponGrip(item.weaponGrip, item.slotsNeeded) === "twoHanded"
      ? "Two-Handed"
      : `Equipped: ${occupyingSlotsText}`;

    if (isSecondarySlot) {
      return `
      <div class="equipped-slot-card is-secondary" data-item-id="${item.id}" data-slot-key="${slot}" data-drop-zone="equipped-slot">
        <div class="equipped-slot-label">${BODY_SLOT_LABELS[slot]}</div>
        <div class="equipped-slot-item">${escapeHtml(item.name)}</div>
        <div class="equipped-slot-meta equipped-slot-link">${secondarySlotMetaText}</div>
      </div>
    `;
    }

    const quantityText = normalizedType === "item" && parseStackableValue(item.stackable)
      ? `<div class="inventory-item-amount-row"><div class="inventory-item-amount">Amount: ${parseItemQuantity(item.quantity)}</div>${renderQuantityControls(item)}</div>`
      : "";
    const weaponHandedness = normalizedType === "weapon"
      ? (normalizeWeaponGrip(item.weaponGrip, item.slotsNeeded) === "twoHanded" ? "Two-Handed" : "One-Handed")
      : "";
    const weaponType = normalizedType === "weapon"
      ? (WEAPON_TYPE_LABELS[normalizeWeaponType(item.weaponType)] || "Weapon")
      : "";
    const weaponDamage = normalizedType === "weapon"
      ? `${formatWeaponDamageParts(item.weaponDamageParts)} + ${(WEAPON_STAT_LABELS[normalizeWeaponStat(item.weaponStat)] || "Power")} Level`
      : "";
    const weaponRange = normalizedType === "weapon" && shouldDisplayWeaponRange(item)
      ? getWeaponReachInFeet(item)
      : null;
    const hasDescription = Boolean(item.description);
    const isDescriptionExpanded = expandedDescriptionIds.has(item.id);
    return `
      <div class="equipped-slot-card" data-item-id="${item.id}" data-slot-key="${slot}" data-drop-zone="equipped-slot" draggable="true">
        <div class="equipped-slot-header">
          <div class="equipped-slot-label">${BODY_SLOT_LABELS[slot]}</div>
          ${hasDescription ? renderDescriptionToggleButton(isDescriptionExpanded) : ""}
        </div>
        <div class="equipped-slot-item">${escapeHtml(item.name)}</div>
        ${weaponHandedness ? `<div class="equipped-slot-meta">${weaponHandedness}${weaponType ? ` | ${weaponType}` : ""}</div>` : ""}
        ${weaponDamage ? `<div class="equipped-slot-meta">Damage: ${escapeHtml(weaponDamage)}</div>` : ""}
        ${Number.isFinite(weaponRange) ? `<div class="equipped-slot-meta">Range: ${weaponRange} ft</div>` : ""}
        ${quantityText}
        ${hasDescription ? `<div class="equipped-slot-desc${isDescriptionExpanded ? "" : " collapsed"}">${escapeHtml(item.description)}</div>` : ""}
        ${getItemModifierSummary(item) ? `<div class="equipped-slot-mod">${escapeHtml(getItemModifierSummary(item))}</div>` : ""}
        <div class="equipped-slot-actions">
          ${renderMoveButton()}
          ${renderMovePickerMenu(item, slot)}
          ${renderEditButton()}
          ${renderDeleteButton(item.id)}
        </div>
      </div>
    `;
  }).join("");
}

function getStorageSlotGrantSources(state) {
  if (!state?.inventoryItems || !state?.equippedSlots) return [];
  const equippedIds = [...new Set(Object.values(state.equippedSlots).filter(Boolean))];
  const sources = [];

  equippedIds.forEach(itemId => {
    const item = state.inventoryItems.find(entry => entry.id === itemId);
    if (!item) return;
    const grants = normalizeModifierList(item.modifiers)
      .filter(modifier => modifier.kind === "storage")
      .reduce((sum, modifier) => sum + Math.max(0, parseInt(modifier.value, 10) || 0), 0);
    for (let i = 0; i < grants; i += 1) {
      sources.push(item.name || "Item");
    }
  });

  return sources;
}

function renderInventorySlots() {
  const state = getState();
  const root = document.getElementById("inventorySlotsList");
  if (!root) return;

  const baseSlotCount = 5;
  const storageSlotSources = getStorageSlotGrantSources(state);

  root.innerHTML = state.inventorySlots.map((itemId, index) => {
    const sourceName = index >= baseSlotCount ? storageSlotSources[index - baseSlotCount] || null : null;
    const slotLabel = sourceName
      ? `Slot ${index + 1} (${escapeHtml(sourceName)})`
      : `Slot ${index + 1}`;

    if (!itemId) {
      return `
        <div class="inventory-slot-card empty" data-slot-index="${index}" data-drop-zone="inventory-slot">
          <div class="inventory-slot-label">${slotLabel}</div>
          <div class="inventory-slot-empty">Empty</div>
        </div>
      `;
    }

    const item = getInventoryItemById(itemId);
    if (!item) return "";

    const controls = `
      <button type="button" class="inventory-mini-btn" data-action="equipItem">Equip</button>
      ${renderEquipPickerMenu(item)}
      ${renderOverflowChoiceMenu(item)}
      ${renderMoveButton()}
      ${renderMovePickerMenu(item)}
      ${renderEditButton()}
      ${renderDeleteButton(item.id, true)}
    `;

    return `
      <div class="inventory-slot-card" data-slot-index="${index}" data-item-id="${item.id}" data-drop-zone="inventory-slot">
        ${renderInventoryItemCard(item, controls, sourceName ? `Stored (${sourceName})` : "Stored")}
      </div>
    `;
  }).join("");
}

function renderDormInventory() {
  const state = getState();
  const root = document.getElementById("dormInventoryList");
  if (!root) return;

  if (!state.dormItemIds.length) {
    root.innerHTML = '<div class="inventory-slot-empty">Storage is empty.</div>';
    return;
  }

  root.innerHTML = state.dormItemIds.map(itemId => {
    const item = getInventoryItemById(itemId);
    if (!item) return "";

    const controls = `
      <button type="button" class="inventory-mini-btn" data-action="equipItem">Equip</button>
      ${renderEquipPickerMenu(item)}
      ${renderOverflowChoiceMenu(item)}
      ${renderMoveButton()}
      ${renderMovePickerMenu(item)}
      ${renderEditButton()}
      ${renderDeleteButton(item.id, true)}
    `;

    return renderInventoryItemCard(item, controls, "Storage");
  }).join("");
}

function handleInventoryActions(event) {
  const state = getState();
  const button = event.target.closest("button[data-action]");
  if (!button) return;

  const card = button.closest("[data-item-id]");
  const itemId = card?.dataset?.itemId;
  const item = itemId ? getInventoryItemById(itemId) : null;
  if (!item) return;

  const action = button.dataset.action;
  if (action === "deleteItem") {
    openEquipPickerItemId = null;
    openMovePickerItemId = null;
    openOverflowChoice = null;
    deleteInventoryItem(item.id);
    return;
  }

  if (action === "editItem") {
    openEquipPickerItemId = null;
    openMovePickerItemId = null;
    openOverflowChoice = null;
    startItemEdit(item.id);
    return;
  }

  if (action === "toggleDescription") {
    openEquipPickerItemId = null;
    openMovePickerItemId = null;
    openOverflowChoice = null;
    if (expandedDescriptionIds.has(item.id)) expandedDescriptionIds.delete(item.id);
    else expandedDescriptionIds.add(item.id);
    const isExpanded = expandedDescriptionIds.has(item.id);
    // In-place DOM update so the CSS transition can animate
    const itemCard = button.closest("[data-item-id]");
    const descEl = itemCard?.querySelector(".inventory-item-desc, .equipped-slot-desc");
    const toggleBtn = itemCard?.querySelector(".inventory-desc-toggle-btn");
    if (descEl) descEl.classList.toggle("collapsed", !isExpanded);
    if (toggleBtn) toggleBtn.setAttribute("aria-expanded", isExpanded ? "true" : "false");
    return;
  }

  if (action === "equipItem") {
    openMovePickerItemId = null;
    openOverflowChoice = null;
    if (shouldShowEquipTargetSelect(item)) {
      openEquipPickerItemId = openEquipPickerItemId === item.id ? null : item.id;
      renderInventory();
      return;
    }

    openEquipPickerItemId = null;
    const result = moveItemToEquippedSlot(item, null);
    if (result.requiresOverflowChoice) {
      openOverflowChoice = {
        itemId: item.id,
        targetSlotKey: result.targetSlotKey || null,
        targetSlots: result.targetSlots || null,
        message: result.message,
      };
      renderInventory();
      return;
    }
    renderInventory();
    scheduleSave();
    setItemFormError(result.message || "");
    return;
  }

  if (action === "equipToSlot") {
    const selectedSlot = button.dataset.slotKey || null;
    openEquipPickerItemId = null;
    openMovePickerItemId = null;
    openOverflowChoice = null;
    const result = moveItemToEquippedSlot(item, selectedSlot);
    if (result.requiresOverflowChoice) {
      openOverflowChoice = {
        itemId: item.id,
        targetSlotKey: result.targetSlotKey || selectedSlot,
        targetSlots: result.targetSlots || null,
        message: result.message,
      };
      renderInventory();
      return;
    }
    renderInventory();
    scheduleSave();
    setItemFormError(result.message || "");
    return;
  }

  if (action === "confirmOverflowToStorage") {
    const pending = openOverflowChoice;
    if (!pending || pending.itemId !== item.id) return;
    openEquipPickerItemId = null;
    openMovePickerItemId = null;
    openOverflowChoice = null;
    const result = moveItemToEquippedSlot(item, pending.targetSlotKey || null, {
      allowOverflowToStorage: true,
      forcedTargetSlots: pending.targetSlots || null,
    });
    renderInventory();
    if (result.ok) {
      scheduleSave();
      setItemFormError("");
    } else {
      setItemFormError(result.message || "Could not equip item.");
    }
    return;
  }

  if (action === "cancelOverflowChoice") {
    openOverflowChoice = null;
    renderInventory();
    return;
  }

  if (action === "moveItem") {
    openEquipPickerItemId = null;
    openOverflowChoice = null;
    const options = getMoveDestinationOptions(item);
    if (!options.length) return;
    openMovePickerItemId = openMovePickerItemId === item.id ? null : item.id;
    renderInventory();
    return;
  }

  if (action === "moveToDestination") {
    const destination = button.dataset.destination || "";
    openEquipPickerItemId = null;
    openMovePickerItemId = null;
    openOverflowChoice = null;
    const result = moveItemToDestination(item, destination);
    if (!result.ok) {
      setItemFormError(result.message || "Could not move item.");
      renderInventory();
      return;
    }
    setItemFormError("");
    renderInventory();
    scheduleSave();
    return;
  }

  if (action === "increaseQuantity") {
    if (normalizeItemType(item.itemType) !== "item" || !parseStackableValue(item.stackable)) return;
    item.quantity = parseItemQuantity((item.quantity || 1) + 1);
    renderInventory();
    scheduleSave();
    return;
  }

  if (action === "decreaseQuantity") {
    if (normalizeItemType(item.itemType) !== "item" || !parseStackableValue(item.stackable)) return;
    item.quantity = parseItemQuantity((item.quantity || 1) - 1);
    renderInventory();
    scheduleSave();
    return;
  }

  if (action === "toDorm" || action === "unequipToDorm") {
    openEquipPickerItemId = null;
    openMovePickerItemId = null;
    openOverflowChoice = null;
    if (isItemTypeDormRestricted(item)) {
      setItemFormError("Items cannot be sent to storage.");
      return;
    }
    placeItemInDorm(item);
    renderInventory();
    scheduleSave();
    return;
  }

  if (action === "toInventory" || action === "unequipToInventory") {
    openEquipPickerItemId = null;
    openMovePickerItemId = null;
    openOverflowChoice = null;
    if (!placeItemInFirstFreeInventorySlot(item)) {
      setItemFormError("Active inventory is full. Free a slot first.");
      return;
    }
    renderInventory();
    scheduleSave();
    return;
  }

}

function findDropZoneElement(target) {
  return target.closest("[data-drop-zone]");
}

function clearDropHighlights() {
  document.querySelectorAll(".inventory-drop-target").forEach(el => el.classList.remove("inventory-drop-target"));
  document.querySelectorAll(".inventory-drop-forbidden").forEach(el => el.classList.remove("inventory-drop-forbidden"));
}

function ensureDragGhost() {
  if (dragGhostEl) return dragGhostEl;
  const ghost = document.createElement("div");
  ghost.className = "inventory-drag-ghost";
  ghost.style.display = "none";
  document.body.appendChild(ghost);
  dragGhostEl = ghost;
  return ghost;
}

function showDragGhost(text) {
  const ghost = ensureDragGhost();
  ghost.textContent = text || "Item";
  ghost.classList.remove("is-valid", "is-forbidden");
  ghost.style.display = "block";
}

function setDragGhostValidity(isValid) {
  if (!dragGhostEl || dragGhostEl.style.display === "none") return;
  dragGhostEl.classList.toggle("is-valid", Boolean(isValid));
  dragGhostEl.classList.toggle("is-forbidden", !isValid);
}

function moveDragGhost(x, y) {
  if (!dragGhostEl || dragGhostEl.style.display === "none") return;
  dragGhostEl.style.left = `${x + 14}px`;
  dragGhostEl.style.top = `${y + 14}px`;
}

function hideDragGhost() {
  if (!dragGhostEl) return;
  dragGhostEl.classList.remove("is-valid", "is-forbidden");
  dragGhostEl.style.display = "none";
}

function triggerInvalidDropFeedback(zoneEl) {
  if (!zoneEl) return;
  zoneEl.classList.remove("inventory-drop-invalid");
  void zoneEl.offsetWidth;
  zoneEl.classList.add("inventory-drop-invalid");
  setTimeout(() => zoneEl.classList.remove("inventory-drop-invalid"), 260);
}

function evaluateDropTarget(item, zoneEl, currentTarget) {
  const state = getState();
  const zoneType = zoneEl?.dataset?.dropZone || currentTarget?.dataset?.dropZone;

  if (zoneType === "inventory-slot") {
    const slotIndex = parseInt(zoneEl?.dataset?.slotIndex ?? currentTarget?.dataset?.slotIndex, 10);
    if (!Number.isInteger(slotIndex)) return { ok: false, message: "Invalid slot." };
    const existingId = state.inventorySlots[slotIndex];
    if (!existingId || existingId === item.id) return { ok: true };
    if (Number.isInteger(item.inventorySlot) || item.location === "dorm") return { ok: true }; // swap from inventory or storage
    return { ok: false, message: "Target slot is occupied." };
  }

  if (zoneType === "inventory-list") {
    if (state.inventorySlots.some(id => !id)) return { ok: true };
    if (Number.isInteger(item.inventorySlot)) return { ok: true }; // no-op allowed
    return { ok: false, message: "Active inventory is full." };
  }

  if (zoneType === "dorm-list") {
    if (isItemTypeDormRestricted(item)) {
      return { ok: false, message: "Items cannot be dropped into storage." };
    }
    return { ok: true };
  }

  if (zoneType === "equipped-slot") {
    const slotKey = zoneEl?.dataset?.slotKey ?? currentTarget?.dataset?.slotKey;
    return moveItemToEquippedSlot(item, slotKey || null, { dryRun: true, strictTarget: true });
  }

  return { ok: false, message: "Drop target not recognized." };
}

function moveItemToInventorySlot(item, slotIndex) {
  const state = getState();
  const existingId = state.inventorySlots[slotIndex];

  if (!existingId || existingId === item.id) {
    return placeItemInInventorySlot(item, slotIndex)
      ? { ok: true }
      : { ok: false, message: "That inventory slot is unavailable." };
  }

  const other = getInventoryItemById(existingId);
  if (!other) {
    state.inventorySlots[slotIndex] = null;
    return placeItemInInventorySlot(item, slotIndex)
      ? { ok: true }
      : { ok: false, message: "That inventory slot is unavailable." };
  }

  if (!Number.isInteger(item.inventorySlot)) {
    if (item.location === "dorm") {
      if (!placeItemInDorm(other)) {
        return { ok: false, message: "Could not move swapped item to storage." };
      }
      return placeItemInInventorySlot(item, slotIndex)
        ? { ok: true }
        : { ok: false, message: "That inventory slot is unavailable." };
    }
    return { ok: false, message: "Target slot is occupied." };
  }

  const fromSlot = item.inventorySlot;
  state.inventorySlots[fromSlot] = other.id;
  other.inventorySlot = fromSlot;
  state.inventorySlots[slotIndex] = item.id;
  item.inventorySlot = slotIndex;
  other.location = "inventory";
  item.location = "inventory";
  return { ok: true };
}

function handleInventoryDrop(event) {
  if (!draggingItemId) return;
  event.preventDefault();

  const item = getInventoryItemById(draggingItemId);
  if (!item) return;

  const zone = findDropZoneElement(event.target);
  const fallbackZone = event.currentTarget?.dataset?.dropZone;
  const zoneType = zone?.dataset?.dropZone || fallbackZone;
  const targetZoneEl = zone || event.currentTarget;

  let result = { ok: false, message: "Drop target not recognized." };
  if (zoneType === "inventory-slot") {
    const slotIndex = parseInt(zone?.dataset?.slotIndex ?? event.currentTarget?.dataset?.slotIndex, 10);
    if (Number.isInteger(slotIndex)) result = moveItemToInventorySlot(item, slotIndex);
  } else if (zoneType === "inventory-list") {
    result = placeItemInFirstFreeInventorySlot(item)
      ? { ok: true }
      : { ok: false, message: "Active inventory is full. Drop onto a specific slot to swap." };
  } else if (zoneType === "equipped-slot") {
    const slotKey = zone?.dataset?.slotKey ?? event.currentTarget?.dataset?.slotKey;
    result = moveItemToEquippedSlot(item, slotKey || null, { strictTarget: true });
  } else if (zoneType === "dorm-list") {
    result = placeItemInDorm(item) ? { ok: true } : { ok: false, message: "Could not move item to storage." };
  }

  clearDropHighlights();
  if (result.requiresOverflowChoice) {
    openOverflowChoice = {
      itemId: item.id,
      targetSlotKey: result.targetSlotKey || null,
      targetSlots: result.targetSlots || null,
      message: result.message,
    };
    hideDragGhost();
    draggingItemId = null;
    renderInventory();
    return;
  }
  if (!result.ok) {
    triggerInvalidDropFeedback(targetZoneEl);
    setItemFormError(result.message);
    hideDragGhost();
    draggingItemId = null;
    return;
  }

  hideDragGhost();
  draggingItemId = null;
  setItemFormError(result.message || "");
  renderInventory();
  scheduleSave();
}

function handleInventoryDragStart(event) {
  const card = event.target.closest("[data-item-id][draggable='true']");
  if (!card) return;

  draggingItemId = card.dataset.itemId;
  const itemName = card.querySelector(".inventory-item-name, .equipped-slot-item")?.textContent?.trim() || "Item";
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData("text/plain", draggingItemId);
  showDragGhost(itemName);
  moveDragGhost(event.clientX, event.clientY);
}

function handleInventoryDragOver(event) {
  if (!draggingItemId) return;
  const zone = findDropZoneElement(event.target) || event.currentTarget;
  if (!zone) return;

  const item = getInventoryItemById(draggingItemId);
  if (!item) return;
  const validity = evaluateDropTarget(item, zone, event.currentTarget);

  event.preventDefault();
  moveDragGhost(event.clientX, event.clientY);
  clearDropHighlights();
  if (validity.ok) {
    zone.classList.add("inventory-drop-target");
    setDragGhostValidity(true);
    event.dataTransfer.dropEffect = "move";
  } else {
    zone.classList.add("inventory-drop-forbidden");
    setDragGhostValidity(false);
    event.dataTransfer.dropEffect = "none";
  }
}

function handleInventoryDragEnd() {
  hideDragGhost();
  draggingItemId = null;
  clearDropHighlights();
}

function ensureInventoryStateShape() {
  const state = getState();
  if (!state) return;

  if (!Array.isArray(state.inventoryItems)) state.inventoryItems = [];
  state.yen = parseYenValue(state.yen);
  if (!Array.isArray(state.inventorySlots)) {
    state.inventorySlots = [null, null, null, null, null];
  }
  if (!Array.isArray(state.dormItemIds)) state.dormItemIds = [];
  if (!state.equippedSlots || typeof state.equippedSlots !== "object") {
    state.equippedSlots = {};
  }

  // Legacy migration: single accessory slot -> two accessory slots.
  if (state.equippedSlots.accessory) {
    const legacyAccessoryId = state.equippedSlots.accessory;
    if (!state.equippedSlots.accessory1) {
      state.equippedSlots.accessory1 = legacyAccessoryId;
    } else if (!state.equippedSlots.accessory2) {
      state.equippedSlots.accessory2 = legacyAccessoryId;
    }
    delete state.equippedSlots.accessory;
  }

  // Legacy migration: chest/back collapsed into one body slot.
  if ("chest" in state.equippedSlots || "back" in state.equippedSlots) {
    const legacyBodyIds = [state.equippedSlots.chest, state.equippedSlots.back].filter(Boolean);
    if (!("body" in state.equippedSlots) || !state.equippedSlots.body) {
      state.equippedSlots.body = legacyBodyIds[0] || null;
    }
    delete state.equippedSlots.chest;
    delete state.equippedSlots.back;
  }

  BODY_SLOT_KEYS.forEach(slot => {
    if (!(slot in state.equippedSlots)) state.equippedSlots[slot] = null;
  });

  state.inventoryItems = state.inventoryItems.map(item => ({
    id: String(item?.id || ""),
    name: String(item?.name || "").trim(),
    description: String(item?.description || ""),
    modifier: String(item?.modifier || ""),
    modifiers: normalizeModifierList(item?.modifiers),
    itemType: normalizeItemType(item?.itemType || inferLegacyItemType(item)),
    weaponGrip: item?.weaponGrip || null,
    weaponType: normalizeWeaponType(item?.weaponType),
    weaponStat: normalizeWeaponStat(item?.weaponStat),
    weaponDamageParts: normalizeWeaponDamageParts(item?.weaponDamageParts),
    weaponRange: parseWeaponRange(item?.weaponRange),
    weaponPolearmReach: parseWeaponPolearmReach(item?.weaponPolearmReach),
    allowedSlots: normalizeAllowedSlots(item?.allowedSlots),
    slotsNeeded: clamp(parseInt(item?.slotsNeeded, 10) || 1, 1, 3),
    stackable: parseStackableValue(item?.stackable),
    quantity: parseItemQuantity(item?.quantity),
    location: ["inventory", "dorm", "equipped"].includes(item?.location) ? item.location : "dorm",
    inventorySlot: Number.isInteger(item?.inventorySlot) ? item.inventorySlot : null,
    equippedSlots: Array.isArray(item?.equippedSlots)
      ? item.equippedSlots.filter(slot => BODY_SLOT_KEYS.includes(slot))
      : [],
  })).filter(item => item.id && item.name);

  state.inventoryItems.forEach(item => applyItemTypeDefaults(item));

  const byId = new Map(state.inventoryItems.map(item => [item.id, item]));

  state.inventorySlots = state.inventorySlots.map((id, idx) => {
    if (!id || !byId.has(id)) return null;
    const item = byId.get(id);
    item.location = "inventory";
    item.inventorySlot = idx;
    item.equippedSlots = [];
    return id;
  });

  state.dormItemIds = state.dormItemIds.filter(id => byId.has(id));
  state.dormItemIds.forEach(id => {
    const item = byId.get(id);
    item.location = "dorm";
    item.inventorySlot = null;
    item.equippedSlots = [];
  });

  BODY_SLOT_KEYS.forEach(slot => {
    const id = state.equippedSlots[slot];
    if (!id || !byId.has(id)) {
      state.equippedSlots[slot] = null;
      return;
    }
    const item = byId.get(id);
    item.location = "equipped";
    item.inventorySlot = null;
    if (!item.equippedSlots.includes(slot)) item.equippedSlots.push(slot);
  });

  state.inventoryItems.forEach(item => {
    if (item.location === "inventory" && item.inventorySlot !== null) return;
    if (item.location === "dorm" && state.dormItemIds.includes(item.id)) return;
    if (item.location === "equipped" && item.equippedSlots.length) return;
    if (placeItemInFirstFreeInventorySlot(item)) return;
    if (isItemTypeDormRestricted(item)) {
      if (placeItemEquipped(item, "rightHand").ok) return;
      if (placeItemEquipped(item, "leftHand").ok) return;
    }
    placeItemInDorm(item);
  });

  const effects = computeActiveModifierEffects(state);
  const desiredSlotCount = Math.max(1, 5 + (effects.extraInventorySlots || 0));
  if (state.inventorySlots.length > desiredSlotCount) {
    const overflowIds = state.inventorySlots.slice(desiredSlotCount).filter(Boolean);
    state.inventorySlots = state.inventorySlots.slice(0, desiredSlotCount);
    overflowIds.forEach(id => {
      const item = byId.get(id);
      if (!item) return;
      item.inventorySlot = null;
      placeItemInDorm(item);
    });
  } else if (state.inventorySlots.length < desiredSlotCount) {
    while (state.inventorySlots.length < desiredSlotCount) state.inventorySlots.push(null);
  }
}

export function renderInventory() {
  ensureInventoryStateShape();
  const state = getState();
  setYenInputDisplay(state?.yen);
  renderEquippedSlots();
  renderInventorySlots();
  renderDormInventory();
  if (_refreshCharacterStats) _refreshCharacterStats();
}

export function initInventory({ getState: getStateFn, scheduleSave: scheduleSaveFn, refreshCharacterStats: refreshCharacterStatsFn = null }) {
  _getState = getStateFn;
  _scheduleSave = scheduleSaveFn;
  _refreshCharacterStats = refreshCharacterStatsFn;

  ensureWeaponEditorFields();

  if (isInitialized) {
    renderInventory();
    return;
  }

  const saveBtn = document.getElementById("saveItemBtn");
  const cancelBtn = document.getElementById("cancelEditItemBtn");
  const equippedGrid = document.getElementById("equippedSlotsGrid");
  const inventoryList = document.getElementById("inventorySlotsList");
  const dormList = document.getElementById("dormInventoryList");
  const yenInput = document.getElementById("yenInput");
  const addYenBtn = document.querySelector("button[data-yen-adjust='add']");
  const subtractYenBtn = document.querySelector("button[data-yen-adjust='subtract']");
  const yenAdjustPopover = document.getElementById("yenAdjustPopover");
  const yenAdjustAmountInput = document.getElementById("yenAdjustAmountInput");
  const yenAdjustApplyBtn = document.getElementById("yenAdjustApplyBtn");
  const yenAdjustCancelBtn = document.getElementById("yenAdjustCancelBtn");
  const editorToggleBtn = document.getElementById("toggleItemEditorBtn");
  const dormToggleBtn = document.getElementById("dormToggleBtn");
  const itemTypeSelect = document.getElementById("itemTypeSelect");
  const itemTypeTabs = document.querySelectorAll(".inventory-type-tab");
  const itemWeaponTypeSelect = document.getElementById("itemWeaponTypeSelect");
  const itemStackableToggle = document.getElementById("itemStackableToggle");
  const itemModifiersSummary = document.getElementById("itemModifiersSummary");

  if (!saveBtn || !cancelBtn || !equippedGrid || !inventoryList || !dormList || !yenInput || !addYenBtn || !subtractYenBtn || !yenAdjustPopover || !yenAdjustAmountInput || !yenAdjustApplyBtn || !yenAdjustCancelBtn || !editorToggleBtn || !dormToggleBtn || !itemTypeSelect || !itemStackableToggle || !itemModifiersSummary || !itemTypeTabs.length) return;

  saveBtn.addEventListener("click", saveItemFromForm);
  cancelBtn.addEventListener("click", resetItemEditor);
  equippedGrid.addEventListener("click", handleInventoryActions);
  inventoryList.addEventListener("click", handleInventoryActions);
  dormList.addEventListener("click", handleInventoryActions);

  editorToggleBtn.addEventListener("click", () => {
    const isOpen = editorToggleBtn.getAttribute("aria-expanded") === "true";
    setItemEditorOpen(!isOpen);
  });
  dormToggleBtn.addEventListener("click", () => {
    const isOpen = dormToggleBtn.getAttribute("aria-expanded") === "true";
    setDormOpen(!isOpen);
  });
  itemTypeTabs.forEach(button => {
    button.addEventListener("click", () => {
      const nextType = setActiveItemType(button.dataset.itemType || "clothing");
      setItemTypeFieldsVisibility(nextType);
    });
  });
  itemStackableToggle.addEventListener("change", () => {
    setItemTypeFieldsVisibility(getItemTypeFromForm());
  });
  itemWeaponTypeSelect?.addEventListener("change", syncWeaponSubtypeFields);

  initWeaponDamageEditorUI();

  initModifierEditorUI();

  document.addEventListener("click", event => {
    if (openEquipPickerItemId) {
      const clickedInsidePicker = event.target.closest(".inventory-equip-picker");
      const clickedEquipBtn = event.target.closest("button[data-action='equipItem']");
      if (!clickedInsidePicker && !clickedEquipBtn) closeEquipPicker();
    }

    if (openMovePickerItemId) {
      const clickedInsideMovePicker = event.target.closest(".inventory-move-picker");
      const clickedMoveBtn = event.target.closest("button[data-action='moveItem']");
      if (!clickedInsideMovePicker && !clickedMoveBtn) closeMovePicker();
    }

    if (openOverflowChoice) {
      const clickedInsideOverflowPicker = event.target.closest(".inventory-overflow-picker");
      const clickedEquipBtn = event.target.closest("button[data-action='equipItem'], button[data-action='equipToSlot']");
      if (!clickedInsideOverflowPicker && !clickedEquipBtn) closeOverflowChoice();
    }

    if (openYenAdjustMode) {
      const clickedInsideYenPopover = event.target.closest("#yenAdjustPopover");
      const clickedYenAdjustBtn = event.target.closest("button[data-yen-adjust]");
      if (!clickedInsideYenPopover && !clickedYenAdjustBtn) closeYenAdjustPopover();
    }
  });

  yenInput.addEventListener("input", e => {
    const state = getState();
    const nextValue = parseYenInputText(e.target.value);
    state.yen = nextValue;
    e.target.value = nextValue ? formatYenValue(nextValue) : "";
    scheduleSave();
  });

  yenInput.addEventListener("blur", () => {
    const state = getState();
    setYenInputDisplay(state?.yen || 0);
  });

  addYenBtn.addEventListener("click", () => {
    openYenAdjustPopoverFor("add");
  });

  subtractYenBtn.addEventListener("click", () => {
    openYenAdjustPopoverFor("subtract");
  });

  yenAdjustApplyBtn.addEventListener("click", () => {
    applyYenAdjustFromPopover();
  });

  yenAdjustCancelBtn.addEventListener("click", () => {
    closeYenAdjustPopover();
  });

  yenAdjustAmountInput.addEventListener("input", e => {
    const value = parseYenInputText(e.target.value);
    e.target.value = value ? formatYenValue(value) : "";
  });

  yenAdjustAmountInput.addEventListener("keydown", e => {
    if (e.key === "Enter") {
      e.preventDefault();
      applyYenAdjustFromPopover();
    } else if (e.key === "Escape") {
      e.preventDefault();
      closeYenAdjustPopover();
    }
  });

  setActiveItemType(getItemTypeFromForm());

  [equippedGrid, inventoryList, dormList].forEach(el => {
    el.addEventListener("dragstart", handleInventoryDragStart);
    el.addEventListener("dragover", handleInventoryDragOver);
    el.addEventListener("drop", handleInventoryDrop);
    el.addEventListener("dragend", handleInventoryDragEnd);
    el.addEventListener("dragleave", () => clearDropHighlights());
  });

  inventoryList.dataset.dropZone = "inventory-list";
  dormList.dataset.dropZone = "dorm-list";

  isInitialized = true;
  setDormOpen(false);
  resetItemEditor();
  renderInventory();
}

