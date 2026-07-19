import {
  CLICKUP_API_BASE_URL,
  CLICKUP_MEMBER_OUTPUT_PROPERTIES,
  clickupAuthorizationHeader,
  extractClickUpErrorMessage,
  mapClickUpMember,
} from '@/tools/clickup/shared'
import type { ClickUpGetListMembersParams, ClickUpMemberListResponse } from '@/tools/clickup/types'
import type { ToolConfig } from '@/tools/types'

export const clickupGetListMembersTool: ToolConfig<
  ClickUpGetListMembersParams,
  ClickUpMemberListResponse
> = {
  id: 'clickup_get_list_members',
  name: 'ClickUp Get List Members',
  description: 'List the workspace members who have explicit access to a ClickUp list',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'clickup',
  },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'OAuth access token or personal API token for ClickUp',
    },
    listId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the list to list members for',
    },
  },

  request: {
    url: (params) => `${CLICKUP_API_BASE_URL}/list/${encodeURIComponent(params.listId)}/member`,
    method: 'GET',
    headers: (params) => ({
      Authorization: clickupAuthorizationHeader(params.accessToken),
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json().catch(() => null)

    if (!response.ok) {
      const error = extractClickUpErrorMessage(response, data, 'Failed to get list members')
      return { success: false, output: { error }, error }
    }

    const rawMembers = Array.isArray(data?.members) ? data.members : []

    return {
      success: true,
      output: { members: rawMembers.map((member: unknown) => mapClickUpMember(member)) },
    }
  },

  outputs: {
    members: {
      type: 'array',
      description: 'Members with explicit access to the list',
      optional: true,
      items: {
        type: 'object',
        properties: CLICKUP_MEMBER_OUTPUT_PROPERTIES,
      },
    },
  },
}
