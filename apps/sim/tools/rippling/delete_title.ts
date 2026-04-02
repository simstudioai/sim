import type { RipplingDeleteTitleParams } from '@/tools/rippling/types'
import type { ToolConfig } from '@/tools/types'

export const ripplingDeleteTitleTool: ToolConfig<RipplingDeleteTitleParams> = {
  id: 'rippling_delete_title',
  name: 'Rippling Delete Title',
  description: 'Delete a title',
  version: '1.0.0',
  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Rippling API key',
    },
    id: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the resource to delete',
    },
  },
  request: {
    url: (params) =>
      `https://rest.ripplingapis.com/titles/${encodeURIComponent(params.id.trim())}/`,
    method: 'DELETE',
    headers: (params) => ({ Authorization: `Bearer ${params.apiKey}`, Accept: 'application/json' }),
  },
  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Rippling API error (${response.status}): ${errorText}`)
    }
    return { success: true, output: { deleted: true } }
  },
  outputs: {
    deleted: { type: 'boolean', description: 'Whether the resource was deleted' },
  },
}
