/** Validate and submit the freshly built production sitemap to IndexNow. */

import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { SITE_ORIGIN } from '../website/seo.ts'

const INDEXNOW_ENDPOINT = 'https://api.indexnow.org/indexnow'
const KEY_FILE = '5ea4e0732ca042618e5286a58181a867.txt'
const MAX_URLS_PER_REQUEST = 10_000
const root = resolve(import.meta.dirname, '..')
const publicKeyPath = resolve(root, 'website/public', KEY_FILE)
const distKeyPath = resolve(root, 'website/.dist', KEY_FILE)
const sitemapPath = resolve(root, 'website/.dist/sitemap.xml')

function fail(message: string): never {
  throw new Error(`indexnow: ${message}`)
}

function decodeXml(value: string): string {
  return value
    .replaceAll('&amp;', '&')
    .replaceAll('&apos;', "'")
    .replaceAll('&quot;', '"')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
}

function sitemapUrls(xml: string): string[] {
  const urls = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(match => decodeXml(match[1] ?? ''))
  if (urls.length === 0) fail('sitemap contains no <loc> URLs')
  if (new Set(urls).size !== urls.length) fail('sitemap contains duplicate <loc> URLs')
  return urls
}

function readKey(path: string): string {
  if (!existsSync(path)) fail(`missing key file ${path.slice(root.length + 1)}`)
  const key = readFileSync(path, 'utf8').trim()
  if (!/^[A-Za-z0-9-]{8,128}$/.test(key)) fail('key must contain 8..128 letters, numbers, or dashes')
  if (`${key}.txt` !== KEY_FILE) fail('key file name and content differ')
  return key
}

function validateUrls(urls: string[]): void {
  for (const value of urls) {
    let url: URL
    try {
      url = new URL(value)
    } catch {
      fail(`invalid sitemap URL ${JSON.stringify(value)}`)
    }
    if (url.origin !== SITE_ORIGIN) fail(`URL is outside ${SITE_ORIGIN}: ${value}`)
    if (url.protocol !== 'https:' || url.username || url.password || url.hash) {
      fail(`URL is not a clean production HTTPS URL: ${value}`)
    }
  }
}

function sameUrls(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((url, index) => url === right[index])
}

async function verifyLivePublication(key: string, localUrls: string[]): Promise<void> {
  const keyLocation = new URL(KEY_FILE, `${SITE_ORIGIN}/`).href
  const keyResponse = await fetch(keyLocation, { redirect: 'follow' })
  if (!keyResponse.ok) fail(`live key returned HTTP ${keyResponse.status}: ${keyLocation}`)
  if ((await keyResponse.text()).trim() !== key) fail('live key content differs from the repository key')

  const sitemapUrl = new URL('/sitemap.xml', SITE_ORIGIN).href
  const sitemapResponse = await fetch(sitemapUrl, { redirect: 'follow' })
  if (!sitemapResponse.ok) fail(`live sitemap returned HTTP ${sitemapResponse.status}: ${sitemapUrl}`)
  const liveUrls = sitemapUrls(await sitemapResponse.text())
  if (!sameUrls(liveUrls, localUrls)) {
    fail('live sitemap differs from the local production build; deploy the current commit before submitting')
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const dryRun = args.length === 1 && args[0] === '--dry-run'
  if (args.length > 0 && !dryRun) fail(`unsupported arguments: ${args.join(' ')}`)
  if (!existsSync(sitemapPath)) fail('missing website/.dist/sitemap.xml; run pnpm run build first')

  const key = readKey(publicKeyPath)
  if (readKey(distKeyPath) !== key) fail('built key file differs from website/public')
  const urls = sitemapUrls(readFileSync(sitemapPath, 'utf8'))
  validateUrls(urls)

  if (dryRun) {
    console.log(`indexnow: ${urls.length} production URLs and the root key file passed dry-run validation.`)
    return
  }

  await verifyLivePublication(key, urls)
  const host = new URL(SITE_ORIGIN).host
  const keyLocation = new URL(KEY_FILE, `${SITE_ORIGIN}/`).href
  const chunks = Array.from(
    { length: Math.ceil(urls.length / MAX_URLS_PER_REQUEST) },
    (_, index) => urls.slice(index * MAX_URLS_PER_REQUEST, (index + 1) * MAX_URLS_PER_REQUEST),
  )

  for (const [index, urlList] of chunks.entries()) {
    const response = await fetch(INDEXNOW_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ host, key, keyLocation, urlList }),
    })
    if (response.status !== 200 && response.status !== 202) {
      const details = (await response.text()).trim().slice(0, 500)
      fail(`submission ${index + 1}/${chunks.length} returned HTTP ${response.status}${details ? `: ${details}` : ''}`)
    }
    console.log(`IndexNow response (${index + 1}/${chunks.length}): ${response.status}`)
  }
  console.log(`Submitted ${urls.length} URL(s) from the deployed sitemap to IndexNow.`)
}

await main()
