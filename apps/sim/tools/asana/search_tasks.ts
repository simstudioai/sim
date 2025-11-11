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
      visibility: 'user-only',
      description: 'Workspace GID to search tasks in',
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
      visibility: 'user-only',
      description: 'Array of project GIDs to filter tasks by',
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
        error: 'Empty response from Asana',
      }
    }

    const data = JSON.parse(responseText)

    if (data.success && data.output) {
      return data
    }

    return {
      success: data.success || false,
      output: data.output || { ts: new Date().toISOString(), tasks: [] },
      error: data.error,
    }
  },

  outputs: {
    success: {
      type: 'boolean',
      description: 'Operation success status',
    },
    output: {
      type: 'object',
      description: 'List of tasks matching the search criteria',
    },
  },
}
