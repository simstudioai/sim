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

/**
 * Parses a custom field value from the block input. JSON values (objects,
 * arrays, numbers, booleans, quoted strings) are decoded so structured and
 * typed fields (labels, progress, number, checkbox) receive the right wire
 * type; anything that isn't valid JSON is passed through as a plain string,
 * which text and dropdown fields accept.
 */
function parseCustomFieldValue(value: unknown): unknown {
  if (typeof value !== 'string') return value
  const trimmed = value.trim()
  if (trimmed.length === 0) return value
  try {
    return JSON.parse(trimmed)
  } catch {
    return value
  }
}

function billableFromAction(action: unknown): boolean | undefined {
  return action === 'billable' ? true : action === 'non_billable' ? false : undefined
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
        { label: 'Set Custom Field Value', id: 'set_custom_field_value' },
        { label: 'Remove Custom Field Value', id: 'remove_custom_field_value' },
        { label: 'Create Checklist', id: 'create_checklist' },
        { label: 'Update Checklist', id: 'update_checklist' },
        { label: 'Delete Checklist', id: 'delete_checklist' },
        { label: 'Create Checklist Item', id: 'create_checklist_item' },
        { label: 'Update Checklist Item', id: 'update_checklist_item' },
        { label: 'Delete Checklist Item', id: 'delete_checklist_item' },
        { label: 'Get Time Entries', id: 'get_time_entries' },
        { label: 'Create Time Entry', id: 'create_time_entry' },
        { label: 'Update Time Entry', id: 'update_time_entry' },
        { label: 'Delete Time Entry', id: 'delete_time_entry' },
        { label: 'Start Timer', id: 'start_timer' },
        { label: 'Stop Timer', id: 'stop_timer' },
        { label: 'Get Running Timer', id: 'get_running_timer' },
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
        value: [
          'search_tasks',
          'get_spaces',
          'get_time_entries',
          'create_time_entry',
          'update_time_entry',
          'delete_time_entry',
          'start_timer',
          'stop_timer',
          'get_running_timer',
        ],
      },
    },
    {
      id: 'spaceId',
      title: 'Space ID',
      type: 'short-input',
      required: true,
      placeholder: 'Enter space ID',
      condition: {
        field: 'operation',
        value: ['get_folders', 'create_folder', 'get_space_tags'],
      },
    },
    {
      id: 'listParent',
      title: 'Location',
      type: 'dropdown',
      options: [
        { label: 'Folder', id: 'folder' },
        { label: 'Space (folderless)', id: 'space' },
      ],
      value: () => 'folder',
      condition: {
        field: 'operation',
        value: ['get_lists', 'create_list'],
      },
    },
    {
      id: 'folderId',
      title: 'Folder ID',
      type: 'short-input',
      required: true,
      placeholder: 'Enter folder ID',
      condition: {
        field: 'operation',
        value: ['get_lists', 'create_list'],
        and: { field: 'listParent', value: 'folder' },
      },
    },
    {
      id: 'listSpaceId',
      title: 'Space ID',
      type: 'short-input',
      required: true,
      placeholder: 'Enter space ID',
      condition: {
        field: 'operation',
        value: ['get_lists', 'create_list'],
        and: { field: 'listParent', value: 'space' },
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
          'set_custom_field_value',
          'remove_custom_field_value',
          'create_checklist',
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
      required: {
        field: 'operation',
        value: [
          'create_task',
          'create_folder',
          'create_list',
          'create_checklist',
          'create_checklist_item',
        ],
      },
      placeholder: 'Enter a name',
      condition: {
        field: 'operation',
        value: [
          'create_task',
          'update_task',
          'create_folder',
          'create_list',
          'create_checklist',
          'update_checklist',
          'create_checklist_item',
          'update_checklist_item',
        ],
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
      placeholder: 'Markdown description (used instead of the plain description)',
      condition: {
        field: 'operation',
        value: ['create_task', 'update_task', 'create_list'],
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
        value: ['create_task', 'get_tasks', 'search_tasks'],
      },
    },
    {
      id: 'assigneesToAdd',
      title: 'Add Assignees',
      type: 'short-input',
      mode: 'advanced',
      placeholder: 'Comma-separated user IDs to add',
      condition: {
        field: 'operation',
        value: ['update_task'],
      },
    },
    {
      id: 'assigneesToRemove',
      title: 'Remove Assignees',
      type: 'short-input',
      mode: 'advanced',
      placeholder: 'Comma-separated user IDs to remove',
      condition: {
        field: 'operation',
        value: ['update_task'],
      },
    },
    {
      id: 'tags',
      title: 'Tags',
      type: 'short-input',
      placeholder: 'Comma-separated tag names',
      condition: {
        field: 'operation',
        value: ['create_task', 'get_tasks', 'search_tasks'],
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
        value: ['create_task', 'update_task'],
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
      id: 'dueDateTime',
      title: 'Due Date Has Time',
      type: 'switch',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: ['create_task', 'update_task'],
      },
    },
    {
      id: 'startDateTime',
      title: 'Start Date Has Time',
      type: 'switch',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: ['create_task', 'update_task'],
      },
    },
    {
      id: 'notifyAll',
      title: 'Notify All',
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
      title: 'Return Markdown Description',
      type: 'switch',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: ['get_task', 'get_tasks', 'search_tasks'],
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
        { label: 'Default (created)', id: 'none' },
        { label: 'Created', id: 'created' },
        { label: 'Updated', id: 'updated' },
        { label: 'Due date', id: 'due_date' },
        { label: 'ID', id: 'id' },
      ],
      value: () => 'none',
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
        value: ['get_tasks', 'search_tasks'],
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
        value: ['get_tasks', 'search_tasks'],
      },
    },
    {
      id: 'dueDateGt',
      title: 'Due After',
      type: 'short-input',
      mode: 'advanced',
      placeholder: 'Unix timestamp in milliseconds',
      condition: {
        field: 'operation',
        value: ['get_tasks', 'search_tasks'],
      },
      wandConfig: {
        enabled: true,
        prompt: TIMESTAMP_WAND_PROMPT,
        placeholder: 'Describe the earliest due date (e.g., "start of this week")...',
        generationType: 'timestamp',
      },
    },
    {
      id: 'dueDateLt',
      title: 'Due Before',
      type: 'short-input',
      mode: 'advanced',
      placeholder: 'Unix timestamp in milliseconds',
      condition: {
        field: 'operation',
        value: ['get_tasks', 'search_tasks'],
      },
      wandConfig: {
        enabled: true,
        prompt: TIMESTAMP_WAND_PROMPT,
        placeholder: 'Describe the latest due date (e.g., "end of next week")...',
        generationType: 'timestamp',
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
        value: ['update_comment', 'update_checklist_item'],
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
      id: 'fieldId',
      title: 'Custom Field ID',
      type: 'short-input',
      required: true,
      placeholder: 'Enter custom field UUID',
      condition: {
        field: 'operation',
        value: ['set_custom_field_value', 'remove_custom_field_value'],
      },
    },
    {
      id: 'fieldValue',
      title: 'Value',
      type: 'long-input',
      required: true,
      placeholder: 'Plain value, or JSON for structured field types',
      condition: {
        field: 'operation',
        value: ['set_custom_field_value'],
      },
      wandConfig: {
        enabled: true,
        prompt: `Generate the value for a ClickUp custom field. The shape depends on the field type:
- Text / short text: a plain string
- Number: a number
- Drop down: the option UUID as a string
- Labels: a JSON array of option UUIDs
- Date: a Unix timestamp in milliseconds

Return ONLY the value (plain string, number, or JSON) - no explanations, no extra text.`,
        placeholder: 'Describe the value to set...',
        generationType: 'json-object',
      },
    },
    {
      id: 'checklistId',
      title: 'Checklist ID',
      type: 'short-input',
      required: true,
      placeholder: 'Enter checklist UUID',
      condition: {
        field: 'operation',
        value: [
          'update_checklist',
          'delete_checklist',
          'create_checklist_item',
          'update_checklist_item',
          'delete_checklist_item',
        ],
      },
    },
    {
      id: 'checklistItemId',
      title: 'Checklist Item ID',
      type: 'short-input',
      required: true,
      placeholder: 'Enter checklist item UUID',
      condition: {
        field: 'operation',
        value: ['update_checklist_item', 'delete_checklist_item'],
      },
    },
    {
      id: 'position',
      title: 'Position',
      type: 'short-input',
      mode: 'advanced',
      placeholder: 'New position on the task (0 places it first)',
      condition: {
        field: 'operation',
        value: ['update_checklist'],
      },
    },
    {
      id: 'itemAssignee',
      title: 'Item Assignee',
      type: 'short-input',
      mode: 'advanced',
      placeholder: 'User ID to assign the item to',
      condition: {
        field: 'operation',
        value: ['create_checklist_item', 'update_checklist_item'],
      },
    },
    {
      id: 'itemParent',
      title: 'Parent Item ID',
      type: 'short-input',
      mode: 'advanced',
      placeholder: 'Checklist item UUID to nest this item under',
      condition: {
        field: 'operation',
        value: ['update_checklist_item'],
      },
    },
    {
      id: 'timerId',
      title: 'Time Entry ID',
      type: 'short-input',
      required: true,
      placeholder: 'Enter time entry ID',
      condition: {
        field: 'operation',
        value: ['update_time_entry', 'delete_time_entry'],
      },
    },
    {
      id: 'entryStart',
      title: 'Start Time',
      type: 'short-input',
      required: { field: 'operation', value: ['create_time_entry'] },
      placeholder: 'Unix timestamp in milliseconds',
      condition: {
        field: 'operation',
        value: ['create_time_entry', 'update_time_entry'],
      },
      wandConfig: {
        enabled: true,
        prompt: TIMESTAMP_WAND_PROMPT,
        placeholder: 'Describe the start time (e.g., "today at 9am")...',
        generationType: 'timestamp',
      },
    },
    {
      id: 'entryEnd',
      title: 'End Time',
      type: 'short-input',
      placeholder: 'Unix timestamp in milliseconds (required when changing the start time)',
      condition: {
        field: 'operation',
        value: ['update_time_entry'],
      },
      wandConfig: {
        enabled: true,
        prompt: TIMESTAMP_WAND_PROMPT,
        placeholder: 'Describe the end time (e.g., "today at 5pm")...',
        generationType: 'timestamp',
      },
    },
    {
      id: 'entryDuration',
      title: 'Duration',
      type: 'short-input',
      required: { field: 'operation', value: ['create_time_entry'] },
      placeholder: 'Duration in milliseconds',
      condition: {
        field: 'operation',
        value: ['create_time_entry', 'update_time_entry'],
      },
    },
    {
      id: 'entryDescription',
      title: 'Entry Description',
      type: 'short-input',
      placeholder: 'Description of the time entry',
      condition: {
        field: 'operation',
        value: ['create_time_entry', 'update_time_entry', 'start_timer'],
      },
    },
    {
      id: 'billableAction',
      title: 'Billable',
      type: 'dropdown',
      mode: 'advanced',
      options: [
        { label: 'No change', id: 'none' },
        { label: 'Billable', id: 'billable' },
        { label: 'Not billable', id: 'non_billable' },
      ],
      value: () => 'none',
      condition: {
        field: 'operation',
        value: ['create_time_entry', 'update_time_entry', 'start_timer'],
      },
    },
    {
      id: 'timerTaskId',
      title: 'Task ID',
      type: 'short-input',
      placeholder: 'Task ID to associate the entry with',
      condition: {
        field: 'operation',
        value: ['create_time_entry', 'update_time_entry', 'start_timer'],
      },
    },
    {
      id: 'timerTags',
      title: 'Entry Tags',
      type: 'short-input',
      mode: 'advanced',
      placeholder: 'Comma-separated time entry tag names',
      condition: {
        field: 'operation',
        value: ['start_timer'],
      },
    },
    {
      id: 'timerAssignee',
      title: 'Assignees',
      type: 'short-input',
      mode: 'advanced',
      placeholder: 'Comma-separated user IDs (owners/admins only)',
      condition: {
        field: 'operation',
        value: ['get_time_entries'],
      },
    },
    {
      id: 'entryAssignee',
      title: 'Assignee',
      type: 'short-input',
      mode: 'advanced',
      placeholder: 'Single user ID (owners/admins only)',
      condition: {
        field: 'operation',
        value: ['create_time_entry', 'get_running_timer'],
      },
    },
    {
      id: 'timeStartDate',
      title: 'From',
      type: 'short-input',
      mode: 'advanced',
      placeholder: 'Unix timestamp in milliseconds',
      condition: {
        field: 'operation',
        value: ['get_time_entries'],
      },
      wandConfig: {
        enabled: true,
        prompt: TIMESTAMP_WAND_PROMPT,
        placeholder: 'Describe the range start (e.g., "start of this month")...',
        generationType: 'timestamp',
      },
    },
    {
      id: 'timeEndDate',
      title: 'To',
      type: 'short-input',
      mode: 'advanced',
      placeholder: 'Unix timestamp in milliseconds',
      condition: {
        field: 'operation',
        value: ['get_time_entries'],
      },
      wandConfig: {
        enabled: true,
        prompt: TIMESTAMP_WAND_PROMPT,
        placeholder: 'Describe the range end (e.g., "now")...',
        generationType: 'timestamp',
      },
    },
    {
      id: 'timeLocationType',
      title: 'Filter By Location',
      type: 'dropdown',
      mode: 'advanced',
      options: [
        { label: 'No location filter', id: 'none' },
        { label: 'Task', id: 'task' },
        { label: 'List', id: 'list' },
        { label: 'Folder', id: 'folder' },
        { label: 'Space', id: 'space' },
      ],
      value: () => 'none',
      condition: {
        field: 'operation',
        value: ['get_time_entries'],
      },
    },
    {
      id: 'timeLocationId',
      title: 'Location ID',
      type: 'short-input',
      mode: 'advanced',
      placeholder: 'ID of the task, list, folder, or space',
      condition: {
        field: 'operation',
        value: ['get_time_entries'],
        and: { field: 'timeLocationType', value: 'none', not: true },
      },
    },
    {
      id: 'includeTaskTags',
      title: 'Include Task Tags',
      type: 'switch',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: ['get_time_entries'],
      },
    },
    {
      id: 'includeLocationNames',
      title: 'Include Location Names',
      type: 'switch',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: ['get_time_entries'],
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
      'clickup_set_custom_field_value',
      'clickup_remove_custom_field_value',
      'clickup_create_checklist',
      'clickup_update_checklist',
      'clickup_delete_checklist',
      'clickup_create_checklist_item',
      'clickup_update_checklist_item',
      'clickup_delete_checklist_item',
      'clickup_get_time_entries',
      'clickup_create_time_entry',
      'clickup_update_time_entry',
      'clickup_delete_time_entry',
      'clickup_start_timer',
      'clickup_stop_timer',
      'clickup_get_running_timer',
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
              dueDateTime: params.dueDateTime ? true : undefined,
              startDate: optionalNumber(params.startDate),
              startDateTime: params.startDateTime ? true : undefined,
              assignees: splitCommaSeparatedNumbers(params.assignees),
              tags: splitCommaSeparated(params.tags),
              timeEstimate: optionalNumber(params.timeEstimate),
              points: optionalNumber(params.points),
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
              dueDateTime: params.dueDateTime ? true : undefined,
              startDate: optionalNumber(params.startDate),
              startDateTime: params.startDateTime ? true : undefined,
              timeEstimate: optionalNumber(params.timeEstimate),
              points: optionalNumber(params.points),
              parent: params.parent || undefined,
              assigneesToAdd: splitCommaSeparatedNumbers(params.assigneesToAdd),
              assigneesToRemove: splitCommaSeparatedNumbers(params.assigneesToRemove),
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
              orderBy: params.orderBy && params.orderBy !== 'none' ? params.orderBy : undefined,
              reverse: params.reverse ? true : undefined,
              subtasks: params.subtasks ? true : undefined,
              includeClosed: params.includeClosed ? true : undefined,
              includeMarkdownDescription: params.includeMarkdownDescription ? true : undefined,
              archived: params.archived ? true : undefined,
              statuses: splitCommaSeparated(params.statuses),
              assignees: splitCommaSeparated(params.assignees),
              tags: splitCommaSeparated(params.tags),
              dueDateGt: optionalNumber(params.dueDateGt),
              dueDateLt: optionalNumber(params.dueDateLt),
            }
          case 'search_tasks':
            return {
              ...baseParams,
              workspaceId: params.workspaceId,
              page: optionalNumber(params.page),
              orderBy: params.orderBy && params.orderBy !== 'none' ? params.orderBy : undefined,
              reverse: params.reverse ? true : undefined,
              subtasks: params.subtasks ? true : undefined,
              includeClosed: params.includeClosed ? true : undefined,
              includeMarkdownDescription: params.includeMarkdownDescription ? true : undefined,
              listIds: splitCommaSeparated(params.listIds),
              spaceIds: splitCommaSeparated(params.spaceIds),
              folderIds: splitCommaSeparated(params.folderIds),
              statuses: splitCommaSeparated(params.statuses),
              assignees: splitCommaSeparated(params.assignees),
              tags: splitCommaSeparated(params.tags),
              dueDateGt: optionalNumber(params.dueDateGt),
              dueDateLt: optionalNumber(params.dueDateLt),
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
              folderId: params.listParent === 'space' ? undefined : params.folderId || undefined,
              spaceId: params.listParent === 'space' ? params.listSpaceId || undefined : undefined,
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
              folderId: params.listParent === 'space' ? undefined : params.folderId || undefined,
              spaceId: params.listParent === 'space' ? params.listSpaceId || undefined : undefined,
              name: params.name,
              content: params.content || undefined,
              markdownContent: params.markdownContent || undefined,
            }
          case 'set_custom_field_value':
            return {
              ...baseParams,
              taskId: params.taskId,
              fieldId: params.fieldId,
              value: parseCustomFieldValue(params.fieldValue),
            }
          case 'remove_custom_field_value':
            return {
              ...baseParams,
              taskId: params.taskId,
              fieldId: params.fieldId,
            }
          case 'create_checklist':
            return {
              ...baseParams,
              taskId: params.taskId,
              name: params.name,
            }
          case 'update_checklist':
            return {
              ...baseParams,
              checklistId: params.checklistId,
              name: params.name || undefined,
              position: optionalNumber(params.position),
            }
          case 'delete_checklist':
            return {
              ...baseParams,
              checklistId: params.checklistId,
            }
          case 'create_checklist_item':
            return {
              ...baseParams,
              checklistId: params.checklistId,
              name: params.name,
              assignee: optionalNumber(params.itemAssignee),
            }
          case 'update_checklist_item':
            return {
              ...baseParams,
              checklistId: params.checklistId,
              checklistItemId: params.checklistItemId,
              name: params.name || undefined,
              assignee: optionalNumber(params.itemAssignee),
              resolved:
                params.resolvedAction === 'resolve'
                  ? true
                  : params.resolvedAction === 'unresolve'
                    ? false
                    : undefined,
              parent: params.itemParent || undefined,
            }
          case 'delete_checklist_item':
            return {
              ...baseParams,
              checklistId: params.checklistId,
              checklistItemId: params.checklistItemId,
            }
          case 'get_time_entries':
            return {
              ...baseParams,
              workspaceId: params.workspaceId,
              startDate: optionalNumber(params.timeStartDate),
              endDate: optionalNumber(params.timeEndDate),
              assignee: params.timerAssignee || undefined,
              taskId:
                params.timeLocationType === 'task' ? params.timeLocationId || undefined : undefined,
              listId:
                params.timeLocationType === 'list' ? params.timeLocationId || undefined : undefined,
              folderId:
                params.timeLocationType === 'folder'
                  ? params.timeLocationId || undefined
                  : undefined,
              spaceId:
                params.timeLocationType === 'space'
                  ? params.timeLocationId || undefined
                  : undefined,
              includeTaskTags: params.includeTaskTags ? true : undefined,
              includeLocationNames: params.includeLocationNames ? true : undefined,
            }
          case 'create_time_entry':
            return {
              ...baseParams,
              workspaceId: params.workspaceId,
              start: optionalNumber(params.entryStart),
              duration: optionalNumber(params.entryDuration),
              description: params.entryDescription || undefined,
              billable: billableFromAction(params.billableAction),
              taskId: params.timerTaskId || undefined,
              assignee: optionalNumber(params.entryAssignee),
            }
          case 'update_time_entry':
            return {
              ...baseParams,
              workspaceId: params.workspaceId,
              timerId: params.timerId,
              description: params.entryDescription || undefined,
              start: optionalNumber(params.entryStart),
              end: optionalNumber(params.entryEnd),
              duration: optionalNumber(params.entryDuration),
              taskId: params.timerTaskId || undefined,
              billable: billableFromAction(params.billableAction),
            }
          case 'delete_time_entry':
            return {
              ...baseParams,
              workspaceId: params.workspaceId,
              timerId: params.timerId,
            }
          case 'start_timer':
            return {
              ...baseParams,
              workspaceId: params.workspaceId,
              taskId: params.timerTaskId || undefined,
              description: params.entryDescription || undefined,
              billable: billableFromAction(params.billableAction),
              tags: splitCommaSeparated(params.timerTags),
            }
          case 'stop_timer':
            return {
              ...baseParams,
              workspaceId: params.workspaceId,
            }
          case 'get_running_timer':
            return {
              ...baseParams,
              workspaceId: params.workspaceId,
              assignee: optionalNumber(params.entryAssignee),
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
    listParent: {
      type: 'string',
      description: 'Where lists live for list operations (folder or space)',
    },
    folderId: { type: 'string', description: 'Folder ID' },
    listSpaceId: { type: 'string', description: 'Space ID for folderless list operations' },
    listId: { type: 'string', description: 'List ID' },
    taskId: { type: 'string', description: 'Task ID' },
    commentId: { type: 'string', description: 'Comment ID' },
    name: { type: 'string', description: 'Name for the task, folder, or list' },
    description: { type: 'string', description: 'Task description' },
    markdownContent: { type: 'string', description: 'Markdown description' },
    status: { type: 'string', description: 'Task status' },
    priority: { type: 'string', description: 'Task priority (1-4)' },
    dueDate: { type: 'string', description: 'Due date (Unix ms)' },
    dueDateTime: { type: 'boolean', description: 'Whether the due date includes a time of day' },
    startDate: { type: 'string', description: 'Start date (Unix ms)' },
    startDateTime: {
      type: 'boolean',
      description: 'Whether the start date includes a time of day',
    },
    assignees: { type: 'string', description: 'Comma-separated assignee user IDs' },
    assigneesToAdd: { type: 'string', description: 'Comma-separated user IDs to add as assignees' },
    assigneesToRemove: {
      type: 'string',
      description: 'Comma-separated user IDs to remove from assignees',
    },
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
    dueDateGt: { type: 'string', description: 'Only tasks due after this Unix ms timestamp' },
    dueDateLt: { type: 'string', description: 'Only tasks due before this Unix ms timestamp' },
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
    fieldId: { type: 'string', description: 'Custom field UUID' },
    fieldValue: {
      type: 'string',
      description: 'Custom field value (plain value, or JSON for structured types)',
    },
    checklistId: { type: 'string', description: 'Checklist UUID' },
    checklistItemId: { type: 'string', description: 'Checklist item UUID' },
    position: { type: 'string', description: 'New checklist position on the task' },
    itemAssignee: { type: 'string', description: 'User ID to assign the checklist item to' },
    itemParent: { type: 'string', description: 'Checklist item UUID to nest under' },
    timerId: { type: 'string', description: 'Time entry ID' },
    entryStart: { type: 'string', description: 'Time entry start (Unix ms)' },
    entryEnd: { type: 'string', description: 'Time entry end (Unix ms)' },
    entryDuration: { type: 'string', description: 'Time entry duration in milliseconds' },
    entryDescription: { type: 'string', description: 'Time entry description' },
    billableAction: {
      type: 'string',
      description: 'Billable action (none, billable, non_billable)',
    },
    timerTaskId: { type: 'string', description: 'Task ID to associate the time entry with' },
    timerTags: { type: 'string', description: 'Comma-separated time entry tag names' },
    timerAssignee: {
      type: 'string',
      description: 'Comma-separated user IDs to filter time entries by',
    },
    entryAssignee: { type: 'string', description: 'Single user ID for the time entry' },
    timeStartDate: { type: 'string', description: 'Time entry range start (Unix ms)' },
    timeEndDate: { type: 'string', description: 'Time entry range end (Unix ms)' },
    timeLocationType: {
      type: 'string',
      description: 'Time entry location filter type (none, task, list, folder, space)',
    },
    timeLocationId: { type: 'string', description: 'ID for the time entry location filter' },
    includeTaskTags: { type: 'boolean', description: 'Include task tags in time entries' },
    includeLocationNames: {
      type: 'boolean',
      description: 'Include list, folder, and space names in time entries',
    },
  },
  outputs: {
    task: { type: 'json', description: 'Task details' },
    tasks: { type: 'json', description: 'Array of tasks' },
    comments: { type: 'json', description: 'Array of comments' },
    id: { type: 'string', description: 'ID of the affected resource' },
    histId: { type: 'string', description: 'History ID of the created comment' },
    date: { type: 'number', description: 'Timestamp of the created comment (Unix ms)' },
    updated: { type: 'boolean', description: 'Whether the resource was updated' },
    deleted: { type: 'boolean', description: 'Whether the resource was deleted' },
    attachment: { type: 'json', description: 'Uploaded attachment details' },
    files: { type: 'json', description: 'Uploaded attachment files' },
    taskId: { type: 'string', description: 'Task ID for tag and custom field operations' },
    fieldId: { type: 'string', description: 'Custom field ID for custom field operations' },
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
    checklist: { type: 'json', description: 'Checklist details including its items' },
    timeEntry: { type: 'json', description: 'Time entry details' },
    timeEntries: { type: 'json', description: 'Array of time entries' },
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
