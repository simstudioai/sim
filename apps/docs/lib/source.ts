import type { StructuredData } from 'fumadocs-core/mdx-plugins/remark-structure'
import { type InferPageType, loader } from 'fumadocs-core/source'
import type { TOCItemType } from 'fumadocs-core/toc'
import type { MDXContent } from 'mdx/types'
import { docs } from '@/.source/server'
import { i18n } from './i18n'

export const source = loader({
  baseUrl: '/',
  source: docs.toFumadocsSource(),
  i18n,
})

/**
 * Extended page data type that includes MDX-specific properties
 * from fumadocs-mdx that aren't properly inferred by TypeScript
 */
export interface DocsPageData {
  title: string
  description?: string
  icon?: string
  full?: boolean
  body: MDXContent
  toc: TOCItemType[]
  structuredData: StructuredData
  _exports: Record<string, unknown>
  getText: (type: 'raw' | 'processed') => Promise<string>
  getMDAST: () => Promise<unknown>
}

export type Page = Omit<InferPageType<typeof source>, 'data'> & {
  data: DocsPageData
}
