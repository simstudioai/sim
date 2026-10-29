import type { DocsPage } from '@/lib/content/types'

/** All public representations use the catalog's complete processed Markdown. */
export function getLLMText(page: DocsPage): string {
  return page.markdown
}

export function isApiOperationPage(page: DocsPage): boolean {
  return page.operation !== undefined
}
