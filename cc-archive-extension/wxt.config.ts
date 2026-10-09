import { defineConfig } from 'wxt';

// See https://wxt.dev/api/config.html
export default defineConfig({
  outDir: process.env.CC_ARCHIVE_WXT_OUT_DIR ?? '.output',
  vite: () => ({
    build: {
      modulePreload: false,
    },
  }),
  hooks: {
    // content.ts 使用 registration: 'runtime'，没有任何 manifest 注册的内容脚本；
    // 但 WXT 仍会在 manifest 中留一个空的 content_scripts: []（无内容脚本注册时的占位符，
    // 对浏览器无实际影响）。这里在生成后剔除该空数组，使 manifest 不含 content_scripts 段。
    'build:manifestGenerated': (_wxt, manifest) => {
      if (Array.isArray(manifest.content_scripts) && manifest.content_scripts.length === 0) {
        delete manifest.content_scripts;
      }
    },
  },
  manifest: {
    name: 'CC Archive',
    description: '一键把网页剪藏进 Obsidian，AI 自动摘要与标签。',
    // tabs：用于读取新建标签页的 URL，从而在「关闭新标签页接管」时把它重定向到主页
    // alarms：Obsidian 恢复后定时把离线队列补写进 vault（只靠 worker 启动时 flush 不够）
    permissions: [
      'activeTab', 'scripting', 'storage', 'bookmarks', 'favicon', 'tabs',
      // 启动器需要调用本机进程（Native Messaging host）才能执行本地命令
      'nativeMessaging',
      'alarms',
    ],
    // GitHub 趋势小组件需要读取 api.github.com（窄域，仅此一个）
    host_permissions: ['https://api.github.com/*'],
    optional_host_permissions: ['http://*/*', 'https://*/*'],
    action: { default_title: '剪藏到 Obsidian' },
    chrome_url_overrides: {
      newtab: 'newtab.html',
    },
  },
});
