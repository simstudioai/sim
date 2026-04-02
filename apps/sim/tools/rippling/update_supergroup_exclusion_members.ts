import type { RipplingUpdateSupergroupExclusionMembersParams } from '@/tools/rippling/types'
import type { ToolConfig } from '@/tools/types'

export const ripplingUpdateSupergroupExclusionMembersTool: ToolConfig<RipplingUpdateSupergroupExclusionMembersParams> =
  {
    id: 'rippling_update_supergroup_exclusion_members',
    name: 'Rippling Update Supergroup Exclusion Members',
    description: 'Update exclusion members of a supergroup',
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
        `https://rest.ripplingapis.com/supergroups/${encodeURIComponent(params.groupId.trim())}/exclusion-members/`,
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
