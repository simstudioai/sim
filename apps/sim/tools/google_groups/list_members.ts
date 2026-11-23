import type {
  GoogleGroupsListMembersParams,
  GoogleGroupsResponse,
} from '@/tools/google_groups/types'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const listMembersTool: ToolConfig<GoogleGroupsListMembersParams, GoogleGroupsResponse> = {
  id: 'google_groups_list_members',
  name: 'Google Groups List Members',
  description: 'List all members of a Google Group',
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
    maxResults: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of results to return (1-200). Example: 50',
    },
    pageToken: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Token for fetching the next page of results',
    },
    roles: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by roles (comma-separated: OWNER, MANAGER, MEMBER)',
    },
    includeDerivedMembership: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Whether to also list indirect members inherited through nested groups (default false)',
    },
  },

  request: {
    url: (params) => {
      const encodedGroupKey = safeUrlPathSegment(params.groupKey, 'groupKey', {
        allowSeparators: true,
      })
      const url = new URL(
        `https://admin.googleapis.com/admin/directory/v1/groups/${encodedGroupKey}/members`
      )

      if (params.maxResults) {
        url.searchParams.set('maxResults', String(params.maxResults))
      }
      if (params.pageToken) {
        url.searchParams.set('pageToken', params.pageToken)
      }
      if (params.roles) {
        url.searchParams.set('roles', params.roles)
      }
      if (params.includeDerivedMembership !== undefined) {
        url.searchParams.set('includeDerivedMembership', String(params.includeDerivedMembership))
      }

      return url.toString()
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
      throw new Error(data.error?.message || 'Failed to list group members')
    }
    return {
      success: true,
      output: {
        members: data.members || [],
        nextPageToken: data.nextPageToken,
      },
    }
  },

  outputs: {
    members: {
      type: 'json',
      description: 'Array of member objects (id, email, role, type, status, etag, kind)',
    },
    nextPageToken: { type: 'string', description: 'Token for fetching next page of results' },
  },
}
