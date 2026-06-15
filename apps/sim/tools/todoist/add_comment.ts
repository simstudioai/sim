import { generateId } from '@sim/utils/id'
import type { TodoistAddCommentParams, TodoistAddCommentResponse } from '@/tools/todoist/types'
import { mapTodoistComment } from '@/tools/todoist/utils'
import type { ToolConfig } from '@/tools/types'

export const todoistAddCommentTool: ToolConfig<TodoistAddCommentParams, TodoistAddCommentResponse> =
  {
    id: 'todoist_add_comment',
    name: 'Todoist Add Comment',
    description: 'Add a comment to an existing task in Todoist',
    version: '1.0.0',

    params: {
      apiKey: {
        type: 'string',
        required: true,
        visibility: 'user-only',
        description: 'Todoist API token from settings/integrations',
      },
      taskId: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'The unique ID of the task to comment on',
      },
      content: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'The text content of the comment',
      },
    },

    request: {
      url: 'https://api.todoist.com/rest/v2/comments',
      method: 'POST',
      headers: (params) => {
        if (!params.apiKey) {
          throw new Error('Missing API key for Todoist API request')
        }
        return {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${params.apiKey}`,
          'X-Request-Id': generateId(),
        }
      },
      body: (params) => {
        return {
          task_id: params.taskId,
          content: params.content,
        }
      },
    },

    transformResponse: async (response) => {
      if (!response.ok) {
        const errorText = await response.text()
        return {
          success: false,
          error: errorText || `Todoist API error: ${response.status} ${response.statusText}`,
          output: {
            id: '',
            content: '',
            postedAt: '',
            taskId: '',
          },
        }
      }

      const data = await response.json()
      return {
        success: true,
        output: mapTodoistComment(data),
      }
    },

    outputs: {
      id: { type: 'string', description: 'The unique comment ID' },
      content: { type: 'string', description: 'The content/text of the comment' },
      postedAt: { type: 'string', description: 'When the comment was posted' },
      taskId: { type: 'string', description: 'The ID of the task the comment belongs to' },
    },
  }
