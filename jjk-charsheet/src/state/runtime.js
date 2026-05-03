import OBR from "https://cdn.jsdelivr.net/npm/@owlbear-rodeo/sdk@3.1.0/+esm";

export function mergeLoadedState({ saved, defaultState, centerStats, rightStats }) {
  const next = { ...defaultState(), ...saved };

  if (!next.overrides || typeof next.overrides !== "object") next.overrides = { derived: {}, subskills: {} };
  if (!next.overrides.derived || typeof next.overrides.derived !== "object") next.overrides.derived = {};
  if (!next.overrides.subskills || typeof next.overrides.subskills !== "object") next.overrides.subskills = {};

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

    try {
      await OBR.room.setMetadata({ [getStorageKey()]: state });
      wroteRoom = true;
    } catch (_) {
      // Keep going and persist local backup below.
    }

    try {
      localStorage.setItem(getStorageKey(), JSON.stringify(state));
    } catch (_) {
      // Ignore local backup write failures.
    }

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
