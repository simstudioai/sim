import type {
  GoogleGroupsAddAliasParams,
  GoogleGroupsAddAliasResponse,
} from '@/tools/google_groups/types'
import type { ToolConfig } from '@/tools/types'

export const addAliasTool: ToolConfig<GoogleGroupsAddAliasParams, GoogleGroupsAddAliasResponse> = {
  id: 'google_groups_add_alias',
  name: 'Google Groups Add Alias',
  description: 'Add an email alias to a Google Group',
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
    alias: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The email alias to add to the group',
    },
  },

  request: {
    url: (params) => {
      const encodedGroupKey = encodeURIComponent(params.groupKey.trim())
      return `https://admin.googleapis.com/admin/directory/v1/groups/${encodedGroupKey}/aliases`
    },
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => ({
      alias: params.alias.trim(),
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()
    if (!response.ok) {
      throw new Error(data.error?.message || 'Failed to add group alias')
    }
    return {
      success: true,
      output: {
        id: data.id ?? null,
        primaryEmail: data.primaryEmail ?? null,
        alias: data.alias ?? null,
        kind: data.kind ?? null,
        etag: data.etag ?? null,
      },
    }
  },

  outputs: {
    id: { type: 'string', description: 'Unique group identifier' },
    primaryEmail: { type: 'string', description: "Group's primary email address" },
    alias: { type: 'string', description: 'The alias that was added' },
    kind: { type: 'string', description: 'API resource type' },
    etag: { type: 'string', description: 'Resource version identifier' },
  },
}
