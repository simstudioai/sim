import { MicrosoftPlannerIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import type { MicrosoftPlannerResponse } from '@/tools/microsoft_planner/types'

interface MicrosoftPlannerBlockParams {
  credential: string
  accessToken?: string
  planId?: string
  taskId?: string
  title?: string
  description?: string
  dueDateTime?: string
  assigneeUserId?: string
  bucketId?: string
  [key: string]: string | number | boolean | undefined
}

export const MicrosoftPlannerBlock: BlockConfig<MicrosoftPlannerResponse> = {
  type: 'microsoft_planner',
  name: 'Microsoft Planner',
  description: 'Read and create tasks in Microsoft Planner',
  longDescription:
    'Integrate Microsoft Planner into the workflow. Can read and create tasks. Requires OAuth.',
  docsLink: 'https://docs.sim.ai/tools/microsoft_planner',
  category: 'tools',
  bgColor: '#E0E0E0',
  icon: MicrosoftPlannerIcon,
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      layout: 'full',
      options: [
        { label: 'Read Task', id: 'read_task' },
        { label: 'Create Task', id: 'create_task' },
      ],
    },
    {
      id: 'credential',
      title: 'Microsoft Account',
      type: 'oauth-input',
      layout: 'full',
      provider: 'microsoft-planner',
      serviceId: 'microsoft-planner',
      requiredScopes: [
        'openid',
        'profile',
        'email',
        'Group.ReadWrite.All',
        'Group.Read.All',
        'Tasks.ReadWrite',
        'offline_access',
      ],
      placeholder: 'Select Microsoft account',
    },
    {
      id: 'planId',
      title: 'Plan ID',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter the plan ID',
      condition: { field: 'operation', value: ['create_task', 'read_task'] },
      dependsOn: ['credential'],
    },
    {
      id: 'taskId',
      title: 'Task ID',
      type: 'file-selector',
      layout: 'full',
      placeholder: 'Select a task',
      provider: 'microsoft-planner',
      condition: { field: 'operation', value: ['read_task'] },
      dependsOn: ['credential', 'planId'],
      mode: 'basic',
      canonicalParamId: 'taskId',
    },

    // Advanced mode
    {
      id: 'manualTaskId',
      title: 'Manual Task ID',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter the task ID',
      condition: { field: 'operation', value: ['read_task'] },
      dependsOn: ['credential', 'planId'],
      mode: 'advanced',
      canonicalParamId: 'taskId',
    },

    {
      id: 'title',
      title: 'Task Title',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter the task title',
      condition: { field: 'operation', value: ['create_task'] },
    },
    {
      id: 'description',
      title: 'Description',
      type: 'long-input',
      layout: 'full',
      placeholder: 'Enter task description (optional)',
      condition: { field: 'operation', value: ['create_task'] },
    },
    {
      id: 'dueDateTime',
      title: 'Due Date',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter due date in ISO 8601 format (e.g., 2024-12-31T23:59:59Z)',
      condition: { field: 'operation', value: ['create_task'] },
    },
    {
      id: 'assigneeUserId',
      title: 'Assignee User ID',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter the user ID to assign this task to (optional)',
      condition: { field: 'operation', value: ['create_task'] },
    },
    {
      id: 'bucketId',
      title: 'Bucket ID',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter the bucket ID to organize the task (optional)',
      condition: { field: 'operation', value: ['create_task'] },
    },
  ],
  tools: {
    access: ['microsoft_planner_read_task', 'microsoft_planner_create_task'],
    config: {
      tool: (params) => {
        switch (params.operation) {
          case 'read_task':
            return 'microsoft_planner_read_task'
          case 'create_task':
            return 'microsoft_planner_create_task'
          default:
            throw new Error(`Invalid Microsoft Planner operation: ${params.operation}`)
        }
      },
      params: (params) => {
        const {
          credential,
          operation,
          planId,
          taskId,
          manualTaskId,
          title,
          description,
          dueDateTime,
          assigneeUserId,
          bucketId,
          ...rest
        } = params

        const baseParams = {
          ...rest,
          credential,
        }

        // Handle both selector and manual task ID
        const effectiveTaskId = (taskId || manualTaskId || '').trim()

        // For read operations
        if (operation === 'read_task') {
          const readParams: MicrosoftPlannerBlockParams = { ...baseParams }

          // If taskId is provided, add it (highest priority - get specific task)
          if (effectiveTaskId) {
            readParams.taskId = effectiveTaskId
          }
          // If no taskId but planId is provided, add planId (get tasks from plan)
          else if (planId?.trim()) {
            readParams.planId = planId.trim()
          }
          // If neither, get all user tasks (baseParams only)

          return readParams
        }

        // For create operation
        if (operation === 'create_task') {
          if (!planId?.trim()) {
            throw new Error('Plan ID is required to create a task.')
          }
          if (!title?.trim()) {
            throw new Error('Task title is required to create a task.')
          }

          const createParams: MicrosoftPlannerBlockParams = {
            ...baseParams,
            planId: planId.trim(),
            title: title.trim(),
          }

          if (description?.trim()) {
            createParams.description = description.trim()
          }

          if (dueDateTime?.trim()) {
            createParams.dueDateTime = dueDateTime.trim()
          }

          if (assigneeUserId?.trim()) {
            createParams.assigneeUserId = assigneeUserId.trim()
          }

          if (bucketId?.trim()) {
            createParams.bucketId = bucketId.trim()
          }

          return createParams
        }

        return baseParams
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    credential: { type: 'string', description: 'Microsoft account credential' },
    planId: { type: 'string', description: 'Plan ID' },
    taskId: { type: 'string', description: 'Task ID' },
    manualTaskId: { type: 'string', description: 'Manual Task ID' },
    title: { type: 'string', description: 'Task title' },
    description: { type: 'string', description: 'Task description' },
    dueDateTime: { type: 'string', description: 'Due date' },
    assigneeUserId: { type: 'string', description: 'Assignee user ID' },
    bucketId: { type: 'string', description: 'Bucket ID' },
  },
  outputs: {
    task: {
      type: 'json',
      description:
        'The Microsoft Planner task object, including details such as id, title, description, status, due date, and assignees.',
    },
    metadata: {
      type: 'json',
      description:
        'Additional metadata about the operation, such as timestamps, request status, or other relevant information.',
    },
  },
}
