import {
  CLICKUP_API_BASE_URL,
  clickupAuthorizationHeader,
  extractClickUpErrorMessage,
} from '@/tools/clickup/shared'
import type {
  ClickUpCustomFieldValueResponse,
  ClickUpSetCustomFieldValueParams,
} from '@/tools/clickup/types'
import type { ToolConfig } from '@/tools/types'

export const clickupSetCustomFieldValueTool: ToolConfig<
  ClickUpSetCustomFieldValueParams,
  ClickUpCustomFieldValueResponse
> = {
  id: 'clickup_set_custom_field_value',
  name: 'ClickUp Set Custom Field Value',
  description:
    'Set the value of a custom field on a ClickUp task (the value shape depends on the field type)',
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
      description: 'ID of the task to set the custom field on',
    },
    fieldId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'UUID of the custom field (find it with the Get Custom Fields or Get Task operations)',
    },
    value: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Value to set. The shape depends on the field type: text/number fields take a plain value, label fields take an array of option UUIDs, dropdown fields take an option UUID',
    },
  },

  request: {
    url: (params) =>
      `${CLICKUP_API_BASE_URL}/task/${encodeURIComponent(params.taskId)}/field/${encodeURIComponent(params.fieldId)}`,
    method: 'POST',
    headers: (params) => ({
      Authorization: clickupAuthorizationHeader(params.accessToken),
      'Content-Type': 'application/json',
    }),
    body: (params) => ({ value: params.value }),
  },

  transformResponse: async (response, params) => {
    if (!response.ok) {
      const data = await response.json().catch(() => null)
      const error = extractClickUpErrorMessage(response, data, 'Failed to set custom field value')
      return { success: false, output: { error }, error }
    }

    return {
      success: true,
      output: { taskId: params?.taskId, fieldId: params?.fieldId },
    }
  },

  outputs: {
    taskId: { type: 'string', description: 'ID of the updated task', optional: true },
    fieldId: { type: 'string', description: 'ID of the custom field that was set', optional: true },
  },
}
