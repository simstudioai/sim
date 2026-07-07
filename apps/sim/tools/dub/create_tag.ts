import type { DubCreateTagParams, DubCreateTagResponse } from '@/tools/dub/types'
import type { ToolConfig } from '@/tools/types'

export const createTagTool: ToolConfig<DubCreateTagParams, DubCreateTagResponse> = {
  id: 'dub_create_tag',
  name: 'Dub Create Tag',
  description: 'Create a new tag in the workspace for organizing and filtering short links.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Dub API key',
    },
    name: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The name of the tag to create (1-50 characters)',
    },
    color: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Tag color: red, yellow, green, blue, purple, brown, gray, or pink (random if omitted)',
    },
  },

  request: {
    url: 'https://api.dub.co/tags',
    method: 'POST',
    headers: (params) => ({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.apiKey}`,
    }),
    body: (params) => {
      const body: Record<string, unknown> = { name: params.name }
      if (params.color) body.color = params.color
      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error?.message || data.error || 'Failed to create tag')
    }

    return {
      success: true,
      output: {
        id: data.id ?? '',
        name: data.name ?? '',
        color: data.color ?? '',
      },
    }
  },

  outputs: {
    id: { type: 'string', description: 'Unique ID of the created tag' },
    name: { type: 'string', description: 'Name of the tag' },
    color: { type: 'string', description: 'Color assigned to the tag' },
  },
}
