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
}) {
  let saveTimeout = null;

  function getStorageKey() {
    const localPlayerId = getLocalPlayerId();
    return localPlayerId ? `${storageKeyBase}-${localPlayerId}` : storageKeyBase;
  }

  async function saveState() {
    try {
      await OBR.room.setMetadata({ [getStorageKey()]: getState() });
    } catch (_) {
      localStorage.setItem(getStorageKey(), JSON.stringify(getState()));
    }

    if (onAfterSave) onAfterSave();
  }

  async function loadState() {
    const key = getStorageKey();

    try {
      const meta = await OBR.room.getMetadata();
      if (meta[key]) return meta[key];
      if (meta[storageKeyBase]) return meta[storageKeyBase];
    } catch (_) {
      const saved = localStorage.getItem(key);
      if (saved) return JSON.parse(saved);

      const oldSaved = localStorage.getItem(storageKeyBase);
      if (oldSaved) return JSON.parse(oldSaved);
    }

    return null;
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
