import type { AsanaSearchTasksParams, AsanaSearchTasksResponse } from '@/tools/asana/types'
import type { ToolConfig } from '@/tools/types'

export const asanaSearchTasksTool: ToolConfig<AsanaSearchTasksParams, AsanaSearchTasksResponse> = {
  id: 'asana_search_tasks',
  name: 'Asana Search Tasks',
  description: 'Search for tasks in an Asana workspace',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'asana',
  },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'OAuth access token for Asana',
    },
    workspace: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Asana workspace GID (numeric string) to search tasks in',
    },
    text: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Text to search for in task names',
    },
    assignee: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter tasks by assignee user GID',
    },
    projects: {
      type: 'array',
      required: false,
      visibility: 'user-or-llm',
      description: 'Array of Asana project GIDs (numeric strings) to filter tasks by',
    },
    completed: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by completion status',
    },
  },

  request: {
    url: '/api/tools/asana/search-tasks',
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params) => ({
      accessToken: params.accessToken,
      workspace: params.workspace,
      text: params.text,
      assignee: params.assignee,
      projects: params.projects,
      completed: params.completed,
    }),
  },

  transformResponse: async (response: Response) => {
    const responseText = await response.text()

    if (!responseText) {
      return {
        success: false,
        output: {},
        error: 'Empty response from Asana',
      }
    }

    const data = JSON.parse(responseText)
    const { success, error, ...output } = data
    return {
      success: success ?? true,
      output,
      error,
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Operation success status' },
    ts: { type: 'string', description: 'Timestamp of the response' },
    tasks: {
      type: 'array',
      description: 'Array of matching tasks',
      items: {
        type: 'object',
        properties: {
          gid: { type: 'string', description: 'Task GID' },
          resource_type: { type: 'string', description: 'Resource type' },
          resource_subtype: { type: 'string', description: 'Resource subtype' },
          name: { type: 'string', description: 'Task name' },
          notes: { type: 'string', description: 'Task notes' },
          completed: { type: 'boolean', description: 'Completion status' },
          assignee: {
            type: 'object',
            description: 'Assignee details',
            properties: {
              gid: { type: 'string', description: 'Assignee GID' },
              name: { type: 'string', description: 'Assignee name' },
            },
          },
          due_on: { type: 'string', description: 'Due date' },
          created_at: { type: 'string', description: 'Creation timestamp' },
          modified_at: { type: 'string', description: 'Modified timestamp' },
        },
      },
    },
    next_page: {
      type: 'object',
      description: 'Pagination info',
      properties: {
        offset: { type: 'string', description: 'Offset token' },
        path: { type: 'string', description: 'API path' },
        uri: { type: 'string', description: 'Full URI' },
      },
    },
  },
}
