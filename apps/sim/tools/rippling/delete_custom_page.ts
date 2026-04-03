import type { RipplingDeleteCustomPageParams } from '@/tools/rippling/types'
import type { ToolConfig } from '@/tools/types'

export const ripplingDeleteCustomPageTool: ToolConfig<RipplingDeleteCustomPageParams> = {
  id: 'rippling_delete_custom_page',
  name: 'Rippling Delete CustomPage',
  description: 'Delete a custom page',
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
      `https://rest.ripplingapis.com/custom-pages/${encodeURIComponent(params.id.trim())}/`,
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
