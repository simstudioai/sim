import { createLogger } from '@sim/logger'
import type { ToolConfig } from '@/tools/types'
import type { AttioCreateAttributeParams, AttioCreateAttributeResponse } from './types'
import { ATTRIBUTE_OUTPUT_PROPERTIES } from './types'

const logger = createLogger('AttioCreateAttribute')

export const attioCreateAttributeTool: ToolConfig<
  AttioCreateAttributeParams,
  AttioCreateAttributeResponse
> = {
  id: 'attio_create_attribute',
  name: 'Attio Create Attribute',
  description: 'Create a new attribute (schema field) on an Attio object or list',
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
      description: 'Whether to create the attribute on an object or a list: objects or lists',
    },
    identifier: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The object or list ID or slug (e.g. people, companies)',
    },
    title: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The attribute display title',
    },
    apiSlug: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The attribute API slug (unique, snake_case)',
    },
    type: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'The attribute value type (e.g. text, number, checkbox, currency, date, timestamp, rating, status, select, record-reference, actor-reference, location, domain, email-address, phone-number)',
    },
    description: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'A description of the attribute',
    },
    isRequired: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether new records must provide a value (default false)',
    },
    isUnique: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether the attribute enforces uniqueness on new data (default false)',
    },
    isMultiselect: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether the attribute supports multiple values (default false)',
    },
    config: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'JSON object of type-dependent configuration (e.g. currency or record-reference settings)',
    },
  },

  request: {
    url: (params) =>
      `https://api.attio.com/v2/${params.target.trim()}/${params.identifier.trim()}/attributes`,
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const data: Record<string, unknown> = {
        title: params.title,
        api_slug: params.apiSlug,
        description: params.description ?? null,
        type: params.type,
        is_required: params.isRequired ?? false,
        is_unique: params.isUnique ?? false,
        is_multiselect: params.isMultiselect ?? false,
        // `config` is a required key on Attio's create-attribute request body (even though its
        // nested fields are only required for type-dependent configs like currency/record-reference).
        config: {},
      }
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
      throw new Error(data.message || 'Failed to create attribute')
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
