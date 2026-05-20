const partyRoster = new Map();

let _getState = null;
let _getPreferredPlayerName = null;
let _getLocalPlayerId = null;
let _onOpenSheet = null; // (snapshot) => void — GM opens a member's sheet
let _isGm = null;        // () => bool — true if current user is GM

function getState() {
  return _getState ? _getState() : null;
}

function getPreferredPlayerName() {
  return _getPreferredPlayerName ? _getPreferredPlayerName() : "Unknown Player";
}

function getLocalPlayerId() {
  return _getLocalPlayerId ? _getLocalPlayerId() : null;
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

function getPartyStatIcon(type) {
  if (type === "hp") {
    return `
      <svg class="party-stat-icon" viewBox="0 0 28 28" aria-hidden="true" focusable="false">
        <path fill="currentColor" d="M14 24c-.2 0-.4-.1-.6-.2C8.5 21 4 17 4 11.8 4 8.6 6.3 6.2 9.2 6.2c2.1 0 3.8 1.1 4.8 2.8 1-1.7 2.7-2.8 4.8-2.8C21.7 6.2 24 8.6 24 11.8c0 5.2-4.5 9.2-9.4 12-.2.1-.4.2-.6.2Z"/>
        <text x="14" y="14">HP</text>
      </svg>
    `;
  }
  if (type === "ce") {
    return `
      <svg class="party-stat-icon" viewBox="0 0 28 28" aria-hidden="true" focusable="false">
        <path fill="currentColor" d="M14 2 25 14 14 26 3 14Z"/>
        <text x="14" y="15">CE</text>
      </svg>
    `;
  }
  return `
    <svg class="party-stat-icon" viewBox="0 0 28 28" aria-hidden="true" focusable="false">
      <path fill="currentColor" d="M14 2 23 6v7c0 5.4-3.4 9.8-9 13-5.6-3.2-9-7.6-9-13V6l9-4Z"/>
      <text x="14" y="14">AC</text>
    </svg>
  `;
}

export function getPartySnapshot() {
  const state = getState();
  const playerName = getPreferredPlayerName();
  const playerId = getLocalPlayerId() || playerName;
  return {
    playerId,
    playerName,
    charName: (state?.charName || "").trim(),
    grade: state?.grade || "",
    archetype: state?.archetype || "",
    subArchetype: state?.subArchetype || "",
    archetype2: state?.archetype2 || "",
    subArchetype2: state?.subArchetype2 || "",
    hpCurrent: state?.hpCurrent || "",
    hpMax: state?.hpMax || "",
    ceCurrent: state?.ceCurrent || "",
    ceMax: state?.ceMax || "",
    ac: state?.ac || "",
  };
}

export function renderPartyList() {
  const list = document.getElementById("partyList");
  if (!list) return;

  const gmMode = typeof _isGm === "function" && _isGm();
  const self = getPartySnapshot();
  const others = Array.from(partyRoster.values())
    .filter(entry => entry.playerId !== self.playerId)
    .filter(hasCharacterName)
    .sort((a, b) => (a.playerName || "").localeCompare(b.playerName || ""));

  // GMs don't appear in the party list — they're facilitators, not characters
  const roster = (!gmMode && hasCharacterName(self))
    ? [self, ...others]
    : others;

  if (!roster.length) {
    list.innerHTML = '<div class="party-empty">No party data yet.</div>';
    return;
  }

  const isGmView = typeof _onOpenSheet === "function";

  list.innerHTML = roster.map((entry, i) => {
    const isSelf = !gmMode && entry.playerId === self.playerId;
    const arcDisplay = formatArchetypeDisplay(entry);
    const gradeStr = entry.grade ? `Grade ${entry.grade}` : "";
    const metaLeft = [gradeStr, arcDisplay].filter(Boolean).join(" \u2022 ");
    const gmOpenable = isGmView && !isSelf;
    return `
    <div class="party-item${gmOpenable ? " party-item--gm-openable" : ""}"
      data-party-idx="${i}"
      ${gmOpenable ? `role="button" tabindex="0" title="Open ${entry.charName || entry.playerName}'s sheet"` : ""}>
      <div class="party-item-header">
        <div class="party-character">${entry.charName}</div>
        <div class="party-player">${isSelf ? "(You)" : entry.playerName}${gmOpenable ? ' <span class="party-item-gm-hint">↗</span>' : ""}</div>
      </div>
      <div class="party-meta">
        <span class="party-meta-left">${metaLeft}</span>
      </div>
      <div class="party-stats">
        <div class="party-stat">
          ${getPartyStatIcon("hp")}
          <div class="party-stat-value">${formatTrack(entry.hpCurrent, entry.hpMax)}</div>
        </div>
        <div class="party-stat">
          ${getPartyStatIcon("ce")}
          <div class="party-stat-value">${formatTrack(entry.ceCurrent, entry.ceMax)}</div>
        </div>
        <div class="party-stat">
          ${getPartyStatIcon("ac")}
          <div class="party-stat-value">${entry.ac === "" ? "—" : entry.ac}</div>
        </div>
      </div>
    </div>
  `;
  }).join("");

  // Wire GM open-sheet clicks
  if (isGmView) {
    list.querySelectorAll(".party-item--gm-openable").forEach(el => {
      const idx = parseInt(el.dataset.partyIdx, 10);
      const entry = roster[idx];
      if (!entry) return;
      const activate = () => _onOpenSheet(entry);
      el.addEventListener("click", activate);
      el.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") activate(); });
    });
  }
}

export function handleIncomingPartySnapshot(entry) {
  if (!entry || !entry.playerId) return;
  if (entry.playerId === getLocalPlayerId()) return;
  if (!hasCharacterName(entry)) {
    partyRoster.delete(entry.playerId);
  } else {
    partyRoster.set(entry.playerId, entry);
  }
  renderPartyList();
  // Notify GM if the update is for the member currently being viewed
  if (typeof _onMemberUpdate === "function") _onMemberUpdate(entry);
}

let _onMemberUpdate = null; // (snapshot) => void — called when a viewed member sends a new snapshot

export function initParty({
  getState: getStateFn,
  getPreferredPlayerName: getPreferredNameFn,
  getLocalPlayerId: getLocalPlayerIdFn,
  onOpenSheet = null,
  onMemberUpdate = null,
  isGm = null,
}) {
  _getState = getStateFn;
  _getPreferredPlayerName = getPreferredNameFn;
  _getLocalPlayerId = getLocalPlayerIdFn;
  _onOpenSheet = onOpenSheet;
  _onMemberUpdate = onMemberUpdate;
  _isGm = isGm;
}