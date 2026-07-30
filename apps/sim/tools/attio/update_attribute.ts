import { createLogger } from '@sim/logger'
import type { ToolConfig } from '@/tools/types'
import type { AttioUpdateAttributeParams, AttioUpdateAttributeResponse } from './types'
import { ATTRIBUTE_OUTPUT_PROPERTIES } from './types'

const logger = createLogger('AttioUpdateAttribute')

export const attioUpdateAttributeTool: ToolConfig<
  AttioUpdateAttributeParams,
  AttioUpdateAttributeResponse
> = {
  id: 'attio_update_attribute',
  name: 'Attio Update Attribute',
  description: 'Update an attribute (schema field) on an Attio object or list',
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
      description: 'The attribute ID or slug to update',
    },
    title: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New attribute display title',
    },
    apiSlug: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New attribute API slug',
    },
    description: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New attribute description',
    },
    isRequired: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether new records must provide a value',
    },
    isUnique: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether the attribute enforces uniqueness on new data',
    },
    isArchived: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Archive or unarchive the attribute',
    },
    config: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'JSON object of type-dependent configuration',
    },
  },

  request: {
    url: (params) =>
      `https://api.attio.com/v2/${params.target.trim()}/${params.identifier.trim()}/attributes/${params.attribute.trim()}`,
    method: 'PATCH',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const data: Record<string, unknown> = {}
      if (params.title != null) data.title = params.title
      if (params.apiSlug != null) data.api_slug = params.apiSlug
      if (params.description != null) data.description = params.description
      if (params.isRequired != null) data.is_required = params.isRequired
      if (params.isUnique != null) data.is_unique = params.isUnique
      if (params.isArchived != null) data.is_archived = params.isArchived
      if (params.config) {
        try {
          data.config =
            typeof params.config === 'string' ? JSON.parse(params.config) : params.config
        } catch {
          throw new Error('Invalid JSON provided for attribute config')
        }
      }
      return { data }
    },
  },

  transformResponse: async (response) => {
    const data = await response.json()
    if (!response.ok) {
      logger.error('Attio API request failed', { data, status: response.status })
      throw new Error(data.message || 'Failed to update attribute')
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
