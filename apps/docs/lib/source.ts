import { createElement, Fragment } from 'react'
import { type InferPageType, loader, multiple } from 'fumadocs-core/source'
import type { DocData, DocMethods } from 'fumadocs-mdx/runtime/types'
import { openapiSource } from 'fumadocs-openapi/server'
import { docs } from '@/.source/server'
import { i18n } from './i18n'
import { openapi } from './openapi'

const METHOD_COLORS: Record<string, string> = {
  GET: 'text-green-600 dark:text-green-400',
  HEAD: 'text-green-600 dark:text-green-400',
  OPTIONS: 'text-green-600 dark:text-green-400',
  POST: 'text-blue-600 dark:text-blue-400',
  PUT: 'text-yellow-600 dark:text-yellow-400',
  PATCH: 'text-orange-600 dark:text-orange-400',
  DELETE: 'text-red-600 dark:text-red-400',
}

/**
 * Custom openapi plugin that places method badges BEFORE the page name
 * in the sidebar (like Mintlify/Gumloop) instead of after.
 */
function openapiPluginBadgeLeft() {
  return {
    name: 'fumadocs:openapi-badge-left',
    enforce: 'pre' as const,
    transformPageTree: {
      file(
        this: {
          storage: {
            read: (path: string) => { format: string; data: Record<string, unknown> } | undefined
          }
        },
        node: { name: React.ReactNode },
        filePath: string | undefined
      ) {
        if (!filePath) return node
        const file = this.storage.read(filePath)
        if (!file || file.format !== 'page') return node
        const openApiData = file.data._openapi as { method?: string; webhook?: boolean } | undefined
        if (!openApiData || typeof openApiData !== 'object') return node
        if (openApiData.webhook) {
          node.name = createElement(
            Fragment,
            null,
            node.name,
            ' ',
            createElement(
              'span',
              {
                className:
                  'ms-auto border border-current px-1 rounded-lg text-xs text-nowrap font-mono',
              },
              'Webhook'
            )
          )
        } else if (openApiData.method) {
          const method = openApiData.method.toUpperCase()
          const colorClass = METHOD_COLORS[method] ?? METHOD_COLORS.GET
          node.name = createElement(
            Fragment,
            null,
            createElement(
              'span',
              { className: `font-mono font-medium me-1.5 text-[10px] text-nowrap ${colorClass}` },
              method
            ),
            node.name
          )
        }
        return node
      },
    },
  }
}

export const source = loader(
  multiple({
    docs: docs.toFumadocsSource(),
    openapi: await openapiSource(openapi, {
      baseDir: 'en/api-reference/(generated)',
      groupBy: 'tag',
    }),
  }),
  {
    baseUrl: '/',
    i18n,
    plugins: [openapiPluginBadgeLeft() as never],
  }
)

/** Full page data type including MDX content and metadata */
export type PageData = DocData &
  DocMethods & {
    title: string
    description?: string
    full?: boolean
  }

export type Page = InferPageType<typeof source>
