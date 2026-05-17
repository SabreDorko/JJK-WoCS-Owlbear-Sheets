import { isGm, getGmOverride, setGmOverride, getObrRole } from "./gm.js";

let _activateMainTab = null;
let _getActiveRollTab = null;
let _clearGroupRollHistory = null;
let _renderRollHistory = null;
let _switchRollTab = null;
let _getState = null;
let _scheduleSave = null;
let _applySheetState = null;
let _clearSheetState = null;
let _isInitialized = false;

let _viewingMemberSnapshot = null;

function getState() {
  return _getState ? _getState() : null;
}
function scheduleSave() {
  if (_scheduleSave) _scheduleSave();
}

const SHARED_TABS = ["party", "notes"];

export function applyGmLayout() {
  const gm = isGm();

  document.querySelectorAll(".tab[data-tab]").forEach(tab => {
    const name = tab.dataset.tab;
    if (gm && !_viewingMemberSnapshot) {
      tab.style.display = SHARED_TABS.includes(name) ? "" : "none";
    } else {
      tab.style.display = "";
    }
  });

  // Back button
  let backBtn = document.getElementById("gmBackBtn");
  if (gm && _viewingMemberSnapshot) {
    if (!backBtn) {
      backBtn = document.createElement("button");
      backBtn.id = "gmBackBtn";
      backBtn.className = "gm-back-btn";
      backBtn.textContent = "← Party";
      backBtn.addEventListener("click", exitMemberSheet);
      document.querySelector(".tab-bar")?.insertAdjacentElement("afterbegin", backBtn);
    }
    backBtn.style.display = "";
  } else if (backBtn) {
    backBtn.style.display = "none";
  }

  // GM badge
  let badge = document.getElementById("gmRoleBadge");
  if (gm) {
    if (!badge) {
      badge = document.createElement("div");
      badge.id = "gmRoleBadge";
      badge.className = "gm-role-badge";
      badge.textContent = "GM";
      const saveBtn = document.getElementById("saveStatusBadge");
      if (saveBtn?.parentElement) {
        saveBtn.parentElement.insertBefore(badge, saveBtn);
      } else {
        document.querySelector(".tab-bar")?.insertAdjacentElement("beforebegin", badge);
      }
    }
    badge.style.display = "";
    badge.title = _viewingMemberSnapshot?.name ? `GM — ${_viewingMemberSnapshot.name}` : "GM mode";
  } else if (badge) {
    badge.style.display = "none";
  }
}

export function enterMemberSheet(snapshot) {
  if (!isGm()) return;
  _viewingMemberSnapshot = snapshot;
  if (_applySheetState) _applySheetState(snapshot);
  applyGmLayout();
  _activateMainTab?.("character");
}

function exitMemberSheet() {
  _viewingMemberSnapshot = null;
  if (_clearSheetState) _clearSheetState();
  applyGmLayout();
  _activateMainTab?.("party");
}

export function isViewingMemberSheet() {
  return _viewingMemberSnapshot !== null;
}

function buildDevPanel() {
  document.getElementById("gmDevPanel")?.remove();

  const panel = document.createElement("div");
  panel.id = "gmDevPanel";
  panel.className = "gm-dev-panel";

  const obrRole = getObrRole();
  const override = getGmOverride();
  const effectiveRole = isGm() ? "GM" : "PLAYER";

  panel.innerHTML = `
    <div class="gm-dev-panel-header">
      <span class="gm-dev-panel-title">⚙ Dev — Role Override</span>
      <button class="gm-dev-panel-close" id="gmDevPanelClose">✕</button>
    </div>
    <div class="gm-dev-panel-body">
      <div class="gm-dev-row">
        <span class="gm-dev-label">OBR Role</span>
        <span class="gm-dev-value">${obrRole ?? "not resolved"}</span>
      </div>
      <div class="gm-dev-row">
        <span class="gm-dev-label">Override</span>
        <span class="gm-dev-value">${override ?? "none"}</span>
      </div>
      <div class="gm-dev-row">
        <span class="gm-dev-label">Effective</span>
        <span class="gm-dev-value gm-dev-effective">${effectiveRole}</span>
      </div>
      <div class="gm-dev-buttons">
        <button class="gm-dev-btn" data-role="GM">Force GM</button>
        <button class="gm-dev-btn" data-role="PLAYER">Force Player</button>
        <button class="gm-dev-btn gm-dev-btn--clear" data-role="clear">Clear Override</button>
      </div>
    </div>`;

  document.body.appendChild(panel);

  document.getElementById("gmDevPanelClose")?.addEventListener("click", () => panel.remove());

  panel.querySelectorAll("[data-role]").forEach(btn => {
    btn.addEventListener("click", () => {
      setGmOverride(btn.dataset.role === "clear" ? null : btn.dataset.role);
      applyGmLayout();
      buildDevPanel();
    });
  });

  setTimeout(() => {
    document.addEventListener("click", function outsideClose(e) {
      if (!panel.contains(e.target)) {
        panel.remove();
        document.removeEventListener("click", outsideClose);
      }
    });
  }, 0);
}

export function initUiShell({
  activateMainTab,
  getActiveRollTab,
  clearGroupRollHistory,
  renderRollHistory,
  switchRollTab,
  getState: getStateFn,
  scheduleSave: scheduleSaveFn,
  applySheetState = null,
  clearSheetState = null,
}) {
  _activateMainTab       = activateMainTab;
  _getActiveRollTab      = getActiveRollTab;
  _clearGroupRollHistory = clearGroupRollHistory;
  _renderRollHistory     = renderRollHistory;
  _switchRollTab         = switchRollTab;
  _getState              = getStateFn;
  _scheduleSave          = scheduleSaveFn;
  _applySheetState       = applySheetState;
  _clearSheetState       = clearSheetState;

  if (_isInitialized) {
    _renderRollHistory?.();
    applyGmLayout();
    return;
  }

  document.querySelectorAll(".tab:not(.disabled)").forEach(tab => {
    tab.addEventListener("click", () => _activateMainTab?.(tab.dataset.tab));
  });

  const rollHistoryPanel    = document.getElementById("rollHistoryPanel");
  const rollHistoryBtn      = document.getElementById("rollHistoryBtn");
  const closeRollHistoryBtn = document.getElementById("closeRollHistoryBtn");
  const clearRollHistoryBtn = document.getElementById("clearRollHistoryBtn");
  const tabMine             = document.getElementById("rollLogTabMine");
  const tabGroup            = document.getElementById("rollLogTabGroup");
  const partyQuickBtn       = document.getElementById("partyQuickBtn");

  rollHistoryBtn?.addEventListener("click",      () => rollHistoryPanel?.classList.toggle("open"));
  closeRollHistoryBtn?.addEventListener("click", () => rollHistoryPanel?.classList.remove("open"));

  clearRollHistoryBtn?.addEventListener("click", () => {
    const state = getState();
    if (!state) return;
    if (_getActiveRollTab?.() === "mine") {
      state.rollHistory = [];
      _renderRollHistory?.();
      scheduleSave();
    } else {
      _clearGroupRollHistory?.();
    }
  });

  tabMine?.addEventListener("click",      () => _switchRollTab?.("mine"));
  tabGroup?.addEventListener("click",     () => _switchRollTab?.("group"));
  partyQuickBtn?.addEventListener("click",() => _activateMainTab?.("party"));

  // Info overlay + triple-click dev toggle
  const infoBtn      = document.getElementById("infoBtn");
  const infoCloseBtn = document.getElementById("infoCloseBtn");
  const infoOverlay  = document.getElementById("infoOverlay");

  if (infoBtn) {
    let clickCount = 0;
    let clickTimer = null;
    infoBtn.addEventListener("click", () => {
      clickCount++;
      clearTimeout(clickTimer);
      clickTimer = setTimeout(() => {
        if (clickCount === 1) {
          infoOverlay?.classList.add("open");
        } else if (clickCount >= 3) {
          buildDevPanel();
        }
        clickCount = 0;
      }, 350);
    });
  }

  infoCloseBtn?.addEventListener("click", () => infoOverlay?.classList.remove("open"));
  infoOverlay?.addEventListener("click", e => {
    if (e.target === e.currentTarget) e.currentTarget.classList.remove("open");
  });

  applyGmLayout();

  _isInitialized = true;
  _renderRollHistory?.();
}