// ── GM ROLE ───────────────────────────────────────────────────────────────────
// Single source of truth for whether the current user is a GM.
// Priority: dev override (localStorage) > OBR role.

const DEV_OVERRIDE_KEY = "jjk-dev-gm-override";

let _obrRole = null; // "GM" | "PLAYER" | null (not yet resolved)

/** Call this once OBR resolves the player role. */
export function initGmRole(obrRole) {
  _obrRole = obrRole ?? null;
}

/**
 * Returns true if the current user should be treated as GM.
 * Dev override takes priority over OBR role.
 */
export function isGm() {
  const override = getGmOverride();
  if (override === "GM")     return true;
  if (override === "PLAYER") return false;
  return _obrRole === "GM";
}

/** The raw OBR role, or null if not yet resolved. */
export function getObrRole() {
  return _obrRole;
}

// ── DEV OVERRIDE ──────────────────────────────────────────────────────────────

/**
 * Returns "GM" | "PLAYER" | null (null = no override, use real OBR role).
 */
export function getGmOverride() {
  try {
    const v = localStorage.getItem(DEV_OVERRIDE_KEY);
    if (v === "GM" || v === "PLAYER") return v;
  } catch (_) {}
  return null;
}

/**
 * Set override. Pass null to clear and fall back to real OBR role.
 * @param {"GM"|"PLAYER"|null} value
 */
export function setGmOverride(value) {
  try {
    if (value === null) {
      localStorage.removeItem(DEV_OVERRIDE_KEY);
    } else {
      localStorage.setItem(DEV_OVERRIDE_KEY, value);
    }
  } catch (_) {}
}