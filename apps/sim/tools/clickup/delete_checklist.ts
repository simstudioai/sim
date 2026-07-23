import {
  CLICKUP_API_BASE_URL,
  clickupAuthorizationHeader,
  extractClickUpErrorMessage,
} from '@/tools/clickup/shared'
import type { ClickUpDeleteChecklistParams, ClickUpDeleteResponse } from '@/tools/clickup/types'
import type { ToolConfig } from '@/tools/types'

export const clickupDeleteChecklistTool: ToolConfig<
  ClickUpDeleteChecklistParams,
  ClickUpDeleteResponse
> = {
  id: 'clickup_delete_checklist',
  name: 'ClickUp Delete Checklist',
  description: 'Delete a checklist from a ClickUp task',
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
      description: 'UUID of the checklist to delete',
    },
  },

  request: {
    url: (params) => `${CLICKUP_API_BASE_URL}/checklist/${encodeURIComponent(params.checklistId)}`,
    method: 'DELETE',
    headers: (params) => ({
      Authorization: clickupAuthorizationHeader(params.accessToken),
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response, params) => {
    if (!response.ok) {
      const data = await response.json().catch(() => null)
      const error = extractClickUpErrorMessage(response, data, 'Failed to delete checklist')
      return { success: false, output: { error }, error }
    }

    return {
      success: true,
      output: { id: params?.checklistId, deleted: true },
    }
  },

  outputs: {
    id: { type: 'string', description: 'ID of the deleted checklist', optional: true },
    deleted: { type: 'boolean', description: 'Whether the checklist was deleted', optional: true },
  },
}
