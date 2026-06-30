import { GoogleTasksIcon } from '@/components/icons'
import { getScopesForService } from '@/lib/oauth/utils'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'
import { SERVICE_ACCOUNT_SUBBLOCKS } from '@/blocks/utils'
import type { GoogleTasksResponse } from '@/tools/google_tasks/types'

export const GoogleTasksBlock: BlockConfig<GoogleTasksResponse> = {
  type: 'google_tasks',
  name: 'Google Tasks',
  description: 'Manage Google Tasks',
  longDescription:
    'Integrate Google Tasks into your workflow. Create, read, update, delete, and list tasks and task lists.',
  docsLink: 'https://docs.sim.ai/integrations/google_tasks',
  category: 'tools',
  integrationType: IntegrationType.Productivity,
  bgColor: '#FFFFFF',
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
      requiredScopes: getScopesForService('google-tasks'),
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
    ...SERVICE_ACCOUNT_SUBBLOCKS,

    // Task List - shown for all task operations (not list_task_lists)
    {
      id: 'taskListSelector',
      title: 'Task List',
      type: 'project-selector',
      canonicalParamId: 'taskListId',
      serviceId: 'google-tasks',
      selectorKey: 'google.tasks.lists',
      placeholder: 'Select task list',
      dependsOn: ['credential'],
      mode: 'basic',
      condition: { field: 'operation', value: 'list_task_lists', not: true },
    },
    {
      id: 'taskListId',
      title: 'Task List ID',
      type: 'short-input',
      canonicalParamId: 'taskListId',
      placeholder: 'Task list ID (leave empty for default list)',
      mode: 'advanced',
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

        const processedParams: Record<string, unknown> = {
          ...rest,
        }

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

export const GoogleTasksBlockMeta = {
  tags: ['google-workspace', 'project-management', 'scheduling'],
  url: 'https://workspace.google.com/products/tasks',
  templates: [
    {
      icon: GoogleTasksIcon,
      title: 'Google Tasks digest',
      prompt:
        'Build a scheduled daily workflow that summarizes Google Tasks due today and tomorrow, and emails the user a prioritized digest each morning.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'productivity',
      tags: ['individual', 'reporting'],
      alsoIntegrations: ['gmail'],
    },
    {
      icon: GoogleTasksIcon,
      title: 'Google Tasks from Gmail',
      prompt:
        'Create a workflow that watches Gmail for emails marked with a task label, extracts the action and due date, and creates a Google Tasks entry with a link back to the email.',
      modules: ['agent', 'workflows'],
      category: 'productivity',
      tags: ['individual', 'automation'],
      alsoIntegrations: ['gmail'],
    },
    {
      icon: GoogleTasksIcon,
      title: 'Google Tasks from meetings',
      prompt:
        'Build a workflow that runs after Google Meet meetings, extracts action items from the transcript, and creates Google Tasks entries for the owner with due dates.',
      modules: ['agent', 'workflows'],
      category: 'productivity',
      tags: ['team', 'automation'],
      alsoIntegrations: ['google_meet'],
    },
    {
      icon: GoogleTasksIcon,
      title: 'Google Tasks completion digest',
      prompt:
        'Create a scheduled weekly workflow that summarizes Google Tasks completed by the user, captures the throughput, and emails a personal productivity report.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'productivity',
      tags: ['individual', 'reporting'],
      alsoIntegrations: ['gmail'],
    },
    {
      icon: GoogleTasksIcon,
      title: 'Google Tasks rolling cleanup',
      prompt:
        'Build a scheduled workflow that runs daily, archives Google Tasks completed more than 30 days ago, and surfaces tasks past their due date for re-prioritization.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'productivity',
      tags: ['individual', 'automation'],
    },
    {
      icon: GoogleTasksIcon,
      title: 'Google Tasks Slack sync',
      prompt:
        'Create a workflow that watches Slack for messages tagged with the saved-task emoji, captures the message and creates a Google Tasks entry with a link to the Slack thread.',
      modules: ['agent', 'workflows'],
      category: 'productivity',
      tags: ['individual', 'sync'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: GoogleTasksIcon,
      title: 'Google Tasks calendar block builder',
      prompt:
        'Build a workflow that on a Google Tasks creation also inserts a Google Calendar focus block with the task title, so the time is actually reserved.',
      modules: ['agent', 'workflows'],
      category: 'productivity',
      tags: ['individual', 'automation'],
      alsoIntegrations: ['google_calendar'],
    },
  ],
  skills: [
    {
      name: 'capture-action-items',
      description:
        'Turn a list of action items into Google Tasks with titles, notes, and due dates in the right task list.',
      content:
        '# Capture Action Items\n\nConvert extracted action items into well-formed Google Tasks.\n\n## Steps\n1. List the available task lists and pick the target list (default to the primary list if none specified).\n2. For each action item, create a task with a concise title, detailed notes for context, and a due date if one was given.\n3. Avoid duplicates by skipping items whose title already exists in the list.\n\n## Output\nReturn the created task IDs and titles, grouped by task list. Note any items skipped as duplicates.',
    },
    {
      name: 'list-due-and-overdue',
      description:
        'List open Google Tasks that are due soon or overdue across a task list for a daily review.',
      content:
        '# List Due and Overdue Tasks\n\nSurface tasks that need attention for a daily or weekly review.\n\n## Steps\n1. List the task lists, or use a specified list.\n2. List tasks in the list, including completed status and due dates.\n3. Filter to incomplete tasks and split into Overdue (due before today) and Due Soon (due within the next few days).\n4. Sort each group by due date ascending.\n\n## Output\nReturn two sections, Overdue and Due Soon, each with task title, due date, and task ID. Useful for posting a standup or reminder digest.',
    },
    {
      name: 'complete-task-by-title',
      description: 'Find a Google Task by its title and mark it completed.',
      content:
        '# Complete Task By Title\n\nMark a task done when given a title rather than an ID.\n\n## Steps\n1. List tasks in the relevant task list and match the requested title (case-insensitive, allow partial match).\n2. If multiple match, prefer the incomplete one; if still ambiguous, return the candidates and ask for clarification.\n3. Update the matched task to set its status to completed.\n4. Confirm the update by reading the task back.\n\n## Output\nReturn the completed task title and ID, or the list of ambiguous candidates if no single match was found.',
    },
  ],
} as const satisfies BlockMeta
