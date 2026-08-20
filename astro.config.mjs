import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig } from 'astro/config'
import starlight from '@astrojs/starlight'
import { unified } from '@astrojs/markdown-remark'
import remarkMermaid from './src/integrations/remark-mermaid.mjs'
import { buildStarlightSidebar } from './scripts/navigation-model.ts'

const root = new URL('.', import.meta.url).pathname
const contentMap = JSON.parse(readFileSync(resolve(root, 'config/content-map.json'), 'utf8'))
const navigation = JSON.parse(readFileSync(resolve(root, 'config/navigation.json'), 'utf8'))
const seo = JSON.parse(readFileSync(resolve(root, 'config/seo-metadata.json'), 'utf8'))
const sidebar = buildStarlightSidebar(navigation, contentMap, seo)

export default defineConfig({
  site: 'https://www.deepseek-harness-docs.com',
  output: 'static',
  trailingSlash: 'never',
  redirects: {
    '/': '/start',
    '/en': '/en/start',
    '/api/cordis/inherited': '/en/api/cordis/inherited',
  },
  build: { format: 'directory' },
  markdown: { processor: unified({ remarkPlugins: [remarkMermaid] }) },
  integrations: [
    starlight({
      title: 'DeepSeek Harness Docs',
      description: 'Structured Chinese and English documentation for DeepSeek Harness.',
      favicon: '/favicon.svg',
      locales: {
        root: { label: '简体中文', lang: 'zh-CN' },
        en: { label: 'English', lang: 'en-US' },
      },
      defaultLocale: 'root',
      sidebar,
      social: [{ icon: 'github', label: 'DeepSeek Harness on GitHub', href: 'https://github.com/deepseek-ai/deepseek-harness' }],
      lastUpdated: false,
      credits: false,
      customCss: ['./src/styles/docs.css'],
      components: { Head: './src/components/Head.astro' },
    }),
  ],
})
