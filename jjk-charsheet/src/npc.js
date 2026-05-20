// ── NPC MODULE ────────────────────────────────────────────────────────────────
import { CENTER_STATS, RIGHT_STATS } from "./state/store.js";
// NPCs are stored as full character-state objects inside state.npcs[].
// Each has a unique `id` so they can be looked up and updated.
// The GM opens an NPC the same way they open a player sheet — the shared
// _gmState / enterMemberSheet / scheduleSave-as-push pattern handles rendering.
// When the GM edits an NPC, scheduleSave calls scheduleNpcSave (provided via
// init) instead of scheduling a player broadcast push.

let _getState        = null;
let _scheduleSave    = null;
let _onOpenNpc       = null; // (npcState) => void — opens NPC in sheet view
let _npcSearchQuery  = "";

function getState() { return _getState ? _getState() : null; }
function scheduleSave() { if (_scheduleSave) _scheduleSave(); }

// ── HELPERS ───────────────────────────────────────────────────────────────────

function ensureNpcs(state) {
  if (!Array.isArray(state.npcs)) state.npcs = [];
}

function generateId() {
  return `npc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function createBlankNpc() {
  const stats = {};
  [...CENTER_STATS, ...RIGHT_STATS].forEach(s => {
    stats[s.key] = { score: "", skills: s.skills.map(() => ({ aptitude: 0 })) };
  });

  return {
    id:           generateId(),
    charName:     "New NPC",
    archetype:    "",
    subArchetype: "",
    archetype2:   "",
    subArchetype2:"",
    grade:        "",
    age:          "",
    ct:           "",
    ac:           "",
    hpCurrent:    "",
    hpMax:        "",
    ceCurrent:    "",
    ceMax:        "",
    movement:     "",
    ceNote:       "",
    sorcererXp:   "",
    xp:           "0",
    techniques: {
      mode: "none",
      activeSubtab: "technique",
      applications: [],
      bindingVows:  [],
      noCtPath:     "",
      notes:        "",
      bindingVowsNotes: "",
    },
    archetypeProgress: {
      unlockedAbilityIds:          [],
      permanentAptitudeSelections: [],
    },
    archetypeGrantedAbilities: [],
    hasSecondArchetype: false,
    inventoryItems:    [],
    inventorySlots:    [null, null, null, null, null],
    dormItemIds:       [],
    equippedSlots: {
      head: null, body: null, legs: null, feet: null,
      rightHand: null, leftHand: null, accessory1: null, accessory2: null,
    },
    directModifiers: [],
    overrides:       { derived: {}, subskills: {} },
    rollHistory:     [],
    stats,
    notes:           [],
    training:        { jujutsuSkills: [], aptitudeTraining: { activeTrainings: [] } },
    skills:          { xpSkills: [], jujutsuSkills: [] },
    customArchetype: {},
  };
}

// ── RENDER ────────────────────────────────────────────────────────────────────

export function renderNpcList() {
  const list = document.getElementById("npcList");
  if (!list) return;

  const state = getState();
  if (!state) return;
  ensureNpcs(state);

  const query = _npcSearchQuery.toLowerCase().trim();
  const npcs  = state.npcs.filter(n =>
    !query || (n.charName || "").toLowerCase().includes(query)
  );

  if (!npcs.length) {
    list.innerHTML = `<div class="party-empty">${query ? "No NPCs match that search." : "No NPCs yet. Click New NPC to add one."}</div>`;
    return;
  }

  list.innerHTML = npcs.map(npc => {
    const grade   = npc.grade ? `Grade ${npc.grade}` : "";
    const arcName = npc.archetype
      ? npc.archetype.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase())
      : "";
    const sub     = npc.subArchetype ? ` (${npc.subArchetype})` : "";
    const meta    = [grade, arcName ? arcName + sub : ""].filter(Boolean).join(" · ");

    return `
      <div class="party-item party-item--gm-openable npc-item" data-npc-id="${npc.id}"
        role="button" tabindex="0" title="Open ${npc.charName}">
        <div class="party-item-header">
          <div class="party-character">${escHtml(npc.charName || "Unnamed NPC")}</div>
          <button class="npc-delete-btn inventory-mini-btn danger"
            data-npc-delete="${npc.id}" title="Delete NPC" type="button">✕</button>
        </div>
        ${meta ? `<div class="party-meta"><span class="party-meta-left">${escHtml(meta)}</span></div>` : ""}
        <div class="party-stats">
          <div class="party-stat">
            ${hpIcon()}
            <div class="party-stat-value">${track(npc.hpCurrent, npc.hpMax)}</div>
          </div>
          <div class="party-stat">
            ${ceIcon()}
            <div class="party-stat-value">${track(npc.ceCurrent, npc.ceMax)}</div>
          </div>
          <div class="party-stat">
            ${acIcon()}
            <div class="party-stat-value">${npc.ac === "" || npc.ac == null ? "—" : npc.ac}</div>
          </div>
        </div>
        <div class="npc-core-stats">
          ${[
            { key: "power",         short: "PWR" },
            { key: "speed",         short: "SPD" },
            { key: "technique",     short: "TEC" },
            { key: "intelligence",  short: "INT" },
            { key: "cooperation",   short: "COO" },
          ].map(({ key, short }) => {
            const val = npc.stats?.[key]?.score;
            return `<div class="npc-core-stat">
              <span class="npc-core-stat-label">${short}</span>
              <span class="npc-core-stat-value">${val !== "" && val != null ? val : "—"}</span>
            </div>`;
          }).join("")}
        </div>
      </div>`;
  }).join("");

  // Open NPC on click
  list.querySelectorAll(".npc-item").forEach(el => {
    el.addEventListener("click", e => {
      if (e.target.closest("[data-npc-delete]")) return; // handled below
      const id  = el.dataset.npcId;
      const npc = state.npcs.find(n => n.id === id);
      if (npc && _onOpenNpc) _onOpenNpc(npc);
    });
    el.addEventListener("keydown", e => {
      if (e.key === "Enter" || e.key === " ") el.click();
    });
  });

  // Delete NPC
  list.querySelectorAll("[data-npc-delete]").forEach(btn => {
    btn.addEventListener("click", e => {
      e.stopPropagation();
      const id = btn.dataset.npcDelete;
      deleteNpc(id);
    });
  });
}

// ── CRUD ──────────────────────────────────────────────────────────────────────

function addNpc() {
  const state = getState();
  if (!state) return;
  ensureNpcs(state);
  const npc = createBlankNpc();
  state.npcs.push(npc);
  scheduleSave();
  renderNpcList();
  // Open the new NPC immediately so GM can edit its name
  if (_onOpenNpc) _onOpenNpc(npc);
}

function deleteNpc(id) {
  const state = getState();
  if (!state) return;
  ensureNpcs(state);
  state.npcs = state.npcs.filter(n => n.id !== id);
  scheduleSave();
  renderNpcList();
}

/**
 * Called by main.js when the GM saves while viewing an NPC.
 * Writes _gmState back into state.npcs at the right index.
 */
export function saveNpcEdits(npcId, editedState) {
  const state = getState();
  if (!state) return;
  ensureNpcs(state);
  const idx = state.npcs.findIndex(n => n.id === npcId);
  if (idx === -1) return;
  // Preserve the id — editedState may not carry it if archetype logic stripped it
  state.npcs[idx] = { ...editedState, id: npcId };
  scheduleSave();
  renderNpcList();
}

// ── INIT ──────────────────────────────────────────────────────────────────────

export function initNpcs({
  getState: getStateFn,
  scheduleSave: scheduleSaveFn,
  onOpenNpc,
}) {
  _getState     = getStateFn;
  _scheduleSave = scheduleSaveFn;
  _onOpenNpc    = onOpenNpc;

  // New NPC button
  document.getElementById("addNpcBtn")?.addEventListener("click", addNpc);

  // Search
  const searchInput = document.getElementById("npcSearchInput");
  if (searchInput) {
    searchInput.addEventListener("input", () => {
      _npcSearchQuery = searchInput.value;
      renderNpcList();
    });
  }
}

// ── TINY HELPERS ─────────────────────────────────────────────────────────────

function escHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function track(cur, max) {
  return `${cur === "" ? "—" : cur} / ${max === "" ? "—" : max}`;
}

function hpIcon() {
  return `<svg class="party-stat-icon" viewBox="0 0 28 28" aria-hidden="true">
    <path fill="currentColor" d="M14 24c-.2 0-.4-.1-.6-.2C8.5 21 4 17 4 11.8 4 8.6 6.3 6.2 9.2 6.2c2.1 0 3.8 1.1 4.8 2.8 1-1.7 2.7-2.8 4.8-2.8C21.7 6.2 24 8.6 24 11.8c0 5.2-4.5 9.2-9.4 12-.2.1-.4.2-.6.2Z"/>
  </svg>`;
}

function ceIcon() {
  return `<svg class="party-stat-icon" viewBox="0 0 28 28" aria-hidden="true">
    <path fill="currentColor" d="M14 2 25 14 14 26 3 14Z"/>
  </svg>`;
}

function acIcon() {
  return `<svg class="party-stat-icon" viewBox="0 0 60 68" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <path d="M30 4L5 13V36C5 50 17 62 30 66C43 62 55 50 55 36V13L30 4Z" stroke="currentColor" stroke-width="1.8" fill="#e2d9c8" />
    <path d="M30 9L9 17V36C9 48 19 58 30 62C41 58 51 48 51 36V17L30 9Z" stroke="currentColor" stroke-width="0.8" fill="none" stroke-dasharray="2 2" />
  </svg>`;
}