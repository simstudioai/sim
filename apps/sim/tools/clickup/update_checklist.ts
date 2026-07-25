import {
  CLICKUP_API_BASE_URL,
  clickupAuthorizationHeader,
  extractClickUpErrorMessage,
} from '@/tools/clickup/shared'
import type {
  ClickUpUpdateChecklistParams,
  ClickUpUpdateChecklistResponse,
} from '@/tools/clickup/types'
import type { ToolConfig } from '@/tools/types'

export const clickupUpdateChecklistTool: ToolConfig<
  ClickUpUpdateChecklistParams,
  ClickUpUpdateChecklistResponse
> = {
  id: 'clickup_update_checklist',
  name: 'ClickUp Update Checklist',
  description: 'Rename or reorder a checklist on a ClickUp task',
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
      description: 'UUID of the checklist to update',
    },
    name: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New name for the checklist',
    },
    position: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'New position of the checklist on the task (0 places it first)',
    },
  },

  request: {
    url: (params) => `${CLICKUP_API_BASE_URL}/checklist/${encodeURIComponent(params.checklistId)}`,
    method: 'PUT',
    headers: (params) => ({
      Authorization: clickupAuthorizationHeader(params.accessToken),
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const body: Record<string, unknown> = {}

      if (params.name !== undefined) body.name = params.name
      if (params.position !== undefined) body.position = params.position

      if (Object.keys(body).length === 0) {
        throw new Error('At least one of name or position is required to update a checklist')
      }

      return body
    },
  },

  transformResponse: async (response, params) => {
    if (!response.ok) {
      const data = await response.json().catch(() => null)
      const error = extractClickUpErrorMessage(response, data, 'Failed to update checklist')
      return { success: false, output: { error }, error }
    }

    return {
      success: true,
      output: { id: params?.checklistId, updated: true },
    }
  },

  outputs: {
    id: { type: 'string', description: 'ID of the updated checklist', optional: true },
    updated: { type: 'boolean', description: 'Whether the checklist was updated', optional: true },
  },
}
