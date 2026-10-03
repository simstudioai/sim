import {
  ACTION_ITEM_OUTPUT_PROPERTIES,
  type CirclebackActionItemResponse,
  type CirclebackUpdateActionItemParams,
} from '@/tools/circleback/types'
import {
  CIRCLEBACK_API_BASE,
  circlebackHeaders,
  mapActionItem,
  throwCirclebackError,
} from '@/tools/circleback/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const updateActionItemTool: ToolConfig<
  CirclebackUpdateActionItemParams,
  CirclebackActionItemResponse
> = {
  id: 'circleback_update_action_item',
  name: 'Circleback Update Action Item',
  description:
    'Updates the title, description, status, or assignee of a Circleback action item. Returns the updated action item.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Circleback API key',
    },
    actionItemId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The unique identifier of the action item',
    },
    title: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'The new title of the action item',
    },
    description: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'The new detailed description of the action item',
    },
    assigneeProfileId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'The profile ID to assign the action item to, or the literal text null to remove the assignee',
    },
    status: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'The completion status: PENDING or DONE',
    },
  },

  request: {
    url: (params) =>
      `${CIRCLEBACK_API_BASE}/action-item/${safeUrlPathSegment(params.actionItemId, 'actionItemId')}`,
    method: 'PUT',
    headers: (params) => circlebackHeaders(params.apiKey),
    body: (params) => {
      const body: Record<string, unknown> = {}
      if (params.title !== undefined && params.title !== '') body.title = params.title
      if (params.description !== undefined && params.description !== '') {
        body.description = params.description
      }
      if (params.assigneeProfileId !== undefined && params.assigneeProfileId !== '') {
        const raw = String(params.assigneeProfileId).trim().toLowerCase()
        if (raw === 'null' || raw === 'none') {
          body.assigneeProfileId = null
        } else {
          const profileId = Number(raw)
          /* A NaN here would serialize as null and silently unassign the item. */
          if (!Number.isInteger(profileId) || profileId <= 0) {
            throw new Error(
              'assigneeProfileId must be a positive profile ID number, or null to remove the assignee'
            )
          }
          body.assigneeProfileId = profileId
        }
      }
      if (params.status) body.status = params.status
      return body
    },
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) await throwCirclebackError(response)

    const data = await response.json()

    return {
      success: true,
      output: mapActionItem(data),
    }
  },

  outputs: ACTION_ITEM_OUTPUT_PROPERTIES,
}
