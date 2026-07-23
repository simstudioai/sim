import { isRecordLike } from '@sim/utils/object'
import {
  CLICKUP_API_BASE_URL,
  CLICKUP_CHECKLIST_OUTPUT_PROPERTIES,
  clickupAuthorizationHeader,
  extractClickUpErrorMessage,
  mapClickUpChecklist,
} from '@/tools/clickup/shared'
import type {
  ClickUpChecklistResponse,
  ClickUpUpdateChecklistItemParams,
} from '@/tools/clickup/types'
import type { ToolConfig } from '@/tools/types'

export const clickupUpdateChecklistItemTool: ToolConfig<
  ClickUpUpdateChecklistItemParams,
  ClickUpChecklistResponse
> = {
  id: 'clickup_update_checklist_item',
  name: 'ClickUp Update Checklist Item',
  description: 'Update a checklist item on a ClickUp task — rename, assign, resolve, or nest it',
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
      description: 'UUID of the checklist item to update',
    },
    name: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New name for the checklist item',
    },
    assignee: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'User ID to assign the item to',
    },
    resolved: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether the item is resolved',
    },
    parent: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'UUID of another checklist item to nest this item under',
    },
  },

  request: {
    url: (params) =>
      `${CLICKUP_API_BASE_URL}/checklist/${encodeURIComponent(params.checklistId)}/checklist_item/${encodeURIComponent(params.checklistItemId)}`,
    method: 'PUT',
    headers: (params) => ({
      Authorization: clickupAuthorizationHeader(params.accessToken),
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const body: Record<string, unknown> = {}

      if (params.name !== undefined) body.name = params.name
      if (params.assignee !== undefined) body.assignee = params.assignee
      if (params.resolved !== undefined) body.resolved = params.resolved
      if (params.parent !== undefined) body.parent = params.parent

      if (Object.keys(body).length === 0) {
        throw new Error(
          'At least one of name, assignee, resolved, or parent is required to update a checklist item'
        )
      }

      return body
    },
  },

  transformResponse: async (response) => {
    const data = await response.json().catch(() => null)

    if (!response.ok) {
      const error = extractClickUpErrorMessage(response, data, 'Failed to update checklist item')
      return { success: false, output: { error }, error }
    }

    return {
      success: true,
      output: { checklist: mapClickUpChecklist(isRecordLike(data) ? data.checklist : null) },
    }
  },

  outputs: {
    checklist: {
      type: 'json',
      description: 'The updated checklist including its items',
      optional: true,
      properties: CLICKUP_CHECKLIST_OUTPUT_PROPERTIES,
    },
  },
}
