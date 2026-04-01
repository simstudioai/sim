import type { RipplingUpdateCustomPageParams } from '@/tools/rippling/types'
import type { ToolConfig } from '@/tools/types'

export const ripplingUpdateCustomPageTool: ToolConfig<RipplingUpdateCustomPageParams> = {
  id: 'rippling_update_custom_page',
  name: 'Rippling Update CustomPage',
  description: 'Update a custom page',
  version: '1.0.0',
  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Rippling API key',
    },
    id: { type: 'string', required: true, visibility: 'user-or-llm', description: 'Page ID' },
    name: { type: 'string', required: false, visibility: 'user-or-llm', description: 'Page name' },
  },
  request: {
    url: (params) =>
      `https://rest.ripplingapis.com/custom-pages/${encodeURIComponent(params.id.trim())}/`,
    method: 'PATCH',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    }),
    body: (params) => {
      const body: Record<string, unknown> = {}
      if (params.name != null) body.name = params.name
      return body
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
        components: data.components ?? [],
        actions: data.actions ?? [],
        canvas_actions: data.canvas_actions ?? [],
        variables: data.variables ?? [],
        media: data.media ?? null,
      },
    }
  },
  outputs: {
    id: { type: 'string', description: 'Page ID' },
    created_at: { type: 'string', description: 'Creation date', optional: true },
    updated_at: { type: 'string', description: 'Update date', optional: true },
    name: { type: 'string', description: 'Name', optional: true },
    components: { type: 'json', description: 'Page components', optional: true },
    actions: { type: 'json', description: 'Page actions', optional: true },
    canvas_actions: { type: 'json', description: 'Canvas actions', optional: true },
    variables: { type: 'json', description: 'Page variables', optional: true },
    media: { type: 'json', description: 'Page media', optional: true },
  },
}
