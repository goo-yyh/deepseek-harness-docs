import { inject } from '@vercel/analytics'
import { inBrowser, type Theme } from 'vitepress'
import DefaultTheme from 'vitepress/theme'

export default {
  extends: DefaultTheme,
  enhanceApp() {
    if (inBrowser) inject()
  },
} satisfies Theme
