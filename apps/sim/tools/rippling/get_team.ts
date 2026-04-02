import type { RipplingGetTeamParams } from '@/tools/rippling/types'
import type { ToolConfig } from '@/tools/types'

export const ripplingGetTeamTool: ToolConfig<RipplingGetTeamParams> = {
  id: 'rippling_get_team',
  name: 'Rippling Get Team',
  description: 'Get a specific team by ID',
  version: '1.0.0',
  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Rippling API key',
    },
    id: { type: 'string', required: true, visibility: 'user-or-llm', description: 'Resource ID' },
    expand: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated fields to expand',
    },
  },
  request: {
    url: (params) => {
      const base = `https://rest.ripplingapis.com/teams/${encodeURIComponent(params.id.trim())}/`
      if (params.expand != null) return `${base}?expand=${encodeURIComponent(params.expand)}`
      return base
    },
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
        parent_id: (data.parent_id as string) ?? null,
        parent: data.parent ?? null,
        __meta: data.__meta ?? null,
      },
    }
  },
  outputs: {
    id: { type: 'string', description: 'Team ID' },
    created_at: { type: 'string', description: 'Creation date', optional: true },
    updated_at: { type: 'string', description: 'Update date', optional: true },
    name: { type: 'string', description: 'Name', optional: true },
    parent_id: { type: 'string', description: 'Parent team ID', optional: true },
    parent: { type: 'json', description: 'Expanded parent team', optional: true },
    __meta: { type: 'json', description: 'Metadata including redacted_fields', optional: true },
  },
}
