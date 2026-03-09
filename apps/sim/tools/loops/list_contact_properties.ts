import type {
  LoopsListContactPropertiesParams,
  LoopsListContactPropertiesResponse,
} from '@/tools/loops/types'
import type { ToolConfig } from '@/tools/types'

export const loopsListContactPropertiesTool: ToolConfig<
  LoopsListContactPropertiesParams,
  LoopsListContactPropertiesResponse
> = {
  id: 'loops_list_contact_properties',
  name: 'Loops List Contact Properties',
  description:
    'Retrieve a list of contact properties from your Loops account. Returns each property with its key, label, and data type. Can filter to show all properties or only custom ones.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Loops API key for authentication',
    },
    list: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Filter type: "all" for all properties (default) or "custom" for custom properties only',
    },
  },

  request: {
    url: (params) => {
      const base = 'https://app.loops.so/api/v1/contacts/properties'
      if (params.list) return `${base}?list=${encodeURIComponent(params.list)}`
      return base
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!Array.isArray(data)) {
      return {
        success: false,
        output: {
          properties: [],
        },
        error: data.message ?? 'Failed to list contact properties',
      }
    }

    return {
      success: true,
      output: {
        properties: data.map((prop: Record<string, unknown>) => ({
          key: (prop.key as string) ?? '',
          label: (prop.label as string) ?? '',
          type: (prop.type as string) ?? '',
        })),
      },
    }
  },

  outputs: {
    properties: {
      type: 'array',
      description: 'Array of contact property objects',
      items: {
        type: 'object',
        properties: {
          key: { type: 'string', description: 'The property key (camelCase identifier)' },
          label: { type: 'string', description: 'The property display label' },
          type: {
            type: 'string',
            description: 'The property data type (string, number, boolean, date)',
          },
        },
      },
    },
  },
}
