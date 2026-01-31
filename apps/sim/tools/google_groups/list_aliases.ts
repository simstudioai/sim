import type {
  GoogleGroupsListAliasesParams,
  GoogleGroupsListAliasesResponse,
} from '@/tools/google_groups/types'
import type { ToolConfig } from '@/tools/types'

export const listAliasesTool: ToolConfig<
  GoogleGroupsListAliasesParams,
  GoogleGroupsListAliasesResponse
> = {
  id: 'google_groups_list_aliases',
  name: 'Google Groups List Aliases',
  description: 'List all email aliases for a Google Group',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'google-groups',
  },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'OAuth access token',
    },
    groupKey: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Group identifier. Can be the group email address (e.g., team@example.com) or the unique group ID',
    },
  },

  request: {
    url: (params) => {
      const encodedGroupKey = encodeURIComponent(params.groupKey.trim())
      return `https://admin.googleapis.com/admin/directory/v1/groups/${encodedGroupKey}/aliases`
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()
    if (!response.ok) {
      throw new Error(data.error?.message || 'Failed to list group aliases')
    }
    return {
      success: true,
      output: {
        aliases: data.aliases ?? [],
      },
    }
  },

  outputs: {
    aliases: {
      type: 'array',
      description: 'List of email aliases for the group',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Unique group identifier' },
          primaryEmail: { type: 'string', description: "Group's primary email address" },
          alias: { type: 'string', description: 'Alias email address' },
          kind: { type: 'string', description: 'API resource type' },
          etag: { type: 'string', description: 'Resource version identifier' },
        },
      },
    },
  },
}
