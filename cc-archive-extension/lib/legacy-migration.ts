/**
 * 旧构建（改名前）把剪藏配图和离线队列存在另一套 IndexedDB 库名下。
 * 库名换了之后新构建读不到旧库，数据看起来像「丢了」——其实还在磁盘上。
 * 这里在启动时一次性把旧库的记录复制进新库：只复制、不删除，保留回滚余地。
 *
 * chrome.storage 的键名（saved_clips / new_tab_prefs / settings …）没有随品牌改动，
 * 所以书签索引、偏好、分组不需要迁移。
 */

/** 迁移标记：记录已搬过的旧库，避免每次启动重复复制 */
const MIGRATION_STATE_KEY = 'cc_archive_legacy_migration';

const LEGACY_DATABASES = [
  { from: 'url-archive-images', to: 'cc-archive-images' },
  { from: 'url-archive-queue', to: 'cc-archive-queue' },
];

export type LegacyDatabaseStatus = 'copied' | 'empty' | 'already' | 'failed';

export type LegacyDatabaseReport = {
  from: string;
  to: string;
  status: LegacyDatabaseStatus;
  records: number;
  error?: string;
};

export type LegacyMigrationReport = {
  databases: LegacyDatabaseReport[];
  records: number;
};

type StoreSpec = { name: string; keyPath: string | string[] | null; autoIncrement: boolean };
type MigrationState = Record<string, { records: number }>;

let inFlight: Promise<LegacyMigrationReport | null> | null = null;

/**
 * 入口页 / worker 启动时调用。迁移失败不能挡住页面渲染，所以内部吞掉异常，
 * 并且最多等 `timeoutMs`：旧库特别大时让页面先出来，复制在后台继续。
 */
export function runLegacyMigration(timeoutMs = 3000): Promise<LegacyMigrationReport | null> {
  if (!inFlight) {
    inFlight = migrateLegacyDatabases().catch((error: unknown) => {
      // 失败不写标记，下次启动重试
      console.warn('[cc-archive] 旧版数据迁移未完成', error);
      inFlight = null;
      return null;
    });
  }
  const timedOut = new Promise<null>((resolve) => {
    setTimeout(() => resolve(null), timeoutMs);
  });
  return Promise.race([inFlight, timedOut]);
}

export async function migrateLegacyDatabases(): Promise<LegacyMigrationReport> {
  const known = await listDatabases();
  const state = await loadState();
  const report: LegacyMigrationReport = { databases: [], records: 0 };

  for (const { from, to } of LEGACY_DATABASES) {
    if (state[from]) {
      report.databases.push({ from, to, status: 'already', records: state[from].records });
      continue;
    }
    const legacyVersion = known.get(from) ?? 0;
    // 旧库不存在 = 全新安装，没有东西要搬
    if (!legacyVersion) continue;
    try {
      const item = await copyDatabase(from, legacyVersion, to, known.get(to) ?? 0);
      report.databases.push(item);
      if (item.status !== 'failed') {
        state[from] = { records: item.records };
        report.records += item.records;
      }
    } catch (error) {
      report.databases.push({
        from,
        to,
        status: 'failed',
        records: 0,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  await saveState(state);
  return report;
}

async function copyDatabase(
  from: string,
  fromVersion: number,
  to: string,
  toVersion: number,
): Promise<LegacyDatabaseReport> {
  const source = await openDatabase(from, fromVersion, () => undefined);
  try {
    const specs = await readStoreSpecs(source);
    // 目标库版本只能取两边已知的最大值：擅自升版本会让应用自己的 open(..., 1) 抛 VersionError
    const target = await openDatabase(to, Math.max(fromVersion, toVersion, 1), createStoreSpecs(specs));
    let records = 0;
    try {
      for (const spec of specs) {
        if (!target.objectStoreNames.contains(spec.name)) continue;
        records += await copyStore(source, target, spec);
      }
    } finally {
      target.close();
    }
    return { from, to, status: records ? 'copied' : 'empty', records };
  } finally {
    source.close();
  }
}

async function copyStore(from: IDBDatabase, to: IDBDatabase, spec: StoreSpec): Promise<number> {
  const readTx = from.transaction(spec.name, 'readonly');
  const store = readTx.objectStore(spec.name);
  const [records, keys] = await Promise.all([waitRequest(store.getAll()), waitRequest(store.getAllKeys())]);
  if (!records.length) return 0;

  const writeTx = to.transaction(spec.name, 'readwrite');
  const target = writeTx.objectStore(spec.name);
  records.forEach((record, index) => {
    // 行内键（如队列的自增 id）已经存在值里，显式传 key 会被 IndexedDB 拒绝
    if (spec.keyPath) target.put(record);
    else target.put(record, keys[index]);
  });
  await completion(writeTx);
  return records.length;
}

async function readStoreSpecs(db: IDBDatabase): Promise<StoreSpec[]> {
  const names = Array.from(db.objectStoreNames);
  if (!names.length) return [];
  const tx = db.transaction(names, 'readonly');
  return names.map((name) => {
    const store = tx.objectStore(name);
    return { name, keyPath: store.keyPath ?? null, autoIncrement: store.autoIncrement };
  });
}

function createStoreSpecs(specs: StoreSpec[]): (db: IDBDatabase) => void {
  return (db) => {
    for (const spec of specs) {
      if (db.objectStoreNames.contains(spec.name)) continue;
      db.createObjectStore(spec.name, { keyPath: spec.keyPath ?? undefined, autoIncrement: spec.autoIncrement });
    }
  };
}

function openDatabase(name: string, version: number, upgrade: (db: IDBDatabase) => void): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, version);
    request.onupgradeneeded = () => upgrade(request.result);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error(`打开数据库 ${name} 失败`));
  });
}

function waitRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB 读取失败'));
  });
}

function completion(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB 写入中断'));
  });
}

async function listDatabases(): Promise<Map<string, number>> {
  if (typeof indexedDB === 'undefined' || typeof indexedDB.databases !== 'function') return new Map();
  // databases() 是唯一「不创建就能探测」的入口，直接 open 会凭空建出空库
  const known = new Map<string, number>();
  for (const item of await indexedDB.databases()) {
    if (item.name && item.version) known.set(item.name, item.version);
  }
  return known;
}

async function loadState(): Promise<MigrationState> {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) return {};
  const got = await chrome.storage.local.get(MIGRATION_STATE_KEY);
  const raw = got[MIGRATION_STATE_KEY];
  return raw && typeof raw === 'object' ? raw as MigrationState : {};
}

async function saveState(state: MigrationState): Promise<void> {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) return;
  await chrome.storage.local.set({ [MIGRATION_STATE_KEY]: state });
}
