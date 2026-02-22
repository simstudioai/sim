import type { HexListCollectionsParams, HexListCollectionsResponse } from '@/tools/hex/types'
import type { ToolConfig } from '@/tools/types'

export const listCollectionsTool: ToolConfig<HexListCollectionsParams, HexListCollectionsResponse> =
  {
    id: 'hex_list_collections',
    name: 'Hex List Collections',
    description: 'List all collections in the Hex workspace.',
    version: '1.0.0',

    params: {
      apiKey: {
        type: 'string',
        required: true,
        visibility: 'user-only',
        description: 'Hex API token (Personal or Workspace)',
      },
      limit: {
        type: 'number',
        required: false,
        visibility: 'user-or-llm',
        description: 'Maximum number of collections to return (1-500, default: 25)',
      },
      sortBy: {
        type: 'string',
        required: false,
        visibility: 'user-only',
        description: 'Sort by field: NAME',
      },
    },

    request: {
      url: (params) => {
        const searchParams = new URLSearchParams()
        if (params.limit) searchParams.set('limit', String(params.limit))
        if (params.sortBy) searchParams.set('sortBy', params.sortBy)
        const qs = searchParams.toString()
        return `https://app.hex.tech/api/v1/collections${qs ? `?${qs}` : ''}`
      },
      method: 'GET',
      headers: (params) => ({
        Authorization: `Bearer ${params.apiKey}`,
        'Content-Type': 'application/json',
      }),
    },

    transformResponse: async (response: Response) => {
      const data = await response.json()
      const collections = Array.isArray(data) ? data : (data.values ?? [])

      return {
        success: true,
        output: {
          collections: collections.map((c: Record<string, unknown>) => ({
            id: (c.id as string) ?? null,
            name: (c.name as string) ?? null,
            description: (c.description as string) ?? null,
            creator: c.creator
              ? {
                  email: (c.creator as Record<string, string>).email ?? null,
                  id: (c.creator as Record<string, string>).id ?? null,
                }
              : null,
          })),
          total: collections.length,
        },
      }
    },

    outputs: {
      collections: {
        type: 'array',
        description: 'List of collections',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'Collection UUID' },
            name: { type: 'string', description: 'Collection name' },
            description: { type: 'string', description: 'Collection description', optional: true },
            creator: {
              type: 'object',
              description: 'Collection creator',
              optional: true,
              properties: {
                email: { type: 'string', description: 'Creator email' },
                id: { type: 'string', description: 'Creator UUID' },
              },
            },
          },
        },
      },
      total: { type: 'number', description: 'Total number of collections returned' },
    },
  }
