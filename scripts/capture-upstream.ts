/** Capture the official Chinese/English publication at one immutable Git commit. */

import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { LOCALES, readJson, sha256, type DocsManifest } from './projection-model.ts'

const UPSTREAM_URL = 'https://github.com/deepseek-ai/deepseek-harness.git'
const CONTROL_FILES = [
  'website/docs.ts',
  'website/.vitepress/config.ts',
  'scripts/project-doc-site.ts',
  'website/public/wordmark.svg',
  'website/public/favicon.svg',
  'LICENSE',
] as const

interface Args { source: string; bootstrap: boolean }
interface TreeEntry { mode: string; type: 'blob' | 'tree' | 'commit'; object_id: string; bytes: number | null; path: string }

function args(argv: string[]): Args {
  let source = ''
  let bootstrap = false
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--source') source = argv[++index] ?? ''
    else if (argv[index] === '--bootstrap') bootstrap = true
    else throw new Error(`capture-upstream: unknown argument ${argv[index]}`)
  }
  if (source === '') throw new Error('Usage: capture-upstream --source <official-checkout> [--bootstrap]')
  return { source: resolve(source), bootstrap }
}

function git(cwd: string, values: string[]): string {
  return execFileSync('git', ['-C', cwd, ...values], { encoding: 'utf8' }).trim()
}

function normalizeRemote(value: string): string {
  return value.replace(/^git@github\.com:/, 'https://github.com/').replace(/\.git$/, '').replace(/\/$/, '')
}

function treeEntries(source: string): TreeEntry[] {
  return git(source, ['ls-tree', '-r', '-t', '-l', 'HEAD']).split('\n').filter(Boolean).map((line) => {
    const match = line.match(/^(\d+) (blob|tree|commit) ([0-9a-f]+)\s+(-|\d+)\t(.+)$/)
    if (match === null) throw new Error(`capture-upstream: cannot parse tree row ${line}`)
    return {
      mode: match[1] as string,
      type: match[2] as TreeEntry['type'],
      object_id: match[3] as string,
      bytes: match[4] === '-' ? null : Number(match[4]),
      path: match[5] as string,
    }
  })
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}

function main(): void {
  const options = args(process.argv.slice(2))
  const root = resolve(import.meta.dirname, '..')
  if (!existsSync(join(options.source, '.git'))) throw new Error(`${options.source} is not a Git checkout.`)
  const remote = normalizeRemote(git(options.source, ['remote', 'get-url', 'origin']))
  if (remote !== normalizeRemote(UPSTREAM_URL)) throw new Error(`capture-upstream: refusing non-official remote ${remote}`)
  const commit = git(options.source, ['rev-parse', 'HEAD'])
  const entries = treeEntries(options.source)
  const byPath = new Map(entries.map(entry => [entry.path, entry]))
  const currentManifest = readJson<DocsManifest>(resolve(root, 'config/docs-manifest.json'))
  const manifest: DocsManifest = {
    ...currentManifest,
    upstream_commit: commit,
    published_route_count: currentManifest.pages.length * LOCALES.length,
  }
  const sourcePaths = [...new Set(currentManifest.pages.flatMap(page => LOCALES.map(locale => page.locales[locale].source)))].sort()
  const lockFile = (path: string) => {
    const entry = byPath.get(path)
    if (entry?.type !== 'blob') throw new Error(`capture-upstream: missing upstream blob ${path}`)
    const bytes = readFileSync(join(options.source, path))
    return { path, git_blob: entry.object_id, sha256: sha256(bytes), bytes: bytes.byteLength }
  }
  const controls = CONTROL_FILES.map(lockFile)
  const publishedSources = sourcePaths.map(lockFile)
  const pairingRecords = [...new Set(sourcePaths
    .map(path => path.replace(/\.zh\.md$/, '.md'))
    .filter(path => byPath.has(path.replace(/\.md$/, '.zh.md')))
    .map(path => path.replace(/\.md$/, '.i18n.yaml')))].sort().map(lockFile)
  const fingerprint = sha256(JSON.stringify({
    commit,
    controls: controls.map(file => [file.path, file.git_blob]),
    sources: publishedSources.map(file => [file.path, file.git_blob]),
    manifest,
  }))
  const lock = {
    schema_version: 1,
    repository: UPSTREAM_URL.replace(/\.git$/, ''),
    branch: git(options.source, ['rev-parse', '--abbrev-ref', 'HEAD']),
    commit,
    commit_time: git(options.source, ['show', '-s', '--format=%cI', 'HEAD']),
    tree: git(options.source, ['rev-parse', 'HEAD^{tree}']),
    captured_at: new Date().toISOString(),
    publication_fingerprint: fingerprint,
    controls,
    published_sources: publishedSources,
    pairing_records: pairingRecords,
  }

  if (options.bootstrap) {
    rmSync(join(root, 'docs'), { recursive: true, force: true })
    cpSync(join(options.source, 'docs'), join(root, 'docs'), { recursive: true })
    cpSync(join(options.source, 'LICENSE'), join(root, 'LICENSE'))
    cpSync(join(options.source, 'website/public/wordmark.svg'), join(root, 'public/wordmark.svg'))
    cpSync(join(options.source, 'website/public/favicon.svg'), join(root, 'public/favicon.svg'))
  } else {
    for (const file of [...publishedSources, ...pairingRecords]) {
      const local = join(root, file.path)
      if (!existsSync(local) || !statSync(local).isFile() || sha256(readFileSync(local)) !== file.sha256) {
        throw new Error(`capture-upstream: local locked file differs: ${file.path}`)
      }
    }
  }

  writeJson(join(root, 'config/upstream-tree.json'), {
    schema_version: 1,
    repository: UPSTREAM_URL.replace(/\.git$/, ''),
    commit,
    entries,
  })
  writeJson(join(root, 'config/upstream-lock.json'), lock)
  writeJson(join(root, 'config/docs-manifest.json'), manifest)
  console.log(`docs:manifest: captured ${manifest.pages.length} zh/en source page identities at ${commit}.`)
}

main()
