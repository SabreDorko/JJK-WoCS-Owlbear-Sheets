// ── IMPORTS ───────────────────────────────────────────────────────────────────
import OBR from "https://cdn.jsdelivr.net/npm/@owlbear-rodeo/sdk@3.1.0/+esm";

import {
  STORAGE_KEY_BASE,
  PARTY_BROADCAST_CHANNEL,
  PARTY_SYNC_REQUEST_CHANNEL,
  ROLL_BROADCAST_CHANNEL,
  CENTER_STATS,
  RIGHT_STATS,
  defaultState,
} from "./state/store.js";
import {
  createPersistenceRuntime,
  mergeLoadedState,
} from "./state/runtime.js";

import { initInventory, renderInventory } from "./inventory.js";
import {
  initCombat,
  computeCombatTabData,
  renderCombatTabData,
  refreshCombatTab } from "./combat.js";
import {
  initCharacter,
  applyCharacterStateToUI,
} from "./character.js";
import {
  initTechniques,
  applyTechniquesStateToUI,
} from "./techniques.js";
import {
  initArchetype,
  applyArchetypeStateToUI,
  renderArchetypeReadOnly,
} from "./archetype.js";
import {
  initParty,
  getPartySnapshot,
  renderPartyList,
  handleIncomingPartySnapshot,
} from "./party.js";

import {
  initRolls,
  showRollToast,
  pushRollHistory,
  renderRollHistory,
  switchRollTab,
  getActiveRollTab,
  addIncomingGroupRoll,
  clearGroupRollHistory,
} from "./rolls.js";
import { initUiShell, applyGmLayout, enterMemberSheet } from "./ui-shell.js";
import { initGmRole, isGm } from "./gm.js";
import { initNotes, applyNotesStateToUI } from "./notes.js";
import { initTraining, renderTraining } from "./training.js";
import { initSkills, renderSkills } from "./skills.js";


// ── RUNTIME STATE ─────────────────────────────────────────────────────────────
let state           = defaultState();
let localPlayerId = null;
let localPlayerName = "";
let obrReady = false;
let _lastSaveTooltip = "No save yet.";

// ── GM SHEET VIEW ─────────────────────────────────────────────────────────────
// _gmState holds a member's full state while the GM views their sheet.
// All renderers call getActiveState() instead of reading `state` directly.
// The global `state` (own sheet) is NEVER modified or swapped.
let _gmState = null;

function getActiveState() {
  return _gmState !== null ? _gmState : state;
}

function applySheetState(fullState) {
  _gmState = fullState;
  _applyStateToUI();
}

function clearSheetState() {
  _gmState = null;
  _applyStateToUI();
}

async function loadMemberFullState(snapshot) {
  const memberId = snapshot.playerId;
  const key = memberId ? `${STORAGE_KEY_BASE}-${memberId}` : STORAGE_KEY_BASE;
  try {
    const meta = await OBR.room.getMetadata();
    const saved = meta[key];
    if (saved && typeof saved === "object") {
      return mergeLoadedState({ saved, defaultState, centerStats: CENTER_STATS, rightStats: RIGHT_STATS });
    }
  } catch (_) {}
  // Fallback: slim snapshot merged over defaults so all keys exist
  return mergeLoadedState({ saved: snapshot, defaultState, centerStats: CENTER_STATS, rightStats: RIGHT_STATS });
}

// Expose for combat tab input handlers
if (typeof window !== 'undefined') {
  window.scheduleSave = scheduleSave;
  window.refreshCombatTab = refreshCombatTab;
  window.applyCharacterStateToUI = applyCharacterStateToUI;
}

function formatSavedAt(savedAt) {
  const parsed = parseInt(savedAt, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return "Never";
  const dt = new Date(parsed);
  return dt.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" });
}

function getSaveSourceLabel(source) {
  if (source === "room+local") return "Room + Local";
  if (source === "room") return "Room";
  if (source === "local") return "Local";
  return "Unknown";
}

function setSaveStatusBadge({ label, tooltip, pending = false, error = false }) {
  const badge = document.getElementById("saveStatusBadge");
  const labelEl = document.getElementById("saveStatusLabel");
  if (!badge) return;
  if (labelEl) labelEl.textContent = label;
  else badge.textContent = label;
  const title = String(tooltip || "").trim() || "No save yet.";
  badge.title = title;
  badge.setAttribute("aria-label", `${label}. ${title}`);
  badge.classList.toggle("is-pending", Boolean(pending));
  badge.classList.toggle("is-error", Boolean(error));
}

function showSavePendingStatus() {
  const pendingTooltip = _lastSaveTooltip === "No save yet."
    ? "Saving changes..."
    : `${_lastSaveTooltip}\nSaving changes...`;
  setSaveStatusBadge({ label: "Saving", tooltip: pendingTooltip, pending: true });
}

function showSavedStatus(info) {
  const timeText = formatSavedAt(info?.savedAt);
  const sourceText = getSaveSourceLabel(info?.source);
  _lastSaveTooltip = `Last saved: ${timeText}\nSource: ${sourceText}`;
  setSaveStatusBadge({ label: "Saved", tooltip: _lastSaveTooltip });
}

function showLoadedStatus(info) {
  if (!info || info.source === "none") {
    _lastSaveTooltip = "No prior save found for this sheet yet.";
    setSaveStatusBadge({ label: "Unsaved", tooltip: _lastSaveTooltip, error: true });
    return;
  }

  const timeText = formatSavedAt(info?.savedAt);
  const sourceText = getSaveSourceLabel(info?.source);
  _lastSaveTooltip = `Loaded save: ${timeText}\nSource: ${sourceText}`;
  setSaveStatusBadge({ label: "Saved", tooltip: _lastSaveTooltip });
}

function getPreferredPlayerName() {
  const sheetPlayerName = (state.playerName || "").trim();
  const owlbearPlayerName = (localPlayerName || "").trim();
  return sheetPlayerName || owlbearPlayerName || "Unknown Player";
}

function broadcastPartySnapshot() {
  if (_gmState !== null) return; // never broadcast while viewing a member
  const snapshot = getPartySnapshot();
  try {
    OBR.broadcast.sendMessage(PARTY_BROADCAST_CHANNEL, snapshot, { destination: "REMOTE" });
  } catch (_) { /* outside OBR */ }
}

const persistence = createPersistenceRuntime({
  storageKeyBase: STORAGE_KEY_BASE,
  getState: () => state, // always saves own state, never member state
  getLocalPlayerId: () => localPlayerId,
  onSchedule: () => {
    renderPartyList();
    showSavePendingStatus();
  },
  onAfterSave: (info) => {
    broadcastPartySnapshot();
    showSavedStatus(info);
  },
  onAfterLoad: (info) => {
    showLoadedStatus(info);
  },
});

function scheduleSave() {
  if (_gmState !== null) return; // never save while viewing a member's sheet
  persistence.scheduleSave();
}

// ── APPLY STATE TO UI ─────────────────────────────────────────────────────────
function _applyStateToUI() {
  const s = getActiveState();
  const viewing = _gmState !== null;

  applyCharacterStateToUI();
  applyTechniquesStateToUI();

  // Safe read-only archetype render during GM view (no mutations/saves)
  if (viewing) {
    renderArchetypeReadOnly(s);
  } else {
    applyArchetypeStateToUI();
  }

  applyNotesStateToUI();
  renderTraining(s);
  renderSkills(s);
  renderRollHistory();

  // Never re-render party list while viewing a member (prevents ghost entries)
  if (!viewing) renderPartyList();

  renderInventory();
  renderCombatTabData(computeCombatTabData(s));
}

function applyStateToUI() { _applyStateToUI(); }

// ── TABS ──────────────────────────────────────────────────────────────────────
function activateMainTab(tabName) {
  const target = document.querySelector(`.tab[data-tab="${tabName}"]`);
  const panel  = document.getElementById("panel-" + tabName);
  if (!panel) return;
  if (target && target.classList.contains("disabled")) return;
  document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
  document.querySelectorAll(".tab-panel").forEach(p => p.classList.remove("active"));
  if (target) target.classList.add("active");
  panel.classList.add("active");
}

// ── INIT ──────────────────────────────────────────────────────────────────────
async function init() {
  setSaveStatusBadge({ label: "Saving", tooltip: "Waiting for initial load...", pending: true });

  initParty({
    getState: () => state,       // party snapshot always from own state
    getPreferredPlayerName,
    getLocalPlayerId: () => localPlayerId,
    onOpenSheet: async (snapshot) => {
      const fullState = await loadMemberFullState(snapshot);
      enterMemberSheet(
        fullState,
        snapshot.charName || snapshot.playerName || "Member",
        snapshot.playerName,
      );
    },
  });

  initCharacter({
    getState: getActiveState,
    scheduleSave,
    showRollToast,
    refreshCombatTab: () => renderCombatTabData(computeCombatTabData(getActiveState())),
  });

  initTechniques({
    getState: getActiveState,
    scheduleSave,
    refreshCharacterStats: applyCharacterStateToUI,
    showRollToast,
    refreshCombatTab: () => renderCombatTabData(computeCombatTabData(getActiveState())),
  });

  initArchetype({
    getState: getActiveState,
    scheduleSave,
  });

  initRolls({
    getState: getActiveState,
    scheduleSave,
    getPreferredPlayerName,
  });

  initInventory({
    getState: getActiveState,
    scheduleSave,
    refreshCharacterStats: applyCharacterStateToUI,
    refreshArchetypeState: applyArchetypeStateToUI,
    refreshCombatTab: () => renderCombatTabData(computeCombatTabData(getActiveState())),
  });

  initNotes({
    getState: getActiveState,
    scheduleSave,
  });

  initTraining({
    getState: getActiveState,
    scheduleSave,
    showRollToast,
    refreshUI: () => renderTraining(getActiveState()),
    refreshAll: applyStateToUI,
  });

  initSkills({
    getState: getActiveState,
    scheduleSave,
    refreshTraining: () => renderTraining(getActiveState()),
    refreshCharacterStats: applyCharacterStateToUI,
  });

  initCombat({
    getState: getActiveState,
    scheduleSave,
    showRollToast,
  });

  document.getElementById("gradeSelect")?.addEventListener("change", () => renderTraining(getActiveState()));

  initUiShell({
    activateMainTab,
    getActiveRollTab,
    clearGroupRollHistory,
    renderRollHistory,
    switchRollTab,
    getState: getActiveState,
    scheduleSave,
    applySheetState,
    clearSheetState,
  });

  renderPartyList();

  // OBR init
  try {
    await OBR.onReady(async () => {
      obrReady = true;
      try { localPlayerName = await OBR.player.getName(); } catch (_) { localPlayerName = ""; }
      try { localPlayerId   = await OBR.player.getId();   } catch (_) { localPlayerId   = localPlayerName || null; }

      // Detect GM role
      try { initGmRole(await OBR.player.getRole()); } catch (_) { initGmRole(null); }
      applyGmLayout();

      OBR.broadcast.onMessage(PARTY_BROADCAST_CHANNEL, event => {
        handleIncomingPartySnapshot(event.data);
      });
      OBR.broadcast.onMessage(PARTY_SYNC_REQUEST_CHANNEL, () => broadcastPartySnapshot());
      OBR.broadcast.onMessage(ROLL_BROADCAST_CHANNEL, event => addIncomingGroupRoll(event.data));

      // Auto-fill player name if blank
      const playerNameField = document.getElementById("playerName");
      if (playerNameField && !playerNameField.value) {
        playerNameField.value = localPlayerName;
        state.playerName      = localPlayerName;
      }

      // Load saved state
      const saved = await persistence.loadState();
      if (saved) {
        state = mergeLoadedState({
          saved,
          defaultState,
          centerStats: CENTER_STATS,
          rightStats: RIGHT_STATS,
        });
        applyStateToUI();
      }

      // Activate party tab AFTER everything is loaded — GM only
      if (isGm()) activateMainTab("party");

      renderPartyList();
      broadcastPartySnapshot();
      OBR.broadcast.sendMessage(PARTY_SYNC_REQUEST_CHANNEL, { requesterId: localPlayerId || "unknown" }, { destination: "REMOTE" });
    });
  } catch (_) {
    // Dev fallback (outside OBR)
    const saved = await persistence.loadState();
    if (saved) {
      state = mergeLoadedState({
        saved,
        defaultState,
        centerStats: CENTER_STATS,
        rightStats: RIGHT_STATS,
      });
      applyStateToUI();
    }
  }
}

init();