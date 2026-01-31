import type {
  GoogleGroupsRemoveAliasParams,
  GoogleGroupsRemoveAliasResponse,
} from '@/tools/google_groups/types'
import type { ToolConfig } from '@/tools/types'

export const removeAliasTool: ToolConfig<
  GoogleGroupsRemoveAliasParams,
  GoogleGroupsRemoveAliasResponse
> = {
  id: 'google_groups_remove_alias',
  name: 'Google Groups Remove Alias',
  description: 'Remove an email alias from a Google Group',
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
      description: 'The email alias to remove from the group',
    },
  },

  request: {
    url: (params) => {
      const encodedGroupKey = encodeURIComponent(params.groupKey.trim())
      const encodedAlias = encodeURIComponent(params.alias.trim())
      return `https://admin.googleapis.com/admin/directory/v1/groups/${encodedGroupKey}/aliases/${encodedAlias}`
    },
    method: 'DELETE',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response) => {
    if (!response.ok) {
      const data = await response.json()
      throw new Error(data.error?.message || 'Failed to remove group alias')
    }
    return {
      success: true,
      output: {
        deleted: true,
      },
    }
  },

  outputs: {
    deleted: { type: 'boolean', description: 'Whether the alias was successfully deleted' },
  },
}
