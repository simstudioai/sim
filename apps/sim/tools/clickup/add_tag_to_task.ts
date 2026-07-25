import {
  CLICKUP_API_BASE_URL,
  clickupAuthorizationHeader,
  extractClickUpErrorMessage,
} from '@/tools/clickup/shared'
import type { ClickUpTaskTagParams, ClickUpTaskTagResponse } from '@/tools/clickup/types'
import type { ToolConfig } from '@/tools/types'

export const clickupAddTagToTaskTool: ToolConfig<ClickUpTaskTagParams, ClickUpTaskTagResponse> = {
  id: 'clickup_add_tag_to_task',
  name: 'ClickUp Add Tag To Task',
  description: 'Add an existing space tag to a ClickUp task',
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
      description: 'ID of the task to tag',
    },
    tagName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Name of the tag to add (must exist in the space)',
    },
  },

  request: {
    url: (params) =>
      `${CLICKUP_API_BASE_URL}/task/${encodeURIComponent(params.taskId)}/tag/${encodeURIComponent(params.tagName)}`,
    method: 'POST',
    headers: (params) => ({
      Authorization: clickupAuthorizationHeader(params.accessToken),
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response, params) => {
    if (!response.ok) {
      const data = await response.json().catch(() => null)
      const error = extractClickUpErrorMessage(response, data, 'Failed to add tag to task')
      return { success: false, output: { error }, error }
    }

    return {
      success: true,
      output: { taskId: params?.taskId, tagName: params?.tagName },
    }
  },

  outputs: {
    taskId: { type: 'string', description: 'ID of the tagged task', optional: true },
    tagName: { type: 'string', description: 'Name of the tag that was added', optional: true },
  },
}
