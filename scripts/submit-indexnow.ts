import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { SITE_ORIGIN } from './projection-model.ts'

const INDEXNOW_ENDPOINT = 'https://api.indexnow.org/indexnow'
const KEY_FILE = '3ad568e2babd4212b27130365f0c7a16.txt'
const root = resolve(import.meta.dirname, '..')
const publicKeyPath = resolve(root, 'public', KEY_FILE)
const distKeyPath = resolve(root, 'dist', KEY_FILE)
const sitemapPath = resolve(root, 'dist/sitemap.xml')
function fail(message: string): never { throw new Error(`indexnow: ${message}`) }
function urls(xml: string): string[] {
  const entries = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(match => (match[1] ?? '').replaceAll('&amp;', '&'))
  if (entries.length === 0 || new Set(entries).size !== entries.length) fail('sitemap is empty or contains duplicates')
  return entries
}
function key(path: string): string {
  if (!existsSync(path)) fail(`missing ${path.slice(root.length + 1)}`)
  const value = readFileSync(path, 'utf8').trim()
  if (`${value}.txt` !== KEY_FILE) fail('key filename and content differ')
  return value
}
async function verifyLive(localKey: string, localUrls: string[]): Promise<void> {
  const keyResponse = await fetch(`${SITE_ORIGIN}/${KEY_FILE}`)
  if (!keyResponse.ok || (await keyResponse.text()).trim() !== localKey) fail('live key does not match')
  const sitemapResponse = await fetch(`${SITE_ORIGIN}/sitemap.xml`)
  if (!sitemapResponse.ok || JSON.stringify(urls(await sitemapResponse.text())) !== JSON.stringify(localUrls)) fail('live sitemap does not match this build')
}
const dryRun = process.argv.slice(2).length === 1 && process.argv[2] === '--dry-run'
if (process.argv.length > (dryRun ? 3 : 2)) fail('unsupported arguments')
if (!existsSync(sitemapPath)) fail('missing dist/sitemap.xml; run pnpm run build first')
const localKey = key(publicKeyPath)
if (key(distKeyPath) !== localKey) fail('built key differs from public key')
const sitemapUrls = urls(readFileSync(sitemapPath, 'utf8'))
for (const value of sitemapUrls) if (new URL(value).origin !== SITE_ORIGIN || /\/(?:ja|ko)(?:\/|$)/.test(new URL(value).pathname)) fail(`invalid URL ${value}`)
if (dryRun) {
  console.log(`indexnow: ${sitemapUrls.length} production URLs and the root key passed dry-run validation.`)
} else {
  await verifyLive(localKey, sitemapUrls)
  const response = await fetch(INDEXNOW_ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ host: new URL(SITE_ORIGIN).host, key: localKey, keyLocation: `${SITE_ORIGIN}/${KEY_FILE}`, urlList: sitemapUrls }),
  })
  if (response.status !== 200 && response.status !== 202) fail(`submission returned HTTP ${response.status}: ${(await response.text()).slice(0, 500)}`)
  console.log(`IndexNow response (1/1): ${response.status}`)
  console.log(`Submitted ${sitemapUrls.length} URL(s) from the deployed sitemap to IndexNow.`)
}
