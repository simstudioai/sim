import type { RipplingGetWorkLocationParams } from '@/tools/rippling/types'
import type { ToolConfig } from '@/tools/types'

export const ripplingGetWorkLocationTool: ToolConfig<RipplingGetWorkLocationParams> = {
  id: 'rippling_get_work_location',
  name: 'Rippling Get Work Location',
  description: 'Get a specific work location by ID',
  version: '1.0.0',
  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Rippling API key',
    },
    id: { type: 'string', required: true, visibility: 'user-or-llm', description: 'Resource ID' },
  },
  request: {
    url: (params) =>
      `https://rest.ripplingapis.com/work-locations/${encodeURIComponent(params.id.trim())}/`,
    method: 'GET',
    headers: (params) => ({ Authorization: `Bearer ${params.apiKey}`, Accept: 'application/json' }),
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
        address: data.address ?? null,
        __meta: data.__meta ?? null,
      },
    }
  },
  outputs: {
    id: { type: 'string', description: 'Location ID' },
    created_at: { type: 'string', description: 'Creation date', optional: true },
    updated_at: { type: 'string', description: 'Update date', optional: true },
    name: { type: 'string', description: 'Name', optional: true },
    address: { type: 'json', description: 'Address object', optional: true },
    __meta: { type: 'json', description: 'Metadata including redacted_fields', optional: true },
  },
}
