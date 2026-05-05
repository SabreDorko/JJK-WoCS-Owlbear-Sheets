// src/weapons.js
export const WEAPON_TYPES = ["bludgeoning", "slashing", "ranged", "polearm"];
export const WEAPON_TYPE_LABELS = { bludgeoning: "Bludgeoning", slashing: "Slashing", ranged: "Ranged", polearm: "Polearm" };
export const WEAPON_STAT_OPTIONS = ["power", "speed", "technique"];
export const WEAPON_STAT_LABELS = { power: "Power", speed: "Speed", technique: "Tech" };
export const WEAPON_STAT_LEVEL_ABBREVIATIONS = { power: "PL", speed: "SL", technique: "TL" };
export const WEAPON_DAMAGE_DICE = ["d4", "d6", "d8", "d10", "d12"];

export function normalizeWeaponType(rawType) {
  return WEAPON_TYPES.includes(rawType) ? rawType : "bludgeoning";
}
export function normalizeWeaponStat(rawStat) {
  if (rawStat === "tech") return "technique";
  return WEAPON_STAT_OPTIONS.includes(rawStat) ? rawStat : "power";
}
export function parseWeaponRange(rawValue) {
  const parsed = parseInt(rawValue, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.min(Math.max(parsed, 1), 9999);
}
export function parseWeaponPolearmReach(rawValue) {
  return rawValue === true || rawValue === "true" || rawValue === 1;
}
export function getWeaponReachInFeet(item) {
  const weaponType = normalizeWeaponType(item?.weaponType);
  if (weaponType === "ranged") return parseWeaponRange(item?.weaponRange);
  if (weaponType === "slashing" || weaponType === "bludgeoning") return 5;
  if (weaponType === "polearm") return parseWeaponPolearmReach(item?.weaponPolearmReach) ? 10 : 5;
  return null;
}
export function shouldDisplayWeaponRange(item) {
  const weaponType = normalizeWeaponType(item?.weaponType);
  return weaponType === "ranged" || weaponType === "polearm";
}
export function parseWeaponDamageCount(rawValue) {
  const parsed = parseInt(rawValue, 10);
  if (!Number.isFinite(parsed)) return 1;
  return Math.min(Math.max(parsed, 1), 99);
}
export function normalizeWeaponDamageDie(rawDie) {
  const normalized = String(rawDie || "").toLowerCase();
  return WEAPON_DAMAGE_DICE.includes(normalized) ? normalized : "d6";
}
export function normalizeWeaponDamageParts(rawParts) {
  if (!Array.isArray(rawParts)) return [{ count: 1, die: "d6" }];
  const parsed = rawParts
    .map(part => ({ count: parseWeaponDamageCount(part?.count), die: normalizeWeaponDamageDie(part?.die) }))
    .filter(part => Number.isFinite(part.count) && part.count > 0);
  return parsed.length ? parsed : [{ count: 1, die: "d6" }];
}
export function formatWeaponDamageParts(parts) {
  return normalizeWeaponDamageParts(parts).map(part => `${part.count}${part.die}`).join(" + ");
}
export function getWeaponDamageBonusAbbreviation(rawStat) {
  return WEAPON_STAT_LEVEL_ABBREVIATIONS[normalizeWeaponStat(rawStat)] || "PL";
}
export function getWeaponDamageBonusTooltip(rawStat) {
  const label = normalizeWeaponStat(rawStat) === "technique" ? "Technique" : (WEAPON_STAT_LABELS[normalizeWeaponStat(rawStat)] || "Power");
  return `${label} Level`;
}
export function getWeaponDamageText(item) {
  return `${formatWeaponDamageParts(item?.weaponDamageParts)} + ${getWeaponDamageBonusAbbreviation(item?.weaponStat)}`;
}
export function normalizeWeaponGrip(rawGrip, slotsNeeded) {
  if (rawGrip === "twoHanded" || rawGrip === "oneHanded") return rawGrip;
  return Math.min(Math.max(parseInt(slotsNeeded, 10) || 1, 1), 3) >= 2 ? "twoHanded" : "oneHanded";
}