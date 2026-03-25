import type {
  RipplingListCustomFieldsParams,
  RipplingListCustomFieldsResponse,
} from '@/tools/rippling/types'
import type { ToolConfig } from '@/tools/types'

export const ripplingListCustomFieldsTool: ToolConfig<
  RipplingListCustomFieldsParams,
  RipplingListCustomFieldsResponse
> = {
  id: 'rippling_list_custom_fields',
  name: 'Rippling List Custom Fields',
  description: 'List all custom fields defined in Rippling',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Rippling API key',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of custom fields to return',
    },
    offset: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Offset for pagination',
    },
  },

  request: {
    url: (params) => {
      const query = new URLSearchParams()
      if (params.limit != null) query.set('limit', String(params.limit))
      if (params.offset != null) query.set('offset', String(params.offset))
      const qs = query.toString()
      return `https://api.rippling.com/platform/api/custom_fields${qs ? `?${qs}` : ''}`
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      Accept: 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Rippling API error (${response.status}): ${errorText}`)
    }

    const data = await response.json()
    const results = Array.isArray(data) ? data : (data.results ?? [])

    const customFields = results.map((field: Record<string, unknown>) => ({
      id: (field.id as string) ?? '',
      type: (field.type as string) ?? null,
      title: (field.title as string) ?? null,
      mandatory: Boolean(field.mandatory),
    }))

    return {
      success: true,
      output: {
        customFields,
        totalCount: customFields.length,
      },
    }
  },

  outputs: {
    customFields: {
      type: 'array',
      description: 'List of custom fields',
      items: {
        type: 'json',
        properties: {
          id: { type: 'string', description: 'Custom field ID' },
          type: { type: 'string', description: 'Field type' },
          title: { type: 'string', description: 'Field title' },
          mandatory: { type: 'boolean', description: 'Whether the field is mandatory' },
        },
      },
    },
    totalCount: {
      type: 'number',
      description: 'Number of custom fields returned on this page',
    },
  },
}
