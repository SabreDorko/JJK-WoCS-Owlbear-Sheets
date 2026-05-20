// ── IMPORTS ───────────────────────────────────────────────────────────────────
import OBR from "https://cdn.jsdelivr.net/npm/@owlbear-rodeo/sdk@3.1.0/+esm";

import {
  STORAGE_KEY_BASE,
  PARTY_BROADCAST_CHANNEL,
  PARTY_SYNC_REQUEST_CHANNEL,
  ROLL_BROADCAST_CHANNEL,
  GM_STATE_REQUEST_CHANNEL,
  GM_STATE_RESPONSE_CHANNEL,
  GM_STATE_PUSH_CHANNEL,
  CENTER_STATS,
  RIGHT_STATS,
  defaultState,
} from "./state/store.js";
import {
  createPersistenceRuntime,
  mergeLoadedState,
  loadStateForPlayer,
} from "./state/runtime.js";

import { initInventory, renderInventory } from "./inventory.js";
import {
  initCombat,
  computeCombatTabData,
  renderCombatTabData,
  refreshCombatTab,
} from "./combat.js";
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
import { initNpcs, renderNpcList, saveNpcEdits } from "./npc.js";


// ── RUNTIME STATE ─────────────────────────────────────────────────────────────
let state            = defaultState();
let localPlayerId    = null;
let localPlayerName  = "";
let obrReady         = false;
let _lastSaveTooltip = "No save yet.";

// ── GM SHEET VIEW & EDITING ───────────────────────────────────────────────────
// _gmState: the member's full state while GM is viewing/editing their sheet.
// The global `state` (GM's own sheet) is never modified.
let _gmState        = null;
let _viewedPlayerId = null;
let _viewingNpcId   = null; // non-null when GM is editing an NPC (not a player)
let _gmPushTimer    = null;
let _npcSaveTimer   = null;

function getActiveState() {
  return _gmState !== null ? _gmState : state;
}

function applySheetState(fullState) {
  _gmState = fullState;
  _applyStateToUI();
}

function clearSheetState() {
  // If leaving an NPC sheet, write edits back to state.npcs before clearing
  if (_viewingNpcId && _gmState) {
    saveNpcEdits(_viewingNpcId, _gmState);
  }
  clearTimeout(_gmPushTimer);
  clearTimeout(_npcSaveTimer);
  _gmPushTimer    = null;
  _npcSaveTimer   = null;
  _gmState        = null;
  _viewedPlayerId = null;
  _viewingNpcId   = null;
  _applyStateToUI();
}

// Debounced push of GM edits to the target player
function scheduleGmPush() {
  if (_gmState === null || !_viewedPlayerId) return;
  clearTimeout(_gmPushTimer);
  _gmPushTimer = setTimeout(() => {
    _gmPushTimer = null;
    try {
      OBR.broadcast.sendMessage(
        GM_STATE_PUSH_CHANNEL,
        { targetPlayerId: _viewedPlayerId, state: _gmState },
        { destination: "REMOTE" },
      );
    } catch (_) {}
  }, 600);
}

// Debounced write of NPC edits back into state.npcs
function scheduleNpcSave() {
  if (_gmState === null || !_viewingNpcId) return;
  clearTimeout(_npcSaveTimer);
  _npcSaveTimer = setTimeout(() => {
    _npcSaveTimer = null;
    saveNpcEdits(_viewingNpcId, _gmState);
    persistence.scheduleSave();
  }, 600);
}

// ── GM STATE REQUEST (broadcast-based load) ───────────────────────────────────
const _pendingStateRequests = new Map();

function requestMemberFullState(snapshot) {
  return new Promise((resolve) => {
    const playerId = snapshot.playerId;

    // Timeout after 4s — fall back to room metadata
    const timer = setTimeout(async () => {
      _pendingStateRequests.delete(playerId);
      const saved = await loadStateForPlayer(STORAGE_KEY_BASE, playerId);
      resolve(saved
        ? mergeLoadedState({ saved, defaultState, centerStats: CENTER_STATS, rightStats: RIGHT_STATS })
        : mergeLoadedState({ saved: snapshot, defaultState, centerStats: CENTER_STATS, rightStats: RIGHT_STATS })
      );
    }, 4000);

    _pendingStateRequests.set(playerId, { resolve, timer });

    try {
      OBR.broadcast.sendMessage(
        GM_STATE_REQUEST_CHANNEL,
        { targetPlayerId: playerId },
        { destination: "REMOTE" },
      );
    } catch (_) {
      clearTimeout(timer);
      _pendingStateRequests.delete(playerId);
      loadStateForPlayer(STORAGE_KEY_BASE, playerId).then(saved => {
        resolve(saved
          ? mergeLoadedState({ saved, defaultState, centerStats: CENTER_STATS, rightStats: RIGHT_STATS })
          : mergeLoadedState({ saved: snapshot, defaultState, centerStats: CENTER_STATS, rightStats: RIGHT_STATS })
        );
      });
    }
  });
}

// ── EXPOSE GLOBALS ────────────────────────────────────────────────────────────
if (typeof window !== "undefined") {
  window.scheduleSave            = () => scheduleSave();
  window.refreshCombatTab        = refreshCombatTab;
  window.applyCharacterStateToUI = applyCharacterStateToUI;
}

// ── SAVE STATUS ───────────────────────────────────────────────────────────────
function formatSavedAt(savedAt) {
  const parsed = parseInt(savedAt, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return "Never";
  return new Date(parsed).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" });
}

function getSaveSourceLabel(source) {
  if (source === "room+local") return "Room + Local";
  if (source === "room")       return "Room";
  if (source === "local")      return "Local";
  return "Unknown";
}

function setSaveStatusBadge({ label, tooltip, pending = false, error = false }) {
  const badge   = document.getElementById("saveStatusBadge");
  const labelEl = document.getElementById("saveStatusLabel");
  if (!badge) return;
  if (labelEl) labelEl.textContent = label;
  else badge.textContent = label;
  const title = String(tooltip || "").trim() || "No save yet.";
  badge.title = title;
  badge.setAttribute("aria-label", `${label}. ${title}`);
  badge.classList.toggle("is-pending", Boolean(pending));
  badge.classList.toggle("is-error",   Boolean(error));
}

function showSavePendingStatus() {
  const pendingTooltip = _lastSaveTooltip === "No save yet."
    ? "Saving changes..."
    : `${_lastSaveTooltip}\nSaving changes...`;
  setSaveStatusBadge({ label: "Saving", tooltip: pendingTooltip, pending: true });
}

function showSavedStatus(info) {
  const timeText   = formatSavedAt(info?.savedAt);
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
  const timeText   = formatSavedAt(info?.savedAt);
  const sourceText = getSaveSourceLabel(info?.source);
  _lastSaveTooltip = `Loaded save: ${timeText}\nSource: ${sourceText}`;
  setSaveStatusBadge({ label: "Saved", tooltip: _lastSaveTooltip });
}

function getPreferredPlayerName() {
  const sheetPlayerName   = (state.playerName  || "").trim();
  const owlbearPlayerName = (localPlayerName   || "").trim();
  return sheetPlayerName || owlbearPlayerName || "Unknown Player";
}

function broadcastPartySnapshot() {
  if (_gmState !== null) return; // never broadcast own snapshot while viewing a member
  const snapshot = getPartySnapshot();
  try {
    OBR.broadcast.sendMessage(PARTY_BROADCAST_CHANNEL, snapshot, { destination: "REMOTE" });
  } catch (_) {}
}

// ── PERSISTENCE ───────────────────────────────────────────────────────────────
const persistence = createPersistenceRuntime({
  storageKeyBase:   STORAGE_KEY_BASE,
  getState:         () => state,        // always persists own state
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
  if (_gmState !== null) {
    if (_viewingNpcId) {
      scheduleNpcSave();   // NPC edit → write back to state.npcs
    } else {
      scheduleGmPush();    // Player edit → push to player via broadcast
    }
    return;
  }
  persistence.scheduleSave();
}

// ── APPLY STATE TO UI ─────────────────────────────────────────────────────────
function _applyStateToUI() {
  const s       = getActiveState();
  const viewing = _gmState !== null;

  applyCharacterStateToUI();
  applyTechniquesStateToUI();

  // Full archetype apply in both modes — scheduleSave is redirected to
  // scheduleGmPush when viewing, so side effects safely target the member
  applyArchetypeStateToUI();

  applyNotesStateToUI();
  renderTraining(s);
  renderSkills(s);
  renderRollHistory();

  if (!viewing) renderPartyList();
  if (!viewing) renderNpcList();

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
    getState:              () => state,
    getPreferredPlayerName,
    getLocalPlayerId:      () => localPlayerId,
    isGm:                  () => isGm(),
    onOpenSheet: async (snapshot) => {
      _viewedPlayerId = snapshot.playerId;
      const fullState = await requestMemberFullState(snapshot);
      enterMemberSheet(
        fullState,
        snapshot.charName || snapshot.playerName || "Member",
        snapshot.playerName,
      );
    },
    onMemberUpdate: async (snapshot) => {
      if (_gmState === null || snapshot.playerId !== _viewedPlayerId) return;
      const fullState = await requestMemberFullState(snapshot);
      _gmState = fullState;
      _applyStateToUI();
    },
  });

  initCharacter({
    getState:         getActiveState,
    scheduleSave,
    showRollToast,
    refreshCombatTab: () => renderCombatTabData(computeCombatTabData(getActiveState())),
  });

  initTechniques({
    getState:              getActiveState,
    scheduleSave,
    refreshCharacterStats: applyCharacterStateToUI,
    showRollToast,
    refreshCombatTab:      () => renderCombatTabData(computeCombatTabData(getActiveState())),
  });

  initArchetype({
    getState:  getActiveState,
    scheduleSave,
  });

  initRolls({
    getState:              getActiveState,
    scheduleSave,
    getPreferredPlayerName,
  });

  initInventory({
    getState:              getActiveState,
    scheduleSave,
    refreshCharacterStats: applyCharacterStateToUI,
    refreshArchetypeState: applyArchetypeStateToUI,
    refreshCombatTab:      () => renderCombatTabData(computeCombatTabData(getActiveState())),
  });

  initNotes({
    getState:  getActiveState,
    scheduleSave,
  });

  initTraining({
    getState:              getActiveState,
    scheduleSave,
    showRollToast,
    refreshUI:             () => renderTraining(getActiveState()),
    refreshAll:            applyStateToUI,
  });

  initSkills({
    getState:              getActiveState,
    scheduleSave,
    refreshTraining:       () => renderTraining(getActiveState()),
    refreshCharacterStats: applyCharacterStateToUI,
  });

  initCombat({
    getState:  getActiveState,
    scheduleSave,
    showRollToast,
  });

  initNpcs({
    getState:    () => state,  // NPC list always reads own state
    scheduleSave: () => persistence.scheduleSave(),
    onOpenNpc: (npc) => {
      _viewingNpcId   = npc.id;
      _viewedPlayerId = null;  // not a player
      enterMemberSheet(
        { ...npc },            // shallow copy so edits don't mutate array directly
        npc.charName || "NPC",
        "NPC",
      );
    },
  });

  document.getElementById("gradeSelect")
    ?.addEventListener("change", () => renderTraining(getActiveState()));

  initUiShell({
    activateMainTab,
    getActiveRollTab,
    clearGroupRollHistory,
    renderRollHistory,
    switchRollTab,
    getState:        getActiveState,
    scheduleSave,
    applySheetState,
    clearSheetState,
  });

  renderPartyList();

  // ── OBR ──────────────────────────────────────────────────────────────────
  try {
    await OBR.onReady(async () => {
      obrReady = true;
      try { localPlayerName = await OBR.player.getName(); } catch (_) { localPlayerName = ""; }
      try { localPlayerId   = await OBR.player.getId();   } catch (_) { localPlayerId   = localPlayerName || null; }

      try { initGmRole(await OBR.player.getRole()); } catch (_) { initGmRole(null); }
      applyGmLayout();

      // ── Broadcast listeners ─────────────────────────────────────────────
      OBR.broadcast.onMessage(PARTY_BROADCAST_CHANNEL, event => {
        handleIncomingPartySnapshot(event.data);
      });
      OBR.broadcast.onMessage(PARTY_SYNC_REQUEST_CHANNEL, () => broadcastPartySnapshot());
      OBR.broadcast.onMessage(ROLL_BROADCAST_CHANNEL, event => addIncomingGroupRoll(event.data));

      // Player → responds to GM full-state requests
      OBR.broadcast.onMessage(GM_STATE_REQUEST_CHANNEL, event => {
        const { targetPlayerId } = event.data || {};
        if (targetPlayerId !== localPlayerId) return;
        try {
          OBR.broadcast.sendMessage(
            GM_STATE_RESPONSE_CHANNEL,
            { playerId: localPlayerId, state },
            { destination: "REMOTE" },
          );
        } catch (_) {}
      });

      // GM → receives full-state response, resolves pending promise
      OBR.broadcast.onMessage(GM_STATE_RESPONSE_CHANNEL, event => {
        const { playerId, state: memberState } = event.data || {};
        const pending = _pendingStateRequests.get(playerId);
        if (!pending) return;
        clearTimeout(pending.timer);
        _pendingStateRequests.delete(playerId);
        pending.resolve(mergeLoadedState({
          saved:       memberState,
          defaultState,
          centerStats: CENTER_STATS,
          rightStats:  RIGHT_STATS,
        }));
      });

      // Player → receives GM edits, applies and saves
      OBR.broadcast.onMessage(GM_STATE_PUSH_CHANNEL, event => {
        const { targetPlayerId, state: gmEditedState } = event.data || {};
        if (targetPlayerId !== localPlayerId) return;
        if (!gmEditedState || typeof gmEditedState !== "object") return;

        // Merge GM's edits into own state, preserving own roll history
        const ownRollHistory = state.rollHistory || [];
        state = mergeLoadedState({
          saved:       { ...gmEditedState, rollHistory: ownRollHistory },
          defaultState,
          centerStats: CENTER_STATS,
          rightStats:  RIGHT_STATS,
        });

        // Re-render own sheet and save
        applyStateToUI();
        persistence.scheduleSave();
        broadcastPartySnapshot();
      });

      // ── Load own state ──────────────────────────────────────────────────
      const playerNameField = document.getElementById("playerName");
      const saved = await persistence.loadState();
      if (saved) {
        state = mergeLoadedState({
          saved,
          defaultState,
          centerStats: CENTER_STATS,
          rightStats:  RIGHT_STATS,
        });
        applyStateToUI();
      }

      if (playerNameField && !playerNameField.value) {
        playerNameField.value = localPlayerName;
        state.playerName      = localPlayerName;
      }

      if (isGm()) activateMainTab("party");

      renderPartyList();
      broadcastPartySnapshot();
      OBR.broadcast.sendMessage(
        PARTY_SYNC_REQUEST_CHANNEL,
        { requesterId: localPlayerId || "unknown" },
        { destination: "REMOTE" },
      );
    });
  } catch (_) {
    // Dev fallback (outside OBR)
    const saved = await persistence.loadState();
    if (saved) {
      state = mergeLoadedState({
        saved,
        defaultState,
        centerStats: CENTER_STATS,
        rightStats:  RIGHT_STATS,
      });
      applyStateToUI();
    }
    applyGmLayout();
    if (isGm()) activateMainTab("party");
  }
}

init();