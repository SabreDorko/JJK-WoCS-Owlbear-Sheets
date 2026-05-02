const partyRoster = new Map();

let _getState = null;
let _getPreferredPlayerName = null;
let _getLocalPlayerId = null;

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

  const self = getPartySnapshot();
  const others = Array.from(partyRoster.values())
    .filter(entry => entry.playerId !== self.playerId)
    .filter(hasCharacterName)
    .sort((a, b) => (a.playerName || "").localeCompare(b.playerName || ""));
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

export function handleIncomingPartySnapshot(entry) {
  if (!entry || !entry.playerId) return;
  if (entry.playerId === getLocalPlayerId()) return;
  if (!hasCharacterName(entry)) {
    partyRoster.delete(entry.playerId);
  } else {
    partyRoster.set(entry.playerId, entry);
  }
  renderPartyList();
}

export function initParty({ getState: getStateFn, getPreferredPlayerName: getPreferredNameFn, getLocalPlayerId: getLocalPlayerIdFn }) {
  _getState = getStateFn;
  _getPreferredPlayerName = getPreferredNameFn;
  _getLocalPlayerId = getLocalPlayerIdFn;
}
