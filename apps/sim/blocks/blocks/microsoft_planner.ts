import { MicrosoftPlannerIcon } from '@/components/icons'
import { getScopesForService } from '@/lib/oauth/utils'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'
import type { MicrosoftPlannerResponse } from '@/tools/microsoft_planner/types'

interface MicrosoftPlannerBlockParams {
  oauthCredential: string
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
  docsLink: 'https://docs.sim.ai/integrations/microsoft_planner',
  category: 'tools',
  integrationType: IntegrationType.Productivity,
  bgColor: '#FFFFFF',
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
      canonicalParamId: 'oauthCredential',
      mode: 'basic',
      serviceId: 'microsoft-planner',
      requiredScopes: getScopesForService('microsoft-planner'),
      placeholder: 'Select Microsoft account',
    },
    {
      id: 'manualCredential',
      title: 'Microsoft Account',
      type: 'short-input',
      canonicalParamId: 'oauthCredential',
      mode: 'advanced',
      placeholder: 'Enter credential ID',
    },

    // Plan selector - basic mode
    {
      id: 'planSelector',
      title: 'Plan',
      type: 'project-selector',
      canonicalParamId: 'planId',
      serviceId: 'microsoft-planner',
      selectorKey: 'microsoft.planner.plans',
      placeholder: 'Select a plan',
      dependsOn: ['credential'],
      mode: 'basic',
      condition: {
        field: 'operation',
        value: ['create_task', 'read_task', 'read_plan', 'list_buckets', 'create_bucket'],
      },
      required: {
        field: 'operation',
        value: ['read_plan', 'list_buckets', 'create_bucket', 'create_task'],
      },
    },

    // Plan ID - advanced mode
    {
      id: 'planId',
      title: 'Plan ID',
      type: 'short-input',
      canonicalParamId: 'planId',
      placeholder: 'Enter the plan ID',
      mode: 'advanced',
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
      selectorKey: 'microsoft.planner',
      condition: { field: 'operation', value: ['read_task'] },
      dependsOn: ['credential', 'planSelector'],
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
          oauthCredential,
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
          oauthCredential,
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
    oauthCredential: { type: 'string', description: 'Microsoft account credential' },
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

export const MicrosoftPlannerBlockMeta = {
  tags: ['project-management', 'microsoft-365'],
  url: 'https://www.microsoft.com/microsoft-365/business/task-management-software',
  templates: [
    {
      icon: MicrosoftPlannerIcon,
      title: 'Microsoft Planner sprint digest',
      prompt:
        'Create a scheduled weekly workflow that pulls Microsoft Planner bucket progress, computes completion rate per bucket, and posts a status digest to the project Microsoft Teams channel.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'productivity',
      tags: ['team', 'reporting'],
      alsoIntegrations: ['microsoft_teams'],
    },
    {
      icon: MicrosoftPlannerIcon,
      title: 'Microsoft Planner SLA monitor',
      prompt:
        'Build a workflow that watches Microsoft Planner tasks with due dates, sends reminders 24 hours before, and escalates to managers in Teams when items breach SLA.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'productivity',
      tags: ['team', 'monitoring'],
      alsoIntegrations: ['microsoft_teams'],
    },
    {
      icon: MicrosoftPlannerIcon,
      title: 'Microsoft Planner Excel-import',
      prompt:
        'Create a workflow that takes a Microsoft Excel task list, creates matching Planner tasks in the right bucket, and writes the planner IDs back to the spreadsheet for tracking.',
      modules: ['files', 'agent', 'workflows'],
      category: 'productivity',
      tags: ['team', 'sync'],
      alsoIntegrations: ['microsoft_excel'],
    },
    {
      icon: MicrosoftPlannerIcon,
      title: 'Microsoft Planner blocker watcher',
      prompt:
        'Build a scheduled workflow that scans Microsoft Planner tasks tagged blocked, identifies the blocking party, and posts a Teams ping with the context to unblock the work.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'productivity',
      tags: ['team', 'automation'],
      alsoIntegrations: ['microsoft_teams'],
    },
    {
      icon: MicrosoftPlannerIcon,
      title: 'Microsoft Planner template launcher',
      prompt:
        'Create a scheduled workflow that polls Microsoft Dataverse for new projects and creates a Planner plan from the project template, populates the standard buckets, and assigns the right owners.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'operations',
      tags: ['enterprise', 'automation'],
      alsoIntegrations: ['microsoft_dataverse'],
    },
    {
      icon: MicrosoftPlannerIcon,
      title: 'Microsoft Planner retrospective',
      prompt:
        'Build a scheduled workflow that runs at the end of a sprint, pulls completed Microsoft Planner tasks, summarizes wins and patterns, and writes the retro doc to a SharePoint page.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'productivity',
      tags: ['team', 'reporting'],
      alsoIntegrations: ['sharepoint'],
    },
    {
      icon: MicrosoftPlannerIcon,
      title: 'Microsoft Planner workload balancer',
      prompt:
        'Create a scheduled weekly workflow that audits Microsoft Planner assignment load per team member, suggests rebalancing, and posts the recommendations to the manager in Teams.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'operations',
      tags: ['hr', 'analysis'],
      alsoIntegrations: ['microsoft_teams'],
    },
  ],
  skills: [
    {
      name: 'create-task-in-bucket',
      description:
        'Create a Microsoft Planner task in a specific plan and bucket with title, due date, and assignee.',
      content:
        '# Create Planner Task\n\nCreate a new task in a Microsoft Planner plan, placing it in the right bucket and setting a due date and owner.\n\n## Steps\n1. Use List Plans to find the target plan, then List Buckets for that plan to locate the bucket id.\n2. Run Create Task with the plan id, a clear title, and the bucket id so it lands in the right column.\n3. If a due date was described in natural language, convert it to ISO 8601 (YYYY-MM-DDTHH:MM:SSZ) before passing dueDateTime.\n4. Set assigneeUserId when an owner is known.\n\n## Output\nConfirm the created task id and report title, bucket, due date, and assignee. Surface the etag for any follow-up updates.',
    },
    {
      name: 'set-up-plan-buckets',
      description:
        'Create a set of stage or phase buckets in a Planner plan to organize tasks by workflow column.',
      content:
        '# Set Up Plan Buckets\n\nStructure a Microsoft Planner plan into the workflow columns a team needs, such as To Do, In Progress, Review, and Done, or project phases.\n\n## Steps\n1. Use List Plans to find the target plan, then List Buckets to see which buckets already exist and avoid duplicates.\n2. Run Create Bucket once per desired column, passing the plan id and a clear bucket name.\n3. Keep names short and ordered so the board reads left to right as work progresses.\n\n## Output\nList every bucket id and name that now exists in the plan, marking which were newly created. Suggest the next bucket only if a stage is clearly missing.',
    },
    {
      name: 'add-task-checklist',
      description:
        'Add a step-by-step checklist to a Planner task so each subtask can be tracked and checked off.',
      content:
        '# Add Task Checklist\n\nBreak a Microsoft Planner task into trackable subtasks using its checklist.\n\n## Steps\n1. Identify the target task id, using Read Task to confirm the title if needed.\n2. Use Get Task Details to read the current checklist and capture the etag required for updates.\n3. Run Update Task Details with the checklist items to add, passing the etag from the previous step.\n4. Set percentComplete on the task with Update Task when progress should reflect the checklist state.\n\n## Output\nConfirm the task id and list the checklist items now present. Note the refreshed etag for any further edits.',
    },
  ],
} as const satisfies BlockMeta
