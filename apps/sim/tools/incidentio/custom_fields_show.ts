import type { CustomFieldsShowParams, CustomFieldsShowResponse } from '@/tools/incidentio/types'
import type { ToolConfig } from '@/tools/types'

export const customFieldsShowTool: ToolConfig<CustomFieldsShowParams, CustomFieldsShowResponse> = {
  id: 'incidentio_custom_fields_show',
  name: 'incident.io Custom Fields Show',
  description: 'Get detailed information about a specific custom field from incident.io.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'incident.io API Key',
    },
    id: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Custom field ID (e.g., "01FCNDV6P870EA6S7TK1DSYDG0")',
    },
  },

  request: {
    url: (params) => `https://api.incident.io/v2/custom_fields/${params.id}`,
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
        custom_field: {
          id: data.custom_field.id,
          name: data.custom_field.name,
          description: data.custom_field.description,
          field_type: data.custom_field.field_type,
          created_at: data.custom_field.created_at,
          updated_at: data.custom_field.updated_at,
          options: data.custom_field.options,
        },
      },
    }
  },

  outputs: {
    custom_field: {
      type: 'object',
      description: 'Custom field details',
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
}
