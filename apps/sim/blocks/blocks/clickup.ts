import { ClickUpIcon } from '@/components/icons'
import { getScopesForService } from '@/lib/oauth/utils'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'
import { normalizeFileInput } from '@/blocks/utils'
import type { ClickUpResponse } from '@/tools/clickup/types'

const TIMESTAMP_WAND_PROMPT = `Generate a Unix timestamp in milliseconds based on the user's description.
Examples:
- "tomorrow at noon" -> Calculate tomorrow at 12:00 and return its Unix ms timestamp
- "next Friday" -> Calculate next Friday at 00:00 and return its Unix ms timestamp
- "in 3 days" -> Calculate 3 days from now and return its Unix ms timestamp

Return ONLY the numeric timestamp in milliseconds - no explanations, no quotes, no extra text.`

function splitCommaSeparated(value: unknown): string[] | undefined {
  if (typeof value !== 'string') return undefined
  const parts = value
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
  return parts.length > 0 ? parts : undefined
}

function splitCommaSeparatedNumbers(value: unknown): number[] | undefined {
  const parts = splitCommaSeparated(value)
  if (!parts) return undefined
  const numbers = parts.map((part) => Number(part)).filter((num) => Number.isFinite(num))
  return numbers.length > 0 ? numbers : undefined
}

function optionalNumber(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

export const ClickUpBlock: BlockConfig<ClickUpResponse> = {
  type: 'clickup',
  name: 'ClickUp',
  description: 'Interact with ClickUp',
  authMode: AuthMode.OAuth,
  longDescription:
    'Integrate ClickUp into the workflow. Create, read, update, and delete tasks, manage comments, tags, folders, and lists, upload attachments, and look up workspaces, members, and custom fields.',
  docsLink: 'https://docs.sim.ai/integrations/clickup',
  category: 'tools',
  integrationType: IntegrationType.Productivity,
  bgColor: '#FFFFFF',
  icon: ClickUpIcon,
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Create Task', id: 'create_task' },
        { label: 'Get Task', id: 'get_task' },
        { label: 'Update Task', id: 'update_task' },
        { label: 'Delete Task', id: 'delete_task' },
        { label: 'Get Tasks', id: 'get_tasks' },
        { label: 'Search Tasks', id: 'search_tasks' },
        { label: 'Create Comment', id: 'create_comment' },
        { label: 'Get Comments', id: 'get_comments' },
        { label: 'Update Comment', id: 'update_comment' },
        { label: 'Delete Comment', id: 'delete_comment' },
        { label: 'Upload Attachment', id: 'upload_attachment' },
        { label: 'Add Tag to Task', id: 'add_tag_to_task' },
        { label: 'Remove Tag from Task', id: 'remove_tag_from_task' },
        { label: 'Get Space Tags', id: 'get_space_tags' },
        { label: 'Get Task Members', id: 'get_task_members' },
        { label: 'Get List Members', id: 'get_list_members' },
        { label: 'Get Custom Fields', id: 'get_custom_fields' },
        { label: 'Get Workspaces', id: 'get_workspaces' },
        { label: 'Get Spaces', id: 'get_spaces' },
        { label: 'Get Folders', id: 'get_folders' },
        { label: 'Get Lists', id: 'get_lists' },
        { label: 'Create Folder', id: 'create_folder' },
        { label: 'Create List', id: 'create_list' },
      ],
      value: () => 'create_task',
    },
    {
      id: 'credential',
      title: 'ClickUp Account',
      type: 'oauth-input',
      canonicalParamId: 'oauthCredential',
      mode: 'basic',
      required: true,
      serviceId: 'clickup',
      requiredScopes: getScopesForService('clickup'),
      placeholder: 'Select ClickUp account',
    },
    {
      id: 'manualCredential',
      title: 'ClickUp Account',
      type: 'short-input',
      canonicalParamId: 'oauthCredential',
      mode: 'advanced',
      placeholder: 'Enter credential ID',
      required: true,
    },
    {
      id: 'workspaceId',
      title: 'Workspace ID',
      type: 'short-input',
      required: true,
      placeholder: 'Enter workspace (team) ID',
      condition: {
        field: 'operation',
        value: ['search_tasks', 'get_spaces'],
      },
    },
    {
      id: 'spaceId',
      title: 'Space ID',
      type: 'short-input',
      required: { field: 'operation', value: ['get_folders', 'create_folder', 'get_space_tags'] },
      placeholder: 'Enter space ID',
      condition: {
        field: 'operation',
        value: ['get_folders', 'create_folder', 'get_space_tags', 'get_lists', 'create_list'],
      },
    },
    {
      id: 'folderId',
      title: 'Folder ID',
      type: 'short-input',
      placeholder: 'Enter folder ID (or use a space ID for folderless lists)',
      condition: {
        field: 'operation',
        value: ['get_lists', 'create_list'],
      },
    },
    {
      id: 'listId',
      title: 'List ID',
      type: 'short-input',
      required: true,
      placeholder: 'Enter list ID',
      condition: {
        field: 'operation',
        value: ['create_task', 'get_tasks', 'get_list_members', 'get_custom_fields'],
      },
    },
    {
      id: 'taskId',
      title: 'Task ID',
      type: 'short-input',
      required: true,
      placeholder: 'Enter task ID',
      condition: {
        field: 'operation',
        value: [
          'get_task',
          'update_task',
          'delete_task',
          'create_comment',
          'get_comments',
          'upload_attachment',
          'add_tag_to_task',
          'remove_tag_from_task',
          'get_task_members',
        ],
      },
    },
    {
      id: 'commentId',
      title: 'Comment ID',
      type: 'short-input',
      required: true,
      placeholder: 'Enter comment ID',
      condition: {
        field: 'operation',
        value: ['update_comment', 'delete_comment'],
      },
    },
    {
      id: 'name',
      title: 'Name',
      type: 'short-input',
      required: { field: 'operation', value: ['create_task', 'create_folder', 'create_list'] },
      placeholder: 'Enter a name',
      condition: {
        field: 'operation',
        value: ['create_task', 'update_task', 'create_folder', 'create_list'],
      },
    },
    {
      id: 'description',
      title: 'Description',
      type: 'long-input',
      placeholder: 'Enter task description',
      condition: {
        field: 'operation',
        value: ['create_task', 'update_task'],
      },
    },
    {
      id: 'markdownContent',
      title: 'Markdown Description',
      type: 'long-input',
      mode: 'advanced',
      placeholder: 'Markdown description (overrides Description)',
      condition: {
        field: 'operation',
        value: ['create_task', 'update_task'],
      },
    },
    {
      id: 'status',
      title: 'Status',
      type: 'short-input',
      placeholder: 'Enter a status that exists in the list (e.g. "in progress")',
      condition: {
        field: 'operation',
        value: ['create_task', 'update_task'],
      },
    },
    {
      id: 'priority',
      title: 'Priority',
      type: 'dropdown',
      options: [
        { label: 'None', id: 'none' },
        { label: 'Urgent', id: '1' },
        { label: 'High', id: '2' },
        { label: 'Normal', id: '3' },
        { label: 'Low', id: '4' },
      ],
      value: () => 'none',
      condition: {
        field: 'operation',
        value: ['create_task', 'update_task'],
      },
    },
    {
      id: 'dueDate',
      title: 'Due Date',
      type: 'short-input',
      placeholder: 'Unix timestamp in milliseconds',
      condition: {
        field: 'operation',
        value: ['create_task', 'update_task'],
      },
      wandConfig: {
        enabled: true,
        prompt: TIMESTAMP_WAND_PROMPT,
        placeholder: 'Describe the due date (e.g., "tomorrow", "next Friday")...',
        generationType: 'timestamp',
      },
    },
    {
      id: 'startDate',
      title: 'Start Date',
      type: 'short-input',
      mode: 'advanced',
      placeholder: 'Unix timestamp in milliseconds',
      condition: {
        field: 'operation',
        value: ['create_task', 'update_task'],
      },
      wandConfig: {
        enabled: true,
        prompt: TIMESTAMP_WAND_PROMPT,
        placeholder: 'Describe the start date (e.g., "today", "next Monday")...',
        generationType: 'timestamp',
      },
    },
    {
      id: 'assignees',
      title: 'Assignees',
      type: 'short-input',
      placeholder: 'Comma-separated user IDs (e.g. 183, 184)',
      condition: {
        field: 'operation',
        value: ['create_task'],
      },
    },
    {
      id: 'tags',
      title: 'Tags',
      type: 'short-input',
      placeholder: 'Comma-separated tag names',
      condition: {
        field: 'operation',
        value: ['create_task'],
      },
    },
    {
      id: 'timeEstimate',
      title: 'Time Estimate',
      type: 'short-input',
      mode: 'advanced',
      placeholder: 'Time estimate in milliseconds',
      condition: {
        field: 'operation',
        value: ['create_task', 'update_task'],
      },
    },
    {
      id: 'points',
      title: 'Sprint Points',
      type: 'short-input',
      mode: 'advanced',
      placeholder: 'Sprint points (number)',
      condition: {
        field: 'operation',
        value: ['update_task'],
      },
    },
    {
      id: 'parent',
      title: 'Parent Task ID',
      type: 'short-input',
      mode: 'advanced',
      placeholder: 'Parent task ID (creates a subtask)',
      condition: {
        field: 'operation',
        value: ['create_task', 'update_task'],
      },
    },
    {
      id: 'notifyAll',
      title: 'Notify Creator',
      type: 'switch',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: ['create_task', 'create_comment'],
      },
    },
    {
      id: 'archiveAction',
      title: 'Archive',
      type: 'dropdown',
      mode: 'advanced',
      options: [
        { label: 'No change', id: 'none' },
        { label: 'Archive', id: 'archive' },
        { label: 'Unarchive', id: 'unarchive' },
      ],
      value: () => 'none',
      condition: {
        field: 'operation',
        value: ['update_task'],
      },
    },
    {
      id: 'includeSubtasks',
      title: 'Include Subtasks',
      type: 'switch',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: ['get_task'],
      },
    },
    {
      id: 'includeMarkdownDescription',
      title: 'Markdown Description',
      type: 'switch',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: ['get_task'],
      },
    },
    {
      id: 'page',
      title: 'Page',
      type: 'short-input',
      mode: 'advanced',
      placeholder: 'Page to fetch (starts at 0)',
      condition: {
        field: 'operation',
        value: ['get_tasks', 'search_tasks'],
      },
    },
    {
      id: 'orderBy',
      title: 'Order By',
      type: 'dropdown',
      mode: 'advanced',
      options: [
        { label: 'Created', id: 'created' },
        { label: 'Updated', id: 'updated' },
        { label: 'Due date', id: 'due_date' },
        { label: 'ID', id: 'id' },
      ],
      value: () => 'created',
      condition: {
        field: 'operation',
        value: ['get_tasks', 'search_tasks'],
      },
    },
    {
      id: 'reverse',
      title: 'Reverse Order',
      type: 'switch',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: ['get_tasks', 'search_tasks'],
      },
    },
    {
      id: 'subtasks',
      title: 'Include Subtasks',
      type: 'switch',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: ['get_tasks', 'search_tasks'],
      },
    },
    {
      id: 'includeClosed',
      title: 'Include Closed Tasks',
      type: 'switch',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: ['get_tasks'],
      },
    },
    {
      id: 'archived',
      title: 'Archived Only',
      type: 'switch',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: ['get_tasks', 'get_spaces', 'get_folders', 'get_lists'],
      },
    },
    {
      id: 'statuses',
      title: 'Statuses',
      type: 'short-input',
      mode: 'advanced',
      placeholder: 'Comma-separated status names to filter by',
      condition: {
        field: 'operation',
        value: ['get_tasks'],
      },
    },
    {
      id: 'listIds',
      title: 'List IDs',
      type: 'short-input',
      mode: 'advanced',
      placeholder: 'Comma-separated list IDs to filter by',
      condition: {
        field: 'operation',
        value: ['search_tasks'],
      },
    },
    {
      id: 'spaceIds',
      title: 'Space IDs',
      type: 'short-input',
      mode: 'advanced',
      placeholder: 'Comma-separated space IDs to filter by',
      condition: {
        field: 'operation',
        value: ['search_tasks'],
      },
    },
    {
      id: 'folderIds',
      title: 'Folder IDs',
      type: 'short-input',
      mode: 'advanced',
      placeholder: 'Comma-separated folder IDs to filter by',
      condition: {
        field: 'operation',
        value: ['search_tasks'],
      },
    },
    {
      id: 'commentText',
      title: 'Comment Text',
      type: 'long-input',
      required: { field: 'operation', value: ['create_comment'] },
      placeholder: 'Enter comment text',
      condition: {
        field: 'operation',
        value: ['create_comment', 'update_comment'],
      },
    },
    {
      id: 'commentAssignee',
      title: 'Comment Assignee',
      type: 'short-input',
      mode: 'advanced',
      placeholder: 'User ID to assign the comment to',
      condition: {
        field: 'operation',
        value: ['create_comment', 'update_comment'],
      },
    },
    {
      id: 'resolvedAction',
      title: 'Resolved',
      type: 'dropdown',
      mode: 'advanced',
      options: [
        { label: 'No change', id: 'none' },
        { label: 'Resolve', id: 'resolve' },
        { label: 'Unresolve', id: 'unresolve' },
      ],
      value: () => 'none',
      condition: {
        field: 'operation',
        value: ['update_comment'],
      },
    },
    {
      id: 'start',
      title: 'Start Timestamp',
      type: 'short-input',
      mode: 'advanced',
      placeholder: 'Unix ms of the last comment from the previous page',
      condition: {
        field: 'operation',
        value: ['get_comments'],
      },
    },
    {
      id: 'startId',
      title: 'Start Comment ID',
      type: 'short-input',
      mode: 'advanced',
      placeholder: 'ID of the last comment from the previous page',
      condition: {
        field: 'operation',
        value: ['get_comments'],
      },
    },
    {
      id: 'tagName',
      title: 'Tag Name',
      type: 'short-input',
      required: true,
      placeholder: 'Enter tag name',
      condition: {
        field: 'operation',
        value: ['add_tag_to_task', 'remove_tag_from_task'],
      },
    },
    {
      id: 'content',
      title: 'List Description',
      type: 'long-input',
      placeholder: 'Enter list description',
      condition: {
        field: 'operation',
        value: ['create_list'],
      },
    },
    {
      id: 'attachmentFile',
      title: 'File',
      type: 'file-upload',
      canonicalParamId: 'file',
      placeholder: 'Upload file',
      mode: 'basic',
      multiple: false,
      required: true,
      condition: {
        field: 'operation',
        value: ['upload_attachment'],
      },
    },
    {
      id: 'fileReference',
      title: 'File',
      type: 'short-input',
      canonicalParamId: 'file',
      placeholder: 'File reference from a previous block',
      mode: 'advanced',
      required: true,
      condition: {
        field: 'operation',
        value: ['upload_attachment'],
      },
    },
  ],
  tools: {
    access: [
      'clickup_create_task',
      'clickup_get_task',
      'clickup_update_task',
      'clickup_delete_task',
      'clickup_get_tasks',
      'clickup_search_tasks',
      'clickup_create_comment',
      'clickup_get_comments',
      'clickup_update_comment',
      'clickup_delete_comment',
      'clickup_upload_attachment',
      'clickup_add_tag_to_task',
      'clickup_remove_tag_from_task',
      'clickup_get_space_tags',
      'clickup_get_task_members',
      'clickup_get_list_members',
      'clickup_get_custom_fields',
      'clickup_get_workspaces',
      'clickup_get_spaces',
      'clickup_get_folders',
      'clickup_get_lists',
      'clickup_create_folder',
      'clickup_create_list',
    ],
    config: {
      tool: (params) => `clickup_${params.operation}`,
      params: (params) => {
        const { oauthCredential, operation } = params

        const baseParams = {
          accessToken: oauthCredential?.accessToken,
        }

        const priorityValue =
          params.priority && params.priority !== 'none' ? Number(params.priority) : undefined

        switch (operation) {
          case 'create_task':
            return {
              ...baseParams,
              listId: params.listId,
              name: params.name,
              description: params.description || undefined,
              markdownContent: params.markdownContent || undefined,
              status: params.status || undefined,
              priority: priorityValue,
              dueDate: optionalNumber(params.dueDate),
              startDate: optionalNumber(params.startDate),
              assignees: splitCommaSeparatedNumbers(params.assignees),
              tags: splitCommaSeparated(params.tags),
              timeEstimate: optionalNumber(params.timeEstimate),
              parent: params.parent || undefined,
              notifyAll: params.notifyAll ? true : undefined,
            }
          case 'get_task':
            return {
              ...baseParams,
              taskId: params.taskId,
              includeSubtasks: params.includeSubtasks ? true : undefined,
              includeMarkdownDescription: params.includeMarkdownDescription ? true : undefined,
            }
          case 'update_task':
            return {
              ...baseParams,
              taskId: params.taskId,
              name: params.name || undefined,
              description: params.description || undefined,
              markdownContent: params.markdownContent || undefined,
              status: params.status || undefined,
              priority: priorityValue,
              dueDate: optionalNumber(params.dueDate),
              startDate: optionalNumber(params.startDate),
              timeEstimate: optionalNumber(params.timeEstimate),
              points: optionalNumber(params.points),
              parent: params.parent || undefined,
              archived:
                params.archiveAction === 'archive'
                  ? true
                  : params.archiveAction === 'unarchive'
                    ? false
                    : undefined,
            }
          case 'delete_task':
            return {
              ...baseParams,
              taskId: params.taskId,
            }
          case 'get_tasks':
            return {
              ...baseParams,
              listId: params.listId,
              page: optionalNumber(params.page),
              orderBy: params.orderBy || undefined,
              reverse: params.reverse ? true : undefined,
              subtasks: params.subtasks ? true : undefined,
              includeClosed: params.includeClosed ? true : undefined,
              archived: params.archived ? true : undefined,
              statuses: splitCommaSeparated(params.statuses),
            }
          case 'search_tasks':
            return {
              ...baseParams,
              workspaceId: params.workspaceId,
              page: optionalNumber(params.page),
              orderBy: params.orderBy || undefined,
              reverse: params.reverse ? true : undefined,
              subtasks: params.subtasks ? true : undefined,
              listIds: splitCommaSeparated(params.listIds),
              spaceIds: splitCommaSeparated(params.spaceIds),
              folderIds: splitCommaSeparated(params.folderIds),
            }
          case 'create_comment':
            return {
              ...baseParams,
              taskId: params.taskId,
              commentText: params.commentText,
              assignee: optionalNumber(params.commentAssignee),
              notifyAll: params.notifyAll ? true : undefined,
            }
          case 'get_comments':
            return {
              ...baseParams,
              taskId: params.taskId,
              start: optionalNumber(params.start),
              startId: params.startId || undefined,
            }
          case 'update_comment':
            return {
              ...baseParams,
              commentId: params.commentId,
              commentText: params.commentText || undefined,
              assignee: optionalNumber(params.commentAssignee),
              resolved:
                params.resolvedAction === 'resolve'
                  ? true
                  : params.resolvedAction === 'unresolve'
                    ? false
                    : undefined,
            }
          case 'delete_comment':
            return {
              ...baseParams,
              commentId: params.commentId,
            }
          case 'upload_attachment': {
            const normalizedFile = normalizeFileInput(params.file, { single: true })
            if (!normalizedFile) {
              throw new Error('An attachment file is required.')
            }
            return {
              ...baseParams,
              taskId: params.taskId,
              file: normalizedFile,
            }
          }
          case 'add_tag_to_task':
          case 'remove_tag_from_task':
            return {
              ...baseParams,
              taskId: params.taskId,
              tagName: params.tagName,
            }
          case 'get_space_tags':
            return {
              ...baseParams,
              spaceId: params.spaceId,
            }
          case 'get_task_members':
            return {
              ...baseParams,
              taskId: params.taskId,
            }
          case 'get_list_members':
            return {
              ...baseParams,
              listId: params.listId,
            }
          case 'get_custom_fields':
            return {
              ...baseParams,
              listId: params.listId,
            }
          case 'get_workspaces':
            return {
              ...baseParams,
            }
          case 'get_spaces':
            return {
              ...baseParams,
              workspaceId: params.workspaceId,
              archived: params.archived ? true : undefined,
            }
          case 'get_folders':
            return {
              ...baseParams,
              spaceId: params.spaceId,
              archived: params.archived ? true : undefined,
            }
          case 'get_lists':
            return {
              ...baseParams,
              folderId: params.folderId || undefined,
              spaceId: params.spaceId || undefined,
              archived: params.archived ? true : undefined,
            }
          case 'create_folder':
            return {
              ...baseParams,
              spaceId: params.spaceId,
              name: params.name,
            }
          case 'create_list':
            return {
              ...baseParams,
              folderId: params.folderId || undefined,
              spaceId: params.spaceId || undefined,
              name: params.name,
              content: params.content || undefined,
              markdownContent: params.markdownContent || undefined,
            }
          default:
            return baseParams
        }
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    oauthCredential: { type: 'string', description: 'ClickUp OAuth credential' },
    workspaceId: { type: 'string', description: 'Workspace (team) ID' },
    spaceId: { type: 'string', description: 'Space ID' },
    folderId: { type: 'string', description: 'Folder ID' },
    listId: { type: 'string', description: 'List ID' },
    taskId: { type: 'string', description: 'Task ID' },
    commentId: { type: 'string', description: 'Comment ID' },
    name: { type: 'string', description: 'Name for the task, folder, or list' },
    description: { type: 'string', description: 'Task description' },
    markdownContent: { type: 'string', description: 'Markdown description' },
    status: { type: 'string', description: 'Task status' },
    priority: { type: 'string', description: 'Task priority (1-4)' },
    dueDate: { type: 'string', description: 'Due date (Unix ms)' },
    startDate: { type: 'string', description: 'Start date (Unix ms)' },
    assignees: { type: 'string', description: 'Comma-separated assignee user IDs' },
    tags: { type: 'string', description: 'Comma-separated tag names' },
    timeEstimate: { type: 'string', description: 'Time estimate in milliseconds' },
    points: { type: 'string', description: 'Sprint points' },
    parent: { type: 'string', description: 'Parent task ID' },
    notifyAll: { type: 'boolean', description: 'Notify the creator' },
    archiveAction: { type: 'string', description: 'Archive action (none, archive, unarchive)' },
    includeSubtasks: { type: 'boolean', description: 'Include subtasks' },
    includeMarkdownDescription: {
      type: 'boolean',
      description: 'Return the description in Markdown',
    },
    page: { type: 'string', description: 'Page to fetch (starts at 0)' },
    orderBy: { type: 'string', description: 'Order-by field' },
    reverse: { type: 'boolean', description: 'Reverse order' },
    subtasks: { type: 'boolean', description: 'Include subtasks in results' },
    includeClosed: { type: 'boolean', description: 'Include closed tasks' },
    archived: { type: 'boolean', description: 'Return archived items' },
    statuses: { type: 'string', description: 'Comma-separated status filters' },
    listIds: { type: 'string', description: 'Comma-separated list ID filters' },
    spaceIds: { type: 'string', description: 'Comma-separated space ID filters' },
    folderIds: { type: 'string', description: 'Comma-separated folder ID filters' },
    commentText: { type: 'string', description: 'Comment text' },
    commentAssignee: { type: 'string', description: 'User ID to assign the comment to' },
    resolvedAction: { type: 'string', description: 'Resolved action (none, resolve, unresolve)' },
    start: { type: 'string', description: 'Pagination start timestamp (Unix ms)' },
    startId: { type: 'string', description: 'Pagination start comment ID' },
    tagName: { type: 'string', description: 'Tag name' },
    content: { type: 'string', description: 'List description' },
    file: { type: 'json', description: 'File to upload as an attachment' },
  },
  outputs: {
    task: { type: 'json', description: 'Task details' },
    tasks: { type: 'json', description: 'Array of tasks' },
    comments: { type: 'json', description: 'Array of comments' },
    id: { type: 'string', description: 'ID of the affected resource' },
    histId: { type: 'string', description: 'History ID of the created comment' },
    date: { type: 'number', description: 'Timestamp of the created comment (Unix ms)' },
    updated: { type: 'boolean', description: 'Whether the comment was updated' },
    deleted: { type: 'boolean', description: 'Whether the resource was deleted' },
    attachment: { type: 'json', description: 'Uploaded attachment details' },
    files: { type: 'json', description: 'Uploaded attachment files' },
    taskId: { type: 'string', description: 'Task ID for tag operations' },
    tagName: { type: 'string', description: 'Tag name for tag operations' },
    tags: { type: 'json', description: 'Array of space tags' },
    members: { type: 'json', description: 'Array of members' },
    fields: { type: 'json', description: 'Array of custom fields' },
    workspaces: { type: 'json', description: 'Array of workspaces' },
    spaces: { type: 'json', description: 'Array of spaces' },
    folders: { type: 'json', description: 'Array of folders' },
    folder: { type: 'json', description: 'Created folder details' },
    lists: { type: 'json', description: 'Array of lists' },
    list: { type: 'json', description: 'Created list details' },
  },
}

export const ClickUpBlockMeta = {
  tags: ['project-management', 'ticketing', 'automation'],
  url: 'https://clickup.com',
  templates: [
    {
      icon: ClickUpIcon,
      title: 'ClickUp task intake',
      prompt:
        'Build a workflow that turns incoming Slack requests into ClickUp tasks in the right list with a clear name, description, priority, and due date, then replies in the thread with the task link.',
      modules: ['agent', 'workflows'],
      category: 'productivity',
      tags: ['team', 'automation'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: ClickUpIcon,
      title: 'ClickUp standup digest',
      prompt:
        'Create a scheduled weekday workflow that pulls open ClickUp tasks for each list, groups them by assignee and status, and posts a morning standup summary to the team Slack channel.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'productivity',
      tags: ['team', 'reporting'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: ClickUpIcon,
      title: 'ClickUp overdue-task nudger',
      prompt:
        'Build a scheduled workflow that searches ClickUp for tasks past their due date, adds a comment asking for a status update, and emails each assignee a digest of their overdue work.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'productivity',
      tags: ['team', 'monitoring'],
      alsoIntegrations: ['gmail'],
    },
    {
      icon: ClickUpIcon,
      title: 'ClickUp bug triager',
      prompt:
        'Create a workflow that reads newly reported bugs from a ClickUp list, classifies each by severity and component with an agent, sets the priority and tags accordingly, and opens a matching GitHub issue for engineering.',
      modules: ['agent', 'workflows'],
      category: 'engineering',
      tags: ['engineering', 'automation'],
      alsoIntegrations: ['github'],
    },
    {
      icon: ClickUpIcon,
      title: 'ClickUp sprint retro writer',
      prompt:
        'Build a workflow that pulls the ClickUp tasks completed during a sprint, summarizes wins, blockers, and recurring themes with an agent, and shares a retro document with the team in Slack.',
      modules: ['agent', 'files', 'workflows'],
      category: 'productivity',
      tags: ['team', 'reporting'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: ClickUpIcon,
      title: 'ClickUp customer onboarding launcher',
      prompt:
        'Create a workflow that on a closed-won Salesforce opportunity creates a ClickUp onboarding task with the right assignees and due date, attaches the signed order form, and writes the task link back to the opportunity.',
      modules: ['agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'crm'],
      alsoIntegrations: ['salesforce'],
    },
    {
      icon: ClickUpIcon,
      title: 'ClickUp meeting action items',
      prompt:
        'Build a workflow that takes meeting notes, extracts action items with an agent, creates a ClickUp task for each with the right assignee and due date, and replies with a checklist of created tasks.',
      modules: ['agent', 'workflows'],
      category: 'productivity',
      tags: ['team', 'automation'],
    },
  ],
  skills: [
    {
      name: 'create-task-from-request',
      description:
        'Turn an incoming request or message into a well-formed ClickUp task in the right list with priority, assignees, and due date. Use for intake and ticket creation.',
      content:
        '# Create Task from Request\n\nConvert an incoming request into a structured ClickUp task.\n\n## Steps\n1. Extract the work to be done, the target list, any assignees, a priority, and a due date.\n2. If the list is referenced by name, walk the hierarchy (workspaces, spaces, folders, lists) to resolve its ID.\n3. Create the task with a clear name, a description capturing the request details, and the extracted fields.\n4. Add a comment with any links or source context if helpful.\n\n## Output\nReport the created task name, its URL or ID, list, assignees, and due date.',
    },
    {
      name: 'summarize-list-tasks',
      description:
        'Fetch the tasks in a ClickUp list and summarize status, overdue items, and who owns what. Use for standups and project status checks.',
      content:
        '# Summarize List Tasks\n\nProduce a status snapshot of a ClickUp list.\n\n## Steps\n1. Resolve the list, then fetch its tasks (include closed tasks when a full picture is needed).\n2. For each task capture name, assignees, status, priority, and due date.\n3. Group into completed, in progress, and overdue or due soon.\n4. Note any unassigned tasks or tasks with no due date.\n\n## Output\nA concise status summary: counts per group, overdue tasks called out by name and owner, and any gaps to address.',
    },
    {
      name: 'update-task-status',
      description:
        'Find a ClickUp task and update its fields — status, priority, due date — or add a progress comment. Use to keep tasks current from other systems.',
      content:
        '# Update Task Status\n\nKeep a ClickUp task in sync with the latest state.\n\n## Steps\n1. Identify the target task by ID, or search the workspace to find it.\n2. Read the current task to confirm it is the right one.\n3. Update the relevant fields — status, priority, due date, or archive state.\n4. Add a comment summarizing what changed and why.\n\n## Output\nReport which fields changed and confirm the task ID. If no matching task was found, say so.',
    },
  ],
} as const satisfies BlockMeta
