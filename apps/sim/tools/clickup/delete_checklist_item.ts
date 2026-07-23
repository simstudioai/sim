import {
  CLICKUP_API_BASE_URL,
  clickupAuthorizationHeader,
  extractClickUpErrorMessage,
} from '@/tools/clickup/shared'
import type { ClickUpDeleteChecklistItemParams, ClickUpDeleteResponse } from '@/tools/clickup/types'
import type { ToolConfig } from '@/tools/types'

export const clickupDeleteChecklistItemTool: ToolConfig<
  ClickUpDeleteChecklistItemParams,
  ClickUpDeleteResponse
> = {
  id: 'clickup_delete_checklist_item',
  name: 'ClickUp Delete Checklist Item',
  description: 'Delete an item from a checklist on a ClickUp task',
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
    checklistId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'UUID of the checklist containing the item',
    },
    checklistItemId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'UUID of the checklist item to delete',
    },
  },

  request: {
    url: (params) =>
      `${CLICKUP_API_BASE_URL}/checklist/${encodeURIComponent(params.checklistId)}/checklist_item/${encodeURIComponent(params.checklistItemId)}`,
    method: 'DELETE',
    headers: (params) => ({
      Authorization: clickupAuthorizationHeader(params.accessToken),
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response, params) => {
    if (!response.ok) {
      const data = await response.json().catch(() => null)
      const error = extractClickUpErrorMessage(response, data, 'Failed to delete checklist item')
      return { success: false, output: { error }, error }
    }

    return {
      success: true,
      output: { id: params?.checklistItemId, deleted: true },
    }
  },

  outputs: {
    id: { type: 'string', description: 'ID of the deleted checklist item', optional: true },
    deleted: { type: 'boolean', description: 'Whether the item was deleted', optional: true },
  },
}
