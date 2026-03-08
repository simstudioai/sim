import type {
  LoopsCreateContactPropertyParams,
  LoopsCreateContactPropertyResponse,
} from '@/tools/loops/types'
import type { ToolConfig } from '@/tools/types'

export const loopsCreateContactPropertyTool: ToolConfig<
  LoopsCreateContactPropertyParams,
  LoopsCreateContactPropertyResponse
> = {
  id: 'loops_create_contact_property',
  name: 'Loops Create Contact Property',
  description:
    'Create a new custom contact property in your Loops account. The property name must be in camelCase format.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Loops API key for authentication',
    },
    name: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The property name in camelCase format (e.g., "favoriteColor")',
    },
    type: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The property data type (e.g., "string", "number", "boolean", "date")',
    },
  },

  request: {
    url: 'https://app.loops.so/api/v1/contacts/properties',
    method: 'POST',
    headers: (params) => ({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.apiKey}`,
    }),
    body: (params) => ({
      name: params.name,
      type: params.type,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!data.success) {
      return {
        success: false,
        output: {
          success: false,
        },
        error: data.message ?? 'Failed to create contact property',
      }
    }

    return {
      success: true,
      output: {
        success: true,
      },
    }
  },

  outputs: {
    success: {
      type: 'boolean',
      description: 'Whether the contact property was created successfully',
    },
  },
}
