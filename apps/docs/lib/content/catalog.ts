import { flattenNavigation } from '@/lib/content/navigation'
import type { ContentCatalog, DocsPage, DocsSection } from '@/lib/content/types'
import catalogData from '@/.content/catalog.json'

const catalog: ContentCatalog = catalogData as ContentCatalog
const pagesByUrl = new Map(catalog.pages.map((page) => [page.url, page]))

export function getPages(): DocsPage[] {
  return catalog.pages
}

/** Resolves only canonical catalog paths, never a remote URL or filesystem path. */
export function getPage(path: string | string[] | undefined): DocsPage | undefined {
  const url = Array.isArray(path) ? `/${path.join('/')}` : (path ?? '/')
  return pagesByUrl.get(url.startsWith('/') ? url : `/${url}`)
}

export function getNavigation(section: DocsSection) {
  return catalog.navigation[section]
}

export function getNeighbours(page: DocsPage) {
  const ordered = flattenNavigation(getNavigation(page.section))
  const index = ordered.findIndex((node) => node.url === page.url)
  return {
    previous: index > 0 ? ordered[index - 1] : undefined,
    next: index >= 0 ? ordered[index + 1] : undefined,
  }
}
