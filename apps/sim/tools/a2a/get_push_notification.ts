import type { ToolConfig } from '@/tools/types'
import type { A2AGetPushNotificationParams, A2AGetPushNotificationResponse } from './types'

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
      description: 'The A2A agent endpoint URL',
    },
    taskId: {
      type: 'string',
      required: true,
      description: 'Task ID to get notification config for',
    },
    apiKey: {
      type: 'string',
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
    url: {
      type: 'string',
      description: 'Configured webhook URL',
    },
    token: {
      type: 'string',
      description: 'Token for webhook validation',
    },
    exists: {
      type: 'boolean',
      description: 'Whether a push notification config exists',
    },
  },
}
