import type { CustomFieldsCreateParams, CustomFieldsCreateResponse } from '@/tools/incidentio/types'
import type { ToolConfig } from '@/tools/types'

export const customFieldsCreateTool: ToolConfig<
  CustomFieldsCreateParams,
  CustomFieldsCreateResponse
> = {
  id: 'incidentio_custom_fields_create',
  name: 'incident.io Custom Fields Create',
  description: 'Create a new custom field in incident.io.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'incident.io API Key',
    },
    name: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Name of the custom field (e.g., "Affected Service")',
    },
    description: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Description of the custom field (required)',
    },
    field_type: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Type of the custom field (e.g., text, single_select, multi_select, numeric, datetime, link, user, team)',
    },
  },

  request: {
    url: 'https://api.incident.io/v2/custom_fields',
    method: 'POST',
    headers: (params) => ({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.apiKey}`,
    }),
    body: (params) => {
      return {
        name: params.name,
        field_type: params.field_type,
        description: params.description,
      }
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
      description: 'Created custom field',
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
