import type { ToolConfig } from '@/tools/types'
import type { A2ASetPushNotificationParams, A2ASetPushNotificationResponse } from './types'

export const a2aSetPushNotificationTool: ToolConfig<
  A2ASetPushNotificationParams,
  A2ASetPushNotificationResponse
> = {
  id: 'a2a_set_push_notification',
  name: 'A2A Set Push Notification',
  description: 'Configure a webhook to receive task update notifications.',
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
      description: 'Task ID to configure notifications for',
    },
    webhookUrl: {
      type: 'string',
      required: true,
      description: 'HTTPS webhook URL to receive notifications',
    },
    token: {
      type: 'string',
      description: 'Token for webhook validation',
    },
    apiKey: {
      type: 'string',
      description: 'API key for authentication',
    },
  },

  request: {
    url: '/api/tools/a2a/set-push-notification',
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params: A2ASetPushNotificationParams) => {
      const body: Record<string, string> = {
        agentUrl: params.agentUrl,
        taskId: params.taskId,
        webhookUrl: params.webhookUrl,
      }
      if (params.token) body.token = params.token
      if (params.apiKey) body.apiKey = params.apiKey
      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!data.success) {
      return {
        success: false,
        output: {
          url: '',
          success: false,
        },
        error: data.error || 'Failed to set push notification',
      }
    }

    return {
      success: true,
      output: {
        url: data.output.url,
        token: data.output.token,
        success: data.output.success,
      },
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
    success: {
      type: 'boolean',
      description: 'Whether configuration was successful',
    },
  },
}
