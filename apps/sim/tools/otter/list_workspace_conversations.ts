import type {
  OtterListConversationsResponse,
  OtterListWorkspaceConversationsParams,
} from '@/tools/otter/types'
import {
  mapOtterConversation,
  OTTER_API_BASE,
  OTTER_CONVERSATION_PROPERTIES,
  OTTER_PAGINATION_OUTPUTS,
  otterHeaders,
  parseOtterLimit,
  readOtterDataList,
  readOtterPagination,
} from '@/tools/otter/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const otterListWorkspaceConversationsTool: ToolConfig<
  OtterListWorkspaceConversationsParams,
  OtterListConversationsResponse
> = {
  id: 'otter_list_workspace_conversations',
  name: 'Otter List Workspace Conversations',
  description:
    'List every conversation in an Otter workspace, most recent first. Requires an Otter Super Admin API key in a workspace with Super Admin enabled.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Otter API key of a Super Admin',
    },
    workspaceId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The Otter workspace ID (the id returned by Get Workspace)',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of conversations per page (1-100)',
    },
    cursor: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Pagination cursor (nextCursor from a previous response)',
    },
  },

  request: {
    url: (params) => {
      const url = new URL(
        `${OTTER_API_BASE}/workspace/${safeUrlPathSegment(params.workspaceId, 'workspaceId')}/conversations`
      )
      const limit = parseOtterLimit(params.limit)
      if (limit !== undefined) url.searchParams.set('limit', String(limit))
      const cursor = params.cursor?.trim()
      if (cursor) url.searchParams.set('cursor', cursor)
      return url.toString()
    },
    method: 'GET',
    headers: (params) => otterHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    const body = await response.json()
    return {
      success: true,
      output: {
        conversations: readOtterDataList(body).map(mapOtterConversation),
        ...readOtterPagination(body),
      },
    }
  },

  outputs: {
    conversations: {
      type: 'array',
      description: 'Workspace conversations, most recent first',
      items: { type: 'object', properties: OTTER_CONVERSATION_PROPERTIES },
    },
    ...OTTER_PAGINATION_OUTPUTS,
  },
}
