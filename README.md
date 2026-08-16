# DeepSeek Harness Docs Mirror

这是 DeepSeek Harness 官方文档的独立中英文镜像。首版直接复用官方 VitePress
站点配置、品牌资源、publication manifest 和 canonical Markdown，因此信息架构、
正文与视觉行为和官方站保持同构。

## 首版范围

- 简体中文根路由与 English `/en/` 路由。
- 83 个 canonical 页面、166 条官方 locale 路由。
- Guide 3 页、Development 17 页、Reference 62 页，以及两个 locale 首页重定向。
- VitePress 本地搜索、Mermaid、深浅色主题、语言切换、响应式侧栏、页内目录与
  GitHub 编辑链接。
- Vercel 静态部署。
- 面向官方 GitHub commit 的不可变 `diff-translation` 工作流。

日文和韩文已经在 `config/locales.json` 中登记，但首版 `published: false`，不会
生成 `/ja/`、`/ko/`，也不会用英文回退冒充译文。

## 官方来源

内容来自 [`deepseek-ai/deepseek-harness`](https://github.com/deepseek-ai/deepseek-harness)。
当前固定 commit、Git tree、publication fingerprint、控制文件和每一份发布源文件
的 Git blob/SHA-256 都记录在 `config/upstream-lock.json`；
`config/docs-manifest.json` 是本镜像的可审计路由投影。

官方资料按仓库内 `LICENSE` 的 MIT License 使用；归属说明见 `NOTICE.md`。

## 本地开发

要求 Node.js 22.19+ 和 pnpm 10。

```bash
pnpm install --frozen-lockfile
pnpm run dev
```

默认开发地址是 `http://127.0.0.1:5173`。

## 验证与构建

```bash
pnpm test
pnpm exec tsc --noEmit
pnpm run docs:check
pnpm run build
pnpm run docs:routes
```

`docs:check` 会验证官方源 bytes、Git blobs、双语 pairing sidecars、83/166
清单和 locale 发布边界。`build` 还会对全部 166 个渲染页面逐页验证本地化标题与
描述、HTML 语言、self-canonical、互惠 hreflang、robots、Open Graph、Twitter、
JSON-LD、sitemap 和 `robots.txt`。审计结果写入 `reports/seo-audit.json`，构建产物
位于 `website/.dist/`。

根路由 `/` 与 `/en/` 是导航重定向，因此使用 `noindex, follow` 并指向对应语言的
Quickstart。中文 Cordis API inherited 页面当前是官方英文回退，也会 `noindex`、
指向英文 canonical，且不会被作为中文译文写入 sitemap/hreflang；Vercel 会对该
中文路由返回永久重定向并进入英文原生页面，静态 HTML 仅作为非 Vercel 环境的回退。

## Vercel 部署

生产地址：[`https://www.deepseek-harness-docs.com`](https://www.deepseek-harness-docs.com)

仓库根目录已包含 `vercel.json`。Vercel 使用：

- Install Command：`pnpm install --frozen-lockfile`
- Build Command：`pnpm run build`
- Output Directory：`website/.dist`

Vercel Project、Git 仓库连接和首次部署由维护者在 Vercel 中创建。本仓库不设置
`git.deploymentEnabled: false`；Project 连接完成后可以继续使用 Vercel Git 自动部署。
当前 canonical origin 是 `https://www.deepseek-harness-docs.com`。迁移生产域名时，
必须同时更新 `website/seo.ts`、`website/public/robots.txt` 并重新运行 SEO 审计。

通过 Vercel CLI 部署时：

```bash
npx vercel
npx vercel --prod
```

## 上游同步

详细流程位于 `.agents/skills/diff-translation/SKILL.md`。触发门禁：

```bash
python3 .agents/skills/diff-translation/scripts/snapshot_manager.py check \
  --repo-root . --require-update
```

完整同步使用同一个不可变 run ID 执行 `prepare`、`discover`、`apply`、浏览器
evidence、`verify` 和 `result`。publication control 变化会阻断自动 promote，必须先
人工核对目录、视觉、适配器或许可证。

## IndexNow

IndexNow 所有权文件位于站点根目录：

`https://www.deepseek-harness-docs.com/5ea4e0732ca042618e5286a58181a867.txt`

构建会离线验证 key 文件和 sitemap；内容部署完成后再提交当前 sitemap：

```bash
pnpm run build
pnpm run indexnow:submit
```

提交脚本只接受 `www.deepseek-harness-docs.com` 的唯一 URL，并在发送前确认线上 key
与 sitemap 和本地构建完全一致。HTTP `200`/`202` 仅表示 IndexNow 已接收通知或等待
验证，不代表页面已经抓取或收录；最终状态在 Bing Webmaster Tools 中查看。

## 目录说明

- `docs/`：官方 canonical 中英文 Markdown、图片和 pairing records。
- `website/docs.ts`：官方 publication manifest。
- `website/.vitepress/config.ts`：官方 VitePress 视觉与导航配置。
- `scripts/project-doc-site.ts`：基于官方 projector 的本地适配器。
- `config/`：上游锁、Git tree、路由清单和 locale 发布状态。
- `.agents/skills/diff-translation/`：增量同步、恢复、验证与结果工作流。
