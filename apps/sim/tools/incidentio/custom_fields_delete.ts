import type { CustomFieldsDeleteParams, CustomFieldsDeleteResponse } from '@/tools/incidentio/types'
import type { ToolConfig } from '@/tools/types'

export const customFieldsDeleteTool: ToolConfig<
  CustomFieldsDeleteParams,
  CustomFieldsDeleteResponse
> = {
  id: 'incidentio_custom_fields_delete',
  name: 'incident.io Custom Fields Delete',
  description: 'Delete a custom field from incident.io.',
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
    method: 'DELETE',
    headers: (params) => ({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.apiKey}`,
    }),
  },

  transformResponse: async (response: Response) => {
    return {
      success: true,
      output: {
        message: 'Custom field successfully deleted',
      },
    }
  },

  outputs: {
    message: {
      type: 'string',
      description: 'Success message',
    },
  },
}
