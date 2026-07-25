import { isRecordLike } from '@sim/utils/object'
import type {
  ClickUpAttachment,
  ClickUpChecklist,
  ClickUpChecklistItem,
  ClickUpComment,
  ClickUpCustomField,
  ClickUpFolder,
  ClickUpList,
  ClickUpMember,
  ClickUpPriority,
  ClickUpSpace,
  ClickUpStatus,
  ClickUpTag,
  ClickUpTask,
  ClickUpTimeEntry,
  ClickUpUser,
  ClickUpWorkspace,
} from '@/tools/clickup/types'
import type { OutputProperty } from '@/tools/types'

export const CLICKUP_API_BASE_URL = 'https://api.clickup.com/api/v2'

/**
 * Builds the Authorization header value for ClickUp API requests.
 *
 * ClickUp documents two credential shapes: OAuth access tokens are sent as
 * `Authorization: Bearer <token>`, while personal API tokens (prefixed with
 * `pk_`) must be sent bare as `Authorization: <token>` with no scheme.
 * This helper detects the personal-token prefix and returns the correct form
 * so tools work with both OAuth connections and pasted API tokens.
 *
 * @param accessToken - OAuth access token or ClickUp personal API token
 * @returns The value to use for the `Authorization` header
 */
export function clickupAuthorizationHeader(accessToken: string): string {
  return accessToken.startsWith('pk_') ? accessToken : `Bearer ${accessToken}`
}

function getRequiredString(value: unknown, field: string): string {
  if (typeof value === 'string' && value.trim().length > 0) {
    return value
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value)
  }

  throw new Error(`ClickUp response is missing required field: ${field}`)
}

function getOptionalString(value: unknown): string | null {
  if (typeof value === 'string') {
    return value
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value)
  }

  return null
}

function getOptionalBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null
}

function getOptionalNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }

  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) {
      return parsed
    }
  }

  return null
}

const CLICKUP_USER_OUTPUT_PROPERTIES: Record<string, OutputProperty> = {
  id: { type: 'number', description: 'User ID', nullable: true },
  username: { type: 'string', description: 'Username', nullable: true },
  email: { type: 'string', description: 'User email', nullable: true },
  profilePicture: { type: 'string', description: 'Profile picture URL', nullable: true },
}

export const CLICKUP_TASK_OUTPUT_PROPERTIES: Record<string, OutputProperty> = {
  id: { type: 'string', description: 'Task ID' },
  customId: { type: 'string', description: 'Custom task ID', nullable: true },
  name: { type: 'string', description: 'Task name' },
  textContent: { type: 'string', description: 'Plain text content', nullable: true },
  description: { type: 'string', description: 'Task description', nullable: true },
  markdownDescription: {
    type: 'string',
    description: 'Task description in Markdown (present when requested)',
    nullable: true,
  },
  status: {
    type: 'object',
    description: 'Task status',
    nullable: true,
    properties: {
      status: { type: 'string', description: 'Status name', nullable: true },
      color: { type: 'string', description: 'Status color', nullable: true },
      type: { type: 'string', description: 'Status type (open, closed, custom)', nullable: true },
    },
  },
  archived: { type: 'boolean', description: 'Whether the task is archived' },
  creator: {
    type: 'object',
    description: 'Task creator',
    nullable: true,
    properties: CLICKUP_USER_OUTPUT_PROPERTIES,
  },
  assignees: {
    type: 'array',
    description: 'Users assigned to the task',
    items: { type: 'object', properties: CLICKUP_USER_OUTPUT_PROPERTIES },
  },
  watchers: {
    type: 'array',
    description: 'Users watching the task',
    items: { type: 'object', properties: CLICKUP_USER_OUTPUT_PROPERTIES },
  },
  tags: {
    type: 'array',
    description: 'Tags applied to the task',
    items: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Tag name', nullable: true },
        tagFg: { type: 'string', description: 'Tag foreground color', nullable: true },
        tagBg: { type: 'string', description: 'Tag background color', nullable: true },
      },
    },
  },
  parent: { type: 'string', description: 'Parent task ID', nullable: true },
  priority: {
    type: 'object',
    description: 'Task priority',
    nullable: true,
    properties: {
      id: { type: 'string', description: 'Priority ID', nullable: true },
      priority: { type: 'string', description: 'Priority name', nullable: true },
      color: { type: 'string', description: 'Priority color', nullable: true },
    },
  },
  dueDate: { type: 'string', description: 'Due date (Unix ms)', nullable: true },
  startDate: { type: 'string', description: 'Start date (Unix ms)', nullable: true },
  points: { type: 'number', description: 'Sprint points', nullable: true },
  timeEstimate: { type: 'number', description: 'Time estimate in milliseconds', nullable: true },
  timeSpent: { type: 'number', description: 'Time tracked in milliseconds', nullable: true },
  customFields: {
    type: 'json',
    description: 'Custom field values on the task (id, name, type, value)',
  },
  dateCreated: { type: 'string', description: 'Creation timestamp (Unix ms)', nullable: true },
  dateUpdated: { type: 'string', description: 'Last update timestamp (Unix ms)', nullable: true },
  dateClosed: { type: 'string', description: 'Closed timestamp (Unix ms)', nullable: true },
  dateDone: { type: 'string', description: 'Done timestamp (Unix ms)', nullable: true },
  list: {
    type: 'object',
    description: 'List containing the task',
    nullable: true,
    properties: {
      id: { type: 'string', description: 'List ID' },
      name: { type: 'string', description: 'List name', nullable: true },
    },
  },
  folder: {
    type: 'object',
    description: 'Folder containing the task',
    nullable: true,
    properties: {
      id: { type: 'string', description: 'Folder ID' },
      name: { type: 'string', description: 'Folder name', nullable: true },
    },
  },
  space: {
    type: 'object',
    description: 'Space containing the task',
    nullable: true,
    properties: {
      id: { type: 'string', description: 'Space ID' },
      name: { type: 'string', description: 'Space name', nullable: true },
    },
  },
  url: { type: 'string', description: 'URL to the task in ClickUp', nullable: true },
  subtasks: {
    type: 'json',
    description: 'Subtasks with the same shape as the task object (present when requested)',
    nullable: true,
  },
}

export const CLICKUP_MEMBER_OUTPUT_PROPERTIES: Record<string, OutputProperty> = {
  id: { type: 'number', description: 'Member user ID', nullable: true },
  username: { type: 'string', description: 'Username', nullable: true },
  email: { type: 'string', description: 'User email', nullable: true },
  color: { type: 'string', description: 'Profile color', nullable: true },
  initials: { type: 'string', description: 'User initials', nullable: true },
  profilePicture: { type: 'string', description: 'Profile picture URL', nullable: true },
}

export const CLICKUP_COMMENT_OUTPUT_PROPERTIES: Record<string, OutputProperty> = {
  id: { type: 'string', description: 'Comment ID' },
  commentText: { type: 'string', description: 'Comment text content', nullable: true },
  resolved: { type: 'boolean', description: 'Whether the comment is resolved', nullable: true },
  user: {
    type: 'object',
    description: 'Comment author',
    nullable: true,
    properties: CLICKUP_USER_OUTPUT_PROPERTIES,
  },
  assignee: {
    type: 'object',
    description: 'User the comment is assigned to',
    nullable: true,
    properties: CLICKUP_USER_OUTPUT_PROPERTIES,
  },
  date: { type: 'string', description: 'Comment timestamp (Unix ms)', nullable: true },
  replyCount: { type: 'string', description: 'Number of replies', nullable: true },
}

export const CLICKUP_LIST_OUTPUT_PROPERTIES: Record<string, OutputProperty> = {
  id: { type: 'string', description: 'List ID' },
  name: { type: 'string', description: 'List name', nullable: true },
  taskCount: { type: 'string', description: 'Number of tasks in the list', nullable: true },
  archived: { type: 'boolean', description: 'Whether the list is archived', nullable: true },
}

export const CLICKUP_FOLDER_OUTPUT_PROPERTIES: Record<string, OutputProperty> = {
  id: { type: 'string', description: 'Folder ID' },
  name: { type: 'string', description: 'Folder name', nullable: true },
  hidden: { type: 'boolean', description: 'Whether the folder is hidden', nullable: true },
  taskCount: { type: 'string', description: 'Number of tasks in the folder', nullable: true },
  space: {
    type: 'object',
    description: 'Space containing the folder',
    nullable: true,
    properties: {
      id: { type: 'string', description: 'Space ID' },
      name: { type: 'string', description: 'Space name', nullable: true },
    },
  },
}

export const CLICKUP_TAG_OUTPUT_PROPERTIES: Record<string, OutputProperty> = {
  name: { type: 'string', description: 'Tag name', nullable: true },
  tagFg: { type: 'string', description: 'Tag foreground color', nullable: true },
  tagBg: { type: 'string', description: 'Tag background color', nullable: true },
}

export function mapClickUpUser(value: unknown): ClickUpUser | null {
  if (!isRecordLike(value)) {
    return null
  }

  return {
    id: getOptionalNumber(value.id),
    username: getOptionalString(value.username),
    email: getOptionalString(value.email),
    profilePicture: getOptionalString(value.profilePicture),
  }
}

function mapClickUpStatus(value: unknown): ClickUpStatus | null {
  if (!isRecordLike(value)) {
    return null
  }

  return {
    status: getOptionalString(value.status),
    color: getOptionalString(value.color),
    type: getOptionalString(value.type),
  }
}

function mapClickUpPriority(value: unknown): ClickUpPriority | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return { id: String(value), priority: null, color: null }
  }

  if (!isRecordLike(value)) {
    return null
  }

  return {
    id: getOptionalString(value.id),
    priority: getOptionalString(value.priority) ?? getOptionalString(value.name),
    color: getOptionalString(value.color),
  }
}

export function mapClickUpTag(value: unknown): ClickUpTag | null {
  if (!isRecordLike(value)) {
    return null
  }

  return {
    name: getOptionalString(value.name),
    tagFg: getOptionalString(value.tag_fg),
    tagBg: getOptionalString(value.tag_bg),
  }
}

function mapIdName(value: unknown): { id: string; name: string | null } | null {
  if (!isRecordLike(value)) {
    return null
  }

  const id = getOptionalString(value.id)
  if (!id) {
    return null
  }

  return { id, name: getOptionalString(value.name) }
}

export function mapClickUpTask(value: unknown): ClickUpTask {
  if (!isRecordLike(value)) {
    throw new Error('ClickUp returned an invalid task object')
  }

  const rawAssignees = Array.isArray(value.assignees) ? value.assignees : []
  const rawWatchers = Array.isArray(value.watchers) ? value.watchers : []
  const rawTags = Array.isArray(value.tags) ? value.tags : []
  const rawCustomFields = Array.isArray(value.custom_fields) ? value.custom_fields : []

  return {
    id: getRequiredString(value.id, 'id'),
    customId: getOptionalString(value.custom_id),
    name: getRequiredString(value.name, 'name'),
    textContent: getOptionalString(value.text_content),
    description: getOptionalString(value.description),
    markdownDescription: getOptionalString(value.markdown_description),
    status: mapClickUpStatus(value.status),
    archived: typeof value.archived === 'boolean' ? value.archived : false,
    creator: mapClickUpUser(value.creator),
    assignees: rawAssignees
      .map((assignee) => mapClickUpUser(assignee))
      .filter((assignee): assignee is ClickUpUser => assignee !== null),
    watchers: rawWatchers
      .map((watcher) => mapClickUpUser(watcher))
      .filter((watcher): watcher is ClickUpUser => watcher !== null),
    tags: rawTags.map((tag) => mapClickUpTag(tag)).filter((tag): tag is ClickUpTag => tag !== null),
    parent: getOptionalString(value.parent),
    priority: mapClickUpPriority(value.priority),
    dueDate: getOptionalString(value.due_date),
    startDate: getOptionalString(value.start_date),
    points: getOptionalNumber(value.points),
    timeEstimate: getOptionalNumber(value.time_estimate),
    timeSpent: getOptionalNumber(value.time_spent),
    customFields: rawCustomFields.filter(isRecordLike),
    dateCreated: getOptionalString(value.date_created),
    dateUpdated: getOptionalString(value.date_updated),
    dateClosed: getOptionalString(value.date_closed),
    dateDone: getOptionalString(value.date_done),
    list: mapIdName(value.list),
    folder: mapIdName(value.folder),
    space: mapIdName(value.space),
    url: getOptionalString(value.url),
    subtasks: Array.isArray(value.subtasks)
      ? value.subtasks.map((subtask) => mapClickUpTask(subtask))
      : null,
  }
}

export function mapClickUpComment(value: unknown): ClickUpComment {
  if (!isRecordLike(value)) {
    throw new Error('ClickUp returned an invalid comment object')
  }

  return {
    id: getRequiredString(value.id, 'id'),
    commentText: getOptionalString(value.comment_text),
    resolved: getOptionalBoolean(value.resolved),
    user: mapClickUpUser(value.user),
    assignee: mapClickUpUser(value.assignee),
    date: getOptionalString(value.date),
    replyCount: getOptionalString(value.reply_count),
  }
}

export function mapClickUpWorkspace(value: unknown): ClickUpWorkspace {
  if (!isRecordLike(value)) {
    throw new Error('ClickUp returned an invalid workspace object')
  }

  return {
    id: getRequiredString(value.id, 'id'),
    name: getOptionalString(value.name),
    color: getOptionalString(value.color),
    avatar: getOptionalString(value.avatar),
  }
}

export function mapClickUpSpace(value: unknown): ClickUpSpace {
  if (!isRecordLike(value)) {
    throw new Error('ClickUp returned an invalid space object')
  }

  const rawStatuses = Array.isArray(value.statuses) ? value.statuses : []

  return {
    id: getRequiredString(value.id, 'id'),
    name: getOptionalString(value.name),
    private: getOptionalBoolean(value.private),
    archived: getOptionalBoolean(value.archived),
    statuses: rawStatuses
      .map((status) => mapClickUpStatus(status))
      .filter((status): status is ClickUpStatus => status !== null),
  }
}

export function mapClickUpFolder(value: unknown): ClickUpFolder {
  if (!isRecordLike(value)) {
    throw new Error('ClickUp returned an invalid folder object')
  }

  return {
    id: getRequiredString(value.id, 'id'),
    name: getOptionalString(value.name),
    hidden: getOptionalBoolean(value.hidden),
    taskCount: getOptionalString(value.task_count),
    space: mapIdName(value.space),
  }
}

export function mapClickUpList(value: unknown): ClickUpList {
  if (!isRecordLike(value)) {
    throw new Error('ClickUp returned an invalid list object')
  }

  return {
    id: getRequiredString(value.id, 'id'),
    name: getOptionalString(value.name),
    taskCount: getOptionalString(value.task_count),
    archived: getOptionalBoolean(value.archived),
  }
}

export function mapClickUpAttachment(value: unknown): ClickUpAttachment {
  if (!isRecordLike(value)) {
    throw new Error('ClickUp returned an invalid attachment object')
  }

  return {
    id: getRequiredString(value.id, 'id'),
    version: getOptionalString(value.version),
    title: getOptionalString(value.title),
    extension: getOptionalString(value.extension),
    url: getOptionalString(value.url),
    date: getOptionalNumber(value.date),
    thumbnailSmall: getOptionalString(value.thumbnail_small),
    thumbnailLarge: getOptionalString(value.thumbnail_large),
  }
}

/**
 * Maps a member from the task/list member endpoints. The documented shape is a
 * flat user object (`{ id, username, email, ... }`); a nested `{ user: {...} }`
 * wrapper (the shape the workspace members endpoint uses) is tolerated too.
 */
export function mapClickUpMember(value: unknown): ClickUpMember {
  if (!isRecordLike(value)) {
    throw new Error('ClickUp returned an invalid member object')
  }

  const source = isRecordLike(value.user) ? value.user : value

  return {
    id: getOptionalNumber(source.id),
    username: getOptionalString(source.username),
    email: getOptionalString(source.email),
    color: getOptionalString(source.color),
    initials: getOptionalString(source.initials),
    profilePicture: getOptionalString(source.profilePicture),
  }
}

export function mapClickUpCustomField(value: unknown): ClickUpCustomField {
  if (!isRecordLike(value)) {
    throw new Error('ClickUp returned an invalid custom field object')
  }

  return {
    id: getRequiredString(value.id, 'id'),
    name: getOptionalString(value.name),
    type: getOptionalString(value.type),
    typeConfig: isRecordLike(value.type_config) ? value.type_config : null,
    dateCreated: getOptionalString(value.date_created),
    hideFromGuests: getOptionalBoolean(value.hide_from_guests),
  }
}

function mapClickUpChecklistItem(value: unknown): ClickUpChecklistItem {
  if (!isRecordLike(value)) {
    throw new Error('ClickUp returned an invalid checklist item object')
  }

  return {
    id: getRequiredString(value.id, 'id'),
    name: getOptionalString(value.name),
    orderIndex: getOptionalNumber(value.orderindex),
    assignee: mapClickUpUser(value.assignee),
    resolved: getOptionalBoolean(value.resolved),
    parent: getOptionalString(value.parent),
    dateCreated: getOptionalString(value.date_created),
    children: Array.isArray(value.children)
      ? value.children.filter((child): child is string => typeof child === 'string')
      : [],
  }
}

export function mapClickUpChecklist(value: unknown): ClickUpChecklist {
  if (!isRecordLike(value)) {
    throw new Error('ClickUp returned an invalid checklist object')
  }

  const rawItems = Array.isArray(value.items) ? value.items : []

  return {
    id: getRequiredString(value.id, 'id'),
    taskId: getOptionalString(value.task_id),
    name: getOptionalString(value.name),
    orderIndex: getOptionalNumber(value.orderindex),
    resolved: getOptionalNumber(value.resolved),
    unresolved: getOptionalNumber(value.unresolved),
    dateCreated: getOptionalString(value.date_created),
    items: rawItems.map((item) => mapClickUpChecklistItem(item)),
  }
}

export function mapClickUpTimeEntry(value: unknown): ClickUpTimeEntry {
  if (!isRecordLike(value)) {
    throw new Error('ClickUp returned an invalid time entry object')
  }

  const rawTags = Array.isArray(value.tags) ? value.tags : []
  const rawTaskTags = Array.isArray(value.task_tags) ? value.task_tags : []
  const rawLocation = isRecordLike(value.task_location) ? value.task_location : null

  return {
    id: getRequiredString(value.id, 'id'),
    task: mapIdName(value.task),
    workspaceId: getOptionalString(value.wid),
    user: mapClickUpUser(value.user),
    billable: getOptionalBoolean(value.billable),
    start: getOptionalString(value.start),
    end: getOptionalString(value.end),
    duration: getOptionalNumber(value.duration),
    description: getOptionalString(value.description),
    tags: rawTags.map((tag) => mapClickUpTag(tag)).filter((tag): tag is ClickUpTag => tag !== null),
    source: getOptionalString(value.source),
    at: getOptionalString(value.at),
    taskUrl: getOptionalString(value.task_url),
    taskTags: rawTaskTags
      .map((tag) => mapClickUpTag(tag))
      .filter((tag): tag is ClickUpTag => tag !== null),
    taskLocation: rawLocation
      ? {
          listId: getOptionalString(rawLocation.list_id),
          folderId: getOptionalString(rawLocation.folder_id),
          spaceId: getOptionalString(rawLocation.space_id),
          listName: getOptionalString(rawLocation.list_name),
          folderName: getOptionalString(rawLocation.folder_name),
          spaceName: getOptionalString(rawLocation.space_name),
        }
      : null,
  }
}

const CLICKUP_CHECKLIST_ITEM_OUTPUT_PROPERTIES: Record<string, OutputProperty> = {
  id: { type: 'string', description: 'Checklist item ID' },
  name: { type: 'string', description: 'Checklist item name', nullable: true },
  orderIndex: { type: 'number', description: 'Order of the item in the checklist', nullable: true },
  assignee: {
    type: 'object',
    description: 'User the item is assigned to',
    nullable: true,
    properties: {
      id: { type: 'number', description: 'User ID', nullable: true },
      username: { type: 'string', description: 'Username', nullable: true },
      email: { type: 'string', description: 'User email', nullable: true },
      profilePicture: { type: 'string', description: 'Profile picture URL', nullable: true },
    },
  },
  resolved: { type: 'boolean', description: 'Whether the item is resolved', nullable: true },
  parent: { type: 'string', description: 'Parent checklist item ID', nullable: true },
  dateCreated: { type: 'string', description: 'Creation timestamp (Unix ms)', nullable: true },
  children: {
    type: 'array',
    description: 'IDs of nested child items',
    items: { type: 'string', description: 'A checklist item ID' },
  },
}

export const CLICKUP_CHECKLIST_OUTPUT_PROPERTIES: Record<string, OutputProperty> = {
  id: { type: 'string', description: 'Checklist ID' },
  taskId: {
    type: 'string',
    description: 'ID of the task the checklist belongs to',
    nullable: true,
  },
  name: { type: 'string', description: 'Checklist name', nullable: true },
  orderIndex: { type: 'number', description: 'Order of the checklist on the task', nullable: true },
  resolved: { type: 'number', description: 'Number of resolved items', nullable: true },
  unresolved: { type: 'number', description: 'Number of unresolved items', nullable: true },
  dateCreated: { type: 'string', description: 'Creation timestamp (Unix ms)', nullable: true },
  items: {
    type: 'array',
    description: 'Items in the checklist',
    items: { type: 'object', properties: CLICKUP_CHECKLIST_ITEM_OUTPUT_PROPERTIES },
  },
}

export const CLICKUP_TIME_ENTRY_OUTPUT_PROPERTIES: Record<string, OutputProperty> = {
  id: { type: 'string', description: 'Time entry ID' },
  task: {
    type: 'object',
    description: 'Task the time entry is associated with',
    nullable: true,
    properties: {
      id: { type: 'string', description: 'Task ID' },
      name: { type: 'string', description: 'Task name', nullable: true },
    },
  },
  workspaceId: { type: 'string', description: 'Workspace ID', nullable: true },
  user: {
    type: 'object',
    description: 'User the time entry belongs to',
    nullable: true,
    properties: {
      id: { type: 'number', description: 'User ID', nullable: true },
      username: { type: 'string', description: 'Username', nullable: true },
      email: { type: 'string', description: 'User email', nullable: true },
      profilePicture: { type: 'string', description: 'Profile picture URL', nullable: true },
    },
  },
  billable: { type: 'boolean', description: 'Whether the entry is billable', nullable: true },
  start: { type: 'string', description: 'Start timestamp (Unix ms)', nullable: true },
  end: { type: 'string', description: 'End timestamp (Unix ms)', nullable: true },
  duration: {
    type: 'number',
    description: 'Duration in milliseconds (negative while the timer is running)',
    nullable: true,
  },
  description: { type: 'string', description: 'Time entry description', nullable: true },
  tags: {
    type: 'array',
    description: 'Time entry tags',
    items: { type: 'object', properties: CLICKUP_TAG_OUTPUT_PROPERTIES },
  },
  source: { type: 'string', description: 'Source that created the entry', nullable: true },
  at: { type: 'string', description: 'Last update timestamp (Unix ms)', nullable: true },
  taskUrl: { type: 'string', description: 'URL to the task in ClickUp', nullable: true },
  taskTags: {
    type: 'array',
    description: 'Tags on the associated task (present when requested)',
    items: { type: 'object', properties: CLICKUP_TAG_OUTPUT_PROPERTIES },
  },
  taskLocation: {
    type: 'object',
    description: 'Location of the associated task (names present when requested)',
    nullable: true,
    properties: {
      listId: { type: 'string', description: 'List ID', nullable: true },
      folderId: { type: 'string', description: 'Folder ID', nullable: true },
      spaceId: { type: 'string', description: 'Space ID', nullable: true },
      listName: { type: 'string', description: 'List name', nullable: true },
      folderName: { type: 'string', description: 'Folder name', nullable: true },
      spaceName: { type: 'string', description: 'Space name', nullable: true },
    },
  },
}

export function extractClickUpErrorMessage(
  response: Response,
  data: unknown,
  fallback: string
): string {
  if (isRecordLike(data)) {
    const message =
      typeof data.err === 'string' && data.err.trim().length > 0
        ? data.err
        : typeof data.error === 'string' && data.error.trim().length > 0
          ? data.error
          : null
    const ecode = data.ECODE

    if (message) {
      return typeof ecode === 'string' && ecode.trim().length > 0
        ? `${fallback}: ${message} (${ecode})`
        : `${fallback}: ${message}`
    }
  }

  if (response.statusText) {
    return `${fallback}: ${response.status} ${response.statusText}`
  }

  return `${fallback}: ${response.status}`
}
