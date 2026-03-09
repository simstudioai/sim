import type { CustomFieldsUpdateParams, CustomFieldsUpdateResponse } from '@/tools/incidentio/types'
import type { ToolConfig } from '@/tools/types'

export const customFieldsUpdateTool: ToolConfig<
  CustomFieldsUpdateParams,
  CustomFieldsUpdateResponse
> = {
  id: 'incidentio_custom_fields_update',
  name: 'incident.io Custom Fields Update',
  description: 'Update an existing custom field in incident.io.',
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
    name: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'New name for the custom field (e.g., "Affected Service")',
    },
    description: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'New description for the custom field (required)',
    },
  },

  request: {
    url: (params) => `https://api.incident.io/v2/custom_fields/${params.id}`,
    method: 'PUT',
    headers: (params) => ({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.apiKey}`,
    }),
    body: (params) => {
      const body: Record<string, any> = {
        name: params.name,
        description: params.description,
      }

      return body
    },
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
      description: 'Updated custom field',
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
