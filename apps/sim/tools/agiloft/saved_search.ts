import type { AgiloftSavedSearchParams, AgiloftSavedSearchResponse } from '@/tools/agiloft/types'
import { buildSavedSearchUrl, executeAgiloftRequest } from '@/tools/agiloft/utils'
import type { ToolConfig } from '@/tools/types'

export const agiloftSavedSearchTool: ToolConfig<
  AgiloftSavedSearchParams,
  AgiloftSavedSearchResponse
> = {
  id: 'agiloft_saved_search',
  name: 'Agiloft Saved Search',
  description: 'List saved searches defined for an Agiloft table.',
  version: '1.0.0',

  params: {
    instanceUrl: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Agiloft instance URL (e.g., https://mycompany.agiloft.com)',
    },
    knowledgeBase: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Knowledge base name',
    },
    login: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Agiloft username',
    },
    password: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Agiloft password',
    },
    table: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Table name to list saved searches for (e.g., "contracts")',
    },
  },

  request: {
    url: 'https://placeholder.agiloft.com',
    method: 'GET',
    headers: () => ({}),
  },

  directExecution: async (params) => {
    return executeAgiloftRequest<AgiloftSavedSearchResponse>(
      params,
      (base) => ({
        url: buildSavedSearchUrl(base, params),
        method: 'GET',
      }),
      async (response) => {
        if (!response.ok) {
          const errorText = await response.text()
          return {
            success: false,
            output: { searches: [] },
            error: `Agiloft error: ${response.status} - ${errorText}`,
          }
        }

        const data = (await response.json()) as Record<string, unknown>
        const result = (data.result ?? data) as Record<string, unknown>

        const searches: Array<{
          name: string
          label: string
          id: string | number
          description: string | null
        }> = []

        if (Array.isArray(result)) {
          for (const item of result as Record<string, unknown>[]) {
            searches.push({
              name: (item.name as string) ?? '',
              label: (item.label as string) ?? (item.name as string) ?? '',
              id: (item.id as string | number) ?? (item.ID as string | number) ?? '',
              description: (item.description as string | null) ?? null,
            })
          }
        }

        return {
          success: data.success !== false,
          output: {
            searches,
          },
        }
      }
    )
  },

  outputs: {
    searches: {
      type: 'array',
      description: 'List of saved searches for the table',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Saved search name' },
          label: { type: 'string', description: 'Saved search display label' },
          id: { type: 'string', description: 'Saved search database identifier' },
          description: { type: 'string', description: 'Saved search description' },
        },
      },
    },
  },
}
