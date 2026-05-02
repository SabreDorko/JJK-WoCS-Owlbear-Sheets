import { BODY_SLOT_KEYS, BODY_SLOT_LABELS } from "./state/store.js";

let _getState = null;
let _scheduleSave = null;
let editingItemId = null;
let isInitialized = false;
let draggingItemId = null;
let dragGhostEl = null;

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

const SELECTABLE_SLOT_KEYS = [...BODY_SLOT_KEYS, "accessory"];

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

function askYenAdjustmentAmount(direction) {
  const promptText = direction > 0
    ? "Add how much yen?"
    : "Subtract how much yen?";
  const response = window.prompt(promptText, "100");
  if (response === null) return null;
  const amount = parseYenValue(response);
  if (amount <= 0) return null;
  return amount;
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
  const state = getState();
  removeItemFromContainers(item);
  item.location = "dorm";
  if (!state.dormItemIds.includes(item.id)) state.dormItemIds.push(item.id);
  return true;
}

function getEquipSlotsForItem(item, preferredPrimarySlot) {
  const state = getState();
  const allowed = [...new Set((item.allowedSlots || []).flatMap(toInternalEquipSlots))].filter(slot => BODY_SLOT_KEYS.includes(slot));
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

function deleteInventoryItem(itemId) {
  const state = getState();
  const item = getInventoryItemById(itemId);
  if (!item) return;

  removeItemFromContainers(item);
  state.inventoryItems = state.inventoryItems.filter(entry => entry.id !== itemId);
  if (editingItemId === itemId) resetItemEditor();
  renderInventory();
  scheduleSave();
}

function collectAllowedSlotsFromForm() {
  return Array.from(document.querySelectorAll("#itemAllowedSlots input[type='checkbox']:checked"))
    .map(input => input.value)
    .filter(slot => SELECTABLE_SLOT_KEYS.includes(slot));
}

function resetItemEditor() {
  editingItemId = null;
  const title = document.getElementById("itemEditorTitle");
  if (!title) return;

  document.getElementById("itemEditorTitle").textContent = "Create Item";
  document.getElementById("itemNameInput").value = "";
  document.getElementById("itemModifierInput").value = "";
  document.getElementById("itemDescriptionInput").value = "";
  document.getElementById("itemSlotsNeededSelect").value = "1";
  document.getElementById("itemPreferredLocation").value = "inventory";
  document.querySelectorAll("#itemAllowedSlots input[type='checkbox']").forEach(input => {
    input.checked = false;
  });
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
  document.getElementById("itemSlotsNeededSelect").value = String(item.slotsNeeded || 1);
  document.getElementById("itemPreferredLocation").value = item.location === "equipped" ? "equipped" : item.location;
  document.querySelectorAll("#itemAllowedSlots input[type='checkbox']").forEach(input => {
    input.checked = item.allowedSlots.includes(input.value);
  });
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
  const slotsNeeded = clamp(parseInt(document.getElementById("itemSlotsNeededSelect").value, 10) || 1, 1, 3);
  const preferredLocation = document.getElementById("itemPreferredLocation").value;
  const allowedSlots = collectAllowedSlotsFromForm();

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
    item.allowedSlots = allowedSlots;
    item.slotsNeeded = slotsNeeded;
  }

  let placementResult = { ok: true };
  if (preferredLocation === "equipped") {
    placementResult = placeItemEquipped(item);
    if (!placementResult.ok) {
      if (!placeItemInFirstFreeInventorySlot(item)) placeItemInDorm(item);
    }
  } else if (preferredLocation === "inventory") {
    if (!placeItemInFirstFreeInventorySlot(item)) {
      placeItemInDorm(item);
      placementResult = { ok: false, message: "Active inventory is full. Item sent to dorm storage." };
    }
  } else {
    placeItemInDorm(item);
  }

  renderInventory();
  scheduleSave();
  resetItemEditor();
  if (!placementResult.ok && placementResult.message) setItemFormError(placementResult.message);
}

function getItemEquipTarget(triggerEl, itemId) {
  const actionRow = triggerEl.closest(".inventory-item-actions") || triggerEl.closest(".equipped-slot-actions");
  const select = actionRow?.querySelector(`select[data-equip-select='${itemId}']`)
    || triggerEl.closest("[data-item-id]")?.querySelector(`select[data-equip-select='${itemId}']`)
    || document.querySelector(`select[data-equip-select='${itemId}']`);
  const selected = select ? select.value : "auto";
  if (!selected || selected === "auto") return null;
  return selected;
}

function buildEquipSelectOptions(itemId, allowedSlots) {
  const options = ["<option value='auto'>Auto</option>"];
  allowedSlots.forEach(slot => {
    options.push(`<option value='${slot}'>${getAllowedSlotLabel(slot)}</option>`);
  });
  return `
    <select class="inventory-inline-select" data-equip-select="${itemId}">
      ${options.join("")}
    </select>
  `;
}

function renderInventoryItemCard(item, controlsHtml, locationTag) {
  const modifier = item.modifier ? `<div class="inventory-item-modifier">${escapeHtml(item.modifier)}</div>` : "";
  const description = item.description ? `<div class="inventory-item-desc">${escapeHtml(item.description)}</div>` : "";

  return `
    <div class="inventory-item-card" data-item-id="${item.id}" draggable="true">
      <div class="inventory-item-top">
        <div class="inventory-item-name">${escapeHtml(item.name)}</div>
        <div class="inventory-item-location">${escapeHtml(locationTag)}</div>
      </div>
      ${modifier}
      ${description}
      <div class="inventory-item-slots">Equip: ${item.allowedSlots.map(slot => getAllowedSlotLabel(slot)).join(", ") || "None"} | Needs ${item.slotsNeeded} slot${item.slotsNeeded > 1 ? "s" : ""}</div>
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

    const occupies = item.equippedSlots.map(key => BODY_SLOT_LABELS[key]).join(", ");
    return `
      <div class="equipped-slot-card" data-item-id="${item.id}" data-slot-key="${slot}" data-drop-zone="equipped-slot" draggable="true">
        <div class="equipped-slot-label">${BODY_SLOT_LABELS[slot]}</div>
        <div class="equipped-slot-item">${escapeHtml(item.name)}</div>
        <div class="equipped-slot-meta">Occupies: ${occupies}</div>
        ${item.modifier ? `<div class="equipped-slot-mod">Active: ${escapeHtml(item.modifier)}</div>` : ""}
        <div class="equipped-slot-actions">
          <button type="button" class="inventory-mini-btn" data-action="unequipToInventory">To Inventory</button>
          <button type="button" class="inventory-mini-btn" data-action="unequipToDorm">To Dorm</button>
          <button type="button" class="inventory-mini-btn" data-action="editItem">Edit</button>
          <button type="button" class="inventory-mini-btn danger" data-action="deleteItem">Delete</button>
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
      ${buildEquipSelectOptions(item.id, item.allowedSlots)}
      <button type="button" class="inventory-mini-btn" data-action="equipItem">Equip</button>
      <button type="button" class="inventory-mini-btn" data-action="toDorm">To Dorm</button>
      <button type="button" class="inventory-mini-btn" data-action="editItem">Edit</button>
      <button type="button" class="inventory-mini-btn danger" data-action="deleteItem">Delete</button>
    `;

    return `
      <div class="inventory-slot-card" data-slot-index="${index}" data-item-id="${item.id}" data-drop-zone="inventory-slot">
        <div class="inventory-slot-label">Slot ${index + 1}</div>
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
    root.innerHTML = '<div class="inventory-slot-empty">Dorm storage is empty.</div>';
    return;
  }

  root.innerHTML = state.dormItemIds.map(itemId => {
    const item = getInventoryItemById(itemId);
    if (!item) return "";

    const controls = `
      <button type="button" class="inventory-mini-btn" data-action="toInventory">To Inventory</button>
      ${buildEquipSelectOptions(item.id, item.allowedSlots)}
      <button type="button" class="inventory-mini-btn" data-action="equipItem">Equip</button>
      <button type="button" class="inventory-mini-btn" data-action="editItem">Edit</button>
      <button type="button" class="inventory-mini-btn danger" data-action="deleteItem">Delete</button>
    `;

    return renderInventoryItemCard(item, controls, "Dorm");
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
    deleteInventoryItem(item.id);
    return;
  }

  if (action === "editItem") {
    startItemEdit(item.id);
    return;
  }

  if (action === "equipItem") {
    const preferredSlot = getItemEquipTarget(button, item.id);
    const result = placeItemEquipped(item, preferredSlot);
    renderInventory();
    scheduleSave();
    if (!result.ok) setItemFormError(result.message);
    return;
  }

  if (action === "toDorm" || action === "unequipToDorm") {
    placeItemInDorm(item);
    renderInventory();
    scheduleSave();
    return;
  }

  if (action === "toInventory" || action === "unequipToInventory") {
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
    return { ok: true };
  }

  if (zoneType === "equipped-slot") {
    const slotKey = zoneEl?.dataset?.slotKey ?? currentTarget?.dataset?.slotKey;
    const plan = getEquipSlotsForItem(item, slotKey || null);
    return plan.ok ? { ok: true } : { ok: false, message: plan.message };
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
    result = placeItemEquipped(item, slotKey || null);
  } else if (zoneType === "dorm-list") {
    result = placeItemInDorm(item) ? { ok: true } : { ok: false, message: "Could not move item to dorm." };
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
  setItemFormError("");
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
    allowedSlots: normalizeAllowedSlots(item?.allowedSlots),
    slotsNeeded: clamp(parseInt(item?.slotsNeeded, 10) || 1, 1, 3),
    location: ["inventory", "dorm", "equipped"].includes(item?.location) ? item.location : "dorm",
    inventorySlot: Number.isInteger(item?.inventorySlot) ? item.inventorySlot : null,
    equippedSlots: Array.isArray(item?.equippedSlots)
      ? item.equippedSlots.filter(slot => BODY_SLOT_KEYS.includes(slot))
      : [],
  })).filter(item => item.id && item.name);

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
    placeItemInDorm(item);
  });
}

export function renderInventory() {
  ensureInventoryStateShape();
  const state = getState();
  const yenInput = document.getElementById("yenInput");
  if (yenInput) yenInput.value = parseYenValue(state?.yen);
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
  const addYenBtn = document.getElementById("addYenBtn");
  const subtractYenBtn = document.getElementById("subtractYenBtn");
  const editorToggleBtn = document.getElementById("toggleItemEditorBtn");
  const dormToggleBtn = document.getElementById("dormToggleBtn");

  if (!saveBtn || !cancelBtn || !equippedGrid || !inventoryList || !dormList || !yenInput || !addYenBtn || !subtractYenBtn || !editorToggleBtn || !dormToggleBtn) return;

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

  yenInput.addEventListener("input", e => {
    const state = getState();
    state.yen = parseYenValue(e.target.value);
    scheduleSave();
  });

  const applyYenDelta = (direction) => {
    const state = getState();
    const base = parseYenValue(yenInput.value);
    const amount = askYenAdjustmentAmount(direction);
    if (!amount) return;
    const next = Math.max(0, base + (direction * amount));
    state.yen = next;
    yenInput.value = next;
    scheduleSave();
  };

  addYenBtn.addEventListener("click", () => applyYenDelta(1));
  subtractYenBtn.addEventListener("click", () => applyYenDelta(-1));

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
