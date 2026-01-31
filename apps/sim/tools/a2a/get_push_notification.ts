import type {
  A2AGetPushNotificationParams,
  A2AGetPushNotificationResponse,
} from '@/tools/a2a/types'
import { A2A_OUTPUT_PROPERTIES } from '@/tools/a2a/types'
import type { ToolConfig } from '@/tools/types'

export const a2aGetPushNotificationTool: ToolConfig<
  A2AGetPushNotificationParams,
  A2AGetPushNotificationResponse
> = {
  id: 'a2a_get_push_notification',
  name: 'A2A Get Push Notification',
  description: 'Get the push notification webhook configuration for a task.',
  version: '1.0.0',

  params: {
    agentUrl: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'The A2A agent endpoint URL',
    },
    taskId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Task ID to get notification config for',
    },
    apiKey: {
      type: 'string',
      visibility: 'user-only',
      description: 'API key for authentication',
    },
  },

  request: {
    url: '/api/tools/a2a/get-push-notification',
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const body: Record<string, string> = {
        agentUrl: params.agentUrl,
        taskId: params.taskId,
      }
      if (params.apiKey) body.apiKey = params.apiKey
      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      return {
        success: false,
        output: {
          exists: false,
        },
        error: data.error || 'Failed to get push notification',
      }
    }

    return {
      success: data.success,
      output: data.output,
      error: data.error,
    }
  },

  outputs: {
    url: { ...A2A_OUTPUT_PROPERTIES.webhookUrl, optional: true },
    token: A2A_OUTPUT_PROPERTIES.webhookToken,
    exists: A2A_OUTPUT_PROPERTIES.exists,
  },
}
