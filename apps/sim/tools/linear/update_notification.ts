import type {
  LinearUpdateNotificationParams,
  LinearUpdateNotificationResponse,
} from '@/tools/linear/types'
import type { ToolConfig } from '@/tools/types'

export const linearUpdateNotificationTool: ToolConfig<
  LinearUpdateNotificationParams,
  LinearUpdateNotificationResponse
> = {
  id: 'linear_update_notification',
  name: 'Linear Update Notification',
  description: 'Mark a notification as read or unread in Linear',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'linear',
  },

  params: {
    notificationId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Notification ID to update',
    },
    readAt: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Timestamp to mark as read (ISO format). Pass null or omit to mark as unread',
    },
  },

  request: {
    url: 'https://api.linear.app/graphql',
    method: 'POST',
    headers: (params) => {
      if (!params.accessToken) {
        throw new Error('Missing access token for Linear API request')
      }
      return {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${params.accessToken}`,
      }
    },
    body: (params) => {
      const input: Record<string, any> = {}

      // If readAt is provided, use it; if explicitly null, mark as unread; if omitted, mark as read now
      if (params.readAt !== undefined) {
        input.readAt = params.readAt
      } else {
        input.readAt = new Date().toISOString()
      }

      return {
        query: `
          mutation UpdateNotification($id: String!, $input: NotificationUpdateInput!) {
            notificationUpdate(id: $id, input: $input) {
              success
              notification {
                id
                type
                createdAt
                readAt
                issue {
                  id
                  title
                }
              }
            }
          }
        `,
        variables: {
          id: params.notificationId,
          input,
        },
      }
    },
  },

  transformResponse: async (response) => {
    const data = await response.json()

    if (data.errors) {
      return {
        success: false,
        error: data.errors[0]?.message || 'Failed to update notification',
        output: {},
      }
    }

    const result = data.data.notificationUpdate
    if (!result.success) {
      return {
        success: false,
        error: 'Notification update was not successful',
        output: {},
      }
    }

    return {
      success: true,
      output: {
        notification: result.notification,
      },
    }
  },

  outputs: {
    notification: {
      type: 'object',
      description: 'The updated notification',
      properties: {
        id: { type: 'string', description: 'Notification ID' },
        type: { type: 'string', description: 'Notification type' },
        createdAt: { type: 'string', description: 'Creation timestamp' },
        readAt: { type: 'string', description: 'Read timestamp' },
        issue: { type: 'object', description: 'Related issue' },
      },
    },
  },
}
