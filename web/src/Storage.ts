// Persistent storage of memory cards in IndexedDB, one card per cartridge title.

const DatabaseName = "vircon32-web";
const StoreName = "memory-cards";

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DatabaseName, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(StoreName);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDatabase();
  return new Promise<T>((resolve, reject) => {
    const transaction = db.transaction(StoreName, mode);
    const request = action(transaction.objectStore(StoreName));
    transaction.oncomplete = () => { db.close(); resolve(request.result); };
    transaction.onerror = () => { db.close(); reject(transaction.error); };
  });
}

export async function loadStoredCard(key: string): Promise<Uint8Array | null> {
  try {
    const value = await withStore("readonly", (s) => s.get(key));
    return value instanceof Uint8Array ? value : value ? new Uint8Array(value as ArrayBuffer) : null;
  } catch {
    return null;
  }
}

export async function storeCard(key: string, bytes: Uint8Array): Promise<void> {
  try {
    await withStore("readwrite", (s) => s.put(bytes.slice(), key));
  } catch (e) {
    console.warn("Could not save memory card", e);
  }
}

/** creates the bytes of an empty memory card file */
export function createEmptyCard(): Uint8Array {
  const bytes = new Uint8Array(8 + 1024 * 256 * 4);
  for (let i = 0; i < 8; i++) bytes[i] = "V32-MEMC".charCodeAt(i);
  return bytes;
}

export function sameBytes(a: Uint8Array | null, b: Uint8Array | null): boolean {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
