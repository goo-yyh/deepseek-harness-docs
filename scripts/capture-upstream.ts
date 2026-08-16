/** Capture the audited DeepSeek Harness documentation publication at one Git commit. */

import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import {
  cpSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync,
} from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { docsPages, routeLink, type DocsPage } from '../website/docs.ts'

const UPSTREAM_URL = 'https://github.com/deepseek-ai/deepseek-harness.git'
const CONTROL_FILES = [
  'website/docs.ts',
  'website/.vitepress/config.ts',
  'scripts/project-doc-site.ts',
  'website/public/wordmark.svg',
  'website/public/favicon.svg',
  'LICENSE',
] as const
const ADAPTED_CONTROLS = new Set<string>([
  'scripts/project-doc-site.ts',
  'website/.vitepress/config.ts',
])

interface Args {
  source: string
  bootstrap: boolean
}

interface TreeEntry {
  mode: string
  type: 'blob' | 'tree' | 'commit'
  object_id: string
  bytes: number | null
  path: string
}

function parseArgs(argv: string[]): Args {
  let source = ''
  let bootstrap = false
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--source') {
      source = argv[index + 1] ?? ''
      index += 1
    } else if (arg === '--bootstrap') {
      bootstrap = true
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }
  if (source === '') throw new Error('Usage: capture-upstream --source <official-checkout> [--bootstrap]')
  return { source: resolve(source), bootstrap }
}

function runGit(cwd: string, args: string[]): string {
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' }).trim()
}

function sha256(bytes: string | Buffer): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function normalizeRemote(value: string): string {
  return value
    .replace(/^git@github\.com:/, 'https://github.com/')
    .replace(/\.git$/, '')
    .replace(/\/$/, '')
}

function readTree(source: string): TreeEntry[] {
  const raw = runGit(source, ['ls-tree', '-r', '-t', '-l', 'HEAD'])
  return raw.split('\n').filter(Boolean).map((line) => {
    const match = line.match(/^(\d+) (blob|tree|commit) ([0-9a-f]+)\s+(-|\d+)\t(.+)$/)
    if (match === null) throw new Error(`Cannot parse git ls-tree row: ${line}`)
    const [, mode, type, objectId, bytes, path] = match
    if (mode === undefined || type === undefined || objectId === undefined || bytes === undefined || path === undefined) {
      throw new Error(`Incomplete git ls-tree row: ${line}`)
    }
    return {
      mode,
      type: type as TreeEntry['type'],
      object_id: objectId,
      bytes: bytes === '-' ? null : Number.parseInt(bytes, 10),
      path,
    }
  })
}

function canonicalRoute(page: DocsPage): string {
  return page.locale === 'en' ? page.route.replace(/^en\//, '') : page.route
}

function pageId(route: string): string {
  const clean = route.replace(/(?:index)?\.md$/, '').replace(/\/$/, '')
  return clean === '' ? 'home' : clean.replaceAll('/', '.')
}

function publicationManifest(commit: string): object {
  const groups = new Map<string, DocsPage[]>()
  for (const page of docsPages) {
    const route = canonicalRoute(page)
    const pages = groups.get(route) ?? []
    pages.push(page)
    groups.set(route, pages)
  }

  const pages = [...groups.entries()].map(([route, localized]) => {
    const root = localized.find(page => page.locale === 'root')
    const en = localized.find(page => page.locale === 'en')
    if (root === undefined || en === undefined) throw new Error(`Route ${route} does not publish both official locales.`)
    return {
      id: pageId(route),
      route: routeLink(route),
      module: root.sidebar === null ? 'home' : root.sidebar.replace(/^zh-/, ''),
      section: { 'zh-CN': root.section, 'en-US': en.section },
      order: root.order,
      outline: root.outline ?? null,
      locales: {
        'zh-CN': {
          source: root.source,
          label: root.label,
          content_locale: root.contentLocale,
          source_kind: root.contentLocale === 'zh-CN' ? 'official' : 'upstream_english_fallback',
        },
        'en-US': {
          source: en.source,
          label: en.label,
          content_locale: en.contentLocale,
          source_kind: 'official',
        },
      },
    }
  })

  const moduleCounts = Object.fromEntries(['guide', 'develop', 'reference'].map(module => [
    module,
    pages.filter(page => page.module === module).length,
  ]))

  return {
    schema_version: 1,
    upstream_commit: commit,
    canonical_page_count: pages.length,
    published_route_count: docsPages.length,
    official_locales: ['zh-CN', 'en-US'],
    module_counts: moduleCounts,
    pages,
  }
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}

function main(): void {
  const args = parseArgs(process.argv.slice(2))
  const root = resolve(import.meta.dirname, '..')
  if (!existsSync(join(args.source, '.git'))) throw new Error(`${args.source} is not a Git checkout.`)
  const remote = normalizeRemote(runGit(args.source, ['remote', 'get-url', 'origin']))
  if (remote !== normalizeRemote(UPSTREAM_URL)) {
    throw new Error(`Refusing non-official upstream remote: ${remote}`)
  }

  const commit = runGit(args.source, ['rev-parse', 'HEAD'])
  const branch = runGit(args.source, ['rev-parse', '--abbrev-ref', 'HEAD'])
  const tree = readTree(args.source)
  const treeByPath = new Map(tree.map(entry => [entry.path, entry]))
  const controlFiles = CONTROL_FILES.map((path) => {
    const entry = treeByPath.get(path)
    if (entry === undefined || entry.type !== 'blob') throw new Error(`Missing upstream control file: ${path}`)
    const bytes = readFileSync(join(args.source, path))
    return { path, git_blob: entry.object_id, sha256: sha256(bytes), bytes: bytes.byteLength }
  })

  const publishedSources = [...new Set(docsPages.map(page => page.source))].sort()
  const sourceFiles = publishedSources.map((path) => {
    const entry = treeByPath.get(path)
    if (entry === undefined || entry.type !== 'blob') throw new Error(`Missing upstream publication source: ${path}`)
    const bytes = readFileSync(join(args.source, path))
    return { path, git_blob: entry.object_id, sha256: sha256(bytes), bytes: bytes.byteLength }
  })
  const pairRecords = [...new Set(sourceFiles
    .map(file => file.path.replace(/\.zh\.md$/, '.md'))
    .filter(path => treeByPath.has(path.replace(/\.md$/, '.zh.md')))
    .map(path => path.replace(/\.md$/, '.i18n.yaml')))]
    .sort()
    .map((path) => {
      const entry = treeByPath.get(path)
      if (entry === undefined || entry.type !== 'blob') throw new Error(`Missing upstream pair record: ${path}`)
      const bytes = readFileSync(join(args.source, path))
      return { path, git_blob: entry.object_id, sha256: sha256(bytes), bytes: bytes.byteLength }
    })

  const manifest = publicationManifest(commit)
  const fingerprintInput = JSON.stringify({
    commit,
    controls: controlFiles.map(file => [file.path, file.git_blob]),
    sources: sourceFiles.map(file => [file.path, file.git_blob]),
    manifest,
  })
  const lock = {
    schema_version: 1,
    repository: UPSTREAM_URL.replace(/\.git$/, ''),
    branch,
    commit,
    commit_time: runGit(args.source, ['show', '-s', '--format=%cI', 'HEAD']),
    tree: runGit(args.source, ['rev-parse', 'HEAD^{tree}']),
    captured_at: new Date().toISOString(),
    publication_fingerprint: sha256(fingerprintInput),
    controls: controlFiles,
    published_sources: sourceFiles,
    pairing_records: pairRecords,
  }

  if (args.bootstrap) {
    rmSync(join(root, 'docs'), { recursive: true, force: true })
    cpSync(join(args.source, 'docs'), join(root, 'docs'), { recursive: true })
    for (const path of CONTROL_FILES) {
      if (ADAPTED_CONTROLS.has(path)) continue
      const destination = join(root, path)
      mkdirSync(dirname(destination), { recursive: true })
      cpSync(join(args.source, path), destination)
    }
  } else {
    for (const file of [...controlFiles, ...sourceFiles, ...pairRecords]) {
      if (ADAPTED_CONTROLS.has(file.path)) continue
      const local = join(root, file.path)
      if (!existsSync(local) || !statSync(local).isFile()) throw new Error(`Local locked file is missing: ${file.path}`)
      if (sha256(readFileSync(local)) !== file.sha256) throw new Error(`Local locked file differs from upstream: ${file.path}`)
    }
  }

  writeJson(join(root, 'config/upstream-tree.json'), {
    schema_version: 1,
    repository: UPSTREAM_URL.replace(/\.git$/, ''),
    commit,
    entries: tree,
  })
  writeJson(join(root, 'config/docs-manifest.json'), manifest)
  writeJson(join(root, 'config/upstream-lock.json'), lock)
  console.log(`Captured ${pagesCount(manifest)} canonical pages / ${docsPages.length} routes at ${commit}.`)
}

function pagesCount(manifest: object): number {
  const count = Reflect.get(manifest, 'canonical_page_count')
  if (typeof count !== 'number') throw new Error('Generated manifest has no canonical page count.')
  return count
}

main()
