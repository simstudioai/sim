import type { RipplingUpdateSupergroupInclusionMembersParams } from '@/tools/rippling/types'
import type { ToolConfig } from '@/tools/types'

export const ripplingUpdateSupergroupInclusionMembersTool: ToolConfig<RipplingUpdateSupergroupInclusionMembersParams> =
  {
    id: 'rippling_update_supergroup_inclusion_members',
    name: 'Rippling Update Supergroup Inclusion Members',
    description: 'Update inclusion members of a supergroup',
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
      operations: {
        type: 'json',
        required: true,
        visibility: 'user-or-llm',
        description: 'Operations array [{op: "add"|"remove", value: [{id: "member_id"}]}]',
      },
    },
    request: {
      url: (params) =>
        `https://rest.ripplingapis.com/supergroups/${encodeURIComponent(params.groupId.trim())}/inclusion-members/`,
      method: 'PATCH',
      headers: (params) => ({
        Authorization: `Bearer ${params.apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      }),
      body: (params) => ({ Operations: params.operations }),
    },
    transformResponse: async (response: Response) => {
      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`Rippling API error (${response.status}): ${errorText}`)
      }
      const data = await response.json()
      return { success: true, output: { ok: data.ok ?? false } }
    },
    outputs: {
      ok: { type: 'boolean', description: 'Whether the operation succeeded' },
    },
  }
