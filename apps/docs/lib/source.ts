import { createElement, Fragment } from 'react'
import { loader, multiple } from 'fumadocs-core/source'
import type { DocData, DocMethods } from 'fumadocs-mdx/runtime/types'
import { integrationNavigationPlugin } from '@/lib/integration-navigation'
import { createApiReferenceSource } from '@/lib/openapi-source'
import { cn } from '@/lib/utils'
import { docs } from '@/.source/server'

const METHOD_COLORS: Record<string, string> = {
  GET: 'text-green-800 dark:text-green-400',
  HEAD: 'text-green-800 dark:text-green-400',
  OPTIONS: 'text-green-800 dark:text-green-400',
  POST: 'text-blue-800 dark:text-blue-300',
  PUT: 'text-yellow-800 dark:text-yellow-400',
  PATCH: 'text-orange-800 dark:text-orange-300',
  DELETE: 'text-red-800 dark:text-red-400',
}

const API_NAV_LABELS: Record<string, string> = {
  'Workflow imports and workspace sync': 'Import and sync',
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

/**
 * Places HTTP method badges before page names in the sidebar.
 */
function openapiPluginBadgeLeft() {
  return {
    name: 'fumadocs:openapi-badge-left',
    enforce: 'pre' as const,
    transformPageTree: {
      folder(node: { name: React.ReactNode }) {
        if (node.name === 'Mcp servers') node.name = 'MCP servers'
        return node
      },
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
        if (filePath.startsWith('api-reference/') && typeof node.name === 'string') {
          node.name = API_NAV_LABELS[node.name] ?? node.name
        }
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
              {
                className: cn(
                  'inline-flex shrink-0 items-center justify-center rounded-md px-1 py-0.5 font-mono font-medium me-1.5 text-[10px] text-nowrap',
                  colorClass
                ),
                'data-method': method.toLowerCase(),
              },
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
    openapi: await createApiReferenceSource(),
  }),
  {
    baseUrl: '/',
    plugins: [openapiPluginBadgeLeft() as never, integrationNavigationPlugin()],
  }
)

/** Full page data type including MDX content and metadata */
export type PageData = DocData &
  DocMethods & {
    title: string
    description?: string
    full?: boolean
    integration?: { type: string; color: string }
    load: () => Promise<DocData & { lastModified?: Date }>
  }
