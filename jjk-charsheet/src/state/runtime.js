import OBR from "https://cdn.jsdelivr.net/npm/@owlbear-rodeo/sdk@3.1.0/+esm";

export function mergeLoadedState({ saved, defaultState, centerStats, rightStats }) {
  const next = { ...defaultState(), ...saved };

  if (!next.overrides || typeof next.overrides !== "object") next.overrides = { derived: {}, subskills: {} };
  if (!next.overrides.derived || typeof next.overrides.derived !== "object") next.overrides.derived = {};
  if (!next.overrides.subskills || typeof next.overrides.subskills !== "object") next.overrides.subskills = {};
  if (!Array.isArray(next.directModifiers)) next.directModifiers = [];

  if (next.archetype2 || next.subArchetype2) {
    next.hasSecondArchetype = true;
  }

  if (saved?.stats) {
    [...centerStats, ...rightStats].forEach(def => {
      if (saved.stats[def.key]) {
        const savedStat = saved.stats[def.key];
        const savedSkills = Array.isArray(savedStat.skills) ? savedStat.skills : [];
        next.stats[def.key] = {
          score: savedStat.score ?? "",
          skills: def.skills.map((_, i) => {
            const savedSkill = savedSkills[i] || {};
            const rawAptitude = parseInt(savedSkill.aptitude, 10);
            const aptitude = Number.isFinite(rawAptitude)
              ? Math.max(0, Math.min(2, rawAptitude))
              : (savedSkill.dot ? 1 : 0);
            return { aptitude };
          }),
        };
      }
    });
  }

  return next;
}

export function createPersistenceRuntime({
  storageKeyBase,
  getState,
  getLocalPlayerId,
  onSchedule,
  onAfterSave,
  onAfterLoad,
}) {
  let saveTimeout = null;

  function parseStateTimestamp(state) {
    const raw = parseInt(state?.__savedAt, 10);
    return Number.isFinite(raw) && raw > 0 ? raw : 0;
  }

  function pickNewestState(preferredA, preferredB) {
    if (!preferredA && !preferredB) return null;
    if (!preferredA) return preferredB;
    if (!preferredB) return preferredA;

    const aTs = parseStateTimestamp(preferredA);
    const bTs = parseStateTimestamp(preferredB);

    if (aTs > bTs) return preferredA;
    if (bTs > aTs) return preferredB;

    // If timestamps are missing or identical, prefer local copy for same-device continuity.
    return preferredB;
  }

  function getStorageKey() {
    const localPlayerId = getLocalPlayerId();
    return localPlayerId ? `${storageKeyBase}-${localPlayerId}` : storageKeyBase;
  }

  async function saveState() {
    const state = getState();
    if (!state || typeof state !== "object") return;

    state.__savedAt = Date.now();
    let wroteRoom = false;
    const key = getStorageKey();

    // Try to write to room metadata — strip bulky fields to stay under OBR's
    // 16 kB limit. rollHistory and npcs are GM/local-only data; players read
    // their own history from localStorage, and GM reads NPCs from their own state.
    const roomState = { ...state };
    delete roomState.rollHistory;
    delete roomState.npcs;

    try {
      await OBR.room.setMetadata({ [key]: roomState });
      wroteRoom = true;
    } catch (_) {
      // Silently fall through — localStorage below is the reliable backup.
    }

    // Always write full state to localStorage (no size limit concerns)
    try {
      localStorage.setItem(key, JSON.stringify(state));
    } catch (_) {}

    if (onAfterSave) {
      onAfterSave({
        savedAt: state.__savedAt,
        source: wroteRoom ? "room+local" : "local",
      });
    }
  }

  async function loadState() {
    const key = getStorageKey();

    let roomState = null;
    let localState = null;

    try {
      const meta = await OBR.room.getMetadata();
      roomState = meta[key] || meta[storageKeyBase] || null;
    } catch (_) {
      roomState = null;
    }

    try {
      const saved = localStorage.getItem(key);
      localState = saved ? JSON.parse(saved) : null;
      if (!localState) {
        const oldSaved = localStorage.getItem(storageKeyBase);
        localState = oldSaved ? JSON.parse(oldSaved) : null;
      }
    } catch (_) {
      localState = null;
    }

    const picked = pickNewestState(roomState, localState);

    if (onAfterLoad) {
      let source = "none";
      if (picked && picked === roomState) source = "room";
      else if (picked && picked === localState) source = "local";

      onAfterLoad({
        savedAt: parseStateTimestamp(picked),
        source,
      });
    }

    return picked;
  }

  function scheduleSave() {
    clearTimeout(saveTimeout);
    if (onSchedule) onSchedule();
    saveTimeout = setTimeout(saveState, 600);
  }

  return {
    getStorageKey,
    saveState,
    loadState,
    scheduleSave,
  };
}

export async function loadStateForPlayer(storageKeyBase, playerId) {
  const key = playerId ? `${storageKeyBase}-${playerId}` : storageKeyBase;
  console.log(`[GM loadState] playerId="${playerId}" key="${key}"`);

  let roomState  = null;
  let localState = null;

  try {
    const meta = await OBR.room.getMetadata();
    const allKeys = Object.keys(meta).filter(k => k.startsWith(storageKeyBase));
    console.log(`[GM loadState] room keys matching base:`, allKeys);
    roomState = playerId ? (meta[key] || null) : (meta[storageKeyBase] || null);
    console.log(`[GM loadState] roomState found:`, !!roomState, roomState ? `charName="${roomState.charName}"` : "");
    if (roomState) {
      console.log(`[GM loadState] techniques.bindingVows:`, roomState.techniques?.bindingVows);
      console.log(`[GM loadState] archetypeProgress.unlockedAbilityIds:`, roomState.archetypeProgress?.unlockedAbilityIds);
    }
  } catch (err) {
    console.warn(`[GM loadState] room metadata failed:`, err);
    roomState = null;
  }

  try {
    const saved = localStorage.getItem(key);
    localState = saved ? JSON.parse(saved) : null;
    console.log(`[GM loadState] localState found:`, !!localState, localState ? `charName="${localState.charName}"` : "");
    if (localState) {
      console.log(`[GM loadState] local techniques.bindingVows:`, localState.techniques?.bindingVows);
      console.log(`[GM loadState] local archetypeProgress.unlockedAbilityIds:`, localState.archetypeProgress?.unlockedAbilityIds);
    }
  } catch (_) {
    localState = null;
  }

  if (!roomState && !localState) {
    console.warn(`[GM loadState] no state found for playerId="${playerId}"`);
    return null;
  }
  if (!roomState) return localState;
  if (!localState) return roomState;
  const roomTs  = parseInt(roomState?.__savedAt,  10) || 0;
  const localTs = parseInt(localState?.__savedAt, 10) || 0;
  const picked  = roomTs > localTs ? roomState : localState;
  console.log(`[GM loadState] picked source: ${roomTs > localTs ? "room" : "local"}, charName="${picked.charName}"`);
  return picked;
}