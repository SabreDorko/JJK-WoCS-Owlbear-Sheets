import { BODY_SLOT_KEYS, BODY_SLOT_LABELS } from "./state/store.js";

let _getState = null;
let _scheduleSave = null;
let editingItemId = null;
let isInitialized = false;
let draggingItemId = null;
let dragGhostEl = null;
const expandedDescriptionIds = new Set();
let openEquipPickerItemId = null;
let openMovePickerItemId = null;
let openYenAdjustMode = null;

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
const CLOTHING_SELECTABLE_SLOT_KEYS = ["head", "chest", "back", "legs", "feet", "accessory"];
const ITEM_TYPES = ["clothing", "weapon", "item"];

function normalizeItemType(rawType) {
  return ITEM_TYPES.includes(rawType) ? rawType : "clothing";
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
    return;
  }

  if (itemType === "item") {
    item.weaponGrip = null;
    item.allowedSlots = ["rightHand", "leftHand"];
    item.slotsNeeded = 1;
    return;
  }

  item.weaponGrip = null;
  item.allowedSlots = normalizeAllowedSlots(item.allowedSlots).filter(slot => CLOTHING_SELECTABLE_SLOT_KEYS.includes(slot));
  item.slotsNeeded = clamp(parseInt(item.slotsNeeded, 10) || 1, 1, 3);
}

function inferLegacyItemType(item) {
  const allowed = normalizeAllowedSlots(item?.allowedSlots);
  const internalAllowed = [...new Set(allowed.flatMap(toInternalEquipSlots))];
  const onlyHands = internalAllowed.length > 0 && internalAllowed.every(slot => HAND_SLOT_KEYS.includes(slot));
  return onlyHands ? "weapon" : "clothing";
}

function toInternalEquipSlots(slot) {
  if (slot === "accessory") return ["accessory1", "accessory2"];
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

function setItemEditorOpen(isOpen) {
  const panel = document.getElementById("itemEditorPanel");
  const toggleBtn = document.getElementById("toggleItemEditorBtn");
  if (!panel || !toggleBtn) return;
  panel.classList.toggle("collapsed", !isOpen);
  toggleBtn.setAttribute("aria-expanded", isOpen ? "true" : "false");
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
  if (slotIndex < 0 || slotIndex > 4) return false;
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
  const { dryRun = false, strictTarget = false } = options;
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
  const chevron = isDescriptionExpanded ? "&#9662;" : "&#9656;";
  return `<button type="button" class="inventory-desc-toggle-btn" data-action="toggleDescription" aria-label="${ariaLabel}" title="${ariaLabel}" aria-expanded="${isDescriptionExpanded ? "true" : "false"}">${chevron}</button>`;
}

function renderEditButton() {
  return '<button type="button" class="inventory-mini-btn inventory-icon-btn inventory-icon-btn-edit" data-action="editItem" aria-label="Edit item" title="Edit item">&#9998;</button>';
}

function renderDeleteButton() {
  return `
    <button type="button" class="inventory-mini-btn inventory-icon-btn danger" data-action="deleteItem" aria-label="Delete item" title="Delete item">
      <svg class="inventory-icon-trash" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path fill="currentColor" d="M9 3h6l1 2h4v2H4V5h4l1-2zm1 6h2v9h-2V9zm4 0h2v9h-2V9zM7 9h2v9H7V9z"/>
      </svg>
    </button>
  `;
}

function renderMoveButton() {
  return '<button type="button" class="inventory-mini-btn inventory-icon-btn inventory-icon-btn-move" data-action="moveItem" aria-label="Move item" title="Move item">&#8644;</button>';
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

function renderMovePickerMenu(item) {
  if (openMovePickerItemId !== item.id) return "";
  const options = getMoveDestinationOptions(item);
  if (!options.length) return "";

  return `
    <div class="inventory-equip-picker inventory-move-picker" role="menu" aria-label="Choose destination">
      ${options.map(option => `<button type="button" class="inventory-mini-btn" data-action="moveToDestination" data-destination="${option.key}">${option.label}</button>`).join("")}
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

function collectAllowedSlotsFromForm() {
  return Array.from(document.querySelectorAll("#itemAllowedSlots input[type='checkbox']:checked"))
    .map(input => input.value)
    .filter(slot => CLOTHING_SELECTABLE_SLOT_KEYS.includes(slot));
}

function setItemTypeFieldsVisibility(itemType) {
  const slotsNeededField = document.getElementById("itemSlotsNeededField");
  const slotsNeededLabel = document.getElementById("itemSlotsNeededLabel");
  const allowedSlotsField = document.getElementById("itemAllowedSlotsField");
  const weaponGripField = document.getElementById("itemWeaponGripField");
  const preferredLocation = document.getElementById("itemPreferredLocation");
  if (!slotsNeededField || !slotsNeededLabel || !allowedSlotsField || !weaponGripField || !preferredLocation) return;

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

  const dormOption = preferredLocation.querySelector("option[value='dorm']");
  if (dormOption) {
    dormOption.disabled = false;
    dormOption.hidden = false;
  }
}

function getItemTypeFromForm() {
  const select = document.getElementById("itemTypeSelect");
  return normalizeItemType(select?.value);
}

function getItemConfigFromForm() {
  const itemType = getItemTypeFromForm();
  if (itemType === "weapon") {
    const gripSelect = document.getElementById("itemWeaponGripSelect");
    const weaponGrip = normalizeWeaponGrip(gripSelect?.value, 1);
    return {
      itemType,
      weaponGrip,
      allowedSlots: ["rightHand", "leftHand"],
      slotsNeeded: weaponGrip === "twoHanded" ? 2 : 1,
    };
  }

  if (itemType === "item") {
    return {
      itemType,
      weaponGrip: null,
      allowedSlots: ["rightHand", "leftHand"],
      slotsNeeded: 1,
    };
  }

  return {
    itemType,
    weaponGrip: null,
    allowedSlots: collectAllowedSlotsFromForm(),
    slotsNeeded: clamp(parseInt(document.getElementById("itemSlotsNeededSelect")?.value, 10) || 1, 1, 3),
  };
}

function resetItemEditor() {
  editingItemId = null;
  const title = document.getElementById("itemEditorTitle");
  if (!title) return;

  document.getElementById("itemEditorTitle").textContent = "Create Item";
  document.getElementById("itemNameInput").value = "";
  document.getElementById("itemModifierInput").value = "";
  document.getElementById("itemDescriptionInput").value = "";
  document.getElementById("itemTypeSelect").value = "clothing";
  document.getElementById("itemWeaponGripSelect").value = "oneHanded";
  document.getElementById("itemSlotsNeededSelect").value = "1";
  document.getElementById("itemPreferredLocation").value = "inventory";
  document.querySelectorAll("#itemAllowedSlots input[type='checkbox']").forEach(input => {
    input.checked = false;
  });
  setItemTypeFieldsVisibility("clothing");
  document.getElementById("saveItemBtn").textContent = "Save Item";
  document.getElementById("cancelEditItemBtn").style.display = "none";
  setItemFormError("");
  setItemEditorOpen(false);
}

function startItemEdit(itemId) {
  const item = getInventoryItemById(itemId);
  if (!item) return;
  editingItemId = itemId;

  document.getElementById("itemEditorTitle").textContent = "Edit Item";
  document.getElementById("itemNameInput").value = item.name;
  document.getElementById("itemModifierInput").value = item.modifier;
  document.getElementById("itemDescriptionInput").value = item.description;
  document.getElementById("itemTypeSelect").value = normalizeItemType(item.itemType);
  document.getElementById("itemWeaponGripSelect").value = normalizeWeaponGrip(item.weaponGrip, item.slotsNeeded);
  document.getElementById("itemSlotsNeededSelect").value = String(item.slotsNeeded || 1);
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
  const modifier = document.getElementById("itemModifierInput").value.trim();
  const description = document.getElementById("itemDescriptionInput").value.trim();
  const itemConfig = getItemConfigFromForm();
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
      modifier,
      description,
      itemType: itemConfig.itemType,
      weaponGrip: itemConfig.weaponGrip,
      allowedSlots,
      slotsNeeded,
      location: "dorm",
      inventorySlot: null,
      equippedSlots: [],
    };
    state.inventoryItems.push(item);
  } else {
    item.name = name;
    item.modifier = modifier;
    item.description = description;
    item.itemType = itemConfig.itemType;
    item.weaponGrip = itemConfig.weaponGrip;
    item.allowedSlots = allowedSlots;
    item.slotsNeeded = slotsNeeded;
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
  const modifier = item.modifier
    ? `<div class="inventory-item-modifier">${modifierPrefix}${escapeHtml(item.modifier)}</div>`
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
  const equipText = item.allowedSlots.map(slot => getAllowedSlotLabel(slot)).join(", ");
  const details = [];

  if (normalizedType === "weapon") {
    details.push(normalizeWeaponGrip(item.weaponGrip, item.slotsNeeded) === "twoHanded" ? "Two-Handed" : "One-Handed");
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
    const weaponHandedness = normalizedType === "weapon"
      ? (normalizeWeaponGrip(item.weaponGrip, item.slotsNeeded) === "twoHanded" ? "Two-Handed" : "One-Handed")
      : "";
    const occupies = normalizedType !== "weapon" && item.equippedSlots.length > 1
      ? `Occupying: ${item.equippedSlots.map(key => BODY_SLOT_LABELS[key]).join(", ")}`
      : "";
    const hasDescription = Boolean(item.description);
    const isDescriptionExpanded = expandedDescriptionIds.has(item.id);
    return `
      <div class="equipped-slot-card" data-item-id="${item.id}" data-slot-key="${slot}" data-drop-zone="equipped-slot" draggable="true">
        <div class="equipped-slot-label">${BODY_SLOT_LABELS[slot]}</div>
        <div class="equipped-slot-item">${escapeHtml(item.name)}</div>
        ${weaponHandedness ? `<div class="equipped-slot-meta">${weaponHandedness}</div>` : ""}
        ${occupies ? `<div class="equipped-slot-meta">${occupies}</div>` : ""}
        ${hasDescription ? renderDescriptionToggleButton(isDescriptionExpanded) : ""}
        ${hasDescription ? `<div class="equipped-slot-desc${isDescriptionExpanded ? "" : " collapsed"}">${escapeHtml(item.description)}</div>` : ""}
        ${item.modifier ? `<div class="equipped-slot-mod">${escapeHtml(item.modifier)}</div>` : ""}
        <div class="equipped-slot-actions">
          ${renderMoveButton()}
          ${renderMovePickerMenu(item)}
          ${renderEditButton()}
          ${renderDeleteButton()}
        </div>
      </div>
    `;
  }).join("");
}

function renderInventorySlots() {
  const state = getState();
  const root = document.getElementById("inventorySlotsList");
  if (!root) return;

  root.innerHTML = state.inventorySlots.map((itemId, index) => {
    if (!itemId) {
      return `
        <div class="inventory-slot-card empty" data-slot-index="${index}" data-drop-zone="inventory-slot">
          <div class="inventory-slot-label">Slot ${index + 1}</div>
          <div class="inventory-slot-empty">Empty</div>
        </div>
      `;
    }

    const item = getInventoryItemById(itemId);
    if (!item) return "";

    const controls = `
      <button type="button" class="inventory-mini-btn" data-action="equipItem">Equip</button>
      ${renderEquipPickerMenu(item)}
      ${renderMoveButton()}
      ${renderMovePickerMenu(item)}
      ${renderEditButton()}
      ${renderDeleteButton()}
    `;

    return `
      <div class="inventory-slot-card" data-slot-index="${index}" data-item-id="${item.id}" data-drop-zone="inventory-slot">
        ${renderInventoryItemCard(item, controls, "Stored")}
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
      ${renderMoveButton()}
      ${renderMovePickerMenu(item)}
      ${renderEditButton()}
      ${renderDeleteButton()}
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
    deleteInventoryItem(item.id);
    return;
  }

  if (action === "editItem") {
    openEquipPickerItemId = null;
    openMovePickerItemId = null;
    startItemEdit(item.id);
    return;
  }

  if (action === "toggleDescription") {
    openEquipPickerItemId = null;
    openMovePickerItemId = null;
    if (expandedDescriptionIds.has(item.id)) expandedDescriptionIds.delete(item.id);
    else expandedDescriptionIds.add(item.id);
    renderInventory();
    return;
  }

  if (action === "equipItem") {
    openMovePickerItemId = null;
    if (shouldShowEquipTargetSelect(item)) {
      openEquipPickerItemId = openEquipPickerItemId === item.id ? null : item.id;
      renderInventory();
      return;
    }

    openEquipPickerItemId = null;
    const result = moveItemToEquippedSlot(item, null);
    renderInventory();
    scheduleSave();
    setItemFormError(result.message || "");
    return;
  }

  if (action === "equipToSlot") {
    const selectedSlot = button.dataset.slotKey || null;
    openEquipPickerItemId = null;
    openMovePickerItemId = null;
    const result = moveItemToEquippedSlot(item, selectedSlot);
    renderInventory();
    scheduleSave();
    setItemFormError(result.message || "");
    return;
  }

  if (action === "moveItem") {
    openEquipPickerItemId = null;
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

  if (action === "toDorm" || action === "unequipToDorm") {
    openEquipPickerItemId = null;
    openMovePickerItemId = null;
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
    if (Number.isInteger(item.inventorySlot)) return { ok: true }; // swap within inventory
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
  if (!Array.isArray(state.inventorySlots) || state.inventorySlots.length !== 5) {
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

  BODY_SLOT_KEYS.forEach(slot => {
    if (!(slot in state.equippedSlots)) state.equippedSlots[slot] = null;
  });

  state.inventoryItems = state.inventoryItems.map(item => ({
    id: String(item?.id || ""),
    name: String(item?.name || "").trim(),
    description: String(item?.description || ""),
    modifier: String(item?.modifier || ""),
    itemType: normalizeItemType(item?.itemType || inferLegacyItemType(item)),
    weaponGrip: item?.weaponGrip || null,
    allowedSlots: normalizeAllowedSlots(item?.allowedSlots),
    slotsNeeded: clamp(parseInt(item?.slotsNeeded, 10) || 1, 1, 3),
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
}

export function renderInventory() {
  ensureInventoryStateShape();
  const state = getState();
  setYenInputDisplay(state?.yen);
  renderEquippedSlots();
  renderInventorySlots();
  renderDormInventory();
}

export function initInventory({ getState: getStateFn, scheduleSave: scheduleSaveFn }) {
  _getState = getStateFn;
  _scheduleSave = scheduleSaveFn;

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

  if (!saveBtn || !cancelBtn || !equippedGrid || !inventoryList || !dormList || !yenInput || !addYenBtn || !subtractYenBtn || !yenAdjustPopover || !yenAdjustAmountInput || !yenAdjustApplyBtn || !yenAdjustCancelBtn || !editorToggleBtn || !dormToggleBtn || !itemTypeSelect) return;

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
  itemTypeSelect.addEventListener("change", () => {
    setItemTypeFieldsVisibility(getItemTypeFromForm());
  });

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

