import { MicrosoftPlannerIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import type { MicrosoftPlannerResponse } from '@/tools/microsoft_planner/types'

export const MicrosoftPlannerBlock: BlockConfig<MicrosoftPlannerResponse> = {
  type: 'microsoft_planner',
  name: 'Microsoft Planner',
  description: 'Read and create tasks in Microsoft Planner',
  longDescription:
    'Integrate Microsoft Planner functionality to manage tasks. Read all user tasks, tasks from specific plans, individual tasks, or create new tasks with various properties like title, description, due date, and assignees using OAuth authentication.',
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
      condition: { field: 'operation', value: ['create_task'] },
    },
    {
      id: 'taskId',
      title: 'Task ID',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter the task ID',
      condition: { field: 'operation', value: ['read_task'] },
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
    {
      id: 'priority',
      title: 'Priority',
      type: 'dropdown',
      layout: 'full',
      options: [
        { label: 'Urgent (0)', id: '0' },
        { label: 'Important (1)', id: '1' },
        { label: 'Medium (2)', id: '2' },
        { label: 'Low (3)', id: '3' },
        { label: 'Later (4)', id: '4' },
        { label: 'Lowest (5)', id: '5' },
      ],
      condition: { field: 'operation', value: ['create_task'] },
    },
    {
      id: 'percentComplete',
      title: 'Completion %',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter completion percentage (0-100)',
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
          title,
          description,
          dueDateTime,
          assigneeUserId,
          bucketId,
          priority,
          percentComplete,
          ...rest
        } = params

        const baseParams = {
          ...rest,
          credential,
        }

        // For read operations
        if (operation === 'read_task') {
          // No additional parameters needed - will get all user tasks
          return baseParams
        }

        if (operation === 'read_task') {
          if (!planId?.trim()) {
            throw new Error('Plan ID is required to read tasks from a specific plan.')
          }
          return {
            ...baseParams,
            planId: planId.trim(),
          }
        }

        if (operation === 'read_task') {
          if (!taskId?.trim()) {
            throw new Error('Task ID is required to read a specific task.')
          }
          return {
            ...baseParams,
            taskId: taskId.trim(),
          }
        }

        // For create operation
        if (operation === 'create_task') {
          if (!planId?.trim()) {
            throw new Error('Plan ID is required to create a task.')
          }
          if (!title?.trim()) {
            throw new Error('Task title is required to create a task.')
          }

          const createParams: any = {
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

          if (priority !== undefined && priority !== '') {
            createParams.priority = Number.parseInt(priority as string, 10)
          }

          if (percentComplete?.trim()) {
            const percent = Number.parseInt(percentComplete.trim(), 10)
            if (percent >= 0 && percent <= 100) {
              createParams.percentComplete = percent
            }
          }

          return createParams
        }

        return baseParams
      },
    },
  },
  inputs: {
    operation: { type: 'string', required: true },
    credential: { type: 'string', required: true },
    planId: { type: 'string', required: false },
    taskId: { type: 'string', required: false },
    title: { type: 'string', required: false },
    description: { type: 'string', required: false },
    dueDateTime: { type: 'string', required: false },
    assigneeUserId: { type: 'string', required: false },
    bucketId: { type: 'string', required: false },
    priority: { type: 'string', required: false },
    percentComplete: { type: 'string', required: false },
  },
  outputs: {
    task: 'json',
    metadata: 'json',
  },
}
