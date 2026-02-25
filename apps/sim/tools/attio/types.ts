import type { OutputProperty, ToolResponse } from '@/tools/types'

/** Reusable actor shape returned by the Attio API */
export const ACTOR_OUTPUT_PROPERTIES = {
  type: {
    type: 'string',
    description: 'The actor type (e.g. workspace-member, api-token, system)',
  },
  id: { type: 'string', description: 'The actor ID' },
} as const satisfies Record<string, OutputProperty>

/** Reusable linked-record shape returned by the Attio API */
export const LINKED_RECORD_OUTPUT_PROPERTIES = {
  targetObjectId: { type: 'string', description: 'The linked object ID' },
  targetRecordId: { type: 'string', description: 'The linked record ID' },
} as const satisfies Record<string, OutputProperty>

/** Reusable assignee shape returned by the Attio API */
export const ASSIGNEE_OUTPUT_PROPERTIES = {
  type: { type: 'string', description: 'The assignee actor type (e.g. workspace-member)' },
  id: { type: 'string', description: 'The assignee actor ID' },
} as const satisfies Record<string, OutputProperty>

/** Shared output properties for record identifiers (raw API shape, snake_case keys) */
export const RECORD_ID_OUTPUT_PROPERTIES = {
  workspace_id: { type: 'string', description: 'The workspace ID' },
  object_id: { type: 'string', description: 'The object ID' },
  record_id: { type: 'string', description: 'The record ID' },
} as const satisfies Record<string, OutputProperty>

/** Shared output properties for Attio records (raw API shape, snake_case keys) */
export const RECORD_OUTPUT_PROPERTIES = {
  id: {
    type: 'object',
    description: 'The record identifier',
    properties: RECORD_ID_OUTPUT_PROPERTIES,
  },
  created_at: { type: 'string', description: 'When the record was created' },
  web_url: { type: 'string', description: 'URL to view the record in Attio' },
  values: { type: 'json', description: 'The record attribute values' },
} as const satisfies Record<string, OutputProperty>

export const RECORD_OBJECT_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'An Attio record',
  properties: RECORD_OUTPUT_PROPERTIES,
}

export const RECORDS_ARRAY_OUTPUT: OutputProperty = {
  type: 'array',
  description: 'Array of Attio records',
  items: {
    type: 'object',
    properties: RECORD_OUTPUT_PROPERTIES,
  },
}

/** Shared output properties for Attio notes */
export const NOTE_OUTPUT_PROPERTIES = {
  noteId: { type: 'string', description: 'The note ID' },
  parentObject: { type: 'string', description: 'The parent object slug' },
  parentRecordId: { type: 'string', description: 'The parent record ID' },
  title: { type: 'string', description: 'The note title' },
  contentPlaintext: { type: 'string', description: 'The note content as plaintext' },
  contentMarkdown: { type: 'string', description: 'The note content as markdown' },
  meetingId: { type: 'string', description: 'The linked meeting ID', optional: true },
  tags: {
    type: 'array',
    description: 'Tags on the note',
    items: {
      type: 'object',
      properties: {
        type: { type: 'string', description: 'The tag type (e.g. workspace-member)' },
        workspaceMemberId: { type: 'string', description: 'The workspace member ID of the tagger' },
      },
    },
  },
  createdByActor: {
    type: 'object',
    description: 'The actor who created the note',
    properties: ACTOR_OUTPUT_PROPERTIES,
  },
  createdAt: { type: 'string', description: 'When the note was created' },
} as const satisfies Record<string, OutputProperty>

/** Shared output properties for Attio tasks */
export const TASK_OUTPUT_PROPERTIES = {
  taskId: { type: 'string', description: 'The task ID' },
  content: { type: 'string', description: 'The task content' },
  deadlineAt: { type: 'string', description: 'The task deadline', optional: true },
  isCompleted: { type: 'boolean', description: 'Whether the task is completed' },
  linkedRecords: {
    type: 'array',
    description: 'Records linked to this task',
    items: {
      type: 'object',
      properties: LINKED_RECORD_OUTPUT_PROPERTIES,
    },
  },
  assignees: {
    type: 'array',
    description: 'Task assignees',
    items: {
      type: 'object',
      properties: ASSIGNEE_OUTPUT_PROPERTIES,
    },
  },
  createdByActor: {
    type: 'object',
    description: 'The actor who created this task',
    properties: ACTOR_OUTPUT_PROPERTIES,
  },
  createdAt: { type: 'string', description: 'When the task was created' },
} as const satisfies Record<string, OutputProperty>

/** Shared output properties for Attio objects (schema) */
export const OBJECT_OUTPUT_PROPERTIES = {
  objectId: { type: 'string', description: 'The object ID' },
  apiSlug: { type: 'string', description: 'The API slug (e.g. people, companies)' },
  singularNoun: { type: 'string', description: 'Singular display name' },
  pluralNoun: { type: 'string', description: 'Plural display name' },
  createdAt: { type: 'string', description: 'When the object was created' },
} as const satisfies Record<string, OutputProperty>

/** Shared output properties for Attio lists */
export const LIST_OUTPUT_PROPERTIES = {
  listId: { type: 'string', description: 'The list ID' },
  apiSlug: { type: 'string', description: 'The API slug for the list' },
  name: { type: 'string', description: 'The list name' },
  parentObject: { type: 'string', description: 'The parent object slug (e.g. people, companies)' },
  workspaceAccess: {
    type: 'string',
    description: 'Workspace-level access (e.g. full-access, read-only)',
  },
  workspaceMemberAccess: { type: 'json', description: 'Member-level access entries' },
  createdByActor: {
    type: 'object',
    description: 'The actor who created the list',
    properties: ACTOR_OUTPUT_PROPERTIES,
  },
  createdAt: { type: 'string', description: 'When the list was created' },
} as const satisfies Record<string, OutputProperty>

/** Shared output properties for Attio list entries */
export const LIST_ENTRY_OUTPUT_PROPERTIES = {
  entryId: { type: 'string', description: 'The list entry ID' },
  listId: { type: 'string', description: 'The list ID' },
  parentRecordId: { type: 'string', description: 'The parent record ID' },
  parentObject: { type: 'string', description: 'The parent object slug' },
  createdAt: { type: 'string', description: 'When the entry was created' },
  entryValues: { type: 'json', description: 'The entry attribute values (dynamic per list)' },
} as const satisfies Record<string, OutputProperty>

/** Shared output properties for Attio workspace members */
export const MEMBER_OUTPUT_PROPERTIES = {
  memberId: { type: 'string', description: 'The workspace member ID' },
  firstName: { type: 'string', description: 'First name' },
  lastName: { type: 'string', description: 'Last name' },
  avatarUrl: { type: 'string', description: 'Avatar URL', optional: true },
  emailAddress: { type: 'string', description: 'Email address' },
  accessLevel: { type: 'string', description: 'Access level (admin, member, suspended)' },
  createdAt: { type: 'string', description: 'When the member was added' },
} as const satisfies Record<string, OutputProperty>

/** Shared output properties for Attio comments */
export const COMMENT_OUTPUT_PROPERTIES = {
  commentId: { type: 'string', description: 'The comment ID' },
  threadId: { type: 'string', description: 'The thread ID' },
  contentPlaintext: { type: 'string', description: 'The comment content as plaintext' },
  author: {
    type: 'object',
    description: 'The comment author',
    properties: ACTOR_OUTPUT_PROPERTIES,
  },
  entry: {
    type: 'object',
    description: 'The list entry this comment is on',
    properties: {
      listId: { type: 'string', description: 'The list ID' },
      entryId: { type: 'string', description: 'The entry ID' },
    },
  },
  record: {
    type: 'object',
    description: 'The record this comment is on',
    properties: {
      objectId: { type: 'string', description: 'The object ID' },
      recordId: { type: 'string', description: 'The record ID' },
    },
  },
  resolvedAt: { type: 'string', description: 'When the thread was resolved', optional: true },
  resolvedBy: {
    type: 'object',
    description: 'Who resolved the thread',
    properties: ACTOR_OUTPUT_PROPERTIES,
    optional: true,
  },
  createdAt: { type: 'string', description: 'When the comment was created' },
} as const satisfies Record<string, OutputProperty>

/** Shared output properties for Attio threads */
export const THREAD_OUTPUT_PROPERTIES = {
  threadId: { type: 'string', description: 'The thread ID' },
  comments: {
    type: 'array',
    description: 'Comments in the thread',
    items: {
      type: 'object',
      properties: {
        commentId: { type: 'string', description: 'The comment ID' },
        contentPlaintext: { type: 'string', description: 'Comment content as plaintext' },
        author: {
          type: 'object',
          description: 'The comment author',
          properties: ACTOR_OUTPUT_PROPERTIES,
        },
        createdAt: { type: 'string', description: 'When the comment was created' },
      },
    },
  },
  createdAt: { type: 'string', description: 'When the thread was created' },
} as const satisfies Record<string, OutputProperty>

/** Shared output properties for Attio webhooks */
export const WEBHOOK_OUTPUT_PROPERTIES = {
  webhookId: { type: 'string', description: 'The webhook ID' },
  targetUrl: { type: 'string', description: 'The webhook target URL' },
  subscriptions: {
    type: 'array',
    description: 'Event subscriptions',
    items: {
      type: 'object',
      properties: {
        eventType: { type: 'string', description: 'The event type (e.g. record.created)' },
        filter: { type: 'json', description: 'Optional event filter', optional: true },
      },
    },
  },
  status: { type: 'string', description: 'Webhook status (active, degraded, inactive)' },
  createdAt: { type: 'string', description: 'When the webhook was created' },
} as const satisfies Record<string, OutputProperty>

/** Raw Attio record shape from the API */
export interface AttioRecord {
  id: { workspace_id: string; object_id: string; record_id: string }
  created_at: string
  web_url: string
  values: Record<string, unknown>
}

/** Raw Attio note shape from the API */
export interface AttioNote {
  id: { workspace_id: string; note_id: string }
  parent_object: string
  parent_record_id: string
  title: string
  content_plaintext: string
  content_markdown: string
  meeting_id: string | null
  tags: unknown[]
  created_by_actor: unknown
  created_at: string
}

/** Raw Attio task shape from the API */
export interface AttioTask {
  id: { workspace_id: string; task_id: string }
  content_plaintext: string
  deadline_at: string | null
  is_completed: boolean
  linked_records: Array<{ target_object_id: string; target_record_id: string }>
  assignees: Array<{ referenced_actor_type: string; referenced_actor_id: string }>
  created_by_actor: unknown
  created_at: string
}

/** Params for listing/querying records */
export interface AttioListRecordsParams {
  accessToken: string
  objectType: string
  filter?: string
  sorts?: string
  limit?: number
  offset?: number
}

/** Params for getting a single record */
export interface AttioGetRecordParams {
  accessToken: string
  objectType: string
  recordId: string
}

/** Params for creating a record */
export interface AttioCreateRecordParams {
  accessToken: string
  objectType: string
  values: string
}

/** Params for updating a record */
export interface AttioUpdateRecordParams {
  accessToken: string
  objectType: string
  recordId: string
  values: string
}

/** Params for deleting a record */
export interface AttioDeleteRecordParams {
  accessToken: string
  objectType: string
  recordId: string
}

/** Params for searching records */
export interface AttioSearchRecordsParams {
  accessToken: string
  query: string
  objects: string
  limit?: number
}

/** Params for listing notes */
export interface AttioListNotesParams {
  accessToken: string
  parentObject?: string
  parentRecordId?: string
  limit?: number
  offset?: number
}

/** Params for creating a note */
export interface AttioCreateNoteParams {
  accessToken: string
  parentObject: string
  parentRecordId: string
  title: string
  content: string
  format?: string
  createdAt?: string
  meetingId?: string
}

/** Params for deleting a note */
export interface AttioDeleteNoteParams {
  accessToken: string
  noteId: string
}

/** Params for listing tasks */
export interface AttioListTasksParams {
  accessToken: string
  linkedObject?: string
  linkedRecordId?: string
  assignee?: string
  isCompleted?: boolean
  sort?: string
  limit?: number
  offset?: number
}

/** Params for creating a task */
export interface AttioCreateTaskParams {
  accessToken: string
  content: string
  deadlineAt?: string
  isCompleted?: boolean
  linkedRecords?: string
  assignees?: string
}

/** Params for updating a task */
export interface AttioUpdateTaskParams {
  accessToken: string
  taskId: string
  deadlineAt?: string
  isCompleted?: boolean
  linkedRecords?: string
  assignees?: string
}

/** Params for deleting a task */
export interface AttioDeleteTaskParams {
  accessToken: string
  taskId: string
}

/** Response for listing records */
export interface AttioListRecordsResponse extends ToolResponse {
  output: {
    records: AttioRecord[]
    count: number
  }
}

/** Response for getting a single record */
export interface AttioGetRecordResponse extends ToolResponse {
  output: {
    record: AttioRecord
    recordId: string
    webUrl: string
  }
}

/** Response for creating a record */
export interface AttioCreateRecordResponse extends ToolResponse {
  output: {
    record: AttioRecord
    recordId: string
    webUrl: string
  }
}

/** Response for updating a record */
export interface AttioUpdateRecordResponse extends ToolResponse {
  output: {
    record: AttioRecord
    recordId: string
    webUrl: string
  }
}

/** Response for deleting a record */
export interface AttioDeleteRecordResponse extends ToolResponse {
  output: {
    deleted: boolean
  }
}

/** Response for searching records */
export interface AttioSearchRecordsResponse extends ToolResponse {
  output: {
    results: Array<{
      recordId: string | null
      objectId: string | null
      objectSlug: string | null
      recordText: string | null
      recordImage: string | null
    }>
    count: number
  }
}

/** Response for listing notes */
export interface AttioListNotesResponse extends ToolResponse {
  output: {
    notes: Array<{
      noteId: string | null
      parentObject: string | null
      parentRecordId: string | null
      title: string | null
      contentPlaintext: string | null
      contentMarkdown: string | null
      meetingId: string | null
      tags: unknown[]
      createdByActor: unknown
      createdAt: string | null
    }>
    count: number
  }
}

/** Response for creating a note */
export interface AttioCreateNoteResponse extends ToolResponse {
  output: {
    noteId: string | null
    parentObject: string | null
    parentRecordId: string | null
    title: string | null
    contentPlaintext: string | null
    contentMarkdown: string | null
    meetingId: string | null
    tags: unknown[]
    createdByActor: unknown
    createdAt: string | null
  }
}

/** Response for deleting a note */
export interface AttioDeleteNoteResponse extends ToolResponse {
  output: {
    deleted: boolean
  }
}

/** Response for listing tasks */
export interface AttioListTasksResponse extends ToolResponse {
  output: {
    tasks: Array<{
      taskId: string | null
      content: string | null
      deadlineAt: string | null
      isCompleted: boolean
      linkedRecords: Array<{ targetObjectId: string | null; targetRecordId: string | null }>
      assignees: Array<{ type: string | null; id: string | null }>
      createdByActor: unknown
      createdAt: string | null
    }>
    count: number
  }
}

/** Response for creating a task */
export interface AttioCreateTaskResponse extends ToolResponse {
  output: {
    taskId: string | null
    content: string | null
    deadlineAt: string | null
    isCompleted: boolean
    linkedRecords: Array<{ targetObjectId: string | null; targetRecordId: string | null }>
    assignees: Array<{ type: string | null; id: string | null }>
    createdByActor: unknown
    createdAt: string | null
  }
}

/** Response for updating a task */
export interface AttioUpdateTaskResponse extends ToolResponse {
  output: {
    taskId: string | null
    content: string | null
    deadlineAt: string | null
    isCompleted: boolean
    linkedRecords: Array<{ targetObjectId: string | null; targetRecordId: string | null }>
    assignees: Array<{ type: string | null; id: string | null }>
    createdByActor: unknown
    createdAt: string | null
  }
}

/** Response for deleting a task */
export interface AttioDeleteTaskResponse extends ToolResponse {
  output: {
    deleted: boolean
  }
}

/** Params for getting a single note */
export interface AttioGetNoteParams {
  accessToken: string
  noteId: string
}

/** Response for getting a single note */
export interface AttioGetNoteResponse extends ToolResponse {
  output: {
    noteId: string | null
    parentObject: string | null
    parentRecordId: string | null
    title: string | null
    contentPlaintext: string | null
    contentMarkdown: string | null
    meetingId: string | null
    tags: unknown[]
    createdByActor: unknown
    createdAt: string | null
  }
}

/** Params for asserting (upserting) a record */
export interface AttioAssertRecordParams {
  accessToken: string
  objectType: string
  matchingAttribute: string
  values: string
}

/** Response for asserting a record */
export interface AttioAssertRecordResponse extends ToolResponse {
  output: {
    record: AttioRecord
    recordId: string
    webUrl: string
  }
}

/** Params for listing objects */
export interface AttioListObjectsParams {
  accessToken: string
}

/** Response for listing objects */
export interface AttioListObjectsResponse extends ToolResponse {
  output: {
    objects: Array<{
      objectId: string | null
      apiSlug: string | null
      singularNoun: string | null
      pluralNoun: string | null
      createdAt: string | null
    }>
    count: number
  }
}

/** Params for getting an object */
export interface AttioGetObjectParams {
  accessToken: string
  object: string
}

/** Response for getting an object */
export interface AttioGetObjectResponse extends ToolResponse {
  output: {
    objectId: string | null
    apiSlug: string | null
    singularNoun: string | null
    pluralNoun: string | null
    createdAt: string | null
  }
}

/** Params for creating an object */
export interface AttioCreateObjectParams {
  accessToken: string
  apiSlug: string
  singularNoun: string
  pluralNoun: string
}

/** Response for creating an object */
export interface AttioCreateObjectResponse extends ToolResponse {
  output: {
    objectId: string | null
    apiSlug: string | null
    singularNoun: string | null
    pluralNoun: string | null
    createdAt: string | null
  }
}

/** Params for updating an object */
export interface AttioUpdateObjectParams {
  accessToken: string
  object: string
  apiSlug?: string
  singularNoun?: string
  pluralNoun?: string
}

/** Response for updating an object */
export interface AttioUpdateObjectResponse extends ToolResponse {
  output: {
    objectId: string | null
    apiSlug: string | null
    singularNoun: string | null
    pluralNoun: string | null
    createdAt: string | null
  }
}

/** Params for listing lists */
export interface AttioListListsParams {
  accessToken: string
}

/** Response for listing lists */
export interface AttioListListsResponse extends ToolResponse {
  output: {
    lists: Array<{
      listId: string | null
      apiSlug: string | null
      name: string | null
      parentObject: string | null
      workspaceAccess: string | null
      workspaceMemberAccess: string | null
      createdByActor: { type: string | null; id: string | null } | null
      createdAt: string | null
    }>
    count: number
  }
}

/** Params for getting a list */
export interface AttioGetListParams {
  accessToken: string
  list: string
}

/** Response for getting a list */
export interface AttioGetListResponse extends ToolResponse {
  output: {
    listId: string | null
    apiSlug: string | null
    name: string | null
    parentObject: string | null
    workspaceAccess: string | null
    workspaceMemberAccess: string | null
    createdByActor: { type: string | null; id: string | null } | null
    createdAt: string | null
  }
}

/** Params for creating a list */
export interface AttioCreateListParams {
  accessToken: string
  name: string
  apiSlug?: string
  parentObject: string
  workspaceAccess?: string
  workspaceMemberAccess?: string
}

/** Response for creating a list */
export interface AttioCreateListResponse extends ToolResponse {
  output: {
    listId: string | null
    apiSlug: string | null
    name: string | null
    parentObject: string | null
    workspaceAccess: string | null
    workspaceMemberAccess: string | null
    createdByActor: { type: string | null; id: string | null } | null
    createdAt: string | null
  }
}

/** Params for updating a list */
export interface AttioUpdateListParams {
  accessToken: string
  list: string
  name?: string
  apiSlug?: string
  workspaceAccess?: string
  workspaceMemberAccess?: string
}

/** Response for updating a list */
export interface AttioUpdateListResponse extends ToolResponse {
  output: {
    listId: string | null
    apiSlug: string | null
    name: string | null
    parentObject: string | null
    workspaceAccess: string | null
    workspaceMemberAccess: string | null
    createdByActor: { type: string | null; id: string | null } | null
    createdAt: string | null
  }
}

/** Params for querying list entries */
export interface AttioQueryListEntriesParams {
  accessToken: string
  list: string
  filter?: string
  sorts?: string
  limit?: number
  offset?: number
}

/** Response for querying list entries */
export interface AttioQueryListEntriesResponse extends ToolResponse {
  output: {
    entries: Array<{
      entryId: string | null
      listId: string | null
      parentRecordId: string | null
      parentObject: string | null
      createdAt: string | null
      entryValues: Record<string, unknown>
    }>
    count: number
  }
}

/** Params for getting a list entry */
export interface AttioGetListEntryParams {
  accessToken: string
  list: string
  entryId: string
}

/** Response for getting a list entry */
export interface AttioGetListEntryResponse extends ToolResponse {
  output: {
    entryId: string | null
    listId: string | null
    parentRecordId: string | null
    parentObject: string | null
    createdAt: string | null
    entryValues: Record<string, unknown>
  }
}

/** Params for creating a list entry */
export interface AttioCreateListEntryParams {
  accessToken: string
  list: string
  parentRecordId: string
  parentObject: string
  entryValues?: string
}

/** Response for creating a list entry */
export interface AttioCreateListEntryResponse extends ToolResponse {
  output: {
    entryId: string | null
    listId: string | null
    parentRecordId: string | null
    parentObject: string | null
    createdAt: string | null
    entryValues: Record<string, unknown>
  }
}

/** Params for updating a list entry */
export interface AttioUpdateListEntryParams {
  accessToken: string
  list: string
  entryId: string
  entryValues: string
}

/** Response for updating a list entry */
export interface AttioUpdateListEntryResponse extends ToolResponse {
  output: {
    entryId: string | null
    listId: string | null
    parentRecordId: string | null
    parentObject: string | null
    createdAt: string | null
    entryValues: Record<string, unknown>
  }
}

/** Params for deleting a list entry */
export interface AttioDeleteListEntryParams {
  accessToken: string
  list: string
  entryId: string
}

/** Response for deleting a list entry */
export interface AttioDeleteListEntryResponse extends ToolResponse {
  output: {
    deleted: boolean
  }
}

/** Params for listing workspace members */
export interface AttioListMembersParams {
  accessToken: string
}

/** Response for listing workspace members */
export interface AttioListMembersResponse extends ToolResponse {
  output: {
    members: Array<{
      memberId: string | null
      firstName: string | null
      lastName: string | null
      avatarUrl: string | null
      emailAddress: string | null
      accessLevel: string | null
      createdAt: string | null
    }>
    count: number
  }
}

/** Params for getting a workspace member */
export interface AttioGetMemberParams {
  accessToken: string
  memberId: string
}

/** Response for getting a workspace member */
export interface AttioGetMemberResponse extends ToolResponse {
  output: {
    memberId: string | null
    firstName: string | null
    lastName: string | null
    avatarUrl: string | null
    emailAddress: string | null
    accessLevel: string | null
    createdAt: string | null
  }
}

/** Params for creating a comment */
export interface AttioCreateCommentParams {
  accessToken: string
  content: string
  format?: string
  authorType: string
  authorId: string
  list: string
  entryId: string
  threadId?: string
  createdAt?: string
}

/** Response for creating a comment */
export interface AttioCreateCommentResponse extends ToolResponse {
  output: {
    commentId: string | null
    threadId: string | null
    contentPlaintext: string | null
    author: { type: string | null; id: string | null } | null
    entry: { listId: string | null; entryId: string | null } | null
    record: { objectId: string | null; recordId: string | null } | null
    resolvedAt: string | null
    resolvedBy: { type: string | null; id: string | null } | null
    createdAt: string | null
  }
}

/** Params for getting a comment */
export interface AttioGetCommentParams {
  accessToken: string
  commentId: string
}

/** Response for getting a comment */
export interface AttioGetCommentResponse extends ToolResponse {
  output: {
    commentId: string | null
    threadId: string | null
    contentPlaintext: string | null
    author: { type: string | null; id: string | null } | null
    entry: { listId: string | null; entryId: string | null } | null
    record: { objectId: string | null; recordId: string | null } | null
    resolvedAt: string | null
    resolvedBy: { type: string | null; id: string | null } | null
    createdAt: string | null
  }
}

/** Params for deleting a comment */
export interface AttioDeleteCommentParams {
  accessToken: string
  commentId: string
}

/** Response for deleting a comment */
export interface AttioDeleteCommentResponse extends ToolResponse {
  output: {
    deleted: boolean
  }
}

/** Params for listing threads */
export interface AttioListThreadsParams {
  accessToken: string
  recordId?: string
  object?: string
  entryId?: string
  list?: string
  limit?: number
  offset?: number
}

/** Response for listing threads */
export interface AttioListThreadsResponse extends ToolResponse {
  output: {
    threads: Array<{
      threadId: string | null
      comments: Array<{
        commentId: string | null
        contentPlaintext: string | null
        author: { type: string | null; id: string | null } | null
        createdAt: string | null
      }>
      createdAt: string | null
    }>
    count: number
  }
}

/** Params for getting a thread */
export interface AttioGetThreadParams {
  accessToken: string
  threadId: string
}

/** Response for getting a thread */
export interface AttioGetThreadResponse extends ToolResponse {
  output: {
    threadId: string | null
    comments: Array<{
      commentId: string | null
      contentPlaintext: string | null
      author: { type: string | null; id: string | null } | null
      createdAt: string | null
    }>
    createdAt: string | null
  }
}

/** Params for listing webhooks */
export interface AttioListWebhooksParams {
  accessToken: string
  limit?: number
  offset?: number
}

/** Response for listing webhooks */
export interface AttioListWebhooksResponse extends ToolResponse {
  output: {
    webhooks: Array<{
      webhookId: string | null
      targetUrl: string | null
      subscriptions: Array<{ eventType: string | null; filter: unknown }>
      status: string | null
      createdAt: string | null
    }>
    count: number
  }
}

/** Params for getting a webhook */
export interface AttioGetWebhookParams {
  accessToken: string
  webhookId: string
}

/** Response for getting a webhook */
export interface AttioGetWebhookResponse extends ToolResponse {
  output: {
    webhookId: string | null
    targetUrl: string | null
    subscriptions: Array<{ eventType: string | null; filter: unknown }>
    status: string | null
    createdAt: string | null
  }
}

/** Params for creating a webhook */
export interface AttioCreateWebhookParams {
  accessToken: string
  targetUrl: string
  subscriptions: string
}

/** Response for creating a webhook */
export interface AttioCreateWebhookResponse extends ToolResponse {
  output: {
    webhookId: string | null
    targetUrl: string | null
    subscriptions: Array<{ eventType: string | null; filter: unknown }>
    status: string | null
    secret: string | null
    createdAt: string | null
  }
}

/** Params for updating a webhook */
export interface AttioUpdateWebhookParams {
  accessToken: string
  webhookId: string
  targetUrl?: string
  subscriptions?: string
}

/** Response for updating a webhook */
export interface AttioUpdateWebhookResponse extends ToolResponse {
  output: {
    webhookId: string | null
    targetUrl: string | null
    subscriptions: Array<{ eventType: string | null; filter: unknown }>
    status: string | null
    createdAt: string | null
  }
}

/** Params for deleting a webhook */
export interface AttioDeleteWebhookParams {
  accessToken: string
  webhookId: string
}

/** Response for deleting a webhook */
export interface AttioDeleteWebhookResponse extends ToolResponse {
  output: {
    deleted: boolean
  }
}

export type AttioResponse =
  | AttioListRecordsResponse
  | AttioGetRecordResponse
  | AttioCreateRecordResponse
  | AttioUpdateRecordResponse
  | AttioDeleteRecordResponse
  | AttioSearchRecordsResponse
  | AttioAssertRecordResponse
  | AttioListNotesResponse
  | AttioGetNoteResponse
  | AttioCreateNoteResponse
  | AttioDeleteNoteResponse
  | AttioListTasksResponse
  | AttioCreateTaskResponse
  | AttioUpdateTaskResponse
  | AttioDeleteTaskResponse
  | AttioListObjectsResponse
  | AttioGetObjectResponse
  | AttioCreateObjectResponse
  | AttioUpdateObjectResponse
  | AttioListListsResponse
  | AttioGetListResponse
  | AttioCreateListResponse
  | AttioUpdateListResponse
  | AttioQueryListEntriesResponse
  | AttioGetListEntryResponse
  | AttioCreateListEntryResponse
  | AttioUpdateListEntryResponse
  | AttioDeleteListEntryResponse
  | AttioListMembersResponse
  | AttioGetMemberResponse
  | AttioCreateCommentResponse
  | AttioGetCommentResponse
  | AttioDeleteCommentResponse
  | AttioListThreadsResponse
  | AttioGetThreadResponse
  | AttioListWebhooksResponse
  | AttioGetWebhookResponse
  | AttioCreateWebhookResponse
  | AttioUpdateWebhookResponse
  | AttioDeleteWebhookResponse
