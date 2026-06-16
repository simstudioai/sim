import type { AgiloftSavedSearchParams, AgiloftSavedSearchResponse } from '@/tools/agiloft/types'
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
    url: () => '/api/tools/agiloft/saved_search',
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      instanceUrl: params.instanceUrl,
      knowledgeBase: params.knowledgeBase,
      login: params.login,
      password: params.password,
      table: params.table,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    return {
      success: data.success ?? true,
      output: data.output,
      ...(data.error ? { error: data.error } : {}),
    }
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
          id: { type: 'number', description: 'Saved search database identifier' },
          description: {
            type: 'string',
            description: 'Saved search description',
            optional: true,
          },
        },
      },
    },
  },
}
