import { createLogger } from '@sim/logger'
import type { ToolConfig } from '@/tools/types'
import type { AttioGetObjectParams, AttioGetObjectResponse } from './types'
import { OBJECT_OUTPUT_PROPERTIES } from './types'

const logger = createLogger('AttioGetObject')

export const attioGetObjectTool: ToolConfig<AttioGetObjectParams, AttioGetObjectResponse> = {
  id: 'attio_get_object',
  name: 'Attio Get Object',
  description: 'Get a single object by ID or slug',
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
    object: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The object ID or slug (e.g. people, companies)',
    },
  },

  request: {
    url: (params) => `https://api.attio.com/v2/objects/${params.object}`,
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()
    if (!response.ok) {
      logger.error('Attio API request failed', { data, status: response.status })
      throw new Error(data.message || 'Failed to get object')
    }
    const obj = data.data
    return {
      success: true,
      output: {
        objectId: obj.id?.object_id ?? null,
        apiSlug: obj.api_slug ?? null,
        singularNoun: obj.singular_noun ?? null,
        pluralNoun: obj.plural_noun ?? null,
        createdAt: obj.created_at ?? null,
      },
    }
  },

  outputs: OBJECT_OUTPUT_PROPERTIES,
}
