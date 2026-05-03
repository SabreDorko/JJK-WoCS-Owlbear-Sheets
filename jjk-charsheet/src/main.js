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
  renderRollHistory,
  switchRollTab,
  getActiveRollTab,
  addIncomingGroupRoll,
  clearGroupRollHistory,
} from "./rolls.js";
import { initUiShell } from "./ui-shell.js";

// ── RUNTIME STATE ─────────────────────────────────────────────────────────────
let state           = defaultState();
let localPlayerId = null;
let localPlayerName = "";
let obrReady = false;

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
  onSchedule: () => renderPartyList(),
  onAfterSave: () => broadcastPartySnapshot(),
});

function scheduleSave() {
  persistence.scheduleSave();
}

// ── APPLY STATE TO UI ─────────────────────────────────────────────────────────
function applyStateToUI() {
  applyCharacterStateToUI();
  applyTechniquesStateToUI();
  applyArchetypeStateToUI();

  renderRollHistory();
  renderPartyList();
  renderInventory();
}

// ── TABS ──────────────────────────────────────────────────────────────────────
function activateMainTab(tabName) {
  const target = document.querySelector(`.tab[data-tab="${tabName}"]`);
  const panel  = document.getElementById("panel-" + tabName);
  if (!target || !panel || target.classList.contains("disabled")) return;
  document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
  document.querySelectorAll(".tab-panel").forEach(p => p.classList.remove("active"));
  target.classList.add("active");
  panel.classList.add("active");
}

// ── INIT ──────────────────────────────────────────────────────────────────────
async function init() {
  initParty({
    getState: () => state,
    getPreferredPlayerName,
    getLocalPlayerId: () => localPlayerId,
  });

  initCharacter({
    getState: () => state,
    scheduleSave,
    showRollToast,
  });

  initTechniques({
    getState: () => state,
    scheduleSave,
    refreshCharacterStats: applyCharacterStateToUI,
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
  });

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
