import { compareStrings } from '@sim/utils/string'
import type { DocsPage, DocsSection, NavigationMeta, NavNode } from '@/lib/content/types'
import integrationNavigation from '@/content/integration-navigation.json'

const API_LABELS: Record<string, string> = {
  'Get workflow state': 'Get state',
  'Replace workflow state': 'Replace state',
  'Apply workflow operations': 'Apply operations',
  'Update workflow variables': 'Update variables',
  'List workflow versions': 'List versions',
  'Get workflow version': 'Get version',
  'Compare workflow versions': 'Compare versions',
  'Update workflow version': 'Update version',
  'Activate workflow version': 'Activate version',
  'Revert workflow to version': 'Revert to version',
  'Get workflow deployment': 'Get deployment',
  'Update workflow public API access': 'Update public access',
  'Get workflow chat deployment': 'Get chat deployment',
  'Create or replace workflow chat deployment': 'Set chat deployment',
  'Delete workflow chat deployment': 'Delete chat deployment',
  'Rename or move workflow folder': 'Move or rename folder',
  'Get workspace fork availability': 'Get fork availability',
  'List workspace fork children': 'List fork children',
  'List workspace fork resources': 'List fork resources',
  'Update workspace fork mappings': 'Update fork mappings',
  'Update workspace fork exclusions': 'Update fork exclusions',
}

function pageNode(page: DocsPage): NavNode {
  return {
    id: page.id,
    kind: 'page',
    title: page.section === 'api' ? (API_LABELS[page.title] ?? page.title) : page.title,
    url: page.url,
    ...(page.operation ? { method: page.operation.method } : {}),
  }
}

function labelFor(value: string): string {
  if (value === 'mcp-servers') return 'MCP servers'
  return value.replace(/-/g, ' ').replace(/^./, (letter) => letter.toUpperCase())
}

/** Preserves authored ordering, index folding, section boundaries, and integration guide grouping. */
export function buildNavigation(
  pages: DocsPage[],
  metadata: Record<string, NavigationMeta>
): Record<DocsSection, NavNode[]> {
  const byPath = new Map(pages.map((page) => [page.url.slice(1), page]))
  const directories = new Set<string>()
  for (const page of pages) {
    const segments = page.operation
      ? ['api-reference', '(generated)', ...page.slugs.slice(1)]
      : page.sourcePath.replace(/\.mdx$/, '').split('/')
    for (let index = 1; index < segments.length; index++)
      directories.add(segments.slice(0, index).join('/'))
  }
  const publicPath = (value: string) =>
    value
      .split('/')
      .filter((segment) => !segment.startsWith('('))
      .join('/')
      .replace(/(^|\/)index$/, '')
  const build = (directory: string, includeIndex = false): NavNode[] => {
    const meta = metadata[directory]
    const prefix = directory ? `${directory}/` : ''
    const candidates = new Set<string>()
    for (const page of pages) {
      const source = page.operation
        ? `api-reference/(generated)/${page.slugs.slice(1).join('/')}`
        : page.sourcePath.replace(/\.mdx$/, '')
      if (!source.startsWith(prefix)) continue
      const remainder = source.slice(prefix.length)
      if (!remainder.includes('/') && (includeIndex || remainder !== 'index'))
        candidates.add(remainder)
      else if (remainder.includes('/')) candidates.add(remainder.split('/')[0])
    }
    const order = meta?.pages ?? [...candidates].sort(compareStrings)
    const nodes: NavNode[] = []
    for (const entry of order) {
      if (entry.startsWith('!')) continue
      if (/^---.*---$/.test(entry)) {
        nodes.push({ id: `${directory}:${entry}`, kind: 'label', title: entry.slice(3, -3) })
        continue
      }
      const target = `${prefix}${entry.replace(/^\.\//, '')}`
      const canonical = publicPath(target)
      const page = byPath.get(canonical)
      const isDirectory = directories.has(target)
      if (isDirectory) {
        const folder = metadata[target]
        const children = build(target)
        if (!page && !children.length)
          throw new Error(`Navigation ${directory}/meta.json references empty folder ${entry}`)
        nodes.push({
          id: target,
          kind: 'group',
          title:
            meta?.labels?.[entry] ??
            folder?.title ??
            page?.title ??
            labelFor(entry.split('/').at(-1) ?? entry),
          ...(page ? { url: page.url } : {}),
          children,
          defaultOpen: folder?.defaultOpen ?? false,
        })
      } else if (page)
        nodes.push({
          ...pageNode(page),
          ...(meta?.labels?.[entry] ? { title: meta.labels[entry] } : {}),
        })
      else throw new Error(`Navigation ${directory}/meta.json references missing page ${entry}`)
    }
    return nodes
  }
  const navigation = {
    docs: build(''),
    api: build('api-reference'),
    cli: build('cli', true),
    mcp: build('mcp', true),
  }
  const integrations = navigation.docs.find((node) => node.id === 'integrations')
  if (integrations?.children) {
    const children = integrations.children
    const grouped = new Set<string>()
    const shared: NavNode[] = []
    for (const [slug, guide] of Object.entries(integrationNavigation.guides)) {
      const page = byPath.get(`integrations/${slug}`)
      if (!page) throw new Error(`Missing integration credential guide: ${slug}`)
      const node = { ...pageNode(page), title: guide.title }
      const parentSlug = 'integration' in guide ? guide.integration : undefined
      const parent = parentSlug
        ? children.find((child) => child.url === `/integrations/${parentSlug}`)
        : undefined
      if (parent) {
        parent.kind = 'group'
        parent.children = [...(parent.children ?? []), node]
        grouped.add(page.url)
      } else if (parentSlug === undefined) {
        shared.push(node)
        grouped.add(page.url)
      } else
        throw new Error(`Unknown integration parent ${parentSlug} for credential guide ${slug}`)
    }
    for (const guide of integrationNavigation.relatedPages) {
      const parent = children.find((child) => child.url === `/integrations/${guide.integration}`)
      const page = byPath.get(guide.path)
      if (!parent || !page) throw new Error(`Unresolved related integration guide: ${guide.path}`)
      parent.kind = 'group'
      parent.children = [...(parent.children ?? []), { ...pageNode(page), title: guide.title }]
    }
    integrations.children = children
      .filter((node) => !node.url || !grouped.has(node.url))
      .sort((a, b) => a.title.localeCompare(b.title, 'en', { numeric: true, sensitivity: 'base' }))
    if (shared.length)
      integrations.children.push({
        id: 'integrations/shared-credential-guides',
        kind: 'group',
        title: 'Shared credential guides',
        children: shared,
      })
  }
  return navigation
}

/** Returns the unique taxonomy order used by previous/next navigation. */
export function flattenNavigation(nodes: NavNode[]): NavNode[] {
  const seen = new Set<string>()
  const flat: NavNode[] = []
  const walk = (items: NavNode[]) => {
    for (const item of items) {
      if (item.url && !seen.has(item.url)) {
        seen.add(item.url)
        flat.push(item)
      }
      if (item.children) walk(item.children)
    }
  }
  walk(nodes)
  return flat
}

/** Returns the same parent label used by page headers and search results. */
export function findNavigationGroup(nodes: NavNode[], url: string, label = ''): string | undefined {
  let current = label
  for (const node of nodes) {
    if (node.kind === 'label') current = node.title
    if (node.url === url) return current
    if (node.children) {
      const found = findNavigationGroup(node.children, url, node.title)
      if (found !== undefined) return found
    }
  }
}
