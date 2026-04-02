import type { RipplingCreateTitleParams } from '@/tools/rippling/types'
import type { ToolConfig } from '@/tools/types'

export const ripplingCreateTitleTool: ToolConfig<RipplingCreateTitleParams> = {
  id: 'rippling_create_title',
  name: 'Rippling Create Title',
  description: 'Create a new title',
  version: '1.0.0',
  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Rippling API key',
    },
    name: { type: 'string', required: true, visibility: 'user-or-llm', description: 'Title name' },
  },
  request: {
    url: `https://rest.ripplingapis.com/titles/`,
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    }),
    body: (params) => {
      return { name: params.name }
    },
  },
  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Rippling API error (${response.status}): ${errorText}`)
    }
    const data = await response.json()
    return {
      success: true,
      output: {
        id: (data.id as string) ?? '',
        created_at: (data.created_at as string) ?? null,
        updated_at: (data.updated_at as string) ?? null,
        name: (data.name as string) ?? null,
      },
    }
  },
  outputs: {
    id: { type: 'string', description: 'Title ID' },
    created_at: { type: 'string', description: 'Creation date', optional: true },
    updated_at: { type: 'string', description: 'Update date', optional: true },
    name: { type: 'string', description: 'Title name', optional: true },
  },
}
