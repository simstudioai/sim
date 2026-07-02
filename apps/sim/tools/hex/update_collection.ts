import type { HexUpdateCollectionParams, HexUpdateCollectionResponse } from '@/tools/hex/types'
import type { ToolConfig } from '@/tools/types'

export const updateCollectionTool: ToolConfig<
  HexUpdateCollectionParams,
  HexUpdateCollectionResponse
> = {
  id: 'hex_update_collection',
  name: 'Hex Update Collection',
  description: 'Update the name or description of an existing Hex collection.',
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
      description: 'The UUID of the collection to update',
    },
    name: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New name for the collection',
    },
    description: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New description for the collection',
    },
  },

  request: {
    url: (params) => `https://app.hex.tech/api/v1/collections/${params.collectionId.trim()}`,
    method: 'PATCH',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const body: Record<string, unknown> = {}
      if (params.name) body.name = params.name
      if (params.description !== undefined) body.description = params.description
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
