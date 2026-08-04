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

function mergeArrays(existing, incoming) {
  const isIdKeyed = (arr) => arr.some((item) => item && typeof item === "object" && item.id != null);
  if (isIdKeyed(existing) || isIdKeyed(incoming)) {
    const byId = new Map(existing.filter((item) => item && item.id != null).map((item) => [item.id, item]));
    incoming.filter((item) => item && item.id != null).forEach((item) => byId.set(item.id, item));
    return [...byId.values()];
  }
  // A primitive-valued array (e.g. RoutineStore's per-day list of completed
  // item ids) — union rather than id-merge, so a completion recorded on one
  // side isn't lost just because the other side's array happened to "win".
  return [...new Set([...existing, ...incoming])];
}
