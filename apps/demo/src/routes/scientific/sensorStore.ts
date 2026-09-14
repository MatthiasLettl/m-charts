import { createSensorReadings, type SensorReading } from './sensorModel.ts';

// Demo-only, same-origin cache. Bump the key whenever the generator/schema changes.
const DATABASE = 'm-charts-scientific-explorer';
const STORE = 'experiments';
const DATASET_ID = 'thermal-chamber-v1-seed7391-samples4000';
const ROW_COUNT = 12_000;
interface StoredExperiment {
  id: string;
  createdAt: number;
  readings: SensorReading[];
}
export interface SensorDataset {
  readings: SensorReading[];
  createdAt: number;
  source: 'generated' | 'restored';
  storage: 'indexeddb' | 'memory';
}

// React StrictMode may mount twice; share only the in-flight operation. Later
// visits read IndexedDB, instead of retaining a second application-memory cache.
let pending: Promise<SensorDataset> | undefined;
export function loadSensorDataset(regenerate = false): Promise<SensorDataset> {
  if (pending) return pending;
  pending = load(regenerate).finally(() => {
    pending = undefined;
  });
  return pending;
}

async function load(regenerate: boolean): Promise<SensorDataset> {
  let database: IDBDatabase | undefined;
  let generated: StoredExperiment | undefined;
  try {
    database = await openDatabase();
    if (!regenerate) {
      const stored = await readExperiment(database);
      if (validExperiment(stored)) {
        return { ...stored, source: 'restored', storage: 'indexeddb' };
      }
    }
    generated = {
      id: DATASET_ID,
      createdAt: Date.now(),
      readings: createSensorReadings(),
    };
    await writeExperiment(database, generated);
    return { ...generated, source: 'generated', storage: 'indexeddb' };
  } catch {
    // Private browsing, quota limits, blocked databases, and unavailable storage
    // must never send the user to a network dataset or prevent chart use.
    generated ??= {
      id: DATASET_ID,
      createdAt: Date.now(),
      readings: createSensorReadings(),
    };
    return { ...generated, source: 'generated', storage: 'memory' };
  } finally {
    database?.close();
  }
}

function validExperiment(value: unknown): value is StoredExperiment {
  if (!value || typeof value !== 'object') return false;
  const record = value as Partial<StoredExperiment>;
  return (
    record.id === DATASET_ID &&
    Number.isFinite(record.createdAt) &&
    Array.isArray(record.readings) &&
    record.readings.length === ROW_COUNT &&
    record.readings.every(
      (row, index) =>
        row &&
        row.sourceIndex === index &&
        row.sensor === index % 3 &&
        row.id ===
          `TC-${row.sensor + 1}-${Math.floor(index / 3)
            .toString()
            .padStart(4, '0')}` &&
        [
          row.time,
          row.temperature,
          row.pressure,
          row.vibration,
          row.humidity,
        ].every(Number.isFinite) &&
        (row.anomaly === null ||
          row.anomaly === 'heat' ||
          row.anomaly === 'drift'),
    )
  );
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    let settled = false;
    const fail = () => {
      settled = true;
      clearTimeout(timer);
      reject(new Error('Local experiment storage unavailable.'));
    };
    const timer = setTimeout(fail, 3000);
    request.onblocked = fail;
    request.onerror = fail;
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE, { keyPath: 'id' });
    };
    request.onsuccess = () => {
      clearTimeout(timer);
      if (settled) {
        request.result.close();
        return;
      }
      settled = true;
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
  });
}

function readExperiment(database: IDBDatabase): Promise<unknown> {
  return transact(database, 'readonly', (store) => store.get(DATASET_ID));
}
function writeExperiment(
  database: IDBDatabase,
  record: StoredExperiment,
): Promise<unknown> {
  return transact(database, 'readwrite', (store) => store.put(record));
}
function transact(
  database: IDBDatabase,
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE, mode);
    const request = operation(transaction.objectStore(STORE));
    const timer = setTimeout(() => {
      try {
        transaction.abort();
      } catch {
        /* Already finished. */
      }
      reject(new Error('Local experiment storage timed out.'));
    }, 3000);
    transaction.oncomplete = () => {
      clearTimeout(timer);
      resolve(request.result);
    };
    transaction.onabort = transaction.onerror = () => {
      clearTimeout(timer);
      reject(
        transaction.error ?? new Error('Local experiment storage failed.'),
      );
    };
  });
}
