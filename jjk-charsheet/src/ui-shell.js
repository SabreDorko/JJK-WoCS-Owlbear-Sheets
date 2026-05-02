let _activateMainTab = null;
let _getActiveRollTab = null;
let _clearGroupRollHistory = null;
let _renderRollHistory = null;
let _switchRollTab = null;
let _getState = null;
let _scheduleSave = null;
let _isInitialized = false;

function getState() {
  return _getState ? _getState() : null;
}

function scheduleSave() {
  if (_scheduleSave) _scheduleSave();
}

export function initUiShell({
  activateMainTab,
  getActiveRollTab,
  clearGroupRollHistory,
  renderRollHistory,
  switchRollTab,
  getState: getStateFn,
  scheduleSave: scheduleSaveFn,
}) {
  _activateMainTab = activateMainTab;
  _getActiveRollTab = getActiveRollTab;
  _clearGroupRollHistory = clearGroupRollHistory;
  _renderRollHistory = renderRollHistory;
  _switchRollTab = switchRollTab;
  _getState = getStateFn;
  _scheduleSave = scheduleSaveFn;

  if (_isInitialized) {
    _renderRollHistory?.();
    return;
  }

  document.querySelectorAll(".tab:not(.disabled)").forEach(tab => {
    tab.addEventListener("click", () => _activateMainTab?.(tab.dataset.tab));
  });

  const rollHistoryPanel = document.getElementById("rollHistoryPanel");
  const rollHistoryBtn = document.getElementById("rollHistoryBtn");
  const closeRollHistoryBtn = document.getElementById("closeRollHistoryBtn");
  const clearRollHistoryBtn = document.getElementById("clearRollHistoryBtn");
  const tabMine = document.getElementById("rollLogTabMine");
  const tabGroup = document.getElementById("rollLogTabGroup");
  const partyQuickBtn = document.getElementById("partyQuickBtn");

  if (rollHistoryBtn && rollHistoryPanel) {
    rollHistoryBtn.addEventListener("click", () => rollHistoryPanel.classList.toggle("open"));
  }
  if (closeRollHistoryBtn && rollHistoryPanel) {
    closeRollHistoryBtn.addEventListener("click", () => rollHistoryPanel.classList.remove("open"));
  }
  if (clearRollHistoryBtn) {
    clearRollHistoryBtn.addEventListener("click", () => {
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
  }
  if (tabMine) {
    tabMine.addEventListener("click", () => _switchRollTab?.("mine"));
  }
  if (tabGroup) {
    tabGroup.addEventListener("click", () => _switchRollTab?.("group"));
  }
  if (partyQuickBtn) {
    partyQuickBtn.addEventListener("click", () => _activateMainTab?.("party"));
  }

  const infoBtn = document.getElementById("infoBtn");
  const infoCloseBtn = document.getElementById("infoCloseBtn");
  const infoOverlay = document.getElementById("infoOverlay");

  if (infoBtn && infoOverlay) {
    infoBtn.addEventListener("click", () => infoOverlay.classList.add("open"));
  }
  if (infoCloseBtn && infoOverlay) {
    infoCloseBtn.addEventListener("click", () => infoOverlay.classList.remove("open"));
  }
  if (infoOverlay) {
    infoOverlay.addEventListener("click", e => {
      if (e.target === e.currentTarget) e.currentTarget.classList.remove("open");
    });
  }

  _isInitialized = true;
  _renderRollHistory?.();
}
