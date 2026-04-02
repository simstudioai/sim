import type { RipplingListSupergroupsParams } from '@/tools/rippling/types'
import { SUPERGROUP_OUTPUT_PROPERTIES } from '@/tools/rippling/types'
import type { ToolConfig } from '@/tools/types'

export const ripplingListSupergroupsTool: ToolConfig<RipplingListSupergroupsParams> = {
  id: 'rippling_list_supergroups',
  name: 'Rippling List Supergroups',
  description: 'List all supergroups',
  version: '1.0.0',
  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Rippling API key',
    },
    filter: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter expression (filterable fields: app_owner_id, group_type)',
    },
    orderBy: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Sort field. Prefix with - for descending',
    },
  },
  request: {
    url: (params) => {
      const query = new URLSearchParams()
      if (params.filter != null) query.set('filter', params.filter)
      if (params.orderBy != null) query.set('order_by', params.orderBy)
      const qs = query.toString()
      return `https://rest.ripplingapis.com/supergroups/${qs ? `?${qs}` : ''}`
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
    const results = data.results ?? []
    return {
      success: true,
      output: {
        supergroups: results.map((item: Record<string, unknown>) => ({
          id: (item.id as string) ?? '',
          created_at: (item.created_at as string) ?? null,
          updated_at: (item.updated_at as string) ?? null,
          display_name: (item.display_name as string) ?? null,
          description: (item.description as string) ?? null,
          app_owner_id: (item.app_owner_id as string) ?? null,
          group_type: (item.group_type as string) ?? null,
          name: (item.name as string) ?? null,
          sub_group_type: (item.sub_group_type as string) ?? null,
          read_only: (item.read_only as boolean) ?? null,
          parent: (item.parent as string) ?? null,
          mutually_exclusive_key: (item.mutually_exclusive_key as string) ?? null,
          cumulatively_exhaustive_default:
            (item.cumulatively_exhaustive_default as boolean) ?? null,
          include_terminated: (item.include_terminated as boolean) ?? null,
          allow_non_employees: (item.allow_non_employees as boolean) ?? null,
          can_override_role_states: (item.can_override_role_states as boolean) ?? null,
          priority: (item.priority as number) ?? null,
          is_invisible: (item.is_invisible as boolean) ?? null,
          ignore_prov_group_matching: (item.ignore_prov_group_matching as boolean) ?? null,
        })),
        totalCount: results.length,
        nextLink: (data.next_link as string) ?? null,
        __meta: data.__meta ?? null,
      },
    }
  },
  outputs: {
    supergroups: {
      type: 'array',
      description: 'List of supergroups',
      items: { type: 'object', properties: SUPERGROUP_OUTPUT_PROPERTIES },
    },
    totalCount: { type: 'number', description: 'Number of items returned' },
    nextLink: { type: 'string', description: 'Link to next page of results', optional: true },
    __meta: { type: 'json', description: 'Metadata including redacted_fields', optional: true },
  },
}
