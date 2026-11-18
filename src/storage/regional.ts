import { restore, type City } from "../core/sim/city.ts";

const DATABASE = "vibe-town-regional-v2";
const STORE = "checkpoints";

async function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(DATABASE, 1);
    open.onupgradeneeded = () => open.result.createObjectStore(STORE);
    open.onerror = () => reject(open.error);
    open.onblocked = () => reject(new Error("Checkpoint database is busy"));
    open.onsuccess = () => resolve(open.result);
  });
}

export async function writeCheckpoint(value: unknown): Promise<void> {
  const checkpoint = restore(value);
  const db = await database();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE, "readwrite", { durability: "strict" });
      transaction.oncomplete = () => resolve();
      transaction.onabort = () =>
        reject(transaction.error ?? new Error("Checkpoint write interrupted"));
      transaction.objectStore(STORE).put(checkpoint, "active");
    });
  } finally {
    db.close();
  }
}

export async function readCheckpoint(): Promise<City | undefined> {
  const db = await database();
  try {
    const value = await new Promise<unknown>((resolve, reject) => {
      const request = db.transaction(STORE).objectStore(STORE).get("active");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return value === undefined ? undefined : restore(value);
  } finally {
    db.close();
  }
}
