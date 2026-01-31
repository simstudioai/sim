import type {
  A2ADeletePushNotificationParams,
  A2ADeletePushNotificationResponse,
} from '@/tools/a2a/types'
import { A2A_OUTPUT_PROPERTIES } from '@/tools/a2a/types'
import type { ToolConfig } from '@/tools/types'

export const a2aDeletePushNotificationTool: ToolConfig<
  A2ADeletePushNotificationParams,
  A2ADeletePushNotificationResponse
> = {
  id: 'a2a_delete_push_notification',
  name: 'A2A Delete Push Notification',
  description: 'Delete the push notification webhook configuration for a task.',
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
      description: 'Task ID to delete notification config for',
    },
    pushNotificationConfigId: {
      type: 'string',
      visibility: 'user-or-llm',
      description:
        'Push notification configuration ID to delete (optional - server can derive from taskId)',
    },
    apiKey: {
      type: 'string',
      visibility: 'user-only',
      description: 'API key for authentication',
    },
  },

  request: {
    url: '/api/tools/a2a/delete-push-notification',
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const body: Record<string, string> = {
        agentUrl: params.agentUrl,
        taskId: params.taskId,
      }
      if (params.pushNotificationConfigId)
        body.pushNotificationConfigId = params.pushNotificationConfigId
      if (params.apiKey) body.apiKey = params.apiKey
      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    return data
  },

  outputs: {
    success: A2A_OUTPUT_PROPERTIES.success,
  },
}
