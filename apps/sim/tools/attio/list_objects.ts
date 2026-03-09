import { createLogger } from '@sim/logger'
import type { ToolConfig } from '@/tools/types'
import type { AttioListObjectsParams, AttioListObjectsResponse } from './types'
import { OBJECT_OUTPUT_PROPERTIES } from './types'

const logger = createLogger('AttioListObjects')

export const attioListObjectsTool: ToolConfig<AttioListObjectsParams, AttioListObjectsResponse> = {
  id: 'attio_list_objects',
  name: 'Attio List Objects',
  description: 'List all objects (system and custom) in the Attio workspace',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'attio',
  },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'The OAuth access token for the Attio API',
    },
  },

  request: {
    url: 'https://api.attio.com/v2/objects',
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()
    if (!response.ok) {
      logger.error('Attio API request failed', { data, status: response.status })
      throw new Error(data.message || 'Failed to list objects')
    }
    const objects = (data.data ?? []).map(
      (obj: {
        id?: { object_id?: string }
        api_slug?: string
        singular_noun?: string
        plural_noun?: string
        created_at?: string
      }) => ({
        objectId: obj.id?.object_id ?? null,
        apiSlug: obj.api_slug ?? null,
        singularNoun: obj.singular_noun ?? null,
        pluralNoun: obj.plural_noun ?? null,
        createdAt: obj.created_at ?? null,
      })
    )
    return {
      success: true,
      output: {
        objects,
        count: objects.length,
      },
    }
  },

  outputs: {
    objects: {
      type: 'array',
      description: 'Array of objects',
      items: {
        type: 'object',
        properties: OBJECT_OUTPUT_PROPERTIES,
      },
    },
    count: { type: 'number', description: 'Number of objects returned' },
  },
}
