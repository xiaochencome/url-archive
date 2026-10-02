import {
  App,
  type FuzzyMatch,
  FuzzySuggestModal,
  ItemView,
  Modal,
  Notice,
  Platform,
  Plugin,
  PluginSettingTab,
  Setting,
  TFile,
  TFolder,
  WorkspaceLeaf,
  addIcon,
  normalizePath,
  parseYaml,
  setIcon,
} from 'obsidian';
import { ClipServer } from './clip-server';
import {
  entryFromFrontmatter,
  extractFrontmatterBlock,
  pickDormantEntry,
  searchArchive,
  type ArchiveFrontmatter,
  type CcArchiveEntry,
} from './archive-index';
import { createChatAnswer } from './chat-provider';
import { createEmbedding } from './embedding-provider';
import { enrichNoteContent } from './enrich';
import { applySummaryHighlights, extractBodySnapshot } from './note-body';
import { buildRagContext, type RagSource } from './rag';
import { buildCurrentNoteQuery, relatedHitsForCurrentNote } from './related';
import { getDormantEntries, renderDormantReviewMarkdown } from './revival';
import {
  buildEmbeddingText,
  hashEmbeddingText,
  planSemanticIndex,
  removeVectorForPath,
  renameVectorPath,
  searchSemanticIndex,
  type SemanticSearchHit,
  type SemanticVector,
} from './semantic-index';
import ccIconSvg from '../assets/cc-mark.svg';

interface CcArchivePluginSettings {
  archiveFolder: string;
  embeddingBaseUrl: string;
  embeddingApiKey: string;
  embeddingModel: string;
  chatBaseUrl: string;
  chatApiKey: string;
  chatModel: string;
  reviewFolder: string;
  dormantDays: number;
  reviewLimit: number;
  clipServerEnabled: boolean;
  clipServerPort: number;
  clipServerToken: string;
  /** 一次性配对码：用户在扩展里输入它来换取 Token（默认空，点击生成） */
  pairingCode: string;
}

const DEFAULT_SETTINGS: CcArchivePluginSettings = {
  archiveFolder: 'CC Archive',
  embeddingBaseUrl: 'https://open.bigmodel.cn/api/paas/v4',
  embeddingApiKey: '',
  embeddingModel: 'embedding-3',
  chatBaseUrl: 'https://open.bigmodel.cn/api/paas/v4',
  chatApiKey: '',
  chatModel: 'glm-5.2',
  reviewFolder: 'CC Archive Reviews',
  dormantDays: 14,
  reviewLimit: 5,
  clipServerEnabled: true,
  clipServerPort: 27125,
  clipServerToken: '',
  pairingCode: '',
};

const CC_ARCHIVE_VIEW_TYPE = 'cc-archive-panel';
const CC_ICON_ID = 'cc-archive';

interface CcArchivePluginData {
  settings?: Partial<CcArchivePluginSettings>;
  semanticVectors?: SemanticVector[];
}

export default class CcArchivePlugin extends Plugin {
  settings: CcArchivePluginSettings = DEFAULT_SETTINGS;
  private entries: CcArchiveEntry[] = [];
  private semanticVectors: SemanticVector[] = [];
  private clipServer: ClipServer | null = null;
  private statusBarEl: HTMLElement | null = null;

  async onload() {
    await this.loadSettings();
    await this.rebuildIndex();
    await this.startClipServer();
    addIcon(CC_ICON_ID, getSvgBody(ccIconSvg));
    this.registerView(CC_ARCHIVE_VIEW_TYPE, (leaf) => new CcArchivePanelView(leaf, this));
    this.addRibbonIcon(CC_ICON_ID, '打开 CC Archive 面板', () => {
      this.activatePanel();
    });

    this.addCommand({
      id: 'rebuild-cc-archive-index',
      name: '重建 CC Archive 索引',
      callback: async () => {
        await this.rebuildIndex();
        new Notice(`CC Archive 已索引 ${this.entries.length} 条收藏`);
      },
    });

    this.addCommand({
      id: 'search-cc-archive',
      name: '搜索 CC Archive',
      callback: () => {
        this.openKeywordSearch();
      },
    });

    this.addCommand({
      id: 'rebuild-cc-archive-semantic-index',
      name: '重建 CC Archive 语义索引',
      callback: async () => {
        await this.rebuildSemanticIndex();
      },
    });

    this.addCommand({
      id: 'semantic-search-cc-archive',
      name: '语义搜索 CC Archive',
      callback: () => {
        this.openSemanticSearch();
      },
    });

    this.addCommand({
      id: 'backfill-cc-archive-ai',
      name: '补全待处理的 AI 摘要',
      callback: async () => {
        await this.backfillPendingAi();
      },
    });

    this.addCommand({
      id: 'ask-cc-archive',
      name: '问答 CC Archive',
      callback: () => {
        this.openAskModal();
      },
    });

    this.addCommand({
      id: 'revive-cc-archive-clip',
      name: '回访一条沉睡收藏',
      callback: async () => {
        const entry = this.pickReviveEntry();
        if (!entry) {
          new Notice('没有找到 CC Archive 收藏');
          return;
        }
        await this.openEntry(entry);
      },
    });

    this.addCommand({
      id: 'create-cc-archive-dormant-review',
      name: '生成沉睡收藏回顾',
      callback: async () => {
        await this.createDormantReview();
      },
    });

    this.addCommand({
      id: 'suggest-related-cc-archive-clips',
      name: '为当前笔记推荐相关收藏',
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if (!file || file.extension !== 'md') return false;
        if (!checking) {
          this.suggestRelatedForCurrentNote(file).catch((error) => {
            new Notice(error instanceof Error ? error.message : String(error));
          });
        }
        return true;
      },
    });

    this.addCommand({
      id: 'cc-archive-generate-pairing-code',
      name: '生成浏览器扩展配对码',
      callback: async () => {
        this.settings.pairingCode = String(Math.floor(100000 + Math.random() * 900000));
        await this.saveSettings();
        await navigator.clipboard.writeText(this.settings.pairingCode).catch(() => {});
        new Notice(`配对码 ${this.settings.pairingCode} 已生成并复制，请在浏览器扩展里点「自动连接」`);
      },
    });

    this.addCommand({
      id: 'cc-archive-copy-token',
      name: '复制剪藏服务 Token',
      callback: async () => {
        if (!this.settings.clipServerToken) {
          new Notice('尚未生成 Token，请先启用剪藏服务');
          return;
        }
        await navigator.clipboard.writeText(this.settings.clipServerToken);
        new Notice('已复制剪藏服务 Token');
      },
    });

    this.addCommand({
      id: 'cc-archive-open-settings',
      name: '打开 CC Archive 设置',
      callback: () => {
        // 打开设置页并定位到本插件
        const setting = (this.app as unknown as { setting?: { open(): void; openTabById(id: string): void } }).setting;
        setting?.open();
        setting?.openTabById(this.manifest.id);
      },
    });

    this.addCommand({
      id: 'open-cc-archive-panel',
      name: '打开 CC Archive 面板',
      callback: () => {
        this.activatePanel();
      },
    });

    // 用 metadataCache 'changed'（frontmatter 解析完成后触发）而非 vault 'create'/'modify'，
    // 避免索引早于缓存导致新写入的笔记读不到 frontmatter 而漏索引。
    this.registerEvent(this.app.metadataCache.on('changed', async (file) => {
      await this.rebuildIndex();
      if (this.inArchiveFolder(file.path)) this.refreshPanelViews();
    }));
    // 删除/重命名收藏时同步清理语义向量，避免面板「语义向量」数字残留孤儿向量
    this.registerEvent(this.app.vault.on('delete', (file) => this.onFileDeleted(file.path)));
    this.registerEvent(this.app.vault.on('rename', (file, oldPath) => this.onFileRenamed(file.path, oldPath)));
    // 状态栏：一眼看到剪藏服务是否在跑、索引了多少条
    this.statusBarEl = this.addStatusBarItem();
    this.statusBarEl.addClass('cc-archive-status');
    this.statusBarEl.addEventListener('click', () => this.activatePanel());
    this.updateStatusBar();

    this.addSettingTab(new CcArchiveSettingTab(this.app, this));
  }

  /** 刷新状态栏文案；剪藏服务关闭时给出明确提示 */
  updateStatusBar(): void {
    if (!this.statusBarEl) return;
    const running = Boolean(this.clipServer);
    const count = this.entries.length;
    this.statusBarEl.setText(
      running ? `CC Archive · 剪藏服务已连接 · ${count} 条` : `CC Archive · 剪藏服务未启动 · ${count} 条`,
    );
    this.statusBarEl.toggleClass('is-offline', !running);
    this.statusBarEl.setAttribute('aria-label', running
      ? `剪藏服务运行中，已索引 ${count} 条收藏。点击打开面板。`
      : `剪藏服务未启动，浏览器扩展无法写入。点击打开面板。`);
  }

  async rebuildIndex() {
    const files = this.app.vault.getMarkdownFiles()
      .filter((file) => file.path.startsWith(`${this.settings.archiveFolder.replace(/\/+$/, '')}/`));
    const entries: CcArchiveEntry[] = [];

    for (const file of files) {
      const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter as ArchiveFrontmatter | undefined;
      if (!frontmatter) continue;
      const entry = entryFromFrontmatter(file.path, frontmatter);
      if (entry) entries.push(entry);
    }

    this.entries = entries.sort((a, b) => b.clipped.localeCompare(a.clipped));
    this.updateStatusBar();
  }

  /** 数据变化后刷新所有已打开的面板视图，使「已索引收藏 / 语义向量」等统计实时反映最新数据 */
  private refreshPanelViews(): void {
    for (const leaf of this.app.workspace.getLeavesOfType(CC_ARCHIVE_VIEW_TYPE)) {
      const view = leaf.view;
      if (view instanceof CcArchivePanelView) view.render();
    }
  }

  private inArchiveFolder(path: string): boolean {
    return path.startsWith(`${this.settings.archiveFolder.replace(/\/+$/, '')}/`);
  }

  /** 删除笔记：同步移除其语义向量（有变化才写盘），再刷新索引 */
  private async onFileDeleted(path: string): Promise<void> {
    await this.applyVectorChange(removeVectorForPath(this.semanticVectors, path));
    await this.rebuildIndex();
    this.refreshPanelViews();
  }

  /** 重命名笔记：仍在收藏夹则改向量 path（保留向量），移出则删向量，再刷新索引 */
  private async onFileRenamed(newPath: string, oldPath: string): Promise<void> {
    const next = this.inArchiveFolder(newPath)
      ? renameVectorPath(this.semanticVectors, oldPath, newPath)
      : removeVectorForPath(this.semanticVectors, oldPath);
    await this.applyVectorChange(next);
    await this.rebuildIndex();
    this.refreshPanelViews();
  }

  /** 仅当向量数组引用变化时才持久化，避免删/改无关文件时无谓写盘 */
  private async applyVectorChange(next: SemanticVector[]): Promise<void> {
    if (next === this.semanticVectors) return;
    this.semanticVectors = next;
    await this.savePluginData();
  }

  async onunload() {
    await this.stopClipServer();
  }

  getStats() {
    const plan = planSemanticIndex(this.entries, this.semanticVectors);
    return {
      entries: this.entries.length,
      semanticVectors: this.semanticVectors.length,
      pendingEmbeddings: plan.tasks.length,
      clipServer: this.clipServer?.running ?? false,
    };
  }

  /** 优先选真正沉睡（超阈值）的收藏，无则回退到最久未访问的一条 */
  pickReviveEntry(): CcArchiveEntry | null {
    const dormant = getDormantEntries(this.entries, new Date(), this.settings.dormantDays, 1);
    return dormant[0] ?? pickDormantEntry(this.entries);
  }

  /** 启动本地剪藏接收服务：仅桌面端、开关开启且已配置 Token */
  async startClipServer(): Promise<void> {
    if (this.clipServer) return;
    if (!this.settings.clipServerEnabled) return;
    if (Platform.isMobileApp) return; // 移动端无法运行本地 HTTP 服务
    if (!this.settings.clipServerToken) {
      this.settings.clipServerToken = generateToken();
      await this.savePluginData();
    }

    const server = new ClipServer({
      port: this.settings.clipServerPort,
      token: this.settings.clipServerToken,
      writeNote: (path, content) => this.writeClipNote(path, content),
      log: (message) => console.info(`[CC Archive] ${message}`),
      // 配对码一次性有效：校验通过后立即清空，避免被重复使用
      verifyPairingCode: (code) => {
        const expected = this.settings.pairingCode;
        if (!expected || code !== expected) return false;
        this.settings.pairingCode = '';
        void this.savePluginData();
        return true;
      },
      archiveFolder: this.settings.archiveFolder,
    });

    try {
      await server.start();
      this.clipServer = server;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      new Notice(`CC Archive 剪藏服务启动失败：${message}`);
      console.error('[CC Archive] 剪藏服务启动失败', error);
    }
  }

  async stopClipServer(): Promise<void> {
    if (!this.clipServer) return;
    await this.clipServer.stop();
    this.clipServer = null;
  }

  /** 应用设置变更后重启服务，使端口/开关/Token 生效 */
  async restartClipServer(): Promise<void> {
    await this.stopClipServer();
    await this.startClipServer();
  }

  /** 把浏览器扩展发来的 markdown 写入 vault，父文件夹缺失时自动创建 */
  private async writeClipNote(path: string, content: string): Promise<void> {
    const normalized = normalizePath(path);
    await this.ensureParentFolder(normalized);
    const existing = this.app.vault.getAbstractFileByPath(normalized);
    if (existing instanceof TFile) {
      await this.app.vault.modify(existing, content);
    } else {
      await this.app.vault.create(normalized, content);
    }
    // 直接解析写入内容并入索引（不等异步 metadataCache），确保实时剪藏立即可被“搜索收藏”命中
    const entry = this.indexEntryFromContent(normalized, content);
    this.refreshPanelViews(); // 索引已即时更新，先刷新面板；向量在补全后会再刷新一次
    // 后台补该条语义向量，让语义搜索/问答也能立即命中（best-effort）
    if (entry) void this.embedClipEntry(entry);
  }

  /** 从写入的 markdown 解析 frontmatter 并 upsert 单条索引，返回该条目 */
  private indexEntryFromContent(path: string, content: string): CcArchiveEntry | null {
    const block = extractFrontmatterBlock(content);
    if (!block) return null;
    let fm: ArchiveFrontmatter;
    try {
      fm = (parseYaml(block) ?? {}) as ArchiveFrontmatter;
    } catch {
      return null;
    }
    const entry = entryFromFrontmatter(path, fm);
    if (!entry) return null;
    this.entries = [entry, ...this.entries.filter((item) => item.path !== path)]
      .sort((a, b) => b.clipped.localeCompare(a.clipped));
    return entry;
  }

  /** 为单条剪藏补语义向量：未配置或内容未变则跳过，失败静默（best-effort，等用户手动重建语义索引） */
  private async embedClipEntry(entry: CcArchiveEntry): Promise<void> {
    if (!this.hasEmbeddingConfig()) return;
    const text = buildEmbeddingText(entry);
    if (!text.trim()) return;
    const hash = hashEmbeddingText(text);
    const prev = this.semanticVectors.find((vector) => vector.path === entry.path);
    if (prev && prev.hash === hash && prev.embedding.length) return;
    try {
      const embedding = await createEmbedding(text, this.settings);
      this.semanticVectors = [
        ...this.semanticVectors.filter((vector) => vector.path !== entry.path),
        { path: entry.path, embedding, indexedAt: new Date().toISOString(), hash },
      ];
      await this.savePluginData();
      this.refreshPanelViews(); // 向量补全后刷新面板，使「语义向量」计数实时更新
    } catch (error) {
      console.error('[CC Archive] 剪藏自动嵌入失败', error);
    }
  }

  private hasEmbeddingConfig(): boolean {
    return Boolean(
      this.settings.embeddingBaseUrl.trim()
        && this.settings.embeddingApiKey.trim()
        && this.settings.embeddingModel.trim(),
    );
  }

  private hasChatConfig(): boolean {
    return Boolean(
      this.settings.chatBaseUrl.trim()
        && this.settings.chatApiKey.trim()
        && this.settings.chatModel.trim(),
    );
  }

  /** 批量为 ai_pending: true 的历史剪藏补全 AI 摘要（用插件 chat 模型），回填 frontmatter 与速览要点 */
  async backfillPendingAi(): Promise<void> {
    if (!this.hasChatConfig()) {
      new Notice('请先在设置里配置 Chat API 端点 / Key / 模型');
      return;
    }

    const folder = this.settings.archiveFolder.replace(/\/+$/, '');
    const files = this.app.vault.getMarkdownFiles()
      .filter((file) => file.path.startsWith(`${folder}/`))
      .filter((file) => this.app.metadataCache.getFileCache(file)?.frontmatter?.ai_pending === true);

    if (!files.length) {
      new Notice('没有待补 AI 的收藏（ai_pending: true）');
      return;
    }

    new Notice(`开始补全 ${files.length} 条待处理 AI 摘要…`);
    let done = 0;
    let failed = 0;
    for (const file of files) {
      try {
        const content = await this.app.vault.read(file);
        const fm = this.app.metadataCache.getFileCache(file)?.frontmatter ?? {};
        const ai = await enrichNoteContent(
          {
            title: String(fm.title ?? '') || file.basename,
            url: String(fm.url ?? ''),
            body: extractBodySnapshot(content),
          },
          this.settings,
          createChatAnswer,
        );
        // 先更新正文速览要点，再用 processFrontMatter 安全写回 frontmatter
        await this.app.vault.modify(file, applySummaryHighlights(content, ai.highlights));
        await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
          frontmatter.summary = ai.summary;
          frontmatter.tags = ai.tags;
          frontmatter.keywords = ai.keywords;
          frontmatter.aliases = ai.aliases;
          frontmatter.intent = ai.intent;
          frontmatter.ai_pending = false;
        });
        // 用最终内容刷新索引与语义向量
        const updated = await this.app.vault.read(file);
        const entry = this.indexEntryFromContent(file.path, updated);
        if (entry) await this.embedClipEntry(entry);
        done += 1;
        if (done % 5 === 0) new Notice(`补全 AI 摘要：${done}/${files.length}`);
      } catch (error) {
        failed += 1;
        console.error(`[CC Archive] 补全 AI 失败：${file.path}`, error);
      }
    }

    await this.rebuildIndex();
    if (failed) {
      new Notice(`补全完成：成功 ${done} 条，失败 ${failed} 条（保留原样）`);
    } else {
      new Notice(`补全完成：成功 ${done} 条`);
    }
  }

  private async ensureParentFolder(path: string): Promise<void> {
    const slash = path.lastIndexOf('/');
    if (slash <= 0) return;
    const folder = path.slice(0, slash);
    if (this.app.vault.getAbstractFileByPath(folder) instanceof TFolder) return;
    await this.app.vault.createFolder(folder).catch(() => undefined); // 并发/已存在时忽略
  }

  openKeywordSearch() {
    new ArchiveSearchModal(this.app, this.entries, async (entry) => {
      await this.openEntry(entry);
    }).open();
  }

  openSemanticSearch() {
    new SemanticSearchModal(this.app, async (query) => {
      return this.semanticSearch(query);
    }, async (entry) => {
      await this.openEntry(entry);
    }).open();
  }

  openAskModal() {
    new AskCcArchiveModal(this.app, async (question) => {
      return this.answerQuestion(question);
    }).open();
  }

  async activatePanel() {
    const { workspace } = this.app;
    let leaf: WorkspaceLeaf | null = workspace.getLeavesOfType(CC_ARCHIVE_VIEW_TYPE)[0] ?? null;
    if (!leaf) {
      leaf = workspace.getRightLeaf(false);
      await leaf?.setViewState({ type: CC_ARCHIVE_VIEW_TYPE, active: true });
    }
    if (leaf) workspace.revealLeaf(leaf);
  }

  async rebuildSemanticIndex() {
    await this.rebuildIndex();
    const plan = planSemanticIndex(this.entries, this.semanticVectors);

    // 复用未变更条目的旧向量，只对新增/变更的条目调用 embedding API
    const vectors: SemanticVector[] = [...plan.reuse];

    if (!plan.tasks.length) {
      this.semanticVectors = vectors;
      await this.savePluginData();
      new Notice(`CC Archive 语义索引已是最新：共 ${vectors.length} 条，无需重新嵌入`);
      return;
    }

    new Notice(`CC Archive 语义索引：复用 ${plan.reuse.length} 条，待嵌入 ${plan.tasks.length} 条`);

    let done = 0;
    let failed = 0;
    for (const task of plan.tasks) {
      try {
        const embedding = await createEmbedding(task.text, this.settings);
        vectors.push({
          path: task.entry.path,
          embedding,
          indexedAt: new Date().toISOString(),
          hash: task.hash,
        });
        done += 1;
        if (done % 5 === 0) new Notice(`CC Archive 语义索引：${done}/${plan.tasks.length}`);
      } catch (error) {
        failed += 1;
        console.error(`[CC Archive] 嵌入失败：${task.entry.path}`, error);
        // 单条失败不丢历史：若该条已有旧向量则保留，避免整体回退
        const prev = this.semanticVectors.find((vector) => vector.path === task.entry.path);
        if (prev) vectors.push(prev);
      }
    }

    // 无论中途是否有失败，都持久化已完成的进度
    this.semanticVectors = vectors;
    await this.savePluginData();

    if (failed) {
      new Notice(`CC Archive 语义索引完成：更新 ${done} 条，失败 ${failed} 条（已保留旧向量），共 ${vectors.length} 条`);
    } else {
      new Notice(`CC Archive 语义索引已完成：更新 ${done} 条，共 ${vectors.length} 条`);
    }
  }

  async semanticSearch(query: string): Promise<SemanticSearchHit[]> {
    if (!this.semanticVectors.length) {
      throw new Error('语义索引为空，请先运行“重建 CC Archive 语义索引”');
    }
    const embedding = await createEmbedding(query, this.settings);
    return searchSemanticIndex(this.entries, this.semanticVectors, embedding, 10);
  }

  async answerQuestion(question: string): Promise<{ answer: string; sources: RagSource[] }> {
    const hits = await this.semanticSearch(question);
    const context = buildRagContext(question, hits, 5);
    const answer = await createChatAnswer(context.prompt, this.settings);
    return { answer, sources: context.sources };
  }

  async createDormantReview() {
    await this.rebuildIndex();
    const now = new Date();
    const entries = getDormantEntries(this.entries, now, this.settings.dormantDays, this.settings.reviewLimit);
    const markdown = renderDormantReviewMarkdown(entries, now, this.settings.dormantDays);
    const folder = normalizePath(this.settings.reviewFolder || DEFAULT_SETTINGS.reviewFolder);
    const path = normalizePath(`${folder}/${now.toISOString().slice(0, 10)}.md`);

    if (!this.app.vault.getAbstractFileByPath(folder)) {
      await this.app.vault.createFolder(folder);
    }

    const existing = this.app.vault.getAbstractFileByPath(path);
    let file: TFile;
    if (existing instanceof TFile) {
      await this.app.vault.modify(existing, markdown);
      file = existing;
    } else {
      file = await this.app.vault.create(path, markdown);
    }
    await this.app.workspace.getLeaf(false).openFile(file);
    if (entries.length) {
      new Notice(`CC Archive 回顾已生成：${entries.length} 条收藏`);
    } else {
      new Notice(`CC Archive 回顾已生成：0 条（没有超过 ${this.settings.dormantDays} 天未访问的收藏）`);
    }
  }

  async suggestRelatedForCurrentNote(file: TFile) {
    if (!this.semanticVectors.length) {
      throw new Error('语义索引为空，请先运行“重建 CC Archive 语义索引”');
    }
    const content = await this.app.vault.read(file);
    const query = buildCurrentNoteQuery(file.path, content);
    const embedding = await createEmbedding(query, this.settings);
    const hits = relatedHitsForCurrentNote(this.entries, this.semanticVectors, embedding, file.path, 5);
    new RelatedClipsModal(this.app, hits, async (entry) => {
      await this.openEntry(entry);
    }).open();
  }

  async openEntry(entry: CcArchiveEntry) {
    const file = this.app.vault.getAbstractFileByPath(entry.path);
    if (file instanceof TFile) {
      await this.app.workspace.getLeaf(false).openFile(file);
      await this.markVisited(file);
      return;
    }
    window.open(entry.url, '_blank');
  }

  async markVisited(file: TFile) {
    await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
      frontmatter.last_visited = new Date().toISOString();
      frontmatter.revived = Number(frontmatter.revived ?? 0) + 1;
    });
    await this.rebuildIndex();
  }

  async loadSettings() {
    let data = (await this.loadData()) as CcArchivePluginData | Partial<CcArchivePluginSettings> | null;
    if (!data || typeof data !== 'object') {
      data = await this.loadLegacyData();
      if (data) await this.saveData(data);
    }
    if (data && 'archiveFolder' in data) {
      this.settings = { ...DEFAULT_SETTINGS, ...(data as Partial<CcArchivePluginSettings>) };
      this.semanticVectors = [];
      return;
    }
    this.settings = { ...DEFAULT_SETTINGS, ...(data as CcArchivePluginData | null)?.settings };
    this.semanticVectors = (data as CcArchivePluginData | null)?.semanticVectors ?? [];
  }

  /**
   * 插件 id 从 `url-archive` 改成 `cc-archive` 后，Obsidian 会去新目录找 data.json，
   * 旧目录里的设置（剪藏服务 Token、语义向量缓存）就此失联。读一次并固化到新目录，
   * 免得浏览器那边已经配好的配对失效。
   */
  private async loadLegacyData(): Promise<CcArchivePluginData | Partial<CcArchivePluginSettings> | null> {
    const path = '.obsidian/plugins/url-archive/data.json';
    try {
      if (!(await this.app.vault.adapter.exists(path))) return null;
      const parsed = JSON.parse(await this.app.vault.adapter.read(path)) as unknown;
      return parsed && typeof parsed === 'object' ? parsed as CcArchivePluginData : null;
    } catch {
      return null;
    }
  }

  async saveSettings() {
    await this.savePluginData();
    await this.rebuildIndex();
  }

  async savePluginData() {
    await this.saveData({
      settings: this.settings,
      semanticVectors: this.semanticVectors,
    } satisfies CcArchivePluginData);
  }
}

/** 生成一段随机 Token，用于剪藏服务鉴权 */
function generateToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * 把品牌 SVG 转成 Obsidian ribbon 单色图标：
 * 去掉黑色背景矩形与固定配色的 <defs>，统一用 currentColor 随主题变色，
 * 并从原始 798.96×800 画布缩放到 addIcon 期望的 0 0 100 100 视口。
 */
function getSvgBody(svg: string): string {
  const body = svg
    .replace(/<\?xml[\s\S]*?\?>/i, '')
    .replace(/<!doctype[\s\S]*?>/i, '')
    .replace(/<\/?svg[^>]*>/gi, '')
    .replace(/<defs[\s\S]*?<\/defs>/gi, '')
    .replace(/<rect\s+width="798\.96"\s+height="800"\s*\/>/i, '')
    .trim();
  return `<g fill="currentColor" transform="scale(0.125)">${body}</g>`;
}

class ArchiveSearchModal extends FuzzySuggestModal<CcArchiveEntry> {
  constructor(
    app: App,
    private entries: CcArchiveEntry[],
    private onChoose: (entry: CcArchiveEntry) => Promise<void>,
  ) {
    super(app);
    this.setPlaceholder('按标题、标签、别名、场景、摘要搜索 CC Archive...');
  }

  getItems(): CcArchiveEntry[] {
    return this.entries;
  }

  getItemText(entry: CcArchiveEntry): string {
    return [
      entry.title,
      entry.domain,
      entry.tags.join(' '),
      entry.keywords.join(' '),
      entry.aliases.join(' '),
      entry.intent,
      entry.summary,
      entry.why,
      entry.url,
    ].join(' ');
  }

  renderSuggestion(match: FuzzyMatch<CcArchiveEntry>, el: HTMLElement) {
    const entry = match.item;
    el.createEl('div', { text: entry.title || entry.url, cls: 'suggestion-title' });
    el.createEl('small', {
      text: `${entry.domain}${entry.summary ? ` - ${entry.summary}` : ''}`,
      cls: 'suggestion-note',
    });
  }

  async onChooseItem(entry: CcArchiveEntry) {
    await this.onChoose(entry);
  }
}

/** 统一的弹窗头部：标题 + 可选副标题 */
function addModalHeader(contentEl: HTMLElement, title: string, subtitle?: string) {
  const head = contentEl.createDiv({ cls: 'cca-modal-head' });
  head.createDiv({ cls: 'cca-modal-title', text: title });
  if (subtitle) head.createDiv({ cls: 'cca-modal-subtitle', text: subtitle });
}

/** 统一的结果卡片列表：排名 + 标题 + 匹配度 + 域名 + 摘要，点击回调 */
function renderHitList(
  container: HTMLElement,
  hits: SemanticSearchHit[],
  emptyText: string,
  onChoose: (entry: CcArchiveEntry) => void | Promise<void>,
) {
  container.empty();
  if (!hits.length) {
    container.createDiv({ cls: 'cca-empty', text: emptyText });
    return;
  }
  const list = container.createDiv({ cls: 'cca-result-list' });
  hits.forEach((hit, index) => {
    const card = list.createEl('button', { cls: 'cca-result' });
    const head = card.createDiv({ cls: 'cca-result-head' });
    const titleWrap = head.createDiv({ cls: 'cca-result-title-wrap' });
    titleWrap.createSpan({ cls: 'cca-result-rank', text: String(index + 1) });
    titleWrap.createSpan({ cls: 'cca-result-title', text: hit.entry.title || hit.entry.url });
    head.createSpan({ cls: 'cca-result-score', text: `${Math.round(hit.score * 100)}%` });
    if (hit.entry.domain) card.createDiv({ cls: 'cca-result-domain', text: hit.entry.domain });
    if (hit.entry.summary) card.createDiv({ cls: 'cca-result-summary', text: hit.entry.summary });
    card.onclick = () => {
      Promise.resolve(onChoose(hit.entry)).catch((error) => {
        new Notice(error instanceof Error ? error.message : String(error));
      });
    };
  });
}

class SemanticSearchModal extends Modal {
  private resultsEl!: HTMLElement;
  private inputEl!: HTMLInputElement;

  constructor(
    app: App,
    private search: (query: string) => Promise<SemanticSearchHit[]>,
    private onChoose: (entry: CcArchiveEntry) => Promise<void>,
  ) {
    super(app);
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('cc-archive-modal');
    addModalHeader(contentEl, '语义搜索', '用自然语言描述你记得的内容或意图');
    this.inputEl = contentEl.createEl('input', {
      type: 'text',
      cls: 'cca-modal-input',
      placeholder: '描述你记得的内容或意图...',
    });
    this.resultsEl = contentEl.createDiv({ cls: 'cca-modal-results' });

    this.inputEl.addEventListener('keydown', async (event) => {
      if (event.key !== 'Enter') return;
      await this.runSearch();
    });
    this.inputEl.focus();
  }

  private async runSearch() {
    const query = this.inputEl.value.trim();
    if (!query) return;
    this.resultsEl.empty();
    this.resultsEl.createDiv({ cls: 'cca-loading', text: '搜索中…' });
    try {
      const hits = await this.search(query);
      renderHitList(this.resultsEl, hits, '没有找到语义匹配。', async (entry) => {
        await this.onChoose(entry);
        this.close();
      });
    } catch (error) {
      this.resultsEl.empty();
      this.resultsEl.createDiv({ cls: 'cca-error', text: error instanceof Error ? error.message : String(error) });
    }
  }
}

class AskCcArchiveModal extends Modal {
  private resultsEl!: HTMLElement;
  private inputEl!: HTMLTextAreaElement;

  constructor(
    app: App,
    private answer: (question: string) => Promise<{ answer: string; sources: RagSource[] }>,
  ) {
    super(app);
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('cc-archive-modal');
    addModalHeader(contentEl, '问答收藏库', '基于你的收藏检索并生成回答');
    this.inputEl = contentEl.createEl('textarea', {
      cls: 'cca-modal-input cca-modal-textarea',
      placeholder: '询问你的收藏，例如：有哪些财务自动化工具？',
    });
    this.inputEl.rows = 3;
    const actions = contentEl.createDiv({ cls: 'cca-modal-actions' });
    const button = actions.createEl('button', { cls: 'mod-cta', text: '提问' });
    button.onclick = async () => this.runAnswer();
    this.resultsEl = contentEl.createDiv({ cls: 'cca-modal-results' });
    this.inputEl.focus();
  }

  private async runAnswer() {
    const question = this.inputEl.value.trim();
    if (!question) return;
    this.resultsEl.empty();
    this.resultsEl.createDiv({ cls: 'cca-loading', text: '思考中…' });
    try {
      const result = await this.answer(question);
      this.renderAnswer(result.answer, result.sources);
    } catch (error) {
      this.resultsEl.empty();
      this.resultsEl.createDiv({ cls: 'cca-error', text: error instanceof Error ? error.message : String(error) });
    }
  }

  private renderAnswer(answer: string, sources: RagSource[]) {
    this.resultsEl.empty();
    const answerCard = this.resultsEl.createDiv({ cls: 'cca-answer' });
    answerCard.setText(answer);

    this.resultsEl.createDiv({ cls: 'cca-modal-subhead', text: '来源' });
    if (!sources.length) {
      this.resultsEl.createDiv({ cls: 'cca-empty', text: '没有来源。' });
      return;
    }
    const list = this.resultsEl.createDiv({ cls: 'cca-source-list' });
    sources.forEach((source, index) => {
      const item = list.createDiv({ cls: 'cca-source' });
      const head = item.createDiv({ cls: 'cca-result-head' });
      const titleWrap = head.createDiv({ cls: 'cca-result-title-wrap' });
      titleWrap.createSpan({ cls: 'cca-result-rank', text: String(index + 1) });
      titleWrap.createSpan({ cls: 'cca-result-title', text: source.title || source.path });
      head.createSpan({ cls: 'cca-result-score', text: `${Math.round(source.score * 100)}%` });
      item.createDiv({ cls: 'cca-result-domain', text: source.path });
    });
  }
}

class RelatedClipsModal extends Modal {
  constructor(
    app: App,
    private hits: SemanticSearchHit[],
    private onChoose: (entry: CcArchiveEntry) => Promise<void>,
  ) {
    super(app);
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('cc-archive-modal');
    addModalHeader(contentEl, '相关收藏', '与当前笔记语义最接近的收藏');
    const results = contentEl.createDiv({ cls: 'cca-modal-results' });
    renderHitList(results, this.hits, '没有找到相关收藏。', async (entry) => {
      await this.onChoose(entry);
      this.close();
    });
  }
}

class CcArchivePanelView extends ItemView {
  constructor(leaf: WorkspaceLeaf, private plugin: CcArchivePlugin) {
    super(leaf);
  }

  getViewType(): string {
    return CC_ARCHIVE_VIEW_TYPE;
  }

  getDisplayText(): string {
    return 'CC Archive';
  }

  getIcon(): string {
    return CC_ICON_ID;
  }

  async onOpen() {
    this.render();
  }

  render() {
    const { containerEl } = this;
    containerEl.empty();
    const root = containerEl.createDiv({ cls: 'cc-archive-panel' });

    // 品牌头部：logo + 标题 + 副标题
    const header = root.createDiv({ cls: 'cca-header' });
    const mark = header.createDiv({ cls: 'cca-mark' });
    setIcon(mark, CC_ICON_ID);
    const titles = header.createDiv({ cls: 'cca-titles' });
    titles.createDiv({ cls: 'cca-title', text: 'CC Archive' });
    titles.createDiv({ cls: 'cca-subtitle', text: '智能收藏助手' });

    const stats = this.plugin.getStats();

    // 统计卡片
    const statRow = root.createDiv({ cls: 'cca-stats' });
    this.addStat(statRow, String(stats.entries), '已索引收藏');
    this.addStat(statRow, String(stats.semanticVectors), '语义向量');

    // 状态：剪藏服务 + 语义索引待更新提示
    const statusRow = root.createDiv({ cls: 'cca-status-row' });
    const pill = statusRow.createDiv({ cls: `cca-status ${stats.clipServer ? 'is-on' : 'is-off'}` });
    pill.createSpan({ cls: 'cca-dot' });
    pill.createSpan({ text: stats.clipServer ? '剪藏服务运行中' : '剪藏服务未运行' });
    if (stats.pendingEmbeddings > 0) {
      const pending = statusRow.createDiv({ cls: 'cca-status is-pending' });
      pending.createSpan({ cls: 'cca-dot' });
      pending.createSpan({ text: `${stats.pendingEmbeddings} 条待建语义索引` });
    }

    // 分组操作
    this.addSection(root, '检索', [
      { icon: 'search', label: '搜索收藏', onClick: () => this.plugin.openKeywordSearch() },
      { icon: 'sparkles', label: '语义搜索', onClick: () => this.plugin.openSemanticSearch() },
      { icon: 'help-circle', label: '问答收藏库', onClick: () => this.plugin.openAskModal() },
    ]);

    this.addSection(root, '索引', [
      {
        icon: 'refresh-cw',
        label: '重建普通索引',
        onClick: async () => {
          await this.plugin.rebuildIndex();
          new Notice(`CC Archive 已索引 ${this.plugin.getStats().entries} 条收藏`);
          this.render();
        },
      },
      {
        icon: 'brain',
        label: '重建语义索引',
        onClick: async () => {
          await this.plugin.rebuildSemanticIndex();
          this.render();
        },
      },
      {
        icon: 'wand',
        label: '补全待处理 AI 摘要',
        onClick: async () => {
          await this.plugin.backfillPendingAi();
          this.render();
        },
      },
    ]);

    this.addSection(root, '回访', [
      {
        icon: 'history',
        label: '回访一条沉睡收藏',
        onClick: async () => {
          const entry = this.plugin.pickReviveEntry();
          if (!entry) {
            new Notice('没有找到 CC Archive 收藏');
            return;
          }
          await this.plugin.openEntry(entry);
        },
      },
      {
        icon: 'scroll-text',
        label: '生成沉睡收藏回顾',
        onClick: async () => {
          await this.plugin.createDormantReview();
        },
      },
      {
        icon: 'lightbulb',
        label: '为当前笔记推荐收藏',
        onClick: async () => {
          const file = this.app.workspace.getActiveFile();
          if (!file || file.extension !== 'md') {
            new Notice('当前没有打开 markdown 笔记');
            return;
          }
          await this.plugin.suggestRelatedForCurrentNote(file);
        },
      },
    ]);
  }

  private addStat(parent: HTMLElement, value: string, label: string) {
    const card = parent.createDiv({ cls: 'cca-stat' });
    card.createDiv({ cls: 'cca-stat-value', text: value });
    card.createDiv({ cls: 'cca-stat-label', text: label });
  }

  private addSection(
    parent: HTMLElement,
    title: string,
    actions: { icon: string; label: string; onClick: () => void | Promise<void> }[],
  ) {
    const section = parent.createDiv({ cls: 'cca-section' });
    section.createDiv({ cls: 'cca-section-title', text: title });
    const list = section.createDiv({ cls: 'cca-actions' });
    for (const action of actions) {
      this.addActionRow(list, action.icon, action.label, action.onClick);
    }
  }

  private addActionRow(parent: HTMLElement, icon: string, label: string, onClick: () => void | Promise<void>) {
    const btn = parent.createEl('button', { cls: 'cca-action' });
    const iconEl = btn.createSpan({ cls: 'cca-action-icon' });
    setIcon(iconEl, icon);
    btn.createSpan({ cls: 'cca-action-label', text: label });
    const chevron = btn.createSpan({ cls: 'cca-action-chevron' });
    setIcon(chevron, 'chevron-right');
    btn.onclick = () => {
      Promise.resolve(onClick()).catch((error) => {
        new Notice(error instanceof Error ? error.message : String(error));
      });
    };
  }
}

class CcArchiveSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: CcArchivePlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl('h2', { text: 'CC Archive 设置' });

    new Setting(containerEl)
      .setName('收藏文件夹')
      .setDesc('存放 CC Archive 剪藏笔记的 markdown 文件夹。')
      .addText((text) => {
        text
          .setPlaceholder('CC Archive')
          .setValue(this.plugin.settings.archiveFolder)
          .onChange(async (value) => {
            this.plugin.settings.archiveFolder = value.trim() || DEFAULT_SETTINGS.archiveFolder;
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName('Embedding API 端点')
      .setDesc('OpenAI 兼容 base URL，例如：https://open.bigmodel.cn/api/paas/v4')
      .addText((text) => {
        text
          .setPlaceholder(DEFAULT_SETTINGS.embeddingBaseUrl)
          .setValue(this.plugin.settings.embeddingBaseUrl)
          .onChange(async (value) => {
            this.plugin.settings.embeddingBaseUrl = value.trim();
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName('Embedding API Key')
      .setDesc('仅保存在当前 vault 的插件数据中。')
      .addText((text) => {
        text
          .setPlaceholder('API key')
          .setValue(this.plugin.settings.embeddingApiKey)
          .onChange(async (value) => {
            this.plugin.settings.embeddingApiKey = value.trim();
            await this.plugin.saveSettings();
          });
        text.inputEl.type = 'password';
      });

    new Setting(containerEl)
      .setName('Embedding 模型')
      .setDesc('填写你的服务商支持的 embedding 模型。')
      .addText((text) => {
        text
          .setPlaceholder(DEFAULT_SETTINGS.embeddingModel)
          .setValue(this.plugin.settings.embeddingModel)
          .onChange(async (value) => {
            this.plugin.settings.embeddingModel = value.trim();
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName('Chat API 端点')
      .setDesc('OpenAI 兼容 chat base URL。')
      .addText((text) => {
        text
          .setPlaceholder(DEFAULT_SETTINGS.chatBaseUrl)
          .setValue(this.plugin.settings.chatBaseUrl)
          .onChange(async (value) => {
            this.plugin.settings.chatBaseUrl = value.trim();
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName('Chat API Key')
      .setDesc('仅保存在当前 vault 的插件数据中。')
      .addText((text) => {
        text
          .setPlaceholder('API key')
          .setValue(this.plugin.settings.chatApiKey)
          .onChange(async (value) => {
            this.plugin.settings.chatApiKey = value.trim();
            await this.plugin.saveSettings();
          });
        text.inputEl.type = 'password';
      });

    new Setting(containerEl)
      .setName('Chat 模型')
      .setDesc('智谱 GLM-5.2 填 glm-5.2。')
      .addText((text) => {
        text
          .setPlaceholder(DEFAULT_SETTINGS.chatModel)
          .setValue(this.plugin.settings.chatModel)
          .onChange(async (value) => {
            this.plugin.settings.chatModel = value.trim();
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName('回顾笔记文件夹')
      .setDesc('生成沉睡收藏回顾笔记的位置。')
      .addText((text) => {
        text
          .setPlaceholder(DEFAULT_SETTINGS.reviewFolder)
          .setValue(this.plugin.settings.reviewFolder)
          .onChange(async (value) => {
            this.plugin.settings.reviewFolder = value.trim() || DEFAULT_SETTINGS.reviewFolder;
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName('沉睡阈值天数')
      .setDesc('收藏超过这么多天未访问，就会进入沉睡回顾候选。')
      .addText((text) => {
        text
          .setPlaceholder(String(DEFAULT_SETTINGS.dormantDays))
          .setValue(String(this.plugin.settings.dormantDays))
          .onChange(async (value) => {
            const days = Number(value);
            this.plugin.settings.dormantDays = Number.isFinite(days) && days > 0 ? days : DEFAULT_SETTINGS.dormantDays;
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName('回顾条目上限')
      .setDesc('一篇回顾笔记最多包含多少条沉睡收藏。')
      .addText((text) => {
        text
          .setPlaceholder(String(DEFAULT_SETTINGS.reviewLimit))
          .setValue(String(this.plugin.settings.reviewLimit))
          .onChange(async (value) => {
            const limit = Number(value);
            this.plugin.settings.reviewLimit = Number.isFinite(limit) && limit > 0 ? limit : DEFAULT_SETTINGS.reviewLimit;
            await this.plugin.saveSettings();
          });
      });

    containerEl.createEl('h3', { text: '浏览器剪藏服务' });
    containerEl.createEl('p', {
      text: '开启后，CC Archive 浏览器扩展可直接把剪藏写入本 vault，无需再安装 Local REST API 插件。仅桌面端可用，服务只监听 127.0.0.1。',
      cls: 'setting-item-description',
    });

    new Setting(containerEl)
      .setName('启用剪藏服务')
      .setDesc(Platform.isMobileApp ? '移动端不支持本地服务。' : '关闭后浏览器扩展将无法通过本插件写入。')
      .addToggle((toggle) => {
        toggle
          .setDisabled(Platform.isMobileApp)
          .setValue(this.plugin.settings.clipServerEnabled)
          .onChange(async (value) => {
            this.plugin.settings.clipServerEnabled = value;
            await this.plugin.saveSettings();
            await this.plugin.restartClipServer();
            this.display();
          });
      });

    new Setting(containerEl)
      .setName('监听端口')
      .setDesc('浏览器扩展需填写相同端口，默认 27125。')
      .addText((text) => {
        text
          .setPlaceholder(String(DEFAULT_SETTINGS.clipServerPort))
          .setValue(String(this.plugin.settings.clipServerPort))
          .onChange(async (value) => {
            const port = Number(value);
            this.plugin.settings.clipServerPort = Number.isInteger(port) && port >= 1024 && port <= 65535
              ? port
              : DEFAULT_SETTINGS.clipServerPort;
            await this.plugin.saveSettings();
            await this.plugin.restartClipServer();
          });
      });

    new Setting(containerEl)
      .setName('访问 Token')
      .setDesc('把此 Token 填入浏览器扩展的「官方插件 Token」栏位。')
      .addText((text) => {
        text.setValue(this.plugin.settings.clipServerToken).setDisabled(true);
        text.inputEl.style.width = '100%';
      })
      .addExtraButton((button) => {
        button
          .setIcon('copy')
          .setTooltip('复制 Token')
          .onClick(async () => {
            await navigator.clipboard.writeText(this.plugin.settings.clipServerToken);
            new Notice('已复制剪藏服务 Token');
          });
      })
      .addExtraButton((button) => {
        button
          .setIcon('refresh-cw')
          .setTooltip('重新生成 Token')
          .onClick(async () => {
            this.plugin.settings.clipServerToken = generateToken();
            await this.plugin.saveSettings();
            await this.plugin.restartClipServer();
            this.display();
            new Notice('已重新生成 Token，请同步更新浏览器扩展');
          });
      });

    // ── 一键配对 ──────────────────────────────────────────────
    new Setting(containerEl)
      .setName('配对码（给浏览器扩展用）')
      .setDesc('点「生成配对码」后，在扩展设置里点「自动连接」并填入此码，即可自动填好地址与 Token。配对码用一次即失效。')
      .addText((text) => {
        text.setValue(this.plugin.settings.pairingCode || '未生成').setDisabled(true);
        text.inputEl.style.width = '100%';
      })
      .addExtraButton((button) => {
        button
          .setIcon('key-round')
          .setTooltip('生成配对码')
          .onClick(async () => {
            // 6 位数字，便于手动输入；一次性使用
            this.plugin.settings.pairingCode = String(
              Math.floor(100000 + Math.random() * 900000),
            );
            await this.plugin.saveSettings();
            this.display();
            new Notice('已生成配对码，请在浏览器扩展里输入');
          });
      })
      .addExtraButton((button) => {
        button
          .setIcon('copy')
          .setTooltip('复制配对码')
          .onClick(async () => {
            if (!this.plugin.settings.pairingCode) {
              new Notice('请先生成配对码');
              return;
            }
            await navigator.clipboard.writeText(this.plugin.settings.pairingCode);
            new Notice('已复制配对码');
          });
      });

    new Setting(containerEl)
      .setName('服务状态')
      .setDesc(this.plugin.getStats().clipServer ? '运行中' : '未运行');

    new Setting(containerEl)
      .setName('已索引收藏数')
      .setDesc(String(this.plugin['entries'].length));

    new Setting(containerEl)
      .setName('语义向量数')
      .setDesc(String(this.plugin['semanticVectors'].length));
  }
}
