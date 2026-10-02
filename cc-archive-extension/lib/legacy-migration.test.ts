// @vitest-environment node
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { migrateLegacyDatabases, runLegacyMigration } from './legacy-migration';

const LEGACY_IMAGES = 'url-archive-images';
const LEGACY_QUEUE = 'url-archive-queue';
const ALL_DBS = [LEGACY_IMAGES, 'cc-archive-images', LEGACY_QUEUE, 'cc-archive-queue'];

let store: Record<string, unknown>;

beforeEach(async () => {
  store = {};
  (globalThis as any).chrome = {
    storage: {
      local: {
        get: vi.fn(async (key: string) => ({ [key]: store[key] })),
        set: vi.fn(async (obj: Record<string, unknown>) => { Object.assign(store, obj); }),
      },
    },
  };
  await Promise.all(ALL_DBS.map(dropDatabase));
});

test('copies the image store together with its out-of-line keys', async () => {
  await seed(LEGACY_IMAGES, (db) => db.createObjectStore('images'), [
    { value: 'data:image/png;base64,AAA', key: 'clip-a' },
    { value: 'data:image/png;base64,BBB', key: 'clip-b' },
  ]);

  const report = await migrateLegacyDatabases();

  expect(report.records).toBe(2);
  expect(report.databases.find((item) => item.from === LEGACY_IMAGES)).toMatchObject({
    to: 'cc-archive-images',
    status: 'copied',
    records: 2,
  });
  await expect(readAll('cc-archive-images', 'images')).resolves.toEqual([
    { key: 'clip-a', value: 'data:image/png;base64,AAA' },
    { key: 'clip-b', value: 'data:image/png;base64,BBB' },
  ]);
  // 旧库只复制不删除，留着回滚余地
  await expect(readAll(LEGACY_IMAGES, 'images')).resolves.toHaveLength(2);
});

test('keeps inline autoIncrement ids so queued clips stay addressable', async () => {
  await seed(LEGACY_QUEUE, (db) => db.createObjectStore('clips', { keyPath: 'id', autoIncrement: true }), [
    { value: { id: 1, path: 'a.md', content: 'A' } },
    { value: { id: 2, path: 'b.md', content: 'B' } },
  ]);

  await expect(migrateLegacyDatabases()).resolves.toMatchObject({ records: 2 });

  const moved = await readAll<{ id: number }>('cc-archive-queue', 'clips');
  expect(moved.map((row) => row.value.id)).toEqual([1, 2]);
  // 自增计数器必须跟在搬来的 id 之后，否则新的暂存项会撞上旧 id
  await expect(addQueueItem('c.md')).resolves.toBe(3);
});

test('runs once: the second pass reports the marker instead of duplicating', async () => {
  await seed(LEGACY_IMAGES, (db) => db.createObjectStore('images'), [{ value: 'AAA', key: 'clip-a' }]);

  await expect(migrateLegacyDatabases()).resolves.toMatchObject({ records: 1 });
  await expect(migrateLegacyDatabases()).resolves.toMatchObject({
    records: 0,
    databases: [{ from: LEGACY_IMAGES, status: 'already', records: 1 }],
  });
  await expect(readAll('cc-archive-images', 'images')).resolves.toHaveLength(1);
});

test('records an empty legacy database so later boots skip it', async () => {
  await seed(LEGACY_IMAGES, (db) => db.createObjectStore('images'), []);

  await expect(migrateLegacyDatabases()).resolves.toMatchObject({
    records: 0,
    databases: [{ from: LEGACY_IMAGES, status: 'empty', records: 0 }],
  });
  expect(store.cc_archive_legacy_migration).toEqual({ [LEGACY_IMAGES]: { records: 0 } });

  await expect(migrateLegacyDatabases()).resolves.toMatchObject({
    databases: [{ from: LEGACY_IMAGES, status: 'already' }],
  });
});

test('fresh install has nothing to move and creates no database', async () => {
  await expect(migrateLegacyDatabases()).resolves.toEqual({ databases: [], records: 0 });
  // 探测库存在性不能靠 open —— open 不存在的库会把它建出来
  await expect(indexedDB.databases()).resolves.toEqual([]);
});

test('runLegacyMigration shares one attempt per page lifetime', async () => {
  await seed(LEGACY_IMAGES, (db) => db.createObjectStore('images'), [{ value: 'AAA', key: 'clip-a' }]);

  const [first, second] = await Promise.all([runLegacyMigration(), runLegacyMigration()]);

  expect(first).not.toBeNull();
  expect(second).toBe(first);
  expect(first?.records).toBe(1);
});

/* ------------------------------------------------------------------ 测试脚手架 */

type SeedRecord = { value: unknown; key?: IDBValidKey };

function open(name: string, version: number | undefined, upgrade: (db: IDBDatabase) => void): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = version === undefined ? indexedDB.open(name) : indexedDB.open(name, version);
    request.onupgradeneeded = () => upgrade(request.result);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error(`open ${name} failed`));
  });
}

function finished<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function completed(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error);
  });
}

function dropDatabase(name: string): Promise<void> {
  return new Promise((resolve) => {
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
    request.onblocked = () => resolve();
  });
}

/** 建一个 version 1 的旧库并灌数据（store 名取自 upgrade 里创建的那个） */
async function seed(name: string, create: (db: IDBDatabase) => void, records: SeedRecord[]): Promise<void> {
  const db = await open(name, 1, create);
  const storeName = Array.from(db.objectStoreNames)[0];
  const tx = db.transaction(storeName, 'readwrite');
  const objectStore = tx.objectStore(storeName);
  for (const record of records) {
    if (record.key === undefined) objectStore.put(record.value);
    else objectStore.put(record.value, record.key);
  }
  await completed(tx);
  db.close();
}

async function readAll<T = string>(name: string, storeName: string): Promise<Array<{ key: IDBValidKey; value: T }>> {
  const db = await open(name, undefined, () => undefined);
  const tx = db.transaction(storeName, 'readonly');
  const values = await finished(tx.objectStore(storeName).getAll()) as T[];
  const keys = await finished(tx.objectStore(storeName).getAllKeys()) as IDBValidKey[];
  db.close();
  return values.map((value, index) => ({ key: keys[index], value }));
}

async function addQueueItem(path: string): Promise<IDBValidKey> {
  const db = await open('cc-archive-queue', undefined, () => undefined);
  const tx = db.transaction('clips', 'readwrite');
  const key = await finished(tx.objectStore('clips').add({ path, content: path.toUpperCase(), enqueuedAt: '2026-06-23T00:00:00' }));
  await completed(tx);
  db.close();
  return key;
}
