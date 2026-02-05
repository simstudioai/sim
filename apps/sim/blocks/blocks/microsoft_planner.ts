import { MicrosoftPlannerIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import { AuthMode } from '@/blocks/types'
import type { MicrosoftPlannerResponse } from '@/tools/microsoft_planner/types'

interface MicrosoftPlannerBlockParams {
  credential: string
  accessToken?: string
  planId?: string
  taskId?: string
  bucketId?: string
  groupId?: string
  title?: string
  name?: string
  description?: string
  dueDateTime?: string
  startDateTime?: string
  assigneeUserId?: string
  priority?: number
  percentComplete?: number
  etag?: string
  checklist?: string
  references?: string
  previewType?: string
  [key: string]: string | number | boolean | undefined
}

export const MicrosoftPlannerBlock: BlockConfig<MicrosoftPlannerResponse> = {
  type: 'microsoft_planner',
  name: 'Microsoft Planner',
  description: 'Manage tasks, plans, and buckets in Microsoft Planner',
  authMode: AuthMode.OAuth,
  longDescription:
    'Integrate Microsoft Planner into the workflow. Manage tasks, plans, buckets, and task details including checklists and references.',
  docsLink: 'https://docs.sim.ai/tools/microsoft_planner',
  category: 'tools',
  bgColor: '#E0E0E0',
  icon: MicrosoftPlannerIcon,
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Read Task', id: 'read_task' },
        { label: 'Create Task', id: 'create_task' },
        { label: 'Update Task', id: 'update_task' },
        { label: 'Delete Task', id: 'delete_task' },
        { label: 'List Plans', id: 'list_plans' },
        { label: 'Read Plan', id: 'read_plan' },
        { label: 'List Buckets', id: 'list_buckets' },
        { label: 'Read Bucket', id: 'read_bucket' },
        { label: 'Create Bucket', id: 'create_bucket' },
        { label: 'Update Bucket', id: 'update_bucket' },
        { label: 'Delete Bucket', id: 'delete_bucket' },
        { label: 'Get Task Details', id: 'get_task_details' },
        { label: 'Update Task Details', id: 'update_task_details' },
      ],
    },
    {
      id: 'credential',
      title: 'Microsoft Account',
      type: 'oauth-input',
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

    // Plan ID - for various operations
    {
      id: 'planId',
      title: 'Plan ID',
      type: 'short-input',
      placeholder: 'Enter the plan ID',
      condition: {
        field: 'operation',
        value: ['create_task', 'read_task', 'read_plan', 'list_buckets', 'create_bucket'],
      },
      required: {
        field: 'operation',
        value: ['read_plan', 'list_buckets', 'create_bucket', 'create_task'],
      },
      dependsOn: ['credential'],
    },

    // Task ID selector - for read_task (basic mode)
    {
      id: 'taskSelector',
      title: 'Task ID',
      type: 'file-selector',
      placeholder: 'Select a task',
      serviceId: 'microsoft-planner',
      condition: { field: 'operation', value: ['read_task'] },
      dependsOn: ['credential', 'planId'],
      mode: 'basic',
      canonicalParamId: 'readTaskId',
    },

    // Manual Task ID - for read_task (advanced mode)
    {
      id: 'manualReadTaskId',
      title: 'Manual Task ID',
      type: 'short-input',
      placeholder: 'Enter the task ID',
      condition: { field: 'operation', value: ['read_task'] },
      dependsOn: ['credential', 'planId'],
      mode: 'advanced',
      canonicalParamId: 'readTaskId',
    },

    // Task ID for update/delete operations (no basic/advanced split, just one input)
    {
      id: 'updateTaskId',
      title: 'Task ID',
      type: 'short-input',
      placeholder: 'Enter the task ID',
      condition: {
        field: 'operation',
        value: ['update_task', 'delete_task', 'get_task_details', 'update_task_details'],
      },
      required: true,
      dependsOn: ['credential'],
    },

    // Bucket ID for bucket operations
    {
      id: 'bucketIdForRead',
      title: 'Bucket ID',
      type: 'short-input',
      placeholder: 'Enter the bucket ID',
      condition: { field: 'operation', value: ['read_bucket', 'update_bucket', 'delete_bucket'] },
      required: true,
      dependsOn: ['credential'],
    },

    // ETag for update/delete operations
    {
      id: 'etag',
      title: 'ETag',
      type: 'short-input',
      placeholder: 'Etag of the item',
      required: true,
      condition: {
        field: 'operation',
        value: [
          'update_task',
          'delete_task',
          'update_bucket',
          'delete_bucket',
          'update_task_details',
        ],
      },
      dependsOn: ['credential'],
    },

    // Task fields for create/update
    {
      id: 'title',
      title: 'Task Title',
      type: 'short-input',
      placeholder: 'Enter the task title',
      condition: { field: 'operation', value: ['create_task', 'update_task'] },
      required: { field: 'operation', value: 'create_task' },
    },

    // Name for bucket operations
    {
      id: 'name',
      title: 'Bucket Name',
      type: 'short-input',
      placeholder: 'Enter the bucket name',
      condition: { field: 'operation', value: ['create_bucket', 'update_bucket'] },
      required: { field: 'operation', value: 'create_bucket' },
    },

    // Description for task details
    {
      id: 'description',
      title: 'Description',
      type: 'long-input',
      placeholder: 'Enter task description',
      condition: { field: 'operation', value: ['create_task', 'update_task_details'] },
    },

    // Due Date
    {
      id: 'dueDateTime',
      title: 'Due Date',
      type: 'short-input',
      placeholder: 'Enter due date in ISO 8601 format (e.g., 2024-12-31T23:59:59Z)',
      condition: { field: 'operation', value: ['create_task', 'update_task'] },
      wandConfig: {
        enabled: true,
        prompt: `Generate an ISO 8601 timestamp based on the user's description for Microsoft Planner task due date.
The timestamp should be in the format: YYYY-MM-DDTHH:MM:SSZ (UTC timezone).
Examples:
- "tomorrow" -> Calculate tomorrow's date at 23:59:59Z
- "next Friday" -> Calculate the next Friday at 17:00:00Z
- "end of the month" -> Calculate the last day of the current month at 23:59:59Z
- "in 3 days" -> Calculate 3 days from now at 17:00:00Z

Return ONLY the timestamp string - no explanations, no quotes, no extra text.`,
        placeholder: 'Describe the due date (e.g., "next Friday", "end of the month")...',
        generationType: 'timestamp',
      },
    },

    // Start Date
    {
      id: 'startDateTime',
      title: 'Start Date',
      type: 'short-input',
      placeholder: 'Enter start date in ISO 8601 format (optional)',
      condition: { field: 'operation', value: ['update_task'] },
      wandConfig: {
        enabled: true,
        prompt: `Generate an ISO 8601 timestamp based on the user's description for Microsoft Planner task start date.
The timestamp should be in the format: YYYY-MM-DDTHH:MM:SSZ (UTC timezone).
Examples:
- "today" -> Calculate today's date at 09:00:00Z
- "next Monday" -> Calculate the next Monday at 09:00:00Z
- "beginning of next week" -> Calculate the next Monday at 09:00:00Z
- "tomorrow morning" -> Calculate tomorrow's date at 09:00:00Z

Return ONLY the timestamp string - no explanations, no quotes, no extra text.`,
        placeholder: 'Describe the start date (e.g., "next Monday", "tomorrow morning")...',
        generationType: 'timestamp',
      },
    },

    // Assignee
    {
      id: 'assigneeUserId',
      title: 'Assignee User ID',
      type: 'short-input',
      placeholder: 'Enter the user ID to assign this task to (optional)',
      condition: { field: 'operation', value: ['create_task', 'update_task'] },
    },

    // Bucket ID for task
    {
      id: 'bucketId',
      title: 'Bucket ID',
      type: 'short-input',
      placeholder: 'Enter the bucket ID to organize the task (optional)',
      condition: { field: 'operation', value: ['create_task', 'update_task'] },
    },

    // Priority
    {
      id: 'priority',
      title: 'Priority',
      type: 'short-input',
      placeholder: 'Enter priority (0-10, optional)',
      condition: { field: 'operation', value: ['update_task'] },
    },

    // Percent Complete
    {
      id: 'percentComplete',
      title: 'Percent Complete',
      type: 'short-input',
      placeholder: 'Enter completion percentage (0-100, optional)',
      condition: { field: 'operation', value: ['update_task'] },
    },

    // Checklist for task details
    {
      id: 'checklist',
      title: 'Checklist (JSON)',
      type: 'long-input',
      placeholder: 'Enter checklist as JSON object (optional)',
      condition: { field: 'operation', value: ['update_task_details'] },
    },

    // References for task details
    {
      id: 'references',
      title: 'References (JSON)',
      type: 'long-input',
      placeholder: 'Enter references as JSON object (optional)',
      condition: { field: 'operation', value: ['update_task_details'] },
    },

    // Preview Type
    {
      id: 'previewType',
      title: 'Preview Type',
      type: 'short-input',
      placeholder: 'Enter preview type (automatic, noPreview, checklist, description, reference)',
      condition: { field: 'operation', value: ['update_task_details'] },
    },
  ],
  tools: {
    access: [
      'microsoft_planner_read_task',
      'microsoft_planner_create_task',
      'microsoft_planner_update_task',
      'microsoft_planner_delete_task',
      'microsoft_planner_list_plans',
      'microsoft_planner_read_plan',
      'microsoft_planner_list_buckets',
      'microsoft_planner_read_bucket',
      'microsoft_planner_create_bucket',
      'microsoft_planner_update_bucket',
      'microsoft_planner_delete_bucket',
      'microsoft_planner_get_task_details',
      'microsoft_planner_update_task_details',
    ],
    config: {
      tool: (params) => {
        switch (params.operation) {
          case 'read_task':
            return 'microsoft_planner_read_task'
          case 'create_task':
            return 'microsoft_planner_create_task'
          case 'update_task':
            return 'microsoft_planner_update_task'
          case 'delete_task':
            return 'microsoft_planner_delete_task'
          case 'list_plans':
            return 'microsoft_planner_list_plans'
          case 'read_plan':
            return 'microsoft_planner_read_plan'
          case 'list_buckets':
            return 'microsoft_planner_list_buckets'
          case 'read_bucket':
            return 'microsoft_planner_read_bucket'
          case 'create_bucket':
            return 'microsoft_planner_create_bucket'
          case 'update_bucket':
            return 'microsoft_planner_update_bucket'
          case 'delete_bucket':
            return 'microsoft_planner_delete_bucket'
          case 'get_task_details':
            return 'microsoft_planner_get_task_details'
          case 'update_task_details':
            return 'microsoft_planner_update_task_details'
          default:
            throw new Error(`Invalid Microsoft Planner operation: ${params.operation}`)
        }
      },
      params: (params) => {
        const {
          credential,
          operation,
          groupId,
          planId,
          readTaskId, // Canonical param from taskSelector (basic) or manualReadTaskId (advanced) for read_task
          updateTaskId, // Task ID for update/delete operations
          bucketId,
          bucketIdForRead,
          title,
          name,
          description,
          dueDateTime,
          startDateTime,
          assigneeUserId,
          priority,
          percentComplete,
          etag,
          checklist,
          references,
          previewType,
          ...rest
        } = params

        const baseParams: MicrosoftPlannerBlockParams = {
          ...rest,
          credential,
        }

        // Handle different task ID fields based on operation
        const effectiveReadTaskId = readTaskId ? String(readTaskId).trim() : ''
        const effectiveUpdateTaskId = updateTaskId ? String(updateTaskId).trim() : ''
        const effectiveBucketId = (bucketIdForRead || bucketId || '').trim()

        // List Plans
        if (operation === 'list_plans') {
          return baseParams
        }

        // Read Plan
        if (operation === 'read_plan') {
          return {
            ...baseParams,
            planId: planId?.trim(),
          }
        }

        // List Buckets
        if (operation === 'list_buckets') {
          return {
            ...baseParams,
            planId: planId?.trim(),
          }
        }

        // Read Bucket
        if (operation === 'read_bucket') {
          return {
            ...baseParams,
            bucketId: effectiveBucketId,
          }
        }

        // Create Bucket
        if (operation === 'create_bucket') {
          return {
            ...baseParams,
            planId: planId?.trim(),
            name: name?.trim(),
          }
        }

        // Update Bucket
        if (operation === 'update_bucket') {
          const updateBucketParams: MicrosoftPlannerBlockParams = {
            ...baseParams,
            bucketId: effectiveBucketId,
            etag: etag?.trim(),
          }
          if (name?.trim()) {
            updateBucketParams.name = name.trim()
          }
          return updateBucketParams
        }

        // Delete Bucket
        if (operation === 'delete_bucket') {
          return {
            ...baseParams,
            bucketId: effectiveBucketId,
            etag: etag?.trim(),
          }
        }

        // Read Task
        if (operation === 'read_task') {
          const readParams: MicrosoftPlannerBlockParams = { ...baseParams }

          if (effectiveReadTaskId) {
            readParams.taskId = effectiveReadTaskId
          } else if (planId?.trim()) {
            readParams.planId = planId.trim()
          }

          return readParams
        }

        // Create Task
        if (operation === 'create_task') {
          const createParams: MicrosoftPlannerBlockParams = {
            ...baseParams,
            planId: planId?.trim(),
            title: title?.trim(),
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
          if (effectiveBucketId) {
            createParams.bucketId = effectiveBucketId
          }

          return createParams
        }

        // Update Task
        if (operation === 'update_task') {
          const updateParams: MicrosoftPlannerBlockParams = {
            ...baseParams,
            taskId: effectiveUpdateTaskId,
            etag: etag?.trim(),
          }

          if (title?.trim()) {
            updateParams.title = title.trim()
          }
          if (effectiveBucketId) {
            updateParams.bucketId = effectiveBucketId
          }
          if (dueDateTime?.trim()) {
            updateParams.dueDateTime = dueDateTime.trim()
          }
          if (startDateTime?.trim()) {
            updateParams.startDateTime = startDateTime.trim()
          }
          if (assigneeUserId?.trim()) {
            updateParams.assigneeUserId = assigneeUserId.trim()
          }
          if (priority !== undefined) {
            updateParams.priority = Number(priority)
          }
          if (percentComplete !== undefined) {
            updateParams.percentComplete = Number(percentComplete)
          }

          return updateParams
        }

        // Delete Task
        if (operation === 'delete_task') {
          return {
            ...baseParams,
            taskId: effectiveUpdateTaskId,
            etag: etag?.trim(),
          }
        }

        // Get Task Details
        if (operation === 'get_task_details') {
          return {
            ...baseParams,
            taskId: effectiveUpdateTaskId,
          }
        }

        // Update Task Details
        if (operation === 'update_task_details') {
          const updateDetailsParams: MicrosoftPlannerBlockParams = {
            ...baseParams,
            taskId: effectiveUpdateTaskId,
            etag: etag?.trim(),
          }

          if (description?.trim()) {
            updateDetailsParams.description = description.trim()
          }
          if (checklist?.trim()) {
            updateDetailsParams.checklist = checklist.trim()
          }
          if (references?.trim()) {
            updateDetailsParams.references = references.trim()
          }
          if (previewType?.trim()) {
            updateDetailsParams.previewType = previewType.trim()
          }

          return updateDetailsParams
        }

        return baseParams
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    credential: { type: 'string', description: 'Microsoft account credential' },
    groupId: { type: 'string', description: 'Microsoft 365 group ID' },
    planId: { type: 'string', description: 'Plan ID' },
    readTaskId: { type: 'string', description: 'Task ID for read operation' },
    updateTaskId: { type: 'string', description: 'Task ID for update/delete operations' },
    bucketId: { type: 'string', description: 'Bucket ID' },
    bucketIdForRead: { type: 'string', description: 'Bucket ID for read operations' },
    title: { type: 'string', description: 'Task title' },
    name: { type: 'string', description: 'Bucket name' },
    description: { type: 'string', description: 'Task or task details description' },
    dueDateTime: { type: 'string', description: 'Due date' },
    startDateTime: { type: 'string', description: 'Start date' },
    assigneeUserId: { type: 'string', description: 'Assignee user ID' },
    priority: { type: 'number', description: 'Task priority (0-10)' },
    percentComplete: { type: 'number', description: 'Task completion percentage (0-100)' },
    etag: { type: 'string', description: 'ETag for update/delete operations' },
    checklist: { type: 'string', description: 'Checklist items as JSON' },
    references: { type: 'string', description: 'References as JSON' },
    previewType: { type: 'string', description: 'Preview type for task details' },
  },
  outputs: {
    message: {
      type: 'string',
      description: 'Success message from the operation',
    },
    task: {
      type: 'json',
      description:
        'The Microsoft Planner task object, including details such as id, title, description, status, due date, and assignees.',
    },
    tasks: {
      type: 'json',
      description: 'Array of Microsoft Planner tasks',
    },
    taskId: {
      type: 'string',
      description: 'ID of the task',
    },
    etag: {
      type: 'string',
      description: 'ETag of the resource - use this for update/delete operations',
    },
    plan: {
      type: 'json',
      description: 'The Microsoft Planner plan object',
    },
    plans: {
      type: 'json',
      description: 'Array of Microsoft Planner plans',
    },
    bucket: {
      type: 'json',
      description: 'The Microsoft Planner bucket object',
    },
    buckets: {
      type: 'json',
      description: 'Array of Microsoft Planner buckets',
    },
    taskDetails: {
      type: 'json',
      description: 'The Microsoft Planner task details including checklist and references',
    },
    deleted: {
      type: 'boolean',
      description: 'Confirmation of deletion',
    },
    metadata: {
      type: 'json',
      description:
        'Additional metadata about the operation, such as timestamps, request status, or other relevant information.',
    },
  },
}
