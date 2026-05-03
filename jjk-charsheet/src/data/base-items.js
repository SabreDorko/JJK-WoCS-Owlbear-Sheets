import rawBaseItems from "./base-items.json";

function normalizeLookupKey(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\([^)]*\)/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function equipmentLineToLookupCandidates(line) {
  const source = String(line || "").trim();
  if (!source) return [];

  const beforeColon = source.split(":")[0].trim();
  const slashParts = beforeColon.split("/").map(part => part.trim()).filter(Boolean);
  const candidates = [beforeColon, ...slashParts, source];
  return [...new Set(candidates.map(normalizeLookupKey).filter(Boolean))];
}

export const BASE_ITEM_CATALOG = Array.isArray(rawBaseItems) ? rawBaseItems : [];

const _itemById = new Map(BASE_ITEM_CATALOG.map(item => [item.id, item]));
const _itemByLookup = new Map();

BASE_ITEM_CATALOG.forEach(item => {
  const keys = [item.name, ...(Array.isArray(item.aliases) ? item.aliases : [])]
    .map(normalizeLookupKey)
    .filter(Boolean);
  keys.forEach(key => {
    if (!_itemByLookup.has(key)) _itemByLookup.set(key, item);
  });
});

export function getBaseItemById(itemId) {
  return _itemById.get(itemId) || null;
}

export function resolveBaseItemTemplateByStartingEquipmentLine(line) {
  const keys = equipmentLineToLookupCandidates(line);
  for (const key of keys) {
    const match = _itemByLookup.get(key);
    if (match) return match;
  }
  return null;
}
