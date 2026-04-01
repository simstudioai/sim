import type { RipplingGetSupergroupParams } from '@/tools/rippling/types'
import type { ToolConfig } from '@/tools/types'

export const ripplingGetSupergroupTool: ToolConfig<RipplingGetSupergroupParams> = {
  id: 'rippling_get_supergroup',
  name: 'Rippling Get Supergroup',
  description: 'Get a specific supergroup by ID',
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
      `https://rest.ripplingapis.com/supergroups/${encodeURIComponent(params.id.trim())}/`,
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
        display_name: (data.display_name as string) ?? null,
        description: (data.description as string) ?? null,
        app_owner_id: (data.app_owner_id as string) ?? null,
        group_type: (data.group_type as string) ?? null,
        name: (data.name as string) ?? null,
        sub_group_type: (data.sub_group_type as string) ?? null,
        read_only: (data.read_only as boolean) ?? null,
        parent: (data.parent as string) ?? null,
        mutually_exclusive_key: (data.mutually_exclusive_key as string) ?? null,
        cumulatively_exhaustive_default: (data.cumulatively_exhaustive_default as boolean) ?? null,
        include_terminated: (data.include_terminated as boolean) ?? null,
      },
    }
  },
  outputs: {
    id: { type: 'string', description: 'ID' },
    created_at: { type: 'string', description: 'Creation date', optional: true },
    updated_at: { type: 'string', description: 'Update date', optional: true },
    display_name: { type: 'string', description: 'Display name', optional: true },
    description: { type: 'string', description: 'Description', optional: true },
    app_owner_id: { type: 'string', description: 'App owner ID', optional: true },
    group_type: { type: 'string', description: 'Group type', optional: true },
    name: { type: 'string', description: 'Name', optional: true },
    sub_group_type: { type: 'string', description: 'Sub group type', optional: true },
    read_only: { type: 'boolean', description: 'Whether the group is read only', optional: true },
    parent: { type: 'string', description: 'Parent group ID', optional: true },
    mutually_exclusive_key: {
      type: 'string',
      description: 'Mutually exclusive key',
      optional: true,
    },
    cumulatively_exhaustive_default: {
      type: 'boolean',
      description: 'Cumulatively exhaustive default',
      optional: true,
    },
    include_terminated: {
      type: 'boolean',
      description: 'Whether the group includes terminated roles',
      optional: true,
    },
  },
}
