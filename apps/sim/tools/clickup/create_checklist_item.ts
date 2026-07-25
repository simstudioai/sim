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
  ClickUpCreateChecklistItemParams,
} from '@/tools/clickup/types'
import type { ToolConfig } from '@/tools/types'

export const clickupCreateChecklistItemTool: ToolConfig<
  ClickUpCreateChecklistItemParams,
  ClickUpChecklistResponse
> = {
  id: 'clickup_create_checklist_item',
  name: 'ClickUp Create Checklist Item',
  description: 'Add an item to a checklist on a ClickUp task',
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
      description: 'UUID of the checklist to add the item to',
    },
    name: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Name of the checklist item',
    },
    assignee: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'User ID to assign the item to',
    },
  },

  request: {
    url: (params) =>
      `${CLICKUP_API_BASE_URL}/checklist/${encodeURIComponent(params.checklistId)}/checklist_item`,
    method: 'POST',
    headers: (params) => ({
      Authorization: clickupAuthorizationHeader(params.accessToken),
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const body: Record<string, unknown> = {
        name: params.name,
      }

      if (params.assignee !== undefined) body.assignee = params.assignee

      return body
    },
  },

  transformResponse: async (response) => {
    const data = await response.json().catch(() => null)

    if (!response.ok) {
      const error = extractClickUpErrorMessage(response, data, 'Failed to create checklist item')
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
