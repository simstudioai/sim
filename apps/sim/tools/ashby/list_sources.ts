import type { ToolConfig, ToolResponse } from '@/tools/types'

interface AshbyListSourcesParams {
  apiKey: string
}

interface AshbyListSourcesResponse extends ToolResponse {
  output: {
    sources: Array<{
      id: string
      title: string
      isArchived: boolean
    }>
  }
}

export const listSourcesTool: ToolConfig<AshbyListSourcesParams, AshbyListSourcesResponse> = {
  id: 'ashby_list_sources',
  name: 'Ashby List Sources',
  description: 'Lists all candidate sources configured in Ashby.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Ashby API Key',
    },
  },

  request: {
    url: 'https://api.ashbyhq.com/source.list',
    method: 'POST',
    headers: (params) => ({
      'Content-Type': 'application/json',
      Authorization: `Basic ${btoa(`${params.apiKey}:`)}`,
    }),
    body: () => ({}),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!data.success) {
      throw new Error(data.errorInfo?.message || 'Failed to list sources')
    }

    return {
      success: true,
      output: {
        sources: (data.results ?? []).map((s: Record<string, unknown>) => ({
          id: s.id ?? null,
          title: s.title ?? null,
          isArchived: s.isArchived ?? false,
        })),
      },
    }
  },

  outputs: {
    sources: {
      type: 'array',
      description: 'List of sources',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Source UUID' },
          title: { type: 'string', description: 'Source title' },
          isArchived: { type: 'boolean', description: 'Whether the source is archived' },
        },
      },
    },
  },
}
