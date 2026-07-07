import { createLogger } from '@sim/logger'
import type { ToolConfig } from '@/tools/types'
import type { AttioListAttributesParams, AttioListAttributesResponse } from './types'
import { ATTRIBUTE_OUTPUT_PROPERTIES } from './types'

const logger = createLogger('AttioListAttributes')

export const attioListAttributesTool: ToolConfig<
  AttioListAttributesParams,
  AttioListAttributesResponse
> = {
  id: 'attio_list_attributes',
  name: 'Attio List Attributes',
  description: 'List the attributes (schema fields) defined on an Attio object or list',
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
      description: 'Whether the attributes belong to an object or a list: objects or lists',
    },
    identifier: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The object or list ID or slug (e.g. people, companies)',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of attributes to return',
    },
    offset: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of attributes to skip for pagination',
    },
    showArchived: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether to include archived attributes (default false)',
    },
  },

  request: {
    url: (params) => {
      const searchParams = new URLSearchParams()
      if (params.limit != null) searchParams.set('limit', String(params.limit))
      if (params.offset != null) searchParams.set('offset', String(params.offset))
      if (params.showArchived != null)
        searchParams.set('show_archived', String(params.showArchived))
      const qs = searchParams.toString()
      return `https://api.attio.com/v2/${params.target.trim()}/${params.identifier.trim()}/attributes${qs ? `?${qs}` : ''}`
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()
    if (!response.ok) {
      logger.error('Attio API request failed', { data, status: response.status })
      throw new Error(data.message || 'Failed to list attributes')
    }
    const attributes = (data.data ?? []).map((attr: Record<string, unknown>) => {
      const id = attr.id as { attribute_id?: string } | undefined
      return {
        attributeId: id?.attribute_id ?? null,
        title: (attr.title as string) ?? null,
        apiSlug: (attr.api_slug as string) ?? null,
        description: (attr.description as string) ?? null,
        type: (attr.type as string) ?? null,
        isSystemAttribute: (attr.is_system_attribute as boolean) ?? false,
        isWritable: (attr.is_writable as boolean) ?? false,
        isRequired: (attr.is_required as boolean) ?? false,
        isUnique: (attr.is_unique as boolean) ?? false,
        isMultiselect: (attr.is_multiselect as boolean) ?? false,
        isDefaultValueEnabled: (attr.is_default_value_enabled as boolean) ?? false,
        isArchived: (attr.is_archived as boolean) ?? false,
        defaultValue: (attr.default_value as Record<string, unknown>) ?? null,
        relationship: (attr.relationship as Record<string, unknown>) ?? null,
        config: (attr.config as Record<string, unknown>) ?? null,
        createdAt: (attr.created_at as string) ?? null,
      }
    })
    return {
      success: true,
      output: {
        attributes,
        count: attributes.length,
      },
    }
  },

  outputs: {
    attributes: {
      type: 'array',
      description: 'Array of attributes',
      items: {
        type: 'object',
        properties: ATTRIBUTE_OUTPUT_PROPERTIES,
      },
    },
    count: { type: 'number', description: 'Number of attributes returned' },
  },
}
