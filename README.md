# DeepSeek Harness Structured Docs

这是一个基于 DeepSeek Harness 官方中英文文档构建的结构化检索站。站点使用
Astro + Starlight，将锁定的官方 Markdown 按完整语义段落投影到新的任务型菜单和
路由；不改写官方正文，也不复制官方 Guide / Development / Reference 页面边界。

生产 canonical origin：
[`https://www.deepseek-harness-docs.com`](https://www.deepseek-harness-docs.com)

## 产品范围

- 简体中文使用根路由，English 使用 `/en/`。
- 不支持日文、韩文，也不存在 `/ja/`、`/ko/`、翻译状态或英文回退译文。
- 83 个官方 source page 被提取为 717 个中性 segment。
- 当前投影为 85 个 target page identity、169 个中英静态页面。
- 167 个页面可索引，2 个空版本入口为 `noindex`。
- 166 个旧中英 URL 通过永久、单跳 redirect 迁移。

站点提供七组自己的信息架构：开始使用、核心机制、构建与扩展、运行与编排、
API 与类型、示例索引、版本变化。重新组织页面只能提高独立用途与可发现性，不能
保证 Google/Bing 收录或选择本站 canonical。

## 上游内容与许可

内容来自
[`deepseek-ai/deepseek-harness`](https://github.com/deepseek-ai/deepseek-harness)。
`config/upstream-lock.json` 固定上游 commit、Git tree、control、Git blob、SHA-256 和
byte length；`config/docs-manifest.json` 维护上游 page identity 与中英配对。

上游资料按仓库内 `LICENSE` 的 MIT License 使用，归属见 `NOTICE.md`。公开文档页面
不展示来源归属区块或上游 source metadata；内部锁和投影收据继续保留完整溯源。

## 内容投影

真值层如下：

- `config/source-segments.json`：从锁定 Markdown AST 确定性提取的 segment。
- `config/content-map.json`：target page、neutral route、segment owner 和 page kind。
- `config/navigation.json`：七组菜单和顺序。
- `config/seo-metadata.json`：中英文 title、description 和 indexability。
- `config/redirects.json`：旧 URL 迁移。
- `config/projection-lock.json`：projector/framework 版本和输入 hash。
- `config/projection-state/`：各 locale 的目标 route/segment receipt。

每个 segment 只能有一个 primary owner，覆盖率必须为 100%，target page 也不能完整
复刻某一个官方 source page 的有序 segment inventory。`src/content/docs/` 是忽略的
确定性生成树，不是内容真值。

## 本地开发

要求 Node.js `>=22.19.0` 和 `package.json` 固定的 pnpm 版本。

```bash
pnpm install --frozen-lockfile
pnpm run dev
```

默认地址：`http://127.0.0.1:5173`。

## 验证与构建

```bash
pnpm test
pnpm exec tsc --noEmit
pnpm run docs:check
pnpm run content:segments
pnpm run content:project
pnpm run content:audit
pnpm run check
pnpm run build
pnpm run seo:audit
pnpm run docs:routes
```

`build` 会顺序执行 source lock、segment、projection、Astro check/build、sitemap、SEO、
IndexNow dry-run、route 和 fragment 门禁。当前关键输出：

- `reports/content-projection-audit.json`
- `reports/projection-output.json`
- `reports/seo-audit.json`
- `dist/sitemap.xml`

构建还会生成 Pagefind 搜索，并验证 404、Mermaid、图片、内部锚点、canonical、
hreflang、robots、Open Graph、Twitter、JSON-LD、旧 redirect 和日/韩输出为零。

## Vercel 与 Analytics

Vercel 使用：

- Install Command：`pnpm install --frozen-lockfile`
- Build Command：`pnpm run build`
- Output Directory：`dist`

`src/components/Head.astro` 通过 `@vercel/analytics/astro` 全局注入一次 Web
Analytics。仓库改动本身不能证明 Production 已部署或 Analytics 已在线收数；需要在
exact commit 部署成功后进行线上验证。

## 上游同步

使用 `.agents/skills/diff-translation/SKILL.md`（名称为历史兼容，当前不执行目标语言
翻译）：

```bash
python3 .agents/skills/diff-translation/scripts/snapshot_manager.py check \
  --repo-root . --require-update
```

完整流程为 `prepare` → `discover` → `apply` → projection reconcile → browser evidence
→ `verify` → `result`。官方中文和英文只复制冻结 Git blob；catalog/control/license 或
segment ownership 漂移会 fail closed。新 segment 不会被自动分配到 target page。

## IndexNow

所有权文件：

`https://www.deepseek-harness-docs.com/3ad568e2babd4212b27130365f0c7a16.txt`

本地构建只执行 dry-run：

```bash
pnpm run build
```

只有 exact commit 已在 Vercel Production 成功部署，并确认线上 key、sitemap 和代表
页面与本地一致后，才运行：

```bash
pnpm run indexnow:submit
```

HTTP `200`/`202` 只表示接收或等待验证，不代表抓取、收录、canonical 选择或排名。

## 主要目录

- `docs/`：锁定的官方中文/英文 Markdown、图片和 pairing records。
- `config/`：上游、segment、投影、导航、SEO、redirect 和 locale 真值。
- `scripts/`：source capture、projector、审计、sitemap、路由与 IndexNow。
- `src/`：Astro/Starlight content schema、组件、样式和 Markdown integration。
- `public/`：robots、品牌资源和 IndexNow key。
- `.agents/skills/diff-translation/`：不可变中英文同步与恢复流程。
- `specs/0002.md`：本次产品方向和迁移实施方案。
