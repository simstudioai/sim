import type { CustomFieldsListParams, CustomFieldsListResponse } from '@/tools/incidentio/types'
import type { ToolConfig } from '@/tools/types'

export const customFieldsListTool: ToolConfig<CustomFieldsListParams, CustomFieldsListResponse> = {
  id: 'incidentio_custom_fields_list',
  name: 'incident.io Custom Fields List',
  description: 'List all custom fields from incident.io.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'incident.io API Key',
    },
  },

  request: {
    url: 'https://api.incident.io/v2/custom_fields',
    method: 'GET',
    headers: (params) => ({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.apiKey}`,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    return {
      success: true,
      output: {
        custom_fields: data.custom_fields.map((field: any) => ({
          id: field.id,
          name: field.name,
          description: field.description,
          field_type: field.field_type,
          created_at: field.created_at,
          updated_at: field.updated_at,
          options: field.options,
        })),
      },
    }
  },

  outputs: {
    custom_fields: {
      type: 'array',
      description: 'List of custom fields',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Custom field ID' },
          name: { type: 'string', description: 'Custom field name' },
          description: { type: 'string', description: 'Custom field description' },
          field_type: { type: 'string', description: 'Custom field type' },
          created_at: { type: 'string', description: 'Creation timestamp' },
          updated_at: { type: 'string', description: 'Last update timestamp' },
        },
      },
    },
  },
}
