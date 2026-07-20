import { isRecordLike } from '@sim/utils/object'
import {
  CLICKUP_API_BASE_URL,
  CLICKUP_CHECKLIST_OUTPUT_PROPERTIES,
  clickupAuthorizationHeader,
  extractClickUpErrorMessage,
  mapClickUpChecklist,
} from '@/tools/clickup/shared'
import type { ClickUpChecklistResponse, ClickUpCreateChecklistParams } from '@/tools/clickup/types'
import type { ToolConfig } from '@/tools/types'

export const clickupCreateChecklistTool: ToolConfig<
  ClickUpCreateChecklistParams,
  ClickUpChecklistResponse
> = {
  id: 'clickup_create_checklist',
  name: 'ClickUp Create Checklist',
  description: 'Add a new checklist to a ClickUp task',
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
    taskId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the task to add the checklist to',
    },
    name: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Name of the checklist',
    },
  },

  request: {
    url: (params) => `${CLICKUP_API_BASE_URL}/task/${encodeURIComponent(params.taskId)}/checklist`,
    method: 'POST',
    headers: (params) => ({
      Authorization: clickupAuthorizationHeader(params.accessToken),
      'Content-Type': 'application/json',
    }),
    body: (params) => ({ name: params.name }),
  },

  transformResponse: async (response) => {
    const data = await response.json().catch(() => null)

    if (!response.ok) {
      const error = extractClickUpErrorMessage(response, data, 'Failed to create checklist')
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
      description: 'The created checklist',
      optional: true,
      properties: CLICKUP_CHECKLIST_OUTPUT_PROPERTIES,
    },
  },
}
