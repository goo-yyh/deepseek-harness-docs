import type { ContentMap, LocaleId, SeoMetadata } from './projection-model.ts'

export type NavigationLabels = Record<LocaleId, string>

export interface NavigationPageNode {
  type: 'page'
  page_id: string
  labels?: NavigationLabels
}

export interface NavigationGroupNode {
  type: 'group'
  id: string
  labels: NavigationLabels
  collapsed: boolean
  items: NavigationNode[]
}

export type NavigationNode = NavigationPageNode | NavigationGroupNode

export type NavigationRoot = (NavigationPageNode | NavigationGroupNode) & { order: number }

export interface NavigationConfig {
  schema_version: 2
  menus: NavigationRoot[]
}

interface StarlightPageItem {
  label: string
  translations: Record<string, string>
  slug?: string
  link?: string
}

interface StarlightGroupItem {
  label: string
  translations: Record<string, string>
  collapsed: boolean
  items: StarlightSidebarItem[]
}

export type StarlightSidebarItem = StarlightPageItem | StarlightGroupItem

function labels(value: NavigationLabels): { label: string; translations: Record<string, string> } {
  return { label: value['zh-CN'], translations: { 'en-US': value['en-US'] } }
}

export function collectNavigationPageIds(navigation: NavigationConfig): string[] {
  const visit = (node: NavigationNode): string[] => node.type === 'page'
    ? [node.page_id]
    : node.items.flatMap(visit)
  return navigation.menus.flatMap(visit)
}

export function findNavigationPath(navigation: NavigationConfig, pageId: string): string[] | null {
  const visit = (node: NavigationNode, path: string[]): string[] | null => {
    if (node.type === 'page') return node.page_id === pageId ? path : null
    for (const item of node.items) {
      const match = visit(item, [...path, node.id])
      if (match !== null) return match
    }
    return null
  }
  for (const root of navigation.menus) {
    const match = visit(root, [])
    if (match !== null) return match
  }
  return null
}

export function validateNavigation(navigation: NavigationConfig, contentMap: ContentMap): string[] {
  const errors: string[] = []
  if (navigation.schema_version !== 2) errors.push('navigation schema_version must be 2.')
  if (!Array.isArray(navigation.menus) || navigation.menus.length === 0) errors.push('navigation menus are empty.')

  const knownPages = new Set(contentMap.target_pages.map(page => page.page_id))
  const pageOwners = new Map<string, string[]>()
  const groupIds = new Set<string>()
  const rootOrders = new Set<number>()
  let previousOrder = -Infinity

  const validateLabels = (value: NavigationLabels | undefined, owner: string): void => {
    if (value === undefined) return
    for (const locale of ['zh-CN', 'en-US'] as const) {
      if (typeof value[locale] !== 'string' || value[locale].trim() === '') errors.push(`${owner} is missing ${locale} label.`)
    }
  }

  const visit = (node: NavigationNode, path: string[], nestedGroupDepth: number): void => {
    if (node.type === 'page') {
      if (!knownPages.has(node.page_id)) errors.push(`${path.join(' > ')} references unknown page ${node.page_id}.`)
      validateLabels(node.labels, node.page_id)
      const owners = pageOwners.get(node.page_id) ?? []
      owners.push(path.join(' > ') || 'root')
      pageOwners.set(node.page_id, owners)
      return
    }

    if (groupIds.has(node.id)) errors.push(`navigation group id ${node.id} is duplicated.`)
    groupIds.add(node.id)
    validateLabels(node.labels, node.id)
    if (node.items.length === 0) errors.push(`navigation group ${node.id} is empty.`)
    if (nestedGroupDepth > 1) errors.push(`navigation group ${node.id} exceeds the supported two-level menu hierarchy.`)
    for (const item of node.items) visit(item, [...path, node.id], nestedGroupDepth + 1)
  }

  for (const root of navigation.menus) {
    if (!Number.isInteger(root.order)) errors.push('navigation root order must be an integer.')
    if (rootOrders.has(root.order)) errors.push(`navigation root order ${root.order} is duplicated.`)
    if (root.order <= previousOrder) errors.push('navigation roots are not sorted by order.')
    rootOrders.add(root.order)
    previousOrder = root.order
    visit(root, [], 0)
  }

  for (const page of contentMap.target_pages) {
    const owners = pageOwners.get(page.page_id) ?? []
    if (owners.length === 0) errors.push(`navigation omits page ${page.page_id}.`)
    if (owners.length > 1) errors.push(`navigation repeats page ${page.page_id} in ${owners.join(', ')}.`)
  }
  return errors
}

export function buildStarlightSidebar(
  navigation: NavigationConfig,
  contentMap: ContentMap,
  seo: SeoMetadata,
): StarlightSidebarItem[] {
  const errors = validateNavigation(navigation, contentMap)
  if (errors.length > 0) throw new Error(`navigation is invalid:\n- ${errors.join('\n- ')}`)
  const pageById = new Map(contentMap.target_pages.map(page => [page.page_id, page]))

  const visit = (node: NavigationNode): StarlightSidebarItem => {
    if (node.type === 'group') {
      return { ...labels(node.labels), collapsed: node.collapsed, items: node.items.map(visit) }
    }
    const page = pageById.get(node.page_id)
    if (page === undefined) throw new Error(`navigation page ${node.page_id} is missing from content-map.json.`)
    const metadata = seo.pages[node.page_id]
    const resolvedLabels = node.labels ?? {
      'zh-CN': metadata?.['zh-CN']?.title ?? metadata?.['en-US']?.title ?? node.page_id,
      'en-US': metadata?.['en-US']?.title ?? metadata?.['zh-CN']?.title ?? node.page_id,
    }
    const item = labels(resolvedLabels)
    // A locale fallback has no root-locale content entry. A manual link lets
    // Starlight create locale-aware URLs while the root route redirects to the
    // English owner page.
    if (metadata?.['zh-CN'] == null || metadata?.['en-US'] == null) return { ...item, link: page.neutral_route }
    return { ...item, slug: page.neutral_route.replace(/^\//, '') }
  }

  return navigation.menus.map(visit)
}
