import {
  ACTION_ITEM_OUTPUT_PROPERTIES,
  type CirclebackActionItemListResponse,
  type CirclebackListActionItemsParams,
} from '@/tools/circleback/types'
import {
  appendListParams,
  CIRCLEBACK_API_BASE,
  circlebackHeaders,
  mapActionItem,
  parseNextCursor,
  type RawCirclebackActionItem,
  throwCirclebackError,
  toIdList,
} from '@/tools/circleback/utils'
import type { ToolConfig } from '@/tools/types'

export const listActionItemsTool: ToolConfig<
  CirclebackListActionItemsParams,
  CirclebackActionItemListResponse
> = {
  id: 'circleback_list_action_items',
  name: 'Circleback List Action Items',
  description:
    'Lists action items across the authenticated user meetings, filtered by assignee, status, tags, and attendees. Defaults to incomplete action items assigned to the API key owner.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Circleback API key',
    },
    assigneeType: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'The assignee scope to filter by: Me, NotMe, Profile, MyWorkspace, OutsideMyWorkspace, Unassigned, or Anyone. Defaults to Me',
    },
    assigneeProfileId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Profile ID of the assignee to filter by',
    },
    assigneeTeamId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Team ID of the assignee to filter by',
    },
    status: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Completion status to filter by: PENDING or DONE. Defaults to incomplete action items',
    },
    attendeeProfileIds: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated profile IDs of meeting attendees to filter by',
    },
    tagIds: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated tag IDs to filter by',
    },
    cursor: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Pagination cursor from a previous response',
    },
  },

  request: {
    url: (params) => {
      const url = new URL(`${CIRCLEBACK_API_BASE}/action-items`)
      if (params.assigneeType) url.searchParams.append('assigneeType', params.assigneeType)
      if (params.assigneeProfileId) {
        url.searchParams.append('assigneeProfileId', String(params.assigneeProfileId))
      }
      if (params.assigneeTeamId) {
        url.searchParams.append('assigneeTeamId', String(params.assigneeTeamId))
      }
      if (params.status) url.searchParams.append('status', params.status)
      appendListParams(url, 'attendeeProfileIds', toIdList(params.attendeeProfileIds))
      appendListParams(url, 'tagIds', toIdList(params.tagIds))
      if (params.cursor) url.searchParams.append('cursor', params.cursor)
      return url.toString()
    },
    method: 'GET',
    headers: (params) => circlebackHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) await throwCirclebackError(response)

    const data = await response.json()
    const nextCursor = parseNextCursor(response)

    return {
      success: true,
      output: {
        actionItems: (Array.isArray(data) ? data : []).map(
          (item: RawCirclebackActionItem & { canEditActionItem?: boolean }) => ({
            ...mapActionItem(item),
            canEditActionItem: item.canEditActionItem ?? false,
          })
        ),
        nextCursor,
        hasMore: nextCursor !== null,
      },
    }
  },

  outputs: {
    actionItems: {
      type: 'array',
      description:
        'The action items on this page. Each also carries canEditActionItem, whether the caller may edit it',
      items: { type: 'object', properties: ACTION_ITEM_OUTPUT_PROPERTIES },
    },
    nextCursor: {
      type: 'string',
      nullable: true,
      description: 'Pagination cursor for the next page, or null on the last page',
    },
    hasMore: {
      type: 'boolean',
      description: 'Whether another page of action items is available',
    },
  },
}
