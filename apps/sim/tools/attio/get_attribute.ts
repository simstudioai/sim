import { createLogger } from '@sim/logger'
import type { ToolConfig } from '@/tools/types'
import type { AttioGetAttributeParams, AttioGetAttributeResponse } from './types'
import { ATTRIBUTE_OUTPUT_PROPERTIES } from './types'

const logger = createLogger('AttioGetAttribute')

export const attioGetAttributeTool: ToolConfig<AttioGetAttributeParams, AttioGetAttributeResponse> =
  {
    id: 'attio_get_attribute',
    name: 'Attio Get Attribute',
    description: 'Get a single attribute (schema field) on an Attio object or list',
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
      target: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'Whether the attribute belongs to an object or a list: objects or lists',
      },
      identifier: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'The object or list ID or slug (e.g. people, companies)',
      },
      attribute: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'The attribute ID or slug',
      },
    },

    request: {
      url: (params) =>
        `https://api.attio.com/v2/${params.target.trim()}/${params.identifier.trim()}/attributes/${params.attribute.trim()}`,
      method: 'GET',
      headers: (params) => ({
        Authorization: `Bearer ${params.accessToken}`,
      }),
    },

    transformResponse: async (response) => {
      const data = await response.json()
      if (!response.ok) {
        logger.error('Attio API request failed', { data, status: response.status })
        throw new Error(data.message || 'Failed to get attribute')
      }
      const attr = data.data
      return {
        success: true,
        output: {
          attributeId: attr.id?.attribute_id ?? null,
          title: attr.title ?? null,
          apiSlug: attr.api_slug ?? null,
          description: attr.description ?? null,
          type: attr.type ?? null,
          isSystemAttribute: attr.is_system_attribute ?? false,
          isWritable: attr.is_writable ?? false,
          isRequired: attr.is_required ?? false,
          isUnique: attr.is_unique ?? false,
          isMultiselect: attr.is_multiselect ?? false,
          isDefaultValueEnabled: attr.is_default_value_enabled ?? false,
          isArchived: attr.is_archived ?? false,
          defaultValue: attr.default_value ?? null,
          relationship: attr.relationship ?? null,
          config: attr.config ?? null,
          createdAt: attr.created_at ?? null,
        },
      }
    },

    outputs: ATTRIBUTE_OUTPUT_PROPERTIES,
  }
