// ── IMPORTS ───────────────────────────────────────────────────────────────────
import OBR from "https://cdn.jsdelivr.net/npm/@owlbear-rodeo/sdk@3.1.0/+esm";

import {
  STORAGE_KEY_BASE,
  PARTY_BROADCAST_CHANNEL,
  PARTY_SYNC_REQUEST_CHANNEL,
  ROLL_BROADCAST_CHANNEL,
  ARCHETYPES,
  CENTER_STATS,
  RIGHT_STATS,
  defaultState,
} from "./state/store.js";

import {
  initRolls,
  showRollToast,
  renderRollHistory,
  renderGroupRollHistory,
  switchRollTab,
  getActiveRollTab,
  addIncomingGroupRoll,
  clearGroupRollHistory,
} from "./rolls.js";

// ── RUNTIME STATE ─────────────────────────────────────────────────────────────
let state           = defaultState();
let saveTimeout     = null;
let localPlayerId = null;
let localPlayerName = "";
let obrReady = false;
const partyRoster = new Map();

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function getBlackFlashRange(techniqueScore) {
  if (!Number.isFinite(techniqueScore) || techniqueScore < 2) return null;
  if (techniqueScore > 7) return null;
  return (techniqueScore * 4) + 4;
}

function updateBlackFlashRangeDisplay() {
  const valueEl = document.getElementById("blackFlashRangeValue");
  const noteEl = document.getElementById("blackFlashRangeNote");
  if (!valueEl || !noteEl) return;

  const techRaw = state?.stats?.technique?.score;
  const tech = parseInt(techRaw, 10);
  const range = getBlackFlashRange(tech);

  if (range === null) {
    valueEl.textContent = "—";
    noteEl.textContent = "Requires Technique 2-7";
    return;
  }

  valueEl.textContent = String(range);
  noteEl.textContent = `Technique ${tech}`;
}

function getPreferredPlayerName() {
  const sheetPlayerName = (state.playerName || "").trim();
  const owlbearPlayerName = (localPlayerName || "").trim();
  return sheetPlayerName || owlbearPlayerName || "Unknown Player";
}

function getPartySnapshot() {
  const playerName = getPreferredPlayerName();
  const playerId = localPlayerId || playerName;
  return {
    playerId,
    playerName,
    charName: (state.charName || "").trim(),
    grade: state.grade || "",
    archetype: state.archetype || "",
    subArchetype: state.subArchetype || "",
    archetype2: state.archetype2 || "",
    subArchetype2: state.subArchetype2 || "",
    hpCurrent: state.hpCurrent || "",
    hpMax: state.hpMax || "",
    ceCurrent: state.ceCurrent || "",
    ceMax: state.ceMax || "",
    ac: state.ac || ""
  };
}

function formatArchetypeName(key) {
  if (!key) return "";
  return key.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

function formatArchetypeDisplay(entry) {
  if (!entry.archetype) return "";
  let arc1 = formatArchetypeName(entry.archetype);
  if (entry.subArchetype) arc1 += ` (${entry.subArchetype})`;
  if (!entry.archetype2) return arc1;
  let arc2 = formatArchetypeName(entry.archetype2);
  if (entry.subArchetype2) arc2 += ` (${entry.subArchetype2})`;
  return `${arc1} / ${arc2}`;
}

function hasCharacterName(entry) {
  return !!(entry && typeof entry.charName === "string" && entry.charName.trim());
}

function formatTrack(current, max) {
  const cur = current === "" ? "-" : current;
  const mx = max === "" ? "-" : max;
  return `${cur} / ${mx}`;
}

function renderPartyList() {
  const list = document.getElementById("partyList");
  if (!list) return;

  const self = getPartySnapshot();
  const others = Array.from(partyRoster.values())
    .filter(entry => entry.playerId !== self.playerId)
    .filter(hasCharacterName)
    .sort((a, b) => a.playerName.localeCompare(b.playerName));
  const roster = hasCharacterName(self) ? [self, ...others] : others;

  if (!roster.length) {
    list.innerHTML = '<div class="party-empty">No party data yet.</div>';
    return;
  }

  list.innerHTML = roster.map(entry => {
    const arcDisplay = formatArchetypeDisplay(entry);
    const gradeStr = entry.grade ? `Grade ${entry.grade}` : "";
    const metaLeft = [gradeStr, arcDisplay].filter(Boolean).join(" \u2022 ");
    return `
    <div class="party-item">
      <div class="party-character">${entry.charName}</div>
      <div class="party-meta">
        <span class="party-meta-left">${metaLeft}</span>
        <span class="party-meta-player">${entry.playerName}</span>
      </div>
      <div class="party-stats">
        <div class="party-stat">
          <div class="party-stat-label">HP</div>
          <div class="party-stat-value">${formatTrack(entry.hpCurrent, entry.hpMax)}</div>
        </div>
        <div class="party-stat">
          <div class="party-stat-label">CE</div>
          <div class="party-stat-value">${formatTrack(entry.ceCurrent, entry.ceMax)}</div>
        </div>
        <div class="party-stat">
          <div class="party-stat-label">AC</div>
          <div class="party-stat-value">${entry.ac === "" ? "—" : entry.ac}</div>
        </div>
      </div>
    </div>
  `;
  }).join("");
}

function broadcastPartySnapshot() {
  const snapshot = getPartySnapshot();
  try {
    OBR.broadcast.sendMessage(PARTY_BROADCAST_CHANNEL, snapshot, { destination: "REMOTE" });
  } catch (_) { /* outside OBR */ }
}

// ── SAVE / LOAD ───────────────────────────────────────────────────────────────
function getStorageKey() {
  return localPlayerId ? `${STORAGE_KEY_BASE}-${localPlayerId}` : STORAGE_KEY_BASE;
}

function scheduleSave() {
  clearTimeout(saveTimeout);
  renderPartyList();
  saveTimeout = setTimeout(saveState, 600);
}

async function saveState() {
  try {
    await OBR.room.setMetadata({ [getStorageKey()]: state });
  } catch (_) {
    localStorage.setItem(getStorageKey(), JSON.stringify(state));
  }
  broadcastPartySnapshot();
}

async function loadState() {
  const key = getStorageKey();
  try {
    const meta = await OBR.room.getMetadata();
    if (meta[key])              return meta[key];
    if (meta[STORAGE_KEY_BASE]) return meta[STORAGE_KEY_BASE]; // migration fallback
  } catch (_) {
    const saved    = localStorage.getItem(key);
    if (saved)    return JSON.parse(saved);
    const oldSaved = localStorage.getItem(STORAGE_KEY_BASE);
    if (oldSaved) return JSON.parse(oldSaved);
  }
  return null;
}

// ── APPLY STATE TO UI ─────────────────────────────────────────────────────────
function applyStateToUI() {
  const s = state;
  document.getElementById("charName").value   = s.charName   || "";
  document.getElementById("ageInput").value   = s.age        || "";
  document.getElementById("ctInput").value    = s.ct         || "";
  document.getElementById("playerName").value = s.playerName || "";
  document.getElementById("acInput").value    = s.ac         || "";
  document.getElementById("hpCurrent").value  = s.hpCurrent  || "";
  document.getElementById("hpMax").value      = s.hpMax      || "";
  document.getElementById("moveInput").value  = s.movement   || "";
  document.getElementById("ceCurrent").value  = s.ceCurrent  || "";
  document.getElementById("ceMax").value      = s.ceMax      || "";
  document.getElementById("ceNote").value     = s.ceNote     || "";

  const arcSel = document.getElementById("archetypeSelect");
  arcSel.value = s.archetype || "";
  updateSubSelect("subArchetypeSelect", s.archetype || "", s.subArchetype || "");
  if (s.subArchetype) document.getElementById("subArchetypeSelect").value = s.subArchetype;

  const arcSel2 = document.getElementById("archetypeSelect2");
  arcSel2.value = s.archetype2 || "";
  updateSubSelect("subArchetypeSelect2", s.archetype2 || "", s.subArchetype2 || "");
  if (s.subArchetype2) document.getElementById("subArchetypeSelect2").value = s.subArchetype2;

  updateSecondArchetypeUI();
  document.getElementById("gradeSelect").value = s.grade || "";

  renderRollHistory();
  updateBlackFlashRangeDisplay();
  renderPartyList();
}

// ── STAT BLOCKS ───────────────────────────────────────────────────────────────
function renderStats() {
  buildStatBlocks(CENTER_STATS, document.getElementById("centerStats"));
  buildStatBlocks(RIGHT_STATS,  document.getElementById("rightStats"));
}

function buildStatBlocks(defs, container) {
  container.innerHTML = "";
  defs.forEach(def => {
    const sd    = state.stats[def.key];
    const block = document.createElement("div");
    block.className = "stat-block";

    // Score side
    const scoreSide = document.createElement("div");
    scoreSide.className = "stat-score-side";
    scoreSide.innerHTML = `
      <div class="stat-label">${def.label}</div>
      <input class="stat-score-input" type="number" placeholder="—"
             id="score_${def.key}" value="${sd.score}" min="0" />
      <button class="roll-btn" type="button" title="Roll ${def.label.charAt(0).toUpperCase() + def.label.slice(1).toLowerCase()}">Roll</button>
    `;
    scoreSide.querySelector(".roll-btn").addEventListener("click", () => {
      const n = parseInt(document.getElementById("score_" + def.key).value, 10);
      if (!n || n < 1) return;
      const rolls = Array.from({ length: n }, () => Math.floor(Math.random() * 6) + 1);
      showRollToast(def.label, n, rolls, rolls.reduce((a, b) => a + b, 0));
    });

    // Skills side
    const skillsSide = document.createElement("div");
    skillsSide.className = "skills-side";
    def.skills.forEach((skill, i) => {
      const sk  = sd.skills[i];
      const row = document.createElement("div");
      row.className = "skill-row";
      row.innerHTML = `
        <div class="skill-dot${sk.dot ? " filled" : ""}"
             id="dot_${def.key}_${i}" role="checkbox" aria-label="${skill} proficiency"></div>
        <input class="skill-bonus-input" type="text"
               id="bonus_${def.key}_${i}" value="${sk.bonus}" placeholder="+0" maxlength="4" />
        <span class="skill-name">${skill}</span>
        <button class="skill-roll-btn" type="button" title="Roll ${skill}"></button>
      `;
      skillsSide.appendChild(row);

      row.querySelector(".skill-dot").addEventListener("click", () => {
        state.stats[def.key].skills[i].dot = !state.stats[def.key].skills[i].dot;
        row.querySelector(".skill-dot").classList.toggle("filled");
        scheduleSave();
      });
      row.querySelector(".skill-bonus-input").addEventListener("input", e => {
        state.stats[def.key].skills[i].bonus = e.target.value;
        scheduleSave();
      });
      row.querySelector(".skill-roll-btn").addEventListener("click", () => {
        const n = parseInt(state.stats[def.key].score, 10);
        if (!n || n < 1) return;
        const rolls       = Array.from({ length: n }, () => Math.floor(Math.random() * 6) + 1);
        const rawTotal    = rolls.reduce((a, b) => a + b, 0);
        const bonusVal    = parseInt(state.stats[def.key].skills[i].bonus, 10) || 0;
        const total       = rawTotal + bonusVal;
        const maxPossible = n * 6;
        const allOnes     = rolls.every(r => r === 1);
        const critStatus  = allOnes ? "fail" : total >= maxPossible ? "success" : null;
        showRollToast(def.label, n, rolls, total, critStatus, skill);
      });
    });

    block.appendChild(scoreSide);
    block.appendChild(skillsSide);
    container.appendChild(block);

    block.querySelector(`#score_${def.key}`).addEventListener("input", e => {
      state.stats[def.key].score = e.target.value;
      if (def.key === "technique") updateBlackFlashRangeDisplay();
      scheduleSave();
    });
  });
}

// ── ARCHETYPE LOGIC ───────────────────────────────────────────────────────────
window.onArchetypeChange = function () {
  handleArchetypeChange("archetypeSelect", "subArchetypeSelect", "archetype", "subArchetype");
  scheduleSave();
};
window.onArchetypeChange2 = function () {
  handleArchetypeChange("archetypeSelect2", "subArchetypeSelect2", "archetype2", "subArchetype2");
  scheduleSave();
};

function handleArchetypeChange(archetypeId, subId, archetypeKey, subKey) {
  const arc        = document.getElementById(archetypeId).value;
  state[archetypeKey] = arc;
  state[subKey]       = "";
  updateSubSelect(subId, arc, "");
}

function updateSubSelect(subId, arc, selectedSub) {
  const sel = document.getElementById(subId);
  if (!arc) {
    sel.innerHTML = '<option value="">— Pick archetype first —</option>';
    sel.disabled  = true;
    return;
  }
  sel.disabled  = false;
  const opts    = ARCHETYPES[arc] || [];
  sel.innerHTML = '<option value="">— Sub-Archetype —</option>' +
    opts.map(o => `<option value="${o}"${selectedSub === o ? " selected" : ""}>${o}</option>`).join("");
}

function updateSecondArchetypeUI() {
  const show      = !!state.hasSecondArchetype;
  const className = "meta-field multi-class-field" + (show ? "" : " hidden");
  document.getElementById("multiClassArchetypeField").className    = className;
  document.getElementById("multiClassSubArchetypeField").className = className;
  document.getElementById("removeSecondArchetypeField").className  = className + " grid-col-full";
  document.getElementById("addSecondArchetypeBtn").style.display   = show ? "none" : "";
}

function toggleSecondArchetype() {
  state.hasSecondArchetype = !state.hasSecondArchetype;
  if (!state.hasSecondArchetype) {
    state.archetype2 = "";
    state.subArchetype2 = "";
    document.getElementById("archetypeSelect2").value = "";
    updateSubSelect("subArchetypeSelect2", "", "");
  }
  updateSecondArchetypeUI();
  scheduleSave();
}

// ── FIELD BINDINGS ────────────────────────────────────────────────────────────
function bindField(id, stateKey) {
  const el = document.getElementById(id);
  if (!el) return;
  el.addEventListener("input",  e => { state[stateKey] = e.target.value; scheduleSave(); });
  el.addEventListener("change", e => { state[stateKey] = e.target.value; scheduleSave(); });
}

function syncHP() {
  const max = document.getElementById("hpMax").value;
  const cur = document.getElementById("hpCurrent");
  if (!cur.value) { cur.value = max; state.hpCurrent = max; }
  state.hpMax = max;
  scheduleSave();
}
window.syncHP = syncHP;

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

document.querySelectorAll(".tab:not(.disabled)").forEach(tab => {
  tab.addEventListener("click", () => activateMainTab(tab.dataset.tab));
});

// ── INIT ──────────────────────────────────────────────────────────────────────
async function init() {
  // Wire up the rolls module with its dependencies
  initRolls({
    getState:               () => state,
    scheduleSave,
    getPreferredPlayerName,
  });

  renderStats();
  updateBlackFlashRangeDisplay();

  // Bind simple fields
  bindField("charName",            "charName");
  bindField("ageInput",            "age");
  bindField("gradeSelect",         "grade");
  bindField("ctInput",             "ct");
  bindField("playerName",          "playerName");
  bindField("acInput",             "ac");
  bindField("hpCurrent",           "hpCurrent");
  bindField("hpMax",               "hpMax");
  bindField("moveInput",           "movement");
  bindField("ceCurrent",           "ceCurrent");
  bindField("ceMax",               "ceMax");
  bindField("ceNote",              "ceNote");
  bindField("subArchetypeSelect",  "subArchetype");
  bindField("subArchetypeSelect2", "subArchetype2");

  document.getElementById("addSecondArchetypeBtn").addEventListener("click", toggleSecondArchetype);
  document.getElementById("removeSecondArchetypeBtn").addEventListener("click", toggleSecondArchetype);
  updateSecondArchetypeUI();

  // Roll history panel
  const rollHistoryPanel = document.getElementById("rollHistoryPanel");
  document.getElementById("rollHistoryBtn").addEventListener("click", () => rollHistoryPanel.classList.toggle("open"));
  document.getElementById("closeRollHistoryBtn").addEventListener("click", () => rollHistoryPanel.classList.remove("open"));
  document.getElementById("clearRollHistoryBtn").addEventListener("click", () => {
    if (getActiveRollTab() === "mine") {
      state.rollHistory = [];
      renderRollHistory();
      scheduleSave();
    } else {
      clearGroupRollHistory();
    }
  });
  document.getElementById("rollLogTabMine").addEventListener("click",  () => switchRollTab("mine"));
  document.getElementById("rollLogTabGroup").addEventListener("click", () => switchRollTab("group"));

  document.getElementById("partyQuickBtn").addEventListener("click", () => activateMainTab("party"));

  renderRollHistory();
  renderPartyList();

  // Info modal
  document.getElementById("infoBtn").addEventListener("click", () => {
    document.getElementById("infoOverlay").classList.add("open");
  });
  document.getElementById("infoCloseBtn").addEventListener("click", () => {
    document.getElementById("infoOverlay").classList.remove("open");
  });
  document.getElementById("infoOverlay").addEventListener("click", e => {
    if (e.target === e.currentTarget) e.currentTarget.classList.remove("open");
  });

  // OBR init
  try {
    await OBR.onReady(async () => {
      obrReady = true;
      try { localPlayerName = await OBR.player.getName(); } catch (_) { localPlayerName = ""; }
      try { localPlayerId   = await OBR.player.getId();   } catch (_) { localPlayerId   = localPlayerName || null; }

      OBR.broadcast.onMessage(PARTY_BROADCAST_CHANNEL, event => {
        const entry = event.data;
        if (!entry || !entry.playerId) return;
        if (entry.playerId === localPlayerId) return;
        if (!hasCharacterName(entry)) {
          partyRoster.delete(entry.playerId);
        } else {
          partyRoster.set(entry.playerId, entry);
        }
        renderPartyList();
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
      const saved = await loadState();
      if (saved) {
        state = { ...defaultState(), ...saved };
        if (state.archetype2 || state.subArchetype2) state.hasSecondArchetype = true;
        if (saved.stats) {
          [...CENTER_STATS, ...RIGHT_STATS].forEach(def => {
            if (saved.stats[def.key]) {
              const savedStat   = saved.stats[def.key];
              const savedSkills = Array.isArray(savedStat.skills) ? savedStat.skills : [];
              state.stats[def.key] = {
                score:  savedStat.score ?? "",
                skills: def.skills.map((_, i) => ({
                  dot:   !!savedSkills[i]?.dot,
                  bonus: savedSkills[i]?.bonus ?? "",
                })),
              };
            }
          });
        }
        renderStats();
        applyStateToUI();
      }

      renderPartyList();
      broadcastPartySnapshot();
      OBR.broadcast.sendMessage(PARTY_SYNC_REQUEST_CHANNEL, { requesterId: localPlayerId || "unknown" }, { destination: "REMOTE" });
    });
  } catch (_) {
    // Dev fallback (outside OBR)
    const saved = await loadState();
    if (saved) {
      state = { ...defaultState(), ...saved };
      if (state.archetype2 || state.subArchetype2) state.hasSecondArchetype = true;
      renderStats();
      applyStateToUI();
    }
  }
}

init();
