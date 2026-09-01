import {
  ACTION_ITEM_OUTPUT_PROPERTIES,
  type CirclebackActionItemResponse,
  type CirclebackDeleteActionItemParams,
} from '@/tools/circleback/types'
import {
  CIRCLEBACK_API_BASE,
  circlebackHeaders,
  mapActionItem,
  throwCirclebackError,
} from '@/tools/circleback/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const deleteActionItemTool: ToolConfig<
  CirclebackDeleteActionItemParams,
  CirclebackActionItemResponse
> = {
  id: 'circleback_delete_action_item',
  name: 'Circleback Delete Action Item',
  description: 'Deletes a Circleback action item. Returns the deleted action item.',
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
  },

  request: {
    url: (params) =>
      `${CIRCLEBACK_API_BASE}/action-item/${safeUrlPathSegment(params.actionItemId, 'actionItemId')}`,
    method: 'DELETE',
    headers: (params) => circlebackHeaders(params.apiKey),
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
