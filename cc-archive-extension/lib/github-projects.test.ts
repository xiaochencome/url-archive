import { beforeEach, describe, expect, test, vi } from 'vitest';
import {
  addGithubProject,
  GITHUB_PROJECTS_KEY,
  githubProjectFromRepo,
  githubProjectId,
  loadGithubProjects,
  normalizeGithubProject,
  normalizeGithubProjects,
  removeGithubProject,
  saveGithubProjects,
  updateGithubProject,
} from './github-projects';
import type { GithubProject } from './github-projects';

let store: Record<string, unknown>;

beforeEach(() => {
  store = {};
  (globalThis as any).chrome = {
    storage: {
      local: {
        get: vi.fn(async (key: string) => ({ [key]: store[key] })),
        set: vi.fn(async (obj: Record<string, unknown>) => { Object.assign(store, obj); }),
      },
    },
  };
});

function repo(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    fullName: 'vuejs/core',
    owner: 'vuejs',
    name: 'core',
    description: 'Vue.js 核心库',
    url: 'https://github.com/vuejs/core',
    stars: 45000,
    forks: 8000,
    language: 'TypeScript',
    topics: ['vue', 'framework'],
    avatarUrl: 'https://avatars.githubusercontent.com/u/1',
    ...overrides,
  };
}

describe('githubProjectId', () => {
  test('由 fullName 小写派生并去除空白', () => {
    expect(githubProjectId('  VueJS/Core ')).toBe('vuejs/core');
    expect(githubProjectId('A/B')).toBe('a/b');
  });
});

describe('normalizeGithubProject', () => {
  test('归一化完整仓库', () => {
    const project = normalizeGithubProject(repo());
    expect(project).toEqual({
      id: 'vuejs/core',
      fullName: 'vuejs/core',
      owner: 'vuejs',
      name: 'core',
      description: 'Vue.js 核心库',
      url: 'https://github.com/vuejs/core',
      stars: 45000,
      forks: 8000,
      language: 'TypeScript',
      topics: ['vue', 'framework'],
      avatarUrl: 'https://avatars.githubusercontent.com/u/1',
      note: '',
      tags: [],
      savedAt: expect.any(String),
      starredByMe: false,
    });
  });

  test('缺少 url 时回退到规范仓库地址', () => {
    const project = normalizeGithubProject(repo({ url: undefined }));
    expect(project?.url).toBe('https://github.com/vuejs/core');
  });

  test('缺少 fullName 时可由 owner/name 推导', () => {
    const project = normalizeGithubProject(repo({ fullName: undefined }));
    expect(project?.fullName).toBe('vuejs/core');
    expect(project?.id).toBe('vuejs/core');
  });

  test('缺少 fullName 与 owner/name 时可由 url 推导', () => {
    const project = normalizeGithubProject({
      fullName: undefined,
      owner: undefined,
      name: undefined,
      url: 'https://github.com/vuejs/core',
    });
    expect(project?.fullName).toBe('vuejs/core');
    expect(project?.owner).toBe('vuejs');
    expect(project?.name).toBe('core');
  });

  test('完全没有可用标识时返回 null', () => {
    expect(normalizeGithubProject({})).toBeNull();
    expect(normalizeGithubProject({ url: 'not-a-url' })).toBeNull();
    expect(normalizeGithubProject(null)).toBeNull();
    expect(normalizeGithubProject('vuejs/core')).toBeNull();
    expect(normalizeGithubProject([])).toBeNull();
  });

  test('非 github 地址无法推导 fullName 时返回 null', () => {
    expect(normalizeGithubProject({ url: 'https://gitlab.com/a/b' })).toBeNull();
  });

  test('数字走安全非负整数：负数、小数、NaN、字符串', () => {
    const project = normalizeGithubProject(repo({
      stars: -5,
      forks: 3.9,
    }));
    expect(project?.stars).toBe(0);
    expect(project?.forks).toBe(3);

    expect(normalizeGithubProject(repo({ stars: Number.NaN }))?.stars).toBe(0);
    expect(normalizeGithubProject(repo({ stars: '12' }))?.stars).toBe(12);
    expect(normalizeGithubProject(repo({ stars: 'x' }))?.stars).toBe(0);
    expect(normalizeGithubProject(repo({ stars: Number.POSITIVE_INFINITY }))?.stars).toBe(0);
  });

  test('字符串字段 trim，topics 去重去空并忽略大小写', () => {
    const project = normalizeGithubProject(repo({
      description: '  说明  ',
      language: ' Go ',
      topics: [' Vue ', 'vue', '', '  ', 'Framework', 'framework', 42, null],
    }));
    expect(project?.description).toBe('说明');
    expect(project?.language).toBe('Go');
    expect(project?.topics).toEqual(['Vue', 'Framework']);
  });

  test('保留用户备注/标签/标星，标签去重', () => {
    const project = normalizeGithubProject(repo({
      note: '  待读  ',
      tags: ['前端', '前端', ' '],
      starredByMe: true,
    }));
    expect(project?.note).toBe('待读');
    expect(project?.tags).toEqual(['前端']);
    expect(project?.starredByMe).toBe(true);
  });

  test('starredByMe 仅 true 视为真，保留合法 savedAt', () => {
    expect(normalizeGithubProject(repo({ starredByMe: 'yes' }))?.starredByMe).toBe(false);
    expect(normalizeGithubProject(repo({ starredByMe: 1 }))?.starredByMe).toBe(false);
    expect(normalizeGithubProject(repo({ savedAt: '2026-01-02T03:04:05.000Z' }))?.savedAt)
      .toBe('2026-01-02T03:04:05.000Z');
  });

  test('fullName 缺 owner 段时用 url 补全', () => {
    const project = normalizeGithubProject({ fullName: 'core', url: 'https://github.com/vuejs/core' });
    expect(project?.fullName).toBe('vuejs/core');
  });
});

describe('normalizeGithubProjects', () => {
  test('非数组返回空数组', () => {
    expect(normalizeGithubProjects(null)).toEqual([]);
    expect(normalizeGithubProjects({})).toEqual([]);
    expect(normalizeGithubProjects('x')).toEqual([]);
  });

  test('丢弃畸形项', () => {
    const list = normalizeGithubProjects([repo(), null, 'x', {}, 42]);
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe('vuejs/core');
  });

  test('按 id 去重且先出现者优先', () => {
    const list = normalizeGithubProjects([
      repo({ description: '第一份' }),
      repo({ fullName: 'VueJS/Core', description: '第二份' }),
    ]);
    expect(list).toHaveLength(1);
    expect(list[0].description).toBe('第一份');
  });
});

describe('githubProjectFromRepo', () => {
  test('把趋势仓库结构适配成项目', () => {
    const project = githubProjectFromRepo({
      fullName: 'denoland/deno',
      owner: 'denoland',
      name: 'deno',
      description: '运行时',
      url: 'https://github.com/denoland/deno',
      stars: 90000,
      forks: 5000,
      language: 'Rust',
      topics: ['runtime'],
      avatarUrl: 'https://avatars.githubusercontent.com/u/2',
    });
    expect(project.id).toBe('denoland/deno');
    expect(project.note).toBe('');
    expect(project.starredByMe).toBe(false);
  });

  test('无法识别时抛错', () => {
    expect(() => githubProjectFromRepo({ fullName: '' })).toThrow();
  });
});

describe('storage 读写', () => {
  test('无数据时加载为空数组', async () => {
    await expect(loadGithubProjects()).resolves.toEqual([]);
  });

  test('保存时归一化并按 id 去重', async () => {
    const saved = await saveGithubProjects([
      normalizeGithubProject(repo())!,
      normalizeGithubProject(repo({ description: '重复' }))!,
    ]);
    expect(saved).toHaveLength(1);
    expect(store[GITHUB_PROJECTS_KEY]).toEqual(saved);
  });

  test('loadGithubProjects 对畸形存储载荷保持防御', async () => {
    store[GITHUB_PROJECTS_KEY] = 'not-an-array';
    await expect(loadGithubProjects()).resolves.toEqual([]);

    store[GITHUB_PROJECTS_KEY] = [null, { fullName: 'a/b' }];
    const list = await loadGithubProjects();
    expect(list).toHaveLength(1);
    expect(list[0].url).toBe('https://github.com/a/b');
  });
});

describe('addGithubProject', () => {
  test('新增后置顶，重复添加返回已有项且 added=false', async () => {
    const first = await addGithubProject(repo({ fullName: 'vuejs/core' }));
    expect(first.added).toBe(true);

    const second = await addGithubProject(repo({ fullName: 'VueJS/Core', description: '改名' }));
    expect(second.added).toBe(false);
    expect(second.project.id).toBe('vuejs/core');
    expect(second.project.description).toBe('Vue.js 核心库');

    const list = await loadGithubProjects();
    expect(list).toHaveLength(1);
  });

  test('不同仓库依次前插', async () => {
    await addGithubProject(repo({ fullName: 'a/one' }));
    await addGithubProject(repo({ fullName: 'b/two' }));
    const list = await loadGithubProjects();
    expect(list.map((item) => item.fullName)).toEqual(['b/two', 'a/one']);
  });

  test('无法识别的输入抛错且不写存储', async () => {
    await expect(addGithubProject({ fullName: '' })).rejects.toThrow();
    expect(store[GITHUB_PROJECTS_KEY]).toBeUndefined();
  });
});

describe('updateGithubProject', () => {
  test('更新备注、标签、标星', async () => {
    await addGithubProject(repo());
    const updated = await updateGithubProject('vuejs/core', {
      note: '  读源码  ',
      tags: ['前端', '前端', '框架'],
      starredByMe: true,
    });
    expect(updated?.note).toBe('读源码');
    expect(updated?.tags).toEqual(['前端', '框架']);
    expect(updated?.starredByMe).toBe(true);

    const list = await loadGithubProjects();
    expect(list[0]).toEqual(updated);
  });

  test('未提供的字段保持原值', async () => {
    await addGithubProject(repo());
    await updateGithubProject('vuejs/core', { note: '保留' });
    const updated = await updateGithubProject('vuejs/core', { starredByMe: true });
    expect(updated?.note).toBe('保留');
    expect(updated?.starredByMe).toBe(true);
  });

  test('id 不存在返回 null', async () => {
    await expect(updateGithubProject('nope/nope', { note: 'x' })).resolves.toBeNull();
  });
});

describe('removeGithubProject', () => {
  test('删除已存在项返回 true', async () => {
    await addGithubProject(repo());
    await expect(removeGithubProject('vuejs/core')).resolves.toBe(true);
    await expect(loadGithubProjects()).resolves.toEqual([]);
  });

  test('删除不存在项返回 false', async () => {
    await addGithubProject(repo());
    await expect(removeGithubProject('nope/nope')).resolves.toBe(false);
    await expect(loadGithubProjects()).resolves.toHaveLength(1);
  });
});

describe('无 chrome 环境降级', () => {
  test('缺少 chrome 时读写不抛错', async () => {
    const original = (globalThis as any).chrome;
    delete (globalThis as any).chrome;
    try {
      await expect(loadGithubProjects()).resolves.toEqual([]);
      const list = await saveGithubProjects([normalizeGithubProject(repo())!]);
      expect(list).toHaveLength(1);
      await expect(addGithubProject(repo())).resolves.toMatchObject({ added: true });
    } finally {
      (globalThis as any).chrome = original;
    }
  });
});

describe('GithubProject 类型', () => {
  test('导出键名稳定', () => {
    expect(GITHUB_PROJECTS_KEY).toBe('github_projects');
  });

  test('归一化结果满足接口', () => {
    const project: GithubProject = normalizeGithubProject(repo())!;
    expect(typeof project.id).toBe('string');
  });
});
