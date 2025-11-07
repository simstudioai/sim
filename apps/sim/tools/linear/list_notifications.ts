import type {
  LinearListNotificationsParams,
  LinearListNotificationsResponse,
} from '@/tools/linear/types'
import type { ToolConfig } from '@/tools/types'

export const linearListNotificationsTool: ToolConfig<
  LinearListNotificationsParams,
  LinearListNotificationsResponse
> = {
  id: 'linear_list_notifications',
  name: 'Linear List Notifications',
  description: 'List notifications for the current user in Linear',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'linear',
  },

  params: {
    first: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of notifications to return (default: 50)',
    },
    after: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Cursor for pagination',
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
    body: (params) => ({
      query: `
        query ListNotifications($first: Int, $after: String) {
          notifications(first: $first, after: $after) {
            nodes {
              id
              type
              createdAt
              readAt
              ... on IssueNotification {
                issue {
                  id
                  title
                }
              }
            }
            pageInfo {
              hasNextPage
              endCursor
            }
          }
        }
      `,
      variables: {
        first: params.first ? Number(params.first) : 50,
        after: params.after,
      },
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()

    if (data.errors) {
      return {
        success: false,
        error: data.errors[0]?.message || 'Failed to list notifications',
        output: {},
      }
    }

    const result = data.data.notifications
    return {
      success: true,
      output: {
        notifications: result.nodes,
        pageInfo: {
          hasNextPage: result.pageInfo.hasNextPage,
          endCursor: result.pageInfo.endCursor,
        },
      },
    }
  },

  outputs: {
    notifications: {
      type: 'array',
      description: 'Array of notifications',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Notification ID' },
          type: { type: 'string', description: 'Notification type' },
          createdAt: { type: 'string', description: 'Creation timestamp' },
          readAt: { type: 'string', description: 'Read timestamp (null if unread)' },
          issue: { type: 'object', description: 'Related issue' },
        },
      },
    },
    pageInfo: {
      type: 'object',
      description: 'Pagination information',
    },
  },
}
