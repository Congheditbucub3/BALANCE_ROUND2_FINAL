// offline-queue.js — IndexedDB-backed queue for step batches that failed to
// sync to the server. Without this, a dropped connection (dead zone, phone
// locked mid-walk, tab closed) loses whatever steps hadn't synced yet — this
// persists them to disk so they survive a refresh and replay once online.
const DB_NAME = 'balance-offline';
const DB_VERSION = 1;
const STORE_NAME = 'pending-steps';

function openDB() {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) {
      reject(new Error('IndexedDB not supported in this browser'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// Queue a batch that couldn't reach the server. Returns false (and logs,
// rather than throwing) if IndexedDB itself is unavailable — private
// browsing mode in some browsers disables it entirely, and losing one
// batch to that edge case shouldn't crash the tracker.
async function enqueueStepBatch(delta, elapsedMs) {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).add({ delta, elapsedMs, queuedAt: Date.now() });
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    console.warn('Offline queue unavailable — batch not persisted:', err);
    return false;
  }
}

async function getPendingBatches() {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    return [];
  }
}

async function removeBatch(id) {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).delete(id);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    return false;
  }
}

async function pendingCount() {
  const batches = await getPendingBatches();
  return batches.length;
}
