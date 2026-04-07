import type { RipplingListSupergroupInclusionMembersParams } from '@/tools/rippling/types'
import { GROUP_MEMBER_OUTPUT_PROPERTIES } from '@/tools/rippling/types'
import type { ToolConfig } from '@/tools/types'

export const ripplingListSupergroupInclusionMembersTool: ToolConfig<RipplingListSupergroupInclusionMembersParams> =
  {
    id: 'rippling_list_supergroup_inclusion_members',
    name: 'Rippling List Supergroup Inclusion Members',
    description: 'List inclusion members of a supergroup',
    version: '1.0.0',
    params: {
      apiKey: {
        type: 'string',
        required: true,
        visibility: 'user-only',
        description: 'Rippling API key',
      },
      groupId: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'Supergroup ID',
      },
      expand: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Fields to expand (e.g., worker)',
      },
      orderBy: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Sort field',
      },
    },
    request: {
      url: (params) => {
        const query = new URLSearchParams()
        if (params.expand != null) query.set('expand', params.expand)
        if (params.orderBy != null) query.set('order_by', params.orderBy)
        const qs = query.toString()
        return `https://rest.ripplingapis.com/supergroups/${encodeURIComponent(params.groupId.trim())}/inclusion-members/${qs ? `?${qs}` : ''}`
      },
      method: 'GET',
      headers: (params) => ({
        Authorization: `Bearer ${params.apiKey}`,
        Accept: 'application/json',
      }),
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
          members: results.map((item: Record<string, unknown>) => ({
            id: (item.id as string) ?? '',
            created_at: (item.created_at as string) ?? null,
            updated_at: (item.updated_at as string) ?? null,
            full_name: (item.full_name as string) ?? null,
            work_email: (item.work_email as string) ?? null,
            worker_id: (item.worker_id as string) ?? null,
            worker: item.worker ?? null,
          })),
          totalCount: results.length,
          nextLink: (data.next_link as string) ?? null,
          __meta: data.__meta ?? null,
        },
      }
    },
    outputs: {
      members: {
        type: 'array',
        description: 'List of members',
        items: { type: 'object', properties: GROUP_MEMBER_OUTPUT_PROPERTIES },
      },
      totalCount: { type: 'number', description: 'Number of members returned' },
      nextLink: { type: 'string', description: 'Next page link', optional: true },
      __meta: { type: 'json', description: 'Metadata including redacted_fields', optional: true },
    },
  }
