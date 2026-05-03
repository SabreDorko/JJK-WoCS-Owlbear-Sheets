// ── ROLLS MODULE ──────────────────────────────────────────────────────────────
// Handles all dice rolling logic, roll history (personal + group), and toasts.
// Future animated dice / extended roll logic should live here.
import OBR from "https://cdn.jsdelivr.net/npm/@owlbear-rodeo/sdk@3.1.0/+esm";
import { ROLL_BROADCAST_CHANNEL } from "./state/store.js";

const MAX_ROLL_HISTORY       = 50;
const MAX_GROUP_ROLL_HISTORY = 100;
const MAX_TOASTS             = 5;

// ── MODULE-LOCAL STATE ────────────────────────────────────────────────────────
let groupRollHistory = [];
let activeRollTab    = "mine";

// ── INJECTED DEPENDENCIES ─────────────────────────────────────────────────────
// Provided by main.js via initRolls(). Using getters avoids stale-reference
// issues when state is reassigned after load.
let _getState               = null;
let _scheduleSave           = null;
let _getPreferredPlayerName = null;

/**
 * Must be called once during app init before any roll functions are used.
 * @param {{ getState: () => object, scheduleSave: () => void, getPreferredPlayerName: () => string }} deps
 */
export function initRolls({ getState, scheduleSave, getPreferredPlayerName }) {
  _getState               = getState;
  _scheduleSave           = scheduleSave;
  _getPreferredPlayerName = getPreferredPlayerName;
}

// ── ACCESSORS ─────────────────────────────────────────────────────────────────
export function getActiveRollTab()    { return activeRollTab; }
export function getGroupRollHistory() { return groupRollHistory; }

/** Called by main.js when an incoming group roll broadcast arrives. */
export function addIncomingGroupRoll(entry) {
  groupRollHistory = [...groupRollHistory, entry].slice(-MAX_GROUP_ROLL_HISTORY);
  if (activeRollTab === "group") renderGroupRollHistory();
}

/** Called by the Clear button when the group tab is active. */
export function clearGroupRollHistory() {
  groupRollHistory = [];
  renderGroupRollHistory();
}

// ── CRIT BADGE HELPER ─────────────────────────────────────────────────────────
function critBadgeHTML(critStatus) {
  if (critStatus === "success")
    return `<div style="color:#2a6e2a;font-family:'Cinzel',serif;font-size:8px;margin-top:4px;">✦ CRIT SUCCESS</div>`;
  if (critStatus === "fail")
    return `<div style="color:#8b1a1a;font-family:'Cinzel',serif;font-size:8px;margin-top:4px;">✦ CRIT FAIL</div>`;
  if (critStatus === "pass")
    return `<div style="color:#2a6e2a;font-family:'Cinzel',serif;font-size:8px;margin-top:4px;">✦ PASS</div>`;
  return "";
}

function formatSignedValue(value) {
  return value >= 0 ? `+${value}` : `${value}`;
}

function formatRollFormula(entry, forcedRolls, forcedTotal) {
  const rolls = Array.isArray(forcedRolls) ? forcedRolls : entry.rolls;
  const total = Number.isFinite(forcedTotal) ? forcedTotal : entry.total;
  const base = `${entry.diceCount}d6: [${rolls.join(", ")}]`;
  const breakdown = entry.breakdown;
  if (!breakdown) return `${base} = <strong>${total}</strong>`;

  let formula = base;
  if (Number.isFinite(breakdown.skillModifier)) {
    formula += ` + ${breakdown.skillModifier}`;
  }

  const bonuses = Array.isArray(breakdown.equipmentBonuses) ? breakdown.equipmentBonuses : [];
  bonuses.forEach(part => {
    if (!part || !Number.isFinite(part.value)) return;
    formula += ` + ${part.label} (${formatSignedValue(part.value)})`;
  });

  return `${formula} = <strong>${total}</strong>`;
}

function rollModeLabel(rollMode) {
  if (rollMode === "advantage") return "Advantage";
  if (rollMode === "disadvantage") return "Disadvantage";
  return "";
}

function formatRollBody(entry) {
  const breakdown = entry.breakdown;
  const comparedRolls = Array.isArray(breakdown?.comparedRolls) ? breakdown.comparedRolls : null;
  const comparedTotals = Array.isArray(breakdown?.comparedTotals) ? breakdown.comparedTotals : null;
  const selectedIndex = Number.isFinite(breakdown?.selectedRollIndex) ? breakdown.selectedRollIndex : 0;
  const modeLabel = rollModeLabel(entry.rollMode || breakdown?.rollMode);

  if (modeLabel && comparedRolls?.length === 2 && comparedTotals?.length === 2) {
    const discardedIndex = selectedIndex === 0 ? 1 : 0;
    const discardedLine = formatRollFormula(entry, comparedRolls[discardedIndex], comparedTotals[discardedIndex]);
    const keptLine = formatRollFormula(entry, comparedRolls[selectedIndex], comparedTotals[selectedIndex]);
    return `<span class="roll-compared-line roll-compared-discarded">${discardedLine}</span><span class="roll-compared-line roll-compared-kept">${keptLine}</span>`;
  }

  return formatRollFormula(entry);
}

// ── RENDER PERSONAL ROLL HISTORY ──────────────────────────────────────────────
export function renderRollHistory() {
  const list = document.getElementById("rollHistoryList");
  if (!list) return;
  const history = _getState().rollHistory || [];
  if (!history.length) {
    list.innerHTML = '<div class="roll-history-empty">No rolls yet.</div>';
    return;
  }
  list.innerHTML = history.map(item => {
    const label = item.skillName ? `${item.statLabel} › ${item.skillName}` : item.statLabel;
    const modeLabel = rollModeLabel(item.rollMode);
    const modeSuffix = modeLabel ? ` (${modeLabel})` : "";
    const badge = critBadgeHTML(item.critStatus);
    return `
      <div class="roll-history-item">
        <div class="roll-history-item-title">${item.time} • ${label}${modeSuffix}</div>
        <div class="roll-history-item-body">${formatRollBody(item)}</div>
        ${badge ? `<div class="roll-history-item-badge">${badge}</div>` : ""}
      </div>
    `;
  }).join("");
  list.scrollTop = list.scrollHeight;
}

// ── RENDER GROUP ROLL HISTORY ─────────────────────────────────────────────────
export function renderGroupRollHistory() {
  const list = document.getElementById("groupRollHistoryList");
  if (!list) return;
  if (!groupRollHistory.length) {
    list.innerHTML = '<div class="roll-history-empty">No group rolls yet.</div>';
    return;
  }
  list.innerHTML = groupRollHistory.map(item => {
    const label = item.skillName ? `${item.statLabel} › ${item.skillName}` : item.statLabel;
    const modeLabel = rollModeLabel(item.rollMode);
    const modeSuffix = modeLabel ? ` (${modeLabel})` : "";
    const whoParts = [item.charName, item.playerName].filter(v => typeof v === "string" && v.trim());
    const whoDisplay = whoParts.length
      ? `<span style="font-weight:600;color:var(--ink);">${whoParts.join(" • ")}</span> • `
      : "";
    const badge = critBadgeHTML(item.critStatus);
    return `
      <div class="roll-history-item">
        <div class="roll-history-item-title">${item.time} • ${whoDisplay}${label}${modeSuffix}</div>
        <div class="roll-history-item-body">${formatRollBody(item)}</div>
        ${badge ? `<div class="roll-history-item-badge">${badge}</div>` : ""}
      </div>
    `;
  }).join("");
  list.scrollTop = list.scrollHeight;
}

// ── TAB SWITCHING ─────────────────────────────────────────────────────────────
export function switchRollTab(tab) {
  activeRollTab = tab;
  document.getElementById("rollLogTabMine").classList.toggle("active", tab === "mine");
  document.getElementById("rollLogTabGroup").classList.toggle("active", tab === "group");
  document.getElementById("rollHistoryList").style.display  = tab === "mine"  ? "" : "none";
  document.getElementById("groupRollHistoryList").style.display = tab === "group" ? "" : "none";
  if (tab === "group") renderGroupRollHistory();
}

// ── PUSH TO PERSONAL + GROUP HISTORY AND BROADCAST ───────────────────────────
export function pushRollHistory(statLabel, diceCount, rolls, total, critStatus, skillName, breakdown, rollMode) {
  const state = _getState();
  const now  = new Date();
  const time = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });

  state.rollHistory = [
    ...(state.rollHistory || []),
    { statLabel, diceCount, rolls, total, time, critStatus: critStatus || null, skillName: skillName || null, breakdown: breakdown || null, rollMode: rollMode || null },
  ].slice(-MAX_ROLL_HISTORY);
  renderRollHistory();
  _scheduleSave();

  const charName   = (state.charName || "").trim();
  const playerName = _getPreferredPlayerName();
  const groupEntry = { charName, playerName, statLabel, diceCount, rolls, total, time, critStatus: critStatus || null, skillName: skillName || null, breakdown: breakdown || null, rollMode: rollMode || null };
  groupRollHistory = [...groupRollHistory, groupEntry].slice(-MAX_GROUP_ROLL_HISTORY);
  if (activeRollTab === "group") renderGroupRollHistory();

  try {
    OBR.broadcast.sendMessage(ROLL_BROADCAST_CHANNEL, groupEntry, { destination: "REMOTE" });
  } catch (_) { /* outside OBR */ }
}

// ── SHOW ROLL TOAST ───────────────────────────────────────────────────────────
export function showRollToast(statLabel, diceCount, rolls, total, critStatus, skillName, breakdown, rollMode) {
  const container = document.getElementById("rollToastContainer");
  if (!container) return;

  pushRollHistory(statLabel, diceCount, rolls, total, critStatus, skillName, breakdown, rollMode);

  const label = skillName ? `${statLabel} › ${skillName}` : statLabel;
  const modeLabel = rollModeLabel(rollMode || breakdown?.rollMode);
  const modeSuffix = modeLabel ? ` (${modeLabel})` : "";
  let critLine = "";
  if (critStatus === "success")
    critLine = `<div style="font-family:'Cinzel',serif;font-size:10px;letter-spacing:1px;color:#2a6e2a;margin-top:3px;">✦ CRITICAL SUCCESS</div>`;
  if (critStatus === "fail")
    critLine = `<div style="font-family:'Cinzel',serif;font-size:10px;letter-spacing:1px;color:#8b1a1a;margin-top:3px;">✦ CRITICAL FAIL</div>`;
  if (critStatus === "pass")
    critLine = `<div style="font-family:'Cinzel',serif;font-size:10px;letter-spacing:1px;color:#2a6e2a;margin-top:3px;">✦ PASS</div>`;

  const toast = document.createElement("div");
  toast.className = "roll-toast" + (critStatus === "success" ? " crit-success" : critStatus === "fail" ? " crit-fail" : critStatus === "pass" ? " pass" : "");
  toast.innerHTML = `
    <div class="roll-toast-title">${label} Roll${modeSuffix}</div>
    <div class="roll-toast-body">${formatRollBody({ diceCount, rolls, total, breakdown, rollMode })}</div>
    ${critLine}
  `;

  container.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add("show"));

  while (container.children.length > MAX_TOASTS) {
    container.removeChild(container.firstElementChild);
  }

  setTimeout(() => {
    toast.classList.remove("show");
    setTimeout(() => { if (toast.parentNode) toast.parentNode.removeChild(toast); }, 220);
  }, 4200);
}
