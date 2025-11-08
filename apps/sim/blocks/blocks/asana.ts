import { AsanaIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import { AuthMode } from '@/blocks/types'
import type { AsanaResponse } from '@/tools/asana/types'

export const AsanaBlock: BlockConfig<AsanaResponse> = {
  type: 'asana',
  name: 'Asana',
  description: 'Interact with Asana',
  authMode: AuthMode.OAuth,
  longDescription: 'Integrate Asana into the workflow. Can read, write, and update tasks.',
  docsLink: 'https://docs.sim.ai/tools/asana',
  category: 'tools',
  bgColor: '#E0E0E0',
  icon: AsanaIcon,
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Get Task', id: 'get_task' },
        { label: 'Create Task', id: 'create_task' },
        { label: 'Update Task', id: 'update_task' },
        { label: 'Get Projects', id: 'get_projects' },
        { label: 'Search Tasks', id: 'search_tasks' },
        { label: 'Add Comment', id: 'add_comment' },
      ],
      value: () => 'get_task',
    },
    {
      id: 'credential',
      title: 'Asana Account',
      type: 'oauth-input',

      required: true,
      provider: 'asana',
      serviceId: 'asana',
      requiredScopes: ['default'],
      placeholder: 'Select Asana account',
    },
    {
      id: 'workspace',
      title: 'Workspace GID',
      type: 'short-input',
      required: true,
      placeholder: 'Enter Asana workspace GID',
      condition: {
        field: 'operation',
        value: ['create_task', 'get_projects', 'search_tasks'],
      },
    },
    {
      id: 'taskGid',
      title: 'Task GID',
      type: 'short-input',
      required: false,
      placeholder: 'Leave empty to get all tasks with filters below',
      condition: {
        field: 'operation',
        value: ['get_task'],
      },
    },
    {
      id: 'taskGid',
      title: 'Task GID',
      type: 'short-input',
      required: true,
      placeholder: 'Enter Asana task GID',
      condition: {
        field: 'operation',
        value: ['update_task', 'add_comment'],
      },
    },
    {
      id: 'getTasks_workspace',
      title: 'Workspace GID',
      type: 'short-input',
      placeholder: 'Enter workspace GID',
      condition: {
        field: 'operation',
        value: ['get_task'],
      },
    },
    {
      id: 'getTasks_project',
      title: 'Project GID',
      type: 'short-input',

      placeholder: 'Enter project GID',
      condition: {
        field: 'operation',
        value: ['get_task'],
      },
    },
    {
      id: 'getTasks_limit',
      title: 'Limit',
      type: 'short-input',

      placeholder: 'Max tasks to return (default: 50)',
      condition: {
        field: 'operation',
        value: ['get_task'],
      },
    },
    {
      id: 'name',
      title: 'Task Name',
      type: 'short-input',

      required: true,
      placeholder: 'Enter task name',
      condition: {
        field: 'operation',
        value: ['create_task', 'update_task'],
      },
    },
    {
      id: 'notes',
      title: 'Task Notes',
      type: 'long-input',

      placeholder: 'Enter task notes or description',
      condition: {
        field: 'operation',
        value: ['create_task', 'update_task'],
      },
    },
    {
      id: 'assignee',
      title: 'Assignee GID',
      type: 'short-input',

      placeholder: 'Enter assignee user GID',
      condition: {
        field: 'operation',
        value: ['create_task', 'update_task', 'search_tasks'],
      },
    },
    {
      id: 'due_on',
      title: 'Due Date',
      type: 'short-input',

      placeholder: 'YYYY-MM-DD',
      condition: {
        field: 'operation',
        value: ['create_task', 'update_task'],
      },
    },

    {
      id: 'searchText',
      title: 'Search Text',
      type: 'short-input',

      placeholder: 'Enter search text',
      condition: {
        field: 'operation',
        value: ['search_tasks'],
      },
    },
    {
      id: 'commentText',
      title: 'Comment Text',
      type: 'long-input',

      required: true,
      placeholder: 'Enter comment text',
      condition: {
        field: 'operation',
        value: ['add_comment'],
      },
    },
  ],
  tools: {
    access: [
      'asana_get_task',
      'asana_create_task',
      'asana_update_task',
      'asana_get_projects',
      'asana_search_tasks',
      'asana_add_comment',
    ],
    config: {
      tool: (params) => {
        switch (params.operation) {
          case 'get_task':
            return 'asana_get_task'
          case 'create_task':
            return 'asana_create_task'
          case 'update_task':
            return 'asana_update_task'
          case 'get_projects':
            return 'asana_get_projects'
          case 'search_tasks':
            return 'asana_search_tasks'
          case 'add_comment':
            return 'asana_add_comment'
          default:
            return 'asana_get_task'
        }
      },
      params: (params) => {
        const { credential, operation } = params

        const projectsArray = params.projects
          ? params.projects
              .split(',')
              .map((p: string) => p.trim())
              .filter((p: string) => p.length > 0)
          : undefined

        const baseParams = {
          accessToken: credential?.accessToken,
        }

        switch (operation) {
          case 'get_task':
            return {
              ...baseParams,
              taskGid: params.taskGid,
              workspace: params.getTasks_workspace,
              project: params.getTasks_project,
              limit: params.getTasks_limit ? Number(params.getTasks_limit) : undefined,
            }
          case 'create_task':
            return {
              ...baseParams,
              workspace: params.workspace,
              name: params.name,
              notes: params.notes,
              assignee: params.assignee,
              due_on: params.due_on,
            }
          case 'update_task':
            return {
              ...baseParams,
              taskGid: params.taskGid,
              name: params.name,
              notes: params.notes,
              assignee: params.assignee,
              completed: params.completed?.includes('completed'),
              due_on: params.due_on,
            }
          case 'get_projects':
            return {
              ...baseParams,
              workspace: params.workspace,
            }
          case 'search_tasks':
            return {
              ...baseParams,
              workspace: params.workspace,
              text: params.searchText,
              assignee: params.assignee,
              projects: projectsArray,
              completed: params.completed?.includes('completed'),
            }
          case 'add_comment':
            return {
              ...baseParams,
              taskGid: params.taskGid,
              text: params.commentText,
            }
          default:
            return baseParams
        }
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    workspace: { type: 'string', description: 'Workspace GID' },
    taskGid: { type: 'string', description: 'Task GID' },
    getTasks_workspace: { type: 'string', description: 'Workspace GID for getting tasks' },
    getTasks_project: { type: 'string', description: 'Project GID filter for getting tasks' },
    getTasks_limit: { type: 'string', description: 'Limit for getting tasks' },
    name: { type: 'string', description: 'Task name' },
    notes: { type: 'string', description: 'Task notes' },
    assignee: { type: 'string', description: 'Assignee user GID' },
    due_on: { type: 'string', description: 'Due date (YYYY-MM-DD)' },
    projects: { type: 'string', description: 'Project GIDs' },
    completed: { type: 'array', description: 'Completion status' },
    searchText: { type: 'string', description: 'Search text' },
    commentText: { type: 'string', description: 'Comment text' },
  },
  outputs: {
    success: { type: 'boolean', description: 'Operation success status' },
    output: { type: 'string', description: 'Operation result (JSON)' },
  },
}
