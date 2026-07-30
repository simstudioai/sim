import {
  CLICKUP_API_BASE_URL,
  clickupAuthorizationHeader,
  extractClickUpErrorMessage,
} from '@/tools/clickup/shared'
import type {
  ClickUpCustomFieldValueResponse,
  ClickUpRemoveCustomFieldValueParams,
} from '@/tools/clickup/types'
import type { ToolConfig } from '@/tools/types'

export const clickupRemoveCustomFieldValueTool: ToolConfig<
  ClickUpRemoveCustomFieldValueParams,
  ClickUpCustomFieldValueResponse
> = {
  id: 'clickup_remove_custom_field_value',
  name: 'ClickUp Remove Custom Field Value',
  description:
    'Remove the value of a custom field from a ClickUp task (does not delete the field itself)',
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
      description: 'ID of the task to remove the custom field value from',
    },
    fieldId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'UUID of the custom field to clear',
    },
  },

  request: {
    url: (params) =>
      `${CLICKUP_API_BASE_URL}/task/${encodeURIComponent(params.taskId)}/field/${encodeURIComponent(params.fieldId)}`,
    method: 'DELETE',
    headers: (params) => ({
      Authorization: clickupAuthorizationHeader(params.accessToken),
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response, params) => {
    if (!response.ok) {
      const data = await response.json().catch(() => null)
      const error = extractClickUpErrorMessage(
        response,
        data,
        'Failed to remove custom field value'
      )
      return { success: false, output: { error }, error }
    }

    return {
      success: true,
      output: { taskId: params?.taskId, fieldId: params?.fieldId },
    }
  },

  outputs: {
    taskId: { type: 'string', description: 'ID of the updated task', optional: true },
    fieldId: {
      type: 'string',
      description: 'ID of the custom field that was cleared',
      optional: true,
    },
  },
}
