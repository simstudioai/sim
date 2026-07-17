import {
  CLICKUP_API_BASE_URL,
  clickupAuthorizationHeader,
  extractClickUpErrorMessage,
  mapClickUpCustomField,
} from '@/tools/clickup/shared'
import type {
  ClickUpCustomFieldListResponse,
  ClickUpGetCustomFieldsParams,
} from '@/tools/clickup/types'
import type { ToolConfig } from '@/tools/types'

export const clickupGetCustomFieldsTool: ToolConfig<
  ClickUpGetCustomFieldsParams,
  ClickUpCustomFieldListResponse
> = {
  id: 'clickup_get_custom_fields',
  name: 'ClickUp Get Custom Fields',
  description: 'List the custom fields accessible in a ClickUp list',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'clickup',
  },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'OAuth access token or personal API token for ClickUp',
    },
    listId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the list to fetch custom fields from',
    },
  },

  request: {
    url: (params) => `${CLICKUP_API_BASE_URL}/list/${encodeURIComponent(params.listId)}/field`,
    method: 'GET',
    headers: (params) => ({
      Authorization: clickupAuthorizationHeader(params.accessToken),
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json().catch(() => null)

    if (!response.ok) {
      const error = extractClickUpErrorMessage(response, data, 'Failed to get custom fields')
      return { success: false, output: { error }, error }
    }

    const rawFields = Array.isArray(data?.fields) ? data.fields : []

    return {
      success: true,
      output: { fields: rawFields.map((field: unknown) => mapClickUpCustomField(field)) },
    }
  },

  outputs: {
    fields: {
      type: 'array',
      description: 'Custom fields accessible in the list',
      optional: true,
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Custom field ID' },
          name: { type: 'string', description: 'Custom field name', nullable: true },
          type: {
            type: 'string',
            description: 'Custom field type (e.g. text, number, drop_down)',
            nullable: true,
          },
          typeConfig: {
            type: 'json',
            description: 'Type-specific configuration (e.g. dropdown options)',
            nullable: true,
          },
          dateCreated: {
            type: 'string',
            description: 'Creation timestamp (Unix ms)',
            nullable: true,
          },
          hideFromGuests: {
            type: 'boolean',
            description: 'Whether the field is hidden from guests',
            nullable: true,
          },
        },
      },
    },
  },
}
