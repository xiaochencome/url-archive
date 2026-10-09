import { describe, expect, test } from 'vitest';
import { buildRagContext } from './rag';
import type { SemanticSearchHit } from './semantic-index';
import type { CcArchiveEntry } from './archive-index';

function hit(path: string, score: number): SemanticSearchHit {
  const entry: CcArchiveEntry = {
    path,
    url: 'https://example.com',
    title: '标题',
    domain: 'example.com',
    clipped: '2026-07-02',
    summary: '摘要',
    tags: ['标签'],
    keywords: ['关键词'],
    aliases: ['别名'],
    intent: '回访场景',
    why: '备注',
    status: 'unread',
    revived: 0,
    lastVisited: '',
  };
  return { entry, score };
}

describe('rag', () => {
  test('builds prompt with source links and source metadata', () => {
    const context = buildRagContext('我想找财务工具', [hit('CC Archive/a.md', 0.9)]);

    expect(context.prompt).toContain('我想找财务工具');
    expect(context.prompt).toContain('[[CC Archive/a.md]]');
    expect(context.prompt).toContain('只根据给定收藏来源回答');
    expect(context.sources[0]).toMatchObject({ path: 'CC Archive/a.md', score: 0.9 });
  });
});
