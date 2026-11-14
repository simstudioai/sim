import type { AsanaGetTaskParams, AsanaGetTaskResponse } from '@/tools/asana/types'
import type { InternalToolConfig } from '@/tools/types'

export const asanaGetTaskTool: InternalToolConfig<AsanaGetTaskParams, AsanaGetTaskResponse> = {
  id: 'asana_get_task',
  name: 'Asana Get Task',
  description: 'Retrieve a single task by GID or get multiple tasks with filters',
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
    taskGid: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'The globally unique identifier (GID) of the task. If not provided, will get multiple tasks.',
    },
    workspace: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Asana workspace GID (numeric string) to filter tasks. Asana requires an assignee alongside a workspace filter; use project instead to list a project',
    },
    assignee: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Assignee to filter tasks on (user GID, email, or "me"). Required by Asana when filtering by workspace; ignored when filtering by project',
    },
    project: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Asana project GID (numeric string) to filter tasks',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of tasks to return, 1-100 (default: 50)',
    },
    offset: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Pagination offset token from a previous response next_page.offset',
    },
  },

  operation: {
    input: (params) => ({
      accessToken: params.accessToken,
      taskGid: params.taskGid,
      workspace: params.workspace,
      project: params.project,
      assignee: params.assignee,
      limit: params.limit,
      offset: params.offset,
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
    gid: { type: 'string', description: 'Task globally unique identifier' },
    resource_type: { type: 'string', description: 'Resource type (task)' },
    resource_subtype: { type: 'string', description: 'Resource subtype' },
    name: { type: 'string', description: 'Task name' },
    notes: { type: 'string', description: 'Task notes or description' },
    completed: { type: 'boolean', description: 'Whether the task is completed' },
    assignee: {
      type: 'object',
      description: 'Assignee details',
      properties: {
        gid: { type: 'string', description: 'Assignee GID' },
        name: { type: 'string', description: 'Assignee name' },
      },
    },
    created_by: {
      type: 'object',
      description: 'Creator details',
      properties: {
        gid: { type: 'string', description: 'Creator GID' },
        name: { type: 'string', description: 'Creator name' },
      },
    },
    due_on: { type: 'string', description: 'Due date (YYYY-MM-DD)' },
    created_at: { type: 'string', description: 'Task creation timestamp' },
    modified_at: { type: 'string', description: 'Task last modified timestamp' },
    tasks: {
      type: 'array',
      description: 'Array of tasks (when fetching multiple)',
      items: {
        type: 'object',
        properties: {
          gid: { type: 'string', description: 'Task GID' },
          name: { type: 'string', description: 'Task name' },
          completed: { type: 'boolean', description: 'Completion status' },
        },
      },
    },
    next_page: {
      type: 'object',
      description: 'Pagination info when fetching multiple tasks; null on the last page',
      optional: true,
      properties: {
        offset: { type: 'string', description: 'Offset token for the next page' },
        path: { type: 'string', description: 'API path' },
        uri: { type: 'string', description: 'Full URI' },
      },
    },
  },
}
