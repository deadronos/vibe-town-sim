import { restore, type City } from "./sim.ts";
export const saveKey = "vibe-town-juniper-v1";

export function openSave(storage: () => Storage) {
  let original: string | null = null;
  let readable = true;
  try {
    original = storage().getItem(saveKey);
  } catch {
    readable = false;
  }
  const city = restore(original);
  let protectedSave = original !== null && !city;
  return {
    city,
    get protectedSave() {
      return protectedSave;
    },
    get original() {
      return original;
    },
    write(city: City, replace = false) {
      if (protectedSave && !replace) return "Original save protected";
      if (!readable) return "Autosave unavailable";
      try {
        const store = storage();
        // Avoid replacing a newer city or a rejected save changed by another tab.
        if (store.getItem(saveKey) !== original) return "Save changed elsewhere · reload";
        const next = JSON.stringify(city);
        store.setItem(saveKey, next);
        original = next;
        protectedSave = false;
        return "Local autosave";
      } catch {
        return "Autosave unavailable";
      }
    },
  };
}
