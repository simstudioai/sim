import type { HexGetCollectionParams, HexGetCollectionResponse } from '@/tools/hex/types'
import type { ToolConfig } from '@/tools/types'

export const getCollectionTool: ToolConfig<HexGetCollectionParams, HexGetCollectionResponse> = {
  id: 'hex_get_collection',
  name: 'Hex Get Collection',
  description: 'Retrieve details for a specific Hex collection by its ID.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Hex API token (Personal or Workspace)',
    },
    collectionId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The UUID of the collection',
    },
  },

  request: {
    url: (params) => `https://app.hex.tech/api/v1/collections/${params.collectionId}`,
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
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
}
