import { createLogger } from '@sim/logger'
import type { ToolConfig } from '@/tools/types'
import type { AttioCreateObjectParams, AttioCreateObjectResponse } from './types'
import { OBJECT_OUTPUT_PROPERTIES } from './types'

const logger = createLogger('AttioCreateObject')

export const attioCreateObjectTool: ToolConfig<AttioCreateObjectParams, AttioCreateObjectResponse> =
  {
    id: 'attio_create_object',
    name: 'Attio Create Object',
    description: 'Create a custom object in Attio',
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
      apiSlug: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'The API slug for the object (e.g. projects)',
      },
      singularNoun: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'Singular display name (e.g. Project)',
      },
      pluralNoun: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'Plural display name (e.g. Projects)',
      },
    },

    request: {
      url: 'https://api.attio.com/v2/objects',
      method: 'POST',
      headers: (params) => ({
        Authorization: `Bearer ${params.accessToken}`,
        'Content-Type': 'application/json',
      }),
      body: (params) => ({
        data: {
          api_slug: params.apiSlug,
          singular_noun: params.singularNoun,
          plural_noun: params.pluralNoun,
        },
      }),
    },

    transformResponse: async (response) => {
      const data = await response.json()
      if (!response.ok) {
        logger.error('Attio API request failed', { data, status: response.status })
        throw new Error(data.message || 'Failed to create object')
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
