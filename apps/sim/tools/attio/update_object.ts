import { createLogger } from '@sim/logger'
import type { ToolConfig } from '@/tools/types'
import type { AttioUpdateObjectParams, AttioUpdateObjectResponse } from './types'
import { OBJECT_OUTPUT_PROPERTIES } from './types'

const logger = createLogger('AttioUpdateObject')

export const attioUpdateObjectTool: ToolConfig<AttioUpdateObjectParams, AttioUpdateObjectResponse> =
  {
    id: 'attio_update_object',
    name: 'Attio Update Object',
    description: 'Update a custom object in Attio',
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
        description: 'The object ID or slug to update',
      },
      apiSlug: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'New API slug',
      },
      singularNoun: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'New singular display name',
      },
      pluralNoun: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'New plural display name',
      },
    },

    request: {
      url: (params) => `https://api.attio.com/v2/objects/${params.object}`,
      method: 'PATCH',
      headers: (params) => ({
        Authorization: `Bearer ${params.accessToken}`,
        'Content-Type': 'application/json',
      }),
      body: (params) => {
        const data: Record<string, unknown> = {}
        if (params.apiSlug != null) data.api_slug = params.apiSlug
        if (params.singularNoun != null) data.singular_noun = params.singularNoun
        if (params.pluralNoun != null) data.plural_noun = params.pluralNoun
        return { data }
      },
    },

    transformResponse: async (response) => {
      const data = await response.json()
      if (!response.ok) {
        logger.error('Attio API request failed', { data, status: response.status })
        throw new Error(data.message || 'Failed to update object')
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
