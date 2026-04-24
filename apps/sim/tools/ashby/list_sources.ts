import type { AshbySourceSummary } from '@/tools/ashby/types'
import type { ToolConfig, ToolResponse } from '@/tools/types'

interface AshbyListSourcesParams {
  apiKey: string
}

interface AshbyListSourcesResponse extends ToolResponse {
  output: {
    sources: AshbySourceSummary[]
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
        sources: (data.results ?? []).map(
          (s: Record<string, unknown> & { sourceType?: Record<string, unknown> }) => {
            const sourceType = s.sourceType
            return {
              id: (s.id as string) ?? '',
              title: (s.title as string) ?? '',
              isArchived: (s.isArchived as boolean) ?? false,
              sourceType: sourceType
                ? {
                    id: (sourceType.id as string) ?? '',
                    title: (sourceType.title as string) ?? '',
                    isArchived: (sourceType.isArchived as boolean) ?? false,
                  }
                : null,
            }
          }
        ),
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
          sourceType: {
            type: 'object',
            description: 'Source type grouping',
            optional: true,
            properties: {
              id: { type: 'string', description: 'Source type UUID' },
              title: { type: 'string', description: 'Source type title' },
              isArchived: { type: 'boolean', description: 'Whether archived' },
            },
          },
        },
      },
    },
  },
}
