// Shared by cloud-sync.js's per-key remote/local merge and settings.js's
// backup-import merge — both used to independently do a *shallow* merge
// (one level of {...existing, ...incoming} for objects, id-keyed union for
// arrays), which is correct for a flat value like SettingsStore's
// {naverBlogUrl, profileName, ...} but silently wrong for a value that
// nests further, like RoutineStore's {routine: {items, history}, life:
// {items, history}} — the nested `routine`/`life` objects got replaced
// wholesale by whichever side merge() treated as "incoming" instead of
// being merged themselves. Recursing fixes that while staying identical to
// the old behavior for anything already flat (a leaf value with no further
// object/array structure just falls through to "incoming wins", same as
// before).
window.DeepMerge = {
  mergeValues(existing, incoming) {
    // A field explicitly synced as null/undefined shouldn't be able to
    // wipe out real nested data — incoming being "absent" isn't the same
    // signal as incoming genuinely replacing existing with nothing (which
    // is what "incoming wins" below is for, when incoming is an actual
    // leaf value like a string/number/boolean).
    if ((incoming === null || incoming === undefined) && (Array.isArray(existing) || isPlainObject(existing))) {
      return existing;
    }
    if (Array.isArray(existing) && Array.isArray(incoming)) {
      return mergeArrays(existing, incoming);
    }
    if (isPlainObject(existing) && isPlainObject(incoming)) {
      const merged = { ...existing };
      Object.keys(incoming).forEach((key) => {
        merged[key] = Object.prototype.hasOwnProperty.call(existing, key)
          ? window.DeepMerge.mergeValues(existing[key], incoming[key])
          : incoming[key];
      });
      return merged;
    }
    // Not both mergeable the same way (mismatched types, or a leaf value
    // like a string/number/boolean with nothing further to merge) —
    // incoming wins, same fallback the old shallow merge used.
    return incoming;
  },
};

function isPlainObject(v) {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

// The identity field varies by store — most use "id" (schedules, ledger
// entries, ...), but CategoryStore/LedgerCategoryStore items are
// {key,label,color} with no "id" at all. Without recognizing "key" too,
// a category array fell through to the primitive-array union path below,
// which dedupes by *reference* — two category objects representing the
// same key (one from each side of a merge) are different object
// references, so nothing deduped and merging just concatenated both,
// producing visible duplicate categories after every merge-mode import.
function identityField(item) {
  if (!item || typeof item !== "object") return null;
  if (item.id != null) return "id";
  if (item.key != null) return "key";
  return null;
}

function mergeArrays(existing, incoming) {
  const isKeyed = (arr) => arr.some((item) => identityField(item) !== null);
  if (isKeyed(existing) || isKeyed(incoming)) {
    // Preserves insertion order and any items with no identity field on
    // either side (a mixed array used to silently drop those — every item
    // without an id/key just vanished from the merged result instead of
    // being kept as-is).
    const byIdentity = new Map();
    const unidentified = [];
    existing.forEach((item) => {
      const field = identityField(item);
      if (field) byIdentity.set(item[field], item);
      else unidentified.push(item);
    });
    incoming.forEach((item) => {
      const field = identityField(item);
      if (!field) {
        unidentified.push(item);
        return;
      }
      const existingItem = byIdentity.get(item[field]);
      // A same-identity item on both sides is merged field-by-field
      // (recursing through mergeValues) rather than incoming replacing
      // existing wholesale — otherwise two devices editing DIFFERENT
      // fields of the SAME item (e.g. one fixes a ledger entry's amount,
      // the other changes its category) within the sync window would have
      // whichever side lands second silently discard the other's
      // unrelated field too, not just genuinely conflicting ones.
      byIdentity.set(item[field], existingItem ? window.DeepMerge.mergeValues(existingItem, item) : item);
    });
    return [...unidentified, ...byIdentity.values()];
  }
  // A primitive-valued array (e.g. RoutineStore's per-day list of completed
  // item ids) — union rather than id-merge, so a completion recorded on one
  // side isn't lost just because the other side's array happened to "win".
  return [...new Set([...existing, ...incoming])];
}
