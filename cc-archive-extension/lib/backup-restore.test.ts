import { describe, expect, test } from 'vitest';
import {
  MAX_FOLDER_DEPTH,
  folderSegments,
  formatRestoreSummary,
  groupByFolder,
  normalizeUrlKey,
  parseBackup,
  planRestore,
} from './backup-restore';
import type { BackupEntry, RestoreCandidate, RestorePlan } from './backup-restore';

/** 造一条备份原始记录（保留 id/guid/date_added，验证这些旧字段被忽略也不报错） */
function rawEntry(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: '5',
    guid: '9814f98c-0000-0000-0000-000000000000',
    title: 'Moreau Catholic High School Mail',
    url: 'https://mail.google.com/mail/u/0/#inbox',
    folder: 'Bookmarks Bar/已导入/个人收藏',
    date_added: '13382050624852737',
    ...overrides,
  };
}

/** 造一条已解析的备份条目 */
function entry(overrides: Partial<BackupEntry> = {}): BackupEntry {
  return { title: '标题', url: 'https://example.com/a', folder: '', ...overrides };
}

/** 造一条恢复候选 */
function candidate(overrides: Partial<RestoreCandidate> = {}): RestoreCandidate {
  const url = overrides.url ?? 'https://example.com/a';
  return {
    title: '标题',
    url,
    folder: '',
    key: normalizeUrlKey(url),
    path: [],
    ...overrides,
  };
}

/** 手工拼 RestorePlan（用于只关心 summary 的用例） */
function plan(overrides: Partial<RestorePlan['summary']> = {}): RestorePlan {
  const summary = { backupTotal: 0, missing: 0, existing: 0, invalid: 0, ...overrides };
  return { missing: [], existing: [], invalid: summary.invalid, summary };
}

describe('normalizeUrlKey', () => {
  test('去掉 hash 片段', () => {
    expect(normalizeUrlKey('https://example.com/a#section')).toBe('https://example.com/a');
    expect(normalizeUrlKey('https://mail.google.com/mail/u/0/#inbox')).toBe('https://mail.google.com/mail/u/0');
  });

  test('去掉追踪参数但保留有意义的参数', () => {
    expect(normalizeUrlKey('https://example.com/a?utm_source=x&utm_medium=y&id=3'))
      .toBe('https://example.com/a?id=3');
    expect(normalizeUrlKey('https://example.com/a?fbclid=1&gclid=2&ref=x&spm=a.b&from=y&source=z&q=keep'))
      .toBe('https://example.com/a?q=keep');
  });

  test('去掉末尾斜杠并统一小写', () => {
    expect(normalizeUrlKey('https://example.com/a/')).toBe('https://example.com/a');
    expect(normalizeUrlKey('https://example.com/a///')).toBe('https://example.com/a');
    expect(normalizeUrlKey('HTTPS://Example.COM/Path/')).toBe('https://example.com/path');
  });

  test('去掉默认端口但保留非默认端口', () => {
    expect(normalizeUrlKey('https://example.com:443/a')).toBe('https://example.com/a');
    expect(normalizeUrlKey('http://example.com:80/a')).toBe('http://example.com/a');
    expect(normalizeUrlKey('http://localhost:3000/a')).toBe('http://localhost:3000/a');
  });

  test('只删真正的追踪参数，同前缀的合法参数（refresh/fromage/sources）保留', () => {
    // ref / from 是精确名匹配；refresh 撞 ref、fromage 撞 from 属于误伤，必须保留
    expect(normalizeUrlKey('https://example.com/a?refresh=1&fromage=2&sources=keep'))
      .toBe('https://example.com/a?refresh=1&fromage=2&sources=keep');
  });

  test('非法输入返回安全回退值且绝不抛错', () => {
    expect(normalizeUrlKey('not a url')).toBe('not a url');
    expect(normalizeUrlKey('  Not A URL  ')).toBe('not a url');
    expect(normalizeUrlKey('example.com')).toBe('example.com');
    expect(normalizeUrlKey('')).toBe('');
    // 类型系统之外的值（JS 调用方）也不能炸
    expect(normalizeUrlKey(undefined as unknown as string)).toBe('');
    expect(normalizeUrlKey(null as unknown as string)).toBe('');
  });
});

describe('parseBackup', () => {
  test('解析真实备份数组结构，忽略旧 id/guid，保留 date_added', () => {
    const { entries, invalid } = parseBackup([rawEntry()]);

    expect(invalid).toBe(0);
    expect(entries).toEqual([{
      title: 'Moreau Catholic High School Mail',
      url: 'https://mail.google.com/mail/u/0/#inbox',
      folder: 'Bookmarks Bar/已导入/个人收藏',
      dateAdded: '13382050624852737',
    }]);
    // 旧 id / guid 不该出现在结果里
    expect(Object.keys(entries[0])).not.toContain('id');
    expect(Object.keys(entries[0])).not.toContain('guid');
  });

  test('兼容 { bookmarks: [...] } 包装', () => {
    const { entries, invalid } = parseBackup({ bookmarks: [rawEntry(), rawEntry({ url: 'https://b.example/2' })] });

    expect(invalid).toBe(0);
    expect(entries.map((item) => item.url)).toEqual([
      'https://mail.google.com/mail/u/0/#inbox',
      'https://b.example/2',
    ]);
  });

  test('丢掉无 url 与非 http(s) 的条目', () => {
    const { entries, invalid } = parseBackup([
      rawEntry(),
      rawEntry({ url: undefined }),
      rawEntry({ url: '   ' }),
      rawEntry({ url: 'ftp://example.com/file' }),
      rawEntry({ url: 'chrome://bookmarks' }),
      rawEntry({ url: 'javascript:alert(1)' }),
      rawEntry({ url: 'not a url' }),
      'not-an-object',
      null,
    ]);

    expect(entries).toHaveLength(1);
    expect(entries[0].url).toBe('https://mail.google.com/mail/u/0/#inbox');
    expect(invalid).toBe(8);
  });

  test('按归一化 URL 去重，先出现的赢', () => {
    const { entries, invalid } = parseBackup([
      rawEntry({ title: '第一次' }),
      rawEntry({ title: '第二次', url: 'https://mail.google.com/mail/u/0/#inbox?utm_source=x' }),
      rawEntry({ title: '末尾斜杠', url: 'https://mail.google.com/mail/u/0/' }),
    ]);

    expect(entries).toHaveLength(1);
    expect(entries[0].title).toBe('第一次');
    expect(invalid).toBe(2);
  });

  test('trim 字符串字段，folder 缺省为空串', () => {
    const { entries } = parseBackup([
      { title: '  留白标题  ', url: '  https://example.com/a  ', folder: '  study  ' },
      { title: '无文件夹', url: 'https://example.com/b' },
    ]);

    expect(entries[0]).toEqual({
      title: '留白标题',
      url: 'https://example.com/a',
      folder: 'study',
    });
    expect(entries[1]).toEqual({ title: '无文件夹', url: 'https://example.com/b', folder: '' });
    // 没有 date_added 时不产出 dateAdded 键
    expect('dateAdded' in entries[1]).toBe(false);
  });

  test('垃圾输入返回空结果且不抛错', () => {
    for (const garbage of [null, undefined, 42, 'oops', {}, { bookmarks: 'no' }, []]) {
      expect(() => parseBackup(garbage)).not.toThrow();
      expect(parseBackup(garbage)).toEqual({ entries: [], invalid: 0 });
    }
  });
});

describe('planRestore', () => {
  test('按归一化 URL 区分 missing 与 existing', () => {
    const backup = [
      rawEntry({ title: '已存在', url: 'https://example.com/kept' }),
      rawEntry({ title: '要恢复', url: 'https://example.com/gone' }),
    ];

    const result = planRestore(backup, ['https://example.com/kept/']);

    expect(result.missing.map((item) => item.title)).toEqual(['要恢复']);
    expect(result.existing.map((item) => item.title)).toEqual(['已存在']);
    expect(result.summary).toEqual({ backupTotal: 2, missing: 1, existing: 1, invalid: 0 });
  });

  test('只差追踪参数的 URL 算作已存在（不会重复创建）', () => {
    const backup = [rawEntry({ url: 'https://example.com/a?utm_source=newsletter&id=1#top' })];

    const result = planRestore(backup, ['https://example.com/a?id=1']);

    expect(result.missing).toHaveLength(0);
    expect(result.existing).toHaveLength(1);
    expect(result.existing[0].key).toBe('https://example.com/a?id=1');
  });

  test('恢复候选带上归一化 key 与拆分后的 path', () => {
    const backup = [rawEntry({ folder: 'Bookmarks Bar/study' })];

    const [item] = planRestore(backup, []).missing;

    expect(item.key).toBe('https://mail.google.com/mail/u/0');
    expect(item.path).toEqual(['Bookmarks Bar', 'study']);
    expect(item.dateAdded).toBe('13382050624852737');
  });

  test('空备份 → 全零', () => {
    const result = planRestore([], ['https://example.com/a']);

    expect(result.missing).toEqual([]);
    expect(result.existing).toEqual([]);
    expect(result.summary).toEqual({ backupTotal: 0, missing: 0, existing: 0, invalid: 0 });
  });

  test('当前书签为空 → 全部 missing', () => {
    const result = planRestore([rawEntry(), rawEntry({ url: 'https://b.example/2' })], []);

    expect(result.missing).toHaveLength(2);
    expect(result.existing).toHaveLength(0);
    expect(result.summary.missing).toBe(2);
  });

  test('当前书签 URL 非法/为空时不参与比对', () => {
    const result = planRestore([rawEntry()], ['', '   ', 'not a url']);

    expect(result.missing).toHaveLength(1);
    expect(result.existing).toHaveLength(0);
  });

  test('无效条目计入 invalid，同时保留原始备份总数', () => {
    const result = planRestore([rawEntry(), rawEntry({ url: 'ftp://x.example' })], []);

    expect(result.summary).toEqual({ backupTotal: 2, missing: 1, existing: 0, invalid: 1 });
  });
});

describe('folderSegments', () => {
  test('多级路径按 / 拆开', () => {
    expect(folderSegments('Bookmarks Bar/已导入/个人收藏')).toEqual(['Bookmarks Bar', '已导入', '个人收藏']);
    expect(folderSegments('study')).toEqual(['study']);
  });

  test('空串与纯斜杠返回空数组', () => {
    expect(folderSegments('')).toEqual([]);
    expect(folderSegments('/')).toEqual([]);
    expect(folderSegments('///')).toEqual([]);
  });

  test('去掉首尾斜杠、重复斜杠与空白段', () => {
    expect(folderSegments('/a/b/')).toEqual(['a', 'b']);
    expect(folderSegments('a//b///c')).toEqual(['a', 'b', 'c']);
    expect(folderSegments('  a  /  b  ')).toEqual(['a', 'b']);
    expect(folderSegments('a/   /b')).toEqual(['a', 'b']);
  });

  test('层级截断到 MAX_FOLDER_DEPTH', () => {
    const deep = Array.from({ length: MAX_FOLDER_DEPTH + 5 }, (_, index) => `f${index}`).join('/');

    const segments = folderSegments(deep);

    expect(MAX_FOLDER_DEPTH).toBe(8);
    expect(segments).toHaveLength(MAX_FOLDER_DEPTH);
    expect(segments[0]).toBe('f0');
    expect(segments.at(-1)).toBe('f7');
  });
});

describe('groupByFolder', () => {
  test('按文件夹分组', () => {
    const groups = groupByFolder([
      candidate({ title: 'a', folder: 'study' }),
      candidate({ title: 'b', url: 'https://example.com/b', folder: 'study' }),
      candidate({ title: 'c', url: 'https://example.com/c', folder: 'work' }),
    ]);

    expect(groups.map((group) => group.folder)).toEqual(['study', 'work']);
    expect(groups[0].items.map((item) => item.title)).toEqual(['a', 'b']);
    expect(groups[1].items).toHaveLength(1);
  });

  test('按 localeCompare("zh") 排序，空文件夹排最后', () => {
    const groups = groupByFolder([
      candidate({ title: 'root', folder: '' }),
      candidate({ title: '中文', url: 'https://example.com/z', folder: '工作' }),
      candidate({ title: 'english', url: 'https://example.com/e', folder: 'study' }),
    ]);

    const folders = groups.map((group) => group.folder);
    // 空文件夹排最后；其余按 zh 排序（「工作」的拼音 gongzuo 排在 study 之前）
    expect(folders).toEqual(['工作', 'study', '']);
    expect(folders.at(-1)).toBe('');
  });

  test('分组名归一化（去多余斜杠/空白），同组归并', () => {
    const groups = groupByFolder([
      candidate({ title: 'a', folder: '/study/' }),
      candidate({ title: 'b', url: 'https://example.com/b', folder: ' study ' }),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0].folder).toBe('study');
    expect(groups[0].items).toHaveLength(2);
  });

  test('空输入返回空数组', () => {
    expect(groupByFolder([])).toEqual([]);
  });
});

describe('formatRestoreSummary', () => {
  test('有可恢复项时包含各数字', () => {
    const text = formatRestoreSummary(plan({ backupTotal: 151, missing: 114, existing: 37 }));

    expect(text).toContain('151');
    expect(text).toContain('114');
    expect(text).toContain('可恢复');
  });

  test('全部已存在时说明无需恢复', () => {
    const text = formatRestoreSummary(plan({ backupTotal: 12, missing: 0, existing: 12 }));

    expect(text).toContain('12');
    expect(text).toContain('无需恢复');
  });

  test('空备份不产生别扭语法', () => {
    const text = formatRestoreSummary(plan());

    expect(text).toBe('备份为空，没有可恢复的书签。');
    expect(text).not.toContain('0 条已不在');
  });

  test('只有无效条目时明确说明', () => {
    const text = formatRestoreSummary(plan({ backupTotal: 3, missing: 0, existing: 0, invalid: 3 }));

    expect(text).toContain('3');
    expect(text).toContain('没有可恢复的有效书签');
  });
});
