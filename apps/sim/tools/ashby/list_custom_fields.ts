import type { ToolConfig, ToolResponse } from '@/tools/types'

interface AshbyListCustomFieldsParams {
  apiKey: string
}

interface AshbyListCustomFieldsResponse extends ToolResponse {
  output: {
    customFields: Array<{
      id: string
      title: string
      fieldType: string
      objectType: string
      isArchived: boolean
    }>
  }
}

export const listCustomFieldsTool: ToolConfig<
  AshbyListCustomFieldsParams,
  AshbyListCustomFieldsResponse
> = {
  id: 'ashby_list_custom_fields',
  name: 'Ashby List Custom Fields',
  description: 'Lists all custom field definitions configured in Ashby.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Ashby API Key',
    },
  },

  request: {
    url: 'https://api.ashbyhq.com/customField.list',
    method: 'POST',
    headers: (params) => ({
      'Content-Type': 'application/json',
      Authorization: `Basic ${btoa(`${params.apiKey}:`)}`,
    }),
    body: () => ({}),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!data.success) {
      throw new Error(data.errorInfo?.message || 'Failed to list custom fields')
    }

    return {
      success: true,
      output: {
        customFields: (data.results ?? []).map((f: Record<string, unknown>) => ({
          id: f.id ?? null,
          title: f.title ?? null,
          fieldType: f.fieldType ?? null,
          objectType: f.objectType ?? null,
          isArchived: f.isArchived ?? false,
        })),
      },
    }
  },

  outputs: {
    customFields: {
      type: 'array',
      description: 'List of custom field definitions',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Custom field UUID' },
          title: { type: 'string', description: 'Custom field title' },
          fieldType: { type: 'string', description: 'Field type (e.g. String, Number, Boolean)' },
          objectType: {
            type: 'string',
            description: 'Object type the field applies to (e.g. Candidate, Application, Job)',
          },
          isArchived: { type: 'boolean', description: 'Whether the custom field is archived' },
        },
      },
    },
  },
}
