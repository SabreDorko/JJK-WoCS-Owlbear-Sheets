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
import { initCombat, computeCombatTabData, renderCombatTabData } from "./combat.js";
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
import { initUiShell } from "./ui-shell.js";
import { initNotes, applyNotesStateToUI } from "./notes.js";
import { initTraining, renderTraining } from "./training.js";
import { initSkills, renderSkills } from "./skills.js";


// ── RUNTIME STATE ─────────────────────────────────────────────────────────────
let state           = defaultState();
let localPlayerId = null;
let localPlayerName = "";
let obrReady = false;
let _lastSaveTooltip = "No save yet.";

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
  const snapshot = getPartySnapshot();
  try {
    OBR.broadcast.sendMessage(PARTY_BROADCAST_CHANNEL, snapshot, { destination: "REMOTE" });
  } catch (_) { /* outside OBR */ }
}

const persistence = createPersistenceRuntime({
  storageKeyBase: STORAGE_KEY_BASE,
  getState: () => state,
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
  persistence.scheduleSave();
}

// ── APPLY STATE TO UI ─────────────────────────────────────────────────────────
function applyStateToUI() {
  applyCharacterStateToUI();
  applyTechniquesStateToUI();
  applyArchetypeStateToUI();
  applyNotesStateToUI();
  renderTraining(state);
  renderSkills(state);

  renderRollHistory();
  renderPartyList();
  renderInventory();

  // Update Combat tab
  const combatData = computeCombatTabData(state);
  renderCombatTabData(combatData);
}

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
    getState: () => state,
    getPreferredPlayerName,
    getLocalPlayerId: () => localPlayerId,
  });

  initCharacter({
    getState: () => state,
    scheduleSave,
    showRollToast,
    refreshCombatTab: () => renderCombatTabData(computeCombatTabData(state)),
  });

  initTechniques({
    getState: () => state,
    scheduleSave,
    refreshCharacterStats: applyCharacterStateToUI,
    showRollToast,
  });

  initArchetype({
    getState: () => state,
    scheduleSave,
  });

  // Wire up the rolls module with its dependencies
  initRolls({
    getState:               () => state,
    scheduleSave,
    getPreferredPlayerName,
  });

  // Inventory
  initInventory({
    getState: () => state,
    scheduleSave,
    refreshCharacterStats: applyCharacterStateToUI,
    refreshArchetypeState: applyArchetypeStateToUI,
    // Refresh Combat tab when inventory changes
    refreshCombatTab: () => {
      renderCombatTabData(computeCombatTabData(state));
    },
  });

  initNotes({
    getState: () => state,
    scheduleSave,
  });

  initTraining({
    getState: () => state,
    scheduleSave,
    showRollToast,
    refreshUI: () => renderTraining(state),
    refreshAll: applyStateToUI,
  });

  initSkills({
    getState: () => state,
    scheduleSave,
    refreshTraining: () => renderTraining(state),
    refreshCharacterStats: applyCharacterStateToUI,
  });

  initCombat({
    getState: () => state,
    scheduleSave,
    showRollToast,
  });

  // Re-render training slots whenever grade changes (slot unlock is grade-gated)
  document.getElementById("gradeSelect")?.addEventListener("change", () => renderTraining(state));

  initUiShell({
    activateMainTab,
    getActiveRollTab,
    clearGroupRollHistory,
    renderRollHistory,
    switchRollTab,
    getState: () => state,
    scheduleSave,
  });

  renderPartyList();

  // OBR init
  try {
    await OBR.onReady(async () => {
      obrReady = true;
      try { localPlayerName = await OBR.player.getName(); } catch (_) { localPlayerName = ""; }
      try { localPlayerId   = await OBR.player.getId();   } catch (_) { localPlayerId   = localPlayerName || null; }

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
