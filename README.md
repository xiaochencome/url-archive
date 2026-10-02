# CC Archive

把网页剪藏进你自己的 Obsidian，并让收藏「活过来」：正文快照 + AI 摘要标签 + 语义搜索 + 沉睡回访。

所有 AI 调用走 **BYOK（自带 API Key）**，笔记只写进**你自己的 vault**，本仓库不运营任何服务器，也没有遥测。

## 组成

| 目录 | 说明 |
|------|------|
| `cc-archive-extension/` | Chrome / Edge 扩展（MV3）：一键剪藏、接管新标签页为收藏工作台 |
| `cc-archive-obsidian-plugin/` | Obsidian 插件：关键词/语义搜索、问答、沉睡回访，并内置本机剪藏服务 |
| `native-host/` | 可选的 Native Messaging host，让扩展能执行本机命令 |

## 功能

- **正文快照**：剪藏时把正文转成 Markdown 一起存进 vault，原链接失效也不丢内容。
- **AI 富化**：自动生成摘要、标签、关键词与「回访场景」，兼容任意 OpenAI Chat Completions 格式端点。
- **双写入通道**：官方插件的本机服务（推荐）或 Obsidian Local REST API，设置里切换。
- **绝不丢剪藏**：Obsidian 未开启时进本机离线队列，恢复后自动补写。
- **语义搜索与问答**：基于向量的模糊检索，可以直接对收藏库提问。
- **沉睡回访**：把久未打开的收藏定期重新端上来。
- **新标签页工作台**：视觉书签墙、内网/自建服务识别、书签分组面板，面板可拖拽排序、拉伸高度、三种布局模式。

## 安装

### 浏览器扩展

```bash
cd cc-archive-extension
npm install
npm run build          # 产物在 .output/chrome-mv3/
```

打开 `chrome://extensions`（或 `edge://extensions`），开启右上角「开发者模式」，点「加载已解压的扩展程序」，选择 `.output/chrome-mv3/` 目录。

### Obsidian 插件

```bash
cd cc-archive-obsidian-plugin
npm install
npm run build
```

把 `main.js`、`manifest.json`、`styles.css` 放进 vault 的 `.obsidian/plugins/cc-archive/`，然后在 Obsidian「设置 → 第三方插件」里启用。

### 打通两端

1. 启用插件后，在插件设置里打开「浏览器剪藏服务」，复制地址与 Token（服务只监听 `127.0.0.1`）。
2. 扩展设置 → 写入通道选「CC Archive 官方插件」，填入上面的地址与 Token。
3. 扩展设置 → AI 里填入你自己的端点与 Key。

### 可选：本机启动器

需要扩展执行本机命令时，安装 Native Messaging host：

```bash
cd native-host
./install.sh <扩展 ID>     # 扩展 ID 在 chrome://extensions 加载扩展后可见
```

## 从改名前的版本升级 / Upgrading from the pre-rename build

- 剪藏配图与离线队列会自动迁移：首次打开新标签页时，旧库 `url-archive-images` / `url-archive-queue` 的记录被复制进 `cc-archive-*`，旧库保留不动，随时可回滚。
  *Clip images and the offline queue migrate on first load: records are copied out of `url-archive-images` / `url-archive-queue` into `cc-archive-*`; the old databases are kept for rollback.*
- 旧版内置背景视频已随素材一起移除，偏好里残留的 `/wallpaper/*.mp4` 会自动回落到静态壁纸。
  *The bundled background video no longer ships; a leftover `/wallpaper/*.mp4` preference falls back to the static wallpaper.*
- Obsidian 插件会读一次 `.obsidian/plugins/url-archive/data.json` 并写入新目录，剪藏 Token 与语义索引不用重新配置。
  *The Obsidian plugin reads `.obsidian/plugins/url-archive/data.json` once and persists it under the new id, so the clip token and semantic index survive.*
- 默认笔记目录名从 `URL Archive` 变成 `CC Archive`。已有笔记不会被搬动：请把旧目录改名，或在扩展设置里把根目录填回原名。
  *The default vault folder is now `CC Archive`; existing notes are never moved — rename the folder or set it back in settings.*
- 本机启动器的 host 名称也改了，需要重新注册一次：`./native-host/install.sh <扩展 ID>`。
  *The native messaging host was renamed too — re-register it once with `./native-host/install.sh <extension id>`.*

## 从源码开发

- `npm run dev` 启动 WXT 开发模式；`npm run compile` 类型检查；`npm test` 跑单元测试。
- 扩展的构建产物目录（`.output/`）、依赖（`node_modules/`）都不入库。

## 隐私

- 数据只存在你的浏览器和本机：收藏索引、设置、图片缓存都在扩展自己的存储里。
- 页面正文只在剪藏时发往**你配置的** LLM 与 Obsidian 端点。
- 站点图标用浏览器本机的 `_favicon` 缓存渲染，不会把访问过的域名发给第三方。
- 没有账号、没有服务器、没有遥测、不出售或共享数据。详见 [PRIVACY.md](PRIVACY.md)。

## 第三方素材说明

- `public/font/` 内为随扩展分发的开源中文字体，各自遵循其原始许可证，商用/再分发前请核对对应许可证要求。
- `public/engine/` 内为搜索引擎站点的图标，仅用于在设置里标识可选的默认搜索引擎，不构成背书。
- 扩展不内嵌任何图片/视频版权素材，默认壁纸为仓库自行生成的渐变图。

## 许可 / License

MIT，版权持有人 cc（本项目唯一的作者与维护者）。见 [LICENSE](LICENSE)：中英双语，以英文原文为准。

*MIT licensed, Copyright (c) 2026 cc — the project's sole author and maintainer. See [LICENSE](LICENSE) (Chinese + English; the English text governs).*
