import { TodoistIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'
import type { TodoistResponse } from '@/tools/todoist/types'

export const TodoistBlock: BlockConfig<TodoistResponse> = {
  type: 'todoist',
  name: 'Todoist',
  description: 'Manage tasks and projects in Todoist',
  authMode: AuthMode.ApiKey,
  longDescription:
    'Integrate Todoist into workflows to create, update, get, list, and complete tasks, list projects, and add comments.',
  category: 'tools',
  integrationType: IntegrationType.Productivity,
  tags: ['automation'],
  docsLink: 'https://docs.sim.ai/tools/todoist',
  bgColor: '#E44332',
  icon: TodoistIcon,
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Create Task', id: 'todoist_create_task' },
        { label: 'Get Task', id: 'todoist_get_task' },
        { label: 'List Tasks', id: 'todoist_list_tasks' },
        { label: 'Update Task', id: 'todoist_update_task' },
        { label: 'Close Task', id: 'todoist_close_task' },
        { label: 'Delete Task', id: 'todoist_delete_task' },
        { label: 'List Projects', id: 'todoist_list_projects' },
        { label: 'Add Comment', id: 'todoist_add_comment' },
      ],
      value: () => 'todoist_create_task',
    },
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      placeholder: 'Enter your Todoist API token',
      password: true,
      required: true,
    },
    {
      id: 'taskId',
      title: 'Task ID',
      type: 'short-input',
      placeholder: 'Enter task ID',
      required: true,
      condition: {
        field: 'operation',
        value: [
          'todoist_get_task',
          'todoist_update_task',
          'todoist_close_task',
          'todoist_delete_task',
          'todoist_add_comment',
        ],
      },
    },
    {
      id: 'content',
      title: 'Task Content',
      type: 'short-input',
      placeholder: 'e.g. Buy milk',
      required: {
        field: 'operation',
        value: 'todoist_create_task',
      },
      condition: {
        field: 'operation',
        value: ['todoist_create_task', 'todoist_update_task'],
      },
    },
    {
      id: 'description',
      title: 'Description',
      type: 'long-input',
      placeholder: 'Enter task details/description',
      condition: {
        field: 'operation',
        value: ['todoist_create_task', 'todoist_update_task'],
      },
    },
    {
      id: 'projectId',
      title: 'Project ID',
      type: 'short-input',
      placeholder: 'Filter by or add to Project ID',
      condition: {
        field: 'operation',
        value: ['todoist_create_task', 'todoist_list_tasks'],
      },
    },
    {
      id: 'priority',
      title: 'Priority',
      type: 'dropdown',
      options: [
        { label: 'Priority 1 (Normal)', id: '1' },
        { label: 'Priority 2', id: '2' },
        { label: 'Priority 3', id: '3' },
        { label: 'Priority 4 (Urgent)', id: '4' },
      ],
      value: () => '1',
      condition: {
        field: 'operation',
        value: ['todoist_create_task', 'todoist_update_task'],
      },
    },
    {
      id: 'dueString',
      title: 'Due Date',
      type: 'short-input',
      placeholder: 'e.g. tomorrow, next Friday, YYYY-MM-DD',
      condition: {
        field: 'operation',
        value: ['todoist_create_task', 'todoist_update_task'],
      },
      wandConfig: {
        enabled: true,
        prompt: `Generate a due date description string (e.g. "tomorrow", "Friday at 2pm", "YYYY-MM-DD").
Return ONLY the description string.`,
        placeholder: 'Describe the due date...',
      },
    },
    {
      id: 'labels',
      title: 'Labels',
      type: 'short-input',
      placeholder: 'comma, separated, labels',
      condition: {
        field: 'operation',
        value: ['todoist_create_task', 'todoist_update_task'],
      },
    },
    {
      id: 'filter',
      title: 'Filter Query',
      type: 'short-input',
      placeholder: 'e.g. today, overdue, p1',
      condition: {
        field: 'operation',
        value: 'todoist_list_tasks',
      },
    },
    {
      id: 'label',
      title: 'Label Name',
      type: 'short-input',
      placeholder: 'Filter by label name',
      condition: {
        field: 'operation',
        value: 'todoist_list_tasks',
      },
    },
    {
      id: 'commentContent',
      title: 'Comment Content',
      type: 'long-input',
      placeholder: 'Enter comment content',
      required: {
        field: 'operation',
        value: 'todoist_add_comment',
      },
      condition: {
        field: 'operation',
        value: 'todoist_add_comment',
      },
    },
  ],
  tools: {
    access: [
      'todoist_create_task',
      'todoist_get_task',
      'todoist_list_tasks',
      'todoist_update_task',
      'todoist_close_task',
      'todoist_delete_task',
      'todoist_list_projects',
      'todoist_add_comment',
    ],
    config: {
      tool: (params) => params.operation || 'todoist_create_task',
      params: (params) => {
        const { operation, apiKey } = params
        const baseParams = { apiKey }

        const labelsArray = params.labels
          ? params.labels
              .split(',')
              .map((l: string) => l.trim())
              .filter((l: string) => l.length > 0)
          : undefined

        switch (operation) {
          case 'todoist_create_task':
            return {
              ...baseParams,
              content: params.content,
              description: params.description || undefined,
              projectId: params.projectId || undefined,
              priority: params.priority ? Number(params.priority) : undefined,
              dueString: params.dueString || undefined,
              labels: labelsArray,
            }
          case 'todoist_get_task':
            return {
              ...baseParams,
              taskId: params.taskId,
            }
          case 'todoist_list_tasks':
            return {
              ...baseParams,
              projectId: params.projectId || undefined,
              filter: params.filter || undefined,
              label: params.label || undefined,
            }
          case 'todoist_update_task':
            return {
              ...baseParams,
              taskId: params.taskId,
              content: params.content || undefined,
              description: params.description || undefined,
              priority: params.priority ? Number(params.priority) : undefined,
              dueString: params.dueString || undefined,
              labels: labelsArray,
            }
          case 'todoist_close_task':
            return {
              ...baseParams,
              taskId: params.taskId,
            }
          case 'todoist_delete_task':
            return {
              ...baseParams,
              taskId: params.taskId,
            }
          case 'todoist_list_projects':
            return baseParams
          case 'todoist_add_comment':
            return {
              ...baseParams,
              taskId: params.taskId,
              content: params.commentContent,
            }
          default:
            return baseParams
        }
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    apiKey: { type: 'string', description: 'Todoist API Key' },
    taskId: { type: 'string', description: 'The ID of the task' },
    content: { type: 'string', description: 'Task title or content' },
    description: { type: 'string', description: 'Task description' },
    projectId: { type: 'string', description: 'The project ID' },
    priority: { type: 'string', description: 'Priority level (1-4)' },
    dueString: { type: 'string', description: 'Due date string representation' },
    labels: { type: 'string', description: 'Comma-separated labels' },
    filter: { type: 'string', description: 'Todoist filter query' },
    label: { type: 'string', description: 'Label filter name' },
    commentContent: { type: 'string', description: 'Comment text content' },
  },
  outputs: {
    id: { type: 'string', description: 'The unique ID of the task or comment' },
    content: { type: 'string', description: 'The title/content' },
    description: { type: 'string', description: 'Detailed description' },
    projectId: { type: 'string', description: 'The project ID' },
    priority: { type: 'number', description: 'Priority level (1-4)' },
    url: { type: 'string', description: 'Todoist web URL' },
    isCompleted: { type: 'boolean', description: 'Completion status' },
    createdAt: { type: 'string', description: 'Creation timestamp' },
    due: { type: 'json', description: 'Due date information' },
    labels: { type: 'array', description: 'List of labels' },
    success: { type: 'boolean', description: 'Operation success status' },
    taskId: { type: 'string', description: 'Target task ID' },
    tasks: { type: 'json', description: 'Array of tasks' },
    projects: { type: 'json', description: 'Array of projects' },
    postedAt: { type: 'string', description: 'Comment post timestamp' },
  },
}
