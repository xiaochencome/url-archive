import { describe, expect, test } from 'vitest';
import { clipsFromBookmarkTree, formatFolderDisplay, parseFolderSegments } from './bookmarks';

describe('bookmarks', () => {
  test('把浏览器书签树转换为本地收藏索引', () => {
    const clips = clipsFromBookmarkTree([
      {
        title: '根',
        children: [
          {
            title: '工作',
            children: [
              {
                title: '纷析云',
                url: 'https://f3.fenxi365.com/',
                dateAdded: Date.parse('2026-07-01T00:00:00.000Z'),
                dateLastUsed: Date.parse('2026-07-02T08:30:00.000Z'),
              },
            ],
          },
        ],
      },
    ], '2026-07-03T00:00:00.000Z');

    expect(clips).toHaveLength(1);
    expect(clips[0]).toMatchObject({
      title: '纷析云',
      domain: 'f3.fenxi365.com',
      source: 'bookmark',
      folder: '根 / 工作',
      faviconUrl: '',
      tags: ['浏览器书签', '根', '工作'],
      keywords: ['根', '工作'],
      clipped: '2026-07-01T00:00:00.000Z',
      lastVisited: '2026-07-02T08:30:00.000Z',
    });
  });

  test('忽略非网页协议书签', () => {
    const clips = clipsFromBookmarkTree([
      { title: 'Chrome 设置', url: 'chrome://settings' },
      { title: '本地文件', url: 'file:///tmp/a.html' },
      { title: '网页', url: 'https://example.com' },
    ]);

    expect(clips).toHaveLength(1);
    expect(clips[0].url).toBe('https://example.com/');
  });
});

describe('parseFolderSegments', () => {
  test('剥掉开头的书签栏根节点（中英文都算）', () => {
    expect(parseFolderSegments('书签栏/dev')).toEqual(['dev']);
    expect(parseFolderSegments('Bookmarks Bar/study')).toEqual(['study']);
    expect(parseFolderSegments('其它书签/tmp')).toEqual(['tmp']);
  });

  test('「 / 」显示格式与「/」路径格式解析结果一致', () => {
    expect(parseFolderSegments('书签栏 / 工作 / dev')).toEqual(['工作', 'dev']);
    expect(parseFolderSegments('书签栏/工作/dev')).toEqual(['工作', 'dev']);
  });

  test('当前语言的真实书签栏标题也算根节点', () => {
    expect(parseFolderSegments('我的书签栏/dev', '我的书签栏')).toEqual(['dev']);
  });

  test('只剥开头的根名，中间/末尾出现的同名文件夹保留', () => {
    expect(parseFolderSegments('dev/书签栏')).toEqual(['dev', '书签栏']);
    expect(parseFolderSegments('工作/书签栏/dev')).toEqual(['工作', '书签栏', 'dev']);
  });

  test('空串、纯根名、多余斜杠与空白都归一成空数组', () => {
    expect(parseFolderSegments('')).toEqual([]);
    expect(parseFolderSegments('   ')).toEqual([]);
    expect(parseFolderSegments('书签栏')).toEqual([]);
    expect(parseFolderSegments('书签栏//书签栏/ / ')).toEqual([]);
    expect(parseFolderSegments('  /  /dev / ')).toEqual(['dev']);
  });

  test('大小写不影响根名判定', () => {
    expect(parseFolderSegments('BOOKMARKS BAR/study')).toEqual(['study']);
  });
});

describe('formatFolderDisplay', () => {
  test('用「 / 」拼接，和看板里其它分组路径同一套约定', () => {
    expect(formatFolderDisplay('书签栏', ['工作', 'dev'])).toBe('书签栏 / 工作 / dev');
  });

  test('书签栏取不到名字时不留下前导分隔符', () => {
    expect(formatFolderDisplay('', ['dev'])).toBe('dev');
  });

  test('解析 + 拼接后不会再出现 /书签栏/... 这种双根路径（新书签找不到的根因）', () => {
    expect(formatFolderDisplay('书签栏', parseFolderSegments('书签栏/dev', '书签栏'))).toBe('书签栏 / dev');
    expect(formatFolderDisplay('书签栏', parseFolderSegments('dev'))).toBe('书签栏 / dev');
  });

  test('空段列表只剩根名', () => {
    expect(formatFolderDisplay('书签栏', [])).toBe('书签栏');
  });
});
