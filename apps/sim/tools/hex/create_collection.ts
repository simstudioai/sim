import type { HexCreateCollectionParams, HexCreateCollectionResponse } from '@/tools/hex/types'
import type { ToolConfig } from '@/tools/types'

export const createCollectionTool: ToolConfig<
  HexCreateCollectionParams,
  HexCreateCollectionResponse
> = {
  id: 'hex_create_collection',
  name: 'Hex Create Collection',
  description: 'Create a new collection in the Hex workspace to organize projects.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Hex API token (Personal or Workspace)',
    },
    name: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Name for the new collection',
    },
    description: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Optional description for the collection',
    },
  },

  request: {
    url: 'https://app.hex.tech/api/v1/collections',
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const body: Record<string, unknown> = { name: params.name }
      if (params.description) body.description = params.description
      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    return {
      success: true,
      output: {
        id: data.id ?? null,
        name: data.name ?? null,
        description: data.description ?? null,
        creator: data.creator
          ? { email: data.creator.email ?? null, id: data.creator.id ?? null }
          : null,
      },
    }
  },

  outputs: {
    id: { type: 'string', description: 'Newly created collection UUID' },
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
}
