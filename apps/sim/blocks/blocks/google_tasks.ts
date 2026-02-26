import { GoogleTasksIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import { AuthMode } from '@/blocks/types'
import type { GoogleTasksResponse } from '@/tools/google_tasks/types'

export const GoogleTasksBlock: BlockConfig<GoogleTasksResponse> = {
  type: 'google_tasks',
  name: 'Google Tasks',
  description: 'Manage Google Tasks',
  longDescription:
    'Integrate Google Tasks into your workflow. Create, read, update, delete, and list tasks and task lists.',
  docsLink: 'https://docs.sim.ai/tools/google_tasks',
  category: 'tools',
  bgColor: '#E0E0E0',
  icon: GoogleTasksIcon,
  authMode: AuthMode.OAuth,

  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Create Task', id: 'create' },
        { label: 'List Tasks', id: 'list' },
        { label: 'Get Task', id: 'get' },
        { label: 'Update Task', id: 'update' },
        { label: 'Delete Task', id: 'delete' },
        { label: 'List Task Lists', id: 'list_task_lists' },
      ],
      value: () => 'create',
    },
    {
      id: 'credential',
      title: 'Google Tasks Account',
      type: 'oauth-input',
      canonicalParamId: 'oauthCredential',
      mode: 'basic',
      required: true,
      serviceId: 'google-tasks',
      requiredScopes: ['https://www.googleapis.com/auth/tasks'],
      placeholder: 'Select Google Tasks account',
    },
    {
      id: 'manualCredential',
      title: 'Google Tasks Account',
      type: 'short-input',
      canonicalParamId: 'oauthCredential',
      mode: 'advanced',
      placeholder: 'Enter credential ID',
      required: true,
    },

    // Task List ID - shown for all task operations (not list_task_lists)
    {
      id: 'taskListId',
      title: 'Task List ID',
      type: 'short-input',
      placeholder: 'Task list ID (leave empty for default list)',
      condition: { field: 'operation', value: 'list_task_lists', not: true },
    },

    // Create Task Fields
    {
      id: 'title',
      title: 'Title',
      type: 'short-input',
      placeholder: 'Buy groceries',
      condition: { field: 'operation', value: 'create' },
      required: { field: 'operation', value: 'create' },
    },
    {
      id: 'notes',
      title: 'Notes',
      type: 'long-input',
      placeholder: 'Task notes or description',
      condition: { field: 'operation', value: 'create' },
    },
    {
      id: 'due',
      title: 'Due Date',
      type: 'short-input',
      placeholder: '2025-06-03T00:00:00.000Z',
      condition: { field: 'operation', value: 'create' },
      wandConfig: {
        enabled: true,
        prompt: `Generate an RFC 3339 timestamp in UTC based on the user's description.
The timestamp should be in the format: YYYY-MM-DDTHH:MM:SS.000Z (UTC timezone).
Examples:
- "tomorrow" -> Calculate tomorrow's date at 00:00:00.000Z
- "next Friday" -> Calculate the next Friday's date at 00:00:00.000Z
- "June 15" -> 2025-06-15T00:00:00.000Z

Return ONLY the timestamp - no explanations, no extra text.`,
      },
    },
    {
      id: 'status',
      title: 'Status',
      type: 'dropdown',
      condition: { field: 'operation', value: 'create' },
      options: [
        { label: 'Needs Action', id: 'needsAction' },
        { label: 'Completed', id: 'completed' },
      ],
    },

    // Get/Update/Delete Task Fields - Task ID
    {
      id: 'taskId',
      title: 'Task ID',
      type: 'short-input',
      placeholder: 'Task ID',
      condition: { field: 'operation', value: ['get', 'update', 'delete'] },
      required: { field: 'operation', value: ['get', 'update', 'delete'] },
    },

    // Update Task Fields
    {
      id: 'title',
      title: 'New Title',
      type: 'short-input',
      placeholder: 'Updated task title',
      condition: { field: 'operation', value: 'update' },
    },
    {
      id: 'notes',
      title: 'New Notes',
      type: 'long-input',
      placeholder: 'Updated task notes',
      condition: { field: 'operation', value: 'update' },
    },
    {
      id: 'due',
      title: 'New Due Date',
      type: 'short-input',
      placeholder: '2025-06-03T00:00:00.000Z',
      condition: { field: 'operation', value: 'update' },
      wandConfig: {
        enabled: true,
        prompt: `Generate an RFC 3339 timestamp in UTC based on the user's description.
The timestamp should be in the format: YYYY-MM-DDTHH:MM:SS.000Z (UTC timezone).
Examples:
- "tomorrow" -> Calculate tomorrow's date at 00:00:00.000Z
- "next Friday" -> Calculate the next Friday's date at 00:00:00.000Z
- "June 15" -> 2025-06-15T00:00:00.000Z

Return ONLY the timestamp - no explanations, no extra text.`,
      },
    },
    {
      id: 'status',
      title: 'New Status',
      type: 'dropdown',
      condition: { field: 'operation', value: 'update' },
      options: [
        { label: 'Needs Action', id: 'needsAction' },
        { label: 'Completed', id: 'completed' },
      ],
    },

    // List Tasks Fields
    {
      id: 'maxResults',
      title: 'Max Results',
      type: 'short-input',
      placeholder: '20',
      condition: { field: 'operation', value: ['list', 'list_task_lists'] },
    },
    {
      id: 'showCompleted',
      title: 'Show Completed',
      type: 'dropdown',
      condition: { field: 'operation', value: 'list' },
      options: [
        { label: 'Yes', id: 'true' },
        { label: 'No', id: 'false' },
      ],
    },
  ],

  tools: {
    access: [
      'google_tasks_create',
      'google_tasks_list',
      'google_tasks_get',
      'google_tasks_update',
      'google_tasks_delete',
      'google_tasks_list_task_lists',
    ],
    config: {
      tool: (params) => {
        switch (params.operation) {
          case 'create':
            return 'google_tasks_create'
          case 'list':
            return 'google_tasks_list'
          case 'get':
            return 'google_tasks_get'
          case 'update':
            return 'google_tasks_update'
          case 'delete':
            return 'google_tasks_delete'
          case 'list_task_lists':
            return 'google_tasks_list_task_lists'
          default:
            throw new Error(`Invalid Google Tasks operation: ${params.operation}`)
        }
      },
      params: (params) => {
        const { oauthCredential, operation, showCompleted, maxResults, ...rest } = params

        const processedParams: Record<string, unknown> = { ...rest }

        if (maxResults && typeof maxResults === 'string') {
          processedParams.maxResults = Number.parseInt(maxResults, 10)
        }

        if (showCompleted !== undefined) {
          processedParams.showCompleted = showCompleted === 'true'
        }

        return {
          oauthCredential,
          ...processedParams,
        }
      },
    },
  },

  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    oauthCredential: { type: 'string', description: 'Google Tasks access token' },
    taskListId: { type: 'string', description: 'Task list identifier' },
    title: { type: 'string', description: 'Task title' },
    notes: { type: 'string', description: 'Task notes' },
    due: { type: 'string', description: 'Task due date' },
    status: { type: 'string', description: 'Task status' },
    taskId: { type: 'string', description: 'Task identifier' },
    maxResults: { type: 'string', description: 'Maximum number of results' },
    showCompleted: { type: 'string', description: 'Whether to show completed tasks' },
  },

  outputs: {
    id: { type: 'string', description: 'Task ID' },
    title: { type: 'string', description: 'Task title' },
    notes: { type: 'string', description: 'Task notes' },
    status: { type: 'string', description: 'Task status' },
    due: { type: 'string', description: 'Due date' },
    updated: { type: 'string', description: 'Last modification time' },
    selfLink: { type: 'string', description: 'URL for the task' },
    webViewLink: { type: 'string', description: 'Link to task in Google Tasks UI' },
    parent: { type: 'string', description: 'Parent task ID' },
    position: { type: 'string', description: 'Position among sibling tasks' },
    completed: { type: 'string', description: 'Completion date' },
    deleted: { type: 'boolean', description: 'Whether the task is deleted' },
    tasks: { type: 'json', description: 'Array of tasks (list operation)' },
    taskLists: { type: 'json', description: 'Array of task lists (list_task_lists operation)' },
    taskId: { type: 'string', description: 'Deleted task ID (delete operation)' },
    nextPageToken: { type: 'string', description: 'Token for next page of results' },
  },
}
