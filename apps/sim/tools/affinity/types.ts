import type { OutputProperty, ToolResponse } from '@/tools/types'

/** Pagination envelope shared by every Affinity collection endpoint. */
export interface AffinityPagination {
  prevUrl?: string | null
  nextUrl?: string | null
  totalCount?: number
}

/** Cursor outputs every collection tool declares alongside its rows. */
export interface AffinityCollectionMeta {
  count: number
  nextCursor: string | null
  prevCursor: string | null
  totalCount: number | null
}

/** Response of a collection tool: rows named after the resource, plus cursors. */
export interface AffinityCollectionResponse<K extends string, T = unknown> extends ToolResponse {
  output: Record<K, T[]> & AffinityCollectionMeta
}

/** Response of a tool that returns a single resource object. */
export interface AffinityEntityResponse<T extends Record<string, unknown>> extends ToolResponse {
  output: T
}

/** Every tool authenticates with a workspace API key sent as a bearer token. */
export interface AffinityAuthParams {
  apiKey: string
}

/** Cursor pagination accepted by every collection endpoint. */
export interface AffinityCursorParams extends AffinityAuthParams {
  cursor?: string
  limit?: number
}

/** Collections that also accept an Affinity Filtering Language expression. */
export interface AffinityFilterParams extends AffinityCursorParams {
  filter?: string
}

/** Collections that can be asked for the total size of the match. */
export interface AffinityTotalCountParams {
  totalCount?: boolean
}

export interface AffinityGetCurrentUserParams extends AffinityAuthParams {}

export interface AffinityListCompaniesParams extends AffinityCursorParams {
  ids?: string | number[]
  fieldIds?: string | string[]
  fieldTypes?: string | string[]
}

export interface AffinityGetCompanyParams extends AffinityAuthParams {
  companyId: string
  fieldIds?: string | string[]
  fieldTypes?: string | string[]
}

export interface AffinitySearchEntitiesParams
  extends AffinityCursorParams,
    AffinityTotalCountParams {
  filters?: string | Record<string, unknown>
  sorts?: string | Record<string, unknown>[]
  searchTerm?: string
  searchFieldIds?: string | string[]
  fieldIds?: string | string[]
  fieldTypes?: string | string[]
}

export interface AffinityListPersonsParams extends AffinityListCompaniesParams {}

export interface AffinityGetPersonParams extends AffinityAuthParams {
  personId: string
  fieldIds?: string | string[]
  fieldTypes?: string | string[]
}

export interface AffinityEntityScopedParams extends AffinityFilterParams, AffinityTotalCountParams {
  entityType: string
  entityId: string
}

export interface AffinityListRelationshipsParams extends AffinityEntityScopedParams {
  orderBy?: string
}

export interface AffinityListFieldMetadataParams extends AffinityFilterParams {
  entityType: string
  includes?: string | string[]
}

export interface AffinityListFieldDropdownOptionsParams extends AffinityCursorParams {
  entityType: string
  fieldId: string
}

export interface AffinityListEntityFieldValuesParams extends AffinityCursorParams {
  entityType: string
  entityId: string
  ids?: string | string[]
  types?: string | string[]
}

export interface AffinityGetEntityFieldValueParams extends AffinityAuthParams {
  entityType: string
  entityId: string
  fieldId: string
}

export interface AffinityUpdateEntityFieldValueParams extends AffinityGetEntityFieldValueParams {
  value: string | Record<string, unknown>
}

export interface AffinityBatchUpdateEntityFieldsParams extends AffinityAuthParams {
  entityType: string
  entityId: string
  updates: string | Record<string, unknown>[]
}

export interface AffinityListListsParams extends AffinityCursorParams {
  term?: string
}

export interface AffinityCreateListParams extends AffinityAuthParams {
  name: string
  type: string
  isPublic?: boolean
}

export interface AffinityGetListParams extends AffinityAuthParams {
  listId: string
}

export interface AffinityListListFieldsParams extends AffinityFilterParams {
  listId: string
  includes?: string | string[]
}

export interface AffinityListListFieldDropdownOptionsParams extends AffinityCursorParams {
  listId: string
  fieldId: string
}

export interface AffinityCreateListFieldDropdownOptionParams extends AffinityAuthParams {
  listId: string
  fieldId: string
  type: string
  text: string
  rank?: number
  color?: string
  statusCategory?: string
  winRate?: number
}

export interface AffinityGetListFieldDropdownOptionParams extends AffinityAuthParams {
  listId: string
  fieldId: string
  dropdownOptionId: string
}

export interface AffinityUpdateListFieldDropdownOptionParams
  extends AffinityGetListFieldDropdownOptionParams {
  text: string
  rank?: number
  color?: string
  statusCategory?: string
  winRate?: number
}

export interface AffinityDeleteListFieldDropdownOptionParams
  extends AffinityGetListFieldDropdownOptionParams {}

export interface AffinityListListEntriesParams extends AffinityCursorParams {
  listId: string
  fieldIds?: string | string[]
  fieldTypes?: string | string[]
}

export interface AffinitySearchListEntriesParams extends AffinitySearchEntitiesParams {
  listId: string
}

export interface AffinityGetListEntryParams extends AffinityAuthParams {
  listId: string
  listEntryId: string
  fieldIds?: string | string[]
  fieldTypes?: string | string[]
}

export interface AffinityListListEntryFieldsParams extends AffinityCursorParams {
  listId: string
  listEntryId: string
  ids?: string | string[]
  types?: string | string[]
}

export interface AffinityGetListEntryFieldParams extends AffinityAuthParams {
  listId: string
  listEntryId: string
  fieldId: string
}

export interface AffinityUpdateListEntryFieldParams extends AffinityGetListEntryFieldParams {
  value: string | Record<string, unknown>
}

export interface AffinityBatchUpdateListEntryFieldsParams extends AffinityAuthParams {
  listId: string
  listEntryId: string
  updates: string | Record<string, unknown>[]
}

export interface AffinityListListEntryFieldValueChangesParams extends AffinityFilterParams {
  listId: string
  listEntryId: string
}

export interface AffinityListSavedViewsParams extends AffinityCursorParams {
  listId: string
}

export interface AffinityGetSavedViewParams extends AffinityAuthParams {
  listId: string
  viewId: string
}

export interface AffinityListSavedViewEntriesParams extends AffinityCursorParams {
  listId: string
  viewId: string
}

export interface AffinityListNotesParams extends AffinityFilterParams, AffinityTotalCountParams {
  includes?: string | string[]
}

export interface AffinityListTranscriptsParams
  extends AffinityFilterParams,
    AffinityTotalCountParams {}

export interface AffinityCreateNoteParams extends AffinityAuthParams {
  type: string
  html: string
  creatorId?: string
  createdAt?: string
  personIds?: string | number[]
  companyIds?: string | number[]
  opportunityIds?: string | number[]
  interactionId?: string
  interactionType?: string
  parentId?: string
}

export interface AffinitySearchByKeywordParams extends AffinityAuthParams {
  prompt: string
  limit?: number
  companyId?: string
  ids?: string | number[]
}

export interface AffinityNoteIdParams extends AffinityAuthParams {
  noteId: string
}

export interface AffinityGetNoteParams extends AffinityNoteIdParams {
  includes?: string | string[]
}

export interface AffinityUpdateNoteParams extends AffinityNoteIdParams {
  html?: string
  personIds?: string | number[]
  companyIds?: string | number[]
  opportunityIds?: string | number[]
}

export interface AffinityDeleteNoteParams extends AffinityNoteIdParams {}

export interface AffinityNoteCollectionParams
  extends AffinityFilterParams,
    AffinityTotalCountParams {
  noteId: string
}

export interface AffinityListOpportunitiesParams extends AffinityCursorParams {
  ids?: string | number[]
}

export interface AffinityGetOpportunityParams extends AffinityAuthParams {
  opportunityId: string
}

export interface AffinityListMergesParams extends AffinityFilterParams {
  entityType: string
}

export interface AffinityCreateMergeParams extends AffinityAuthParams {
  entityType: string
  primaryId: string
  duplicateId: string
}

export interface AffinityGetMergeParams extends AffinityAuthParams {
  entityType: string
  mergeId: string
}

export interface AffinityGetMergeTaskParams extends AffinityAuthParams {
  entityType: string
  taskId: string
}

export interface AffinityListFieldValueChangesParams extends AffinityFilterParams {
  orderBy?: string
}

export interface AffinityListInferredConnectionsParams
  extends AffinityCursorParams,
    AffinityTotalCountParams {
  filter: string
}

export interface AffinityListRemindersParams
  extends AffinityFilterParams,
    AffinityTotalCountParams {}

export interface AffinityCreateReminderParams extends AffinityAuthParams {
  type: string
  dueDate: string
  entityType: string
  entityId: string
  ownerId?: string
  content?: string
  resetTrigger?: string
  periodDays?: number
}

export interface AffinitySemanticSearchParams extends AffinityAuthParams {
  prompt: string
  limit?: number
  listIds?: string | number[]
}

export interface AffinityGetTranscriptParams extends AffinityAuthParams {
  transcriptId: string
}

export interface AffinityListTranscriptFragmentsParams
  extends AffinityCursorParams,
    AffinityTotalCountParams {
  transcriptId: string
}

export interface AffinityListUsersParams extends AffinityFilterParams {
  term?: string
}

export interface AffinityGetUserParams extends AffinityAuthParams {
  userId: string
}

/** Confirmation returned by the endpoints Affinity answers with `204 No Content`. */
export interface AffinityAcknowledgementResponse extends ToolResponse {
  output: {
    success: true
    id: string
  }
}

/** The tenant, user, and grant behind the API key. */
export interface AffinityCurrentUserResponse extends ToolResponse {
  output: {
    tenant: { id: number; name: string; subdomain: string }
    user: { id: number; firstName: string; lastName: string | null; emailAddress: string }
    grant: { type: string; scopes: string[]; createdAt: string }
  }
}

/** Batch field update acknowledgement. */
export interface AffinityBatchOperationResponse extends ToolResponse {
  output: { operation: string }
}

/** Async merge acknowledgement, carrying the task URL to poll. */
export interface AffinityMergeAcceptedResponse extends ToolResponse {
  output: { taskUrl: string }
}

/** Semantic search returns scored companies plus the model's rationale. */
export interface AffinitySemanticSearchResponse extends ToolResponse {
  output: {
    companies: unknown[]
    count: number
    entityType: string
    explanation: string
  }
}

/** Keyword search over notes or files returns a flat, unpaginated result list. */
export interface AffinityKeywordSearchResponse<K extends string> extends ToolResponse {
  output: Record<K, unknown[]> & { count: number }
}

/** A person as referenced from interactions, notes, and relationships. */
export const PERSON_REFERENCE_OUTPUT_PROPERTIES = {
  id: { type: 'number', description: "The person's unique identifier" },
  firstName: { type: 'string', nullable: true, description: "The person's first name" },
  lastName: { type: 'string', nullable: true, description: "The person's last name" },
  primaryEmailAddress: {
    type: 'string',
    nullable: true,
    description: "The person's primary email address",
  },
  type: {
    type: 'string',
    description: 'Whether the person is internal, a collaborator, or external',
  },
} as const satisfies Record<string, OutputProperty>

/** A company as referenced from notes, field values, and connections. */
export const COMPANY_REFERENCE_OUTPUT_PROPERTIES = {
  id: { type: 'number', description: "The company's unique identifier" },
  name: { type: 'string', description: 'The company name' },
  domain: { type: 'string', nullable: true, description: "The company's primary domain" },
} as const satisfies Record<string, OutputProperty>

/** A resolved field value: the field's identity plus its typed `{type, data}` value. */
export const FIELD_VALUE_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: "The field's unique identifier" },
  name: { type: 'string', description: 'The field name' },
  type: {
    type: 'string',
    description: 'enriched, global, list, relationship-intelligence, or hidden',
  },
  enrichmentSource: {
    type: 'string',
    nullable: true,
    description: 'affinity-data, dealroom, eventbrite, or mailchimp for an enriched field',
  },
  value: {
    type: 'json',
    description:
      'The typed value as {type, data}, where type names the value type (person, company, dropdown, number, location, datetime, text, interaction, …) and data carries the value or null',
  },
} as const satisfies Record<string, OutputProperty>

/** Field metadata: how a field is typed, filtered, and sorted. */
export const FIELD_METADATA_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: "The field's unique identifier" },
  name: { type: 'string', description: 'The field name' },
  type: {
    type: 'string',
    description: 'enriched, global, list, or relationship-intelligence',
  },
  enrichmentSource: {
    type: 'string',
    nullable: true,
    description: 'affinity-data, dealroom, eventbrite, or mailchimp for an enriched field',
  },
  valueType: {
    type: 'string',
    description:
      'The value shape: person, person-multi, company, company-multi, filterable-text, filterable-text-multi, number, number-multi, datetime, location, location-multi, text, ranked-dropdown, dropdown, dropdown-multi, formula-number, or interaction',
  },
  createdAt: { type: 'string', nullable: true, description: 'When the field was created' },
  filterability: {
    type: 'json',
    optional: true,
    nullable: true,
    description:
      'Supported filter operators, or the attributes that can be filtered on. Only present when requested through Includes',
  },
  sortability: {
    type: 'json',
    optional: true,
    nullable: true,
    description:
      'Whether the field can be sorted on, and by which attributes. Only present when requested through Includes',
  },
} as const satisfies Record<string, OutputProperty>

/** A company with any requested non-list field data. */
export const COMPANY_OUTPUT_PROPERTIES = {
  id: { type: 'number', description: "The company's unique identifier" },
  name: { type: 'string', description: 'The company name' },
  domain: { type: 'string', nullable: true, description: 'The primary domain' },
  domains: { type: 'array', description: 'Every domain associated with the company' },
  isGlobal: {
    type: 'boolean',
    description: 'Whether this is an Affinity Data global company profile',
  },
  fields: {
    type: 'array',
    optional: true,
    description: 'Requested field values. Absent unless Field IDs or Field Types was supplied',
    items: { type: 'object', properties: FIELD_VALUE_OUTPUT_PROPERTIES },
  },
} as const satisfies Record<string, OutputProperty>

/** A person with any requested non-list field data. */
export const PERSON_OUTPUT_PROPERTIES = {
  id: { type: 'number', description: "The person's unique identifier" },
  firstName: { type: 'string', description: "The person's first name" },
  lastName: { type: 'string', nullable: true, description: "The person's last name" },
  primaryEmailAddress: {
    type: 'string',
    nullable: true,
    description: "The person's primary email address",
  },
  emailAddresses: { type: 'array', description: 'Every email address on the person' },
  type: { type: 'string', description: 'Whether the person is internal or external' },
  fields: {
    type: 'array',
    optional: true,
    description: 'Requested field values. Absent unless Field IDs or Field Types was supplied',
    items: { type: 'object', properties: FIELD_VALUE_OUTPUT_PROPERTIES },
  },
} as const satisfies Record<string, OutputProperty>

/** An opportunity, which always belongs to exactly one list. */
export const OPPORTUNITY_OUTPUT_PROPERTIES = {
  id: { type: 'number', description: "The opportunity's unique identifier" },
  name: { type: 'string', description: 'The opportunity name' },
  listId: { type: 'number', description: 'The list the opportunity belongs to' },
  listName: { type: 'string', description: 'Name of that list' },
  isRestricted: {
    type: 'boolean',
    description: 'Whether list permissions restrict access to the opportunity',
  },
  isRedacted: { type: 'boolean', description: 'Whether the opportunity fields were redacted' },
} as const satisfies Record<string, OutputProperty>

/**
 * List metadata as returned by the per-entity list endpoints.
 *
 * `/v2/{companies|persons}/{id}/lists` answers with the `List` schema, which
 * carries no `type` — only the `/v2/lists` family returns `ListWithType`.
 */
export const LIST_OUTPUT_PROPERTIES = {
  id: { type: 'number', description: "The list's unique identifier" },
  name: { type: 'string', description: 'The list name' },
  creatorId: { type: 'number', description: 'User who created the list' },
  ownerId: { type: 'number', description: 'User who owns the list' },
  isPublic: { type: 'boolean', description: 'Whether the list is visible to the organization' },
  createdAt: { type: 'string', description: 'When the list was created' },
} as const satisfies Record<string, OutputProperty>

/** List metadata from the `/v2/lists` family, which also names the entity kind the list holds. */
export const LIST_WITH_TYPE_OUTPUT_PROPERTIES = {
  ...LIST_OUTPUT_PROPERTIES,
  type: {
    type: 'string',
    description: 'company, opportunity, or person — the entity kind the list holds',
  },
} as const satisfies Record<string, OutputProperty>

/** A list entry with its entity inlined. */
export const LIST_ENTRY_OUTPUT_PROPERTIES = {
  id: { type: 'number', description: "The list entry's unique identifier" },
  type: { type: 'string', description: 'company, person, or opportunity' },
  listId: { type: 'number', description: 'The list the entry belongs to' },
  createdAt: { type: 'string', description: 'When the entity was added to the list' },
  creatorId: { type: 'number', nullable: true, description: 'User who added the entity' },
  entity: {
    type: 'json',
    description: 'The company, person, or opportunity on the row, including its field values',
  },
} as const satisfies Record<string, OutputProperty>

/** A list entry as returned by the per-entity endpoints, which name the list inline. */
export const ENTITY_LIST_ENTRY_OUTPUT_PROPERTIES = {
  id: { type: 'number', description: "The list entry's unique identifier" },
  listId: { type: 'number', description: 'The list the entry belongs to' },
  listName: { type: 'string', description: 'Name of that list' },
  createdAt: { type: 'string', description: 'When the entity was added to the list' },
  creatorId: { type: 'number', nullable: true, description: 'User who added the entity' },
  fields: {
    type: 'array',
    description: 'Field values on the row, including list-specific fields',
    items: { type: 'object', properties: FIELD_VALUE_OUTPUT_PROPERTIES },
  },
} as const satisfies Record<string, OutputProperty>

/** A note, in any of its five kinds. */
export const NOTE_OUTPUT_PROPERTIES = {
  id: { type: 'number', description: "The note's unique identifier" },
  type: {
    type: 'string',
    description: 'entities, interaction, ai-notetaker, user-reply, or ai-notetaker-reply',
  },
  content: { type: 'json', description: 'The note body as {html}' },
  creator: {
    type: 'object',
    description: 'Person who authored the note',
    properties: PERSON_REFERENCE_OUTPUT_PROPERTIES,
  },
  mentions: { type: 'array', description: 'Persons mentioned in the note body' },
  createdAt: { type: 'string', description: 'When the note was created' },
  updatedAt: { type: 'string', nullable: true, description: 'When the note was last updated' },
  repliesCount: {
    type: 'number',
    optional: true,
    description: 'Number of replies, on root notes only',
  },
  parent: {
    type: 'json',
    optional: true,
    description: 'The note being replied to, on reply notes only',
  },
  interaction: {
    type: 'json',
    optional: true,
    description: 'The meeting, call, chat message, or email the note is anchored to',
  },
  transcriptId: {
    type: 'number',
    optional: true,
    description: 'Transcript behind an AI Notetaker note',
  },
  personsPreview: { type: 'json', optional: true, description: 'Attached persons, with a count' },
  companiesPreview: {
    type: 'json',
    optional: true,
    description: 'Attached companies, with a count',
  },
  opportunitiesPreview: {
    type: 'json',
    optional: true,
    description: 'Attached opportunities, with a count',
  },
} as const satisfies Record<string, OutputProperty>

/** A dropdown option. Rank, color, and status only exist on the richer option kinds. */
export const DROPDOWN_OPTION_OUTPUT_PROPERTIES = {
  id: { type: 'number', description: "The dropdown option's unique identifier" },
  text: { type: 'string', description: 'The option label' },
  type: { type: 'string', description: 'dropdown, ranked-dropdown, or status-dropdown' },
  rank: { type: 'number', optional: true, description: 'Sort order, on ranked and status options' },
  color: {
    type: 'string',
    optional: true,
    nullable: true,
    description: 'white, gray, blue, green, purple, orange, or red',
  },
  statusCategory: {
    type: 'string',
    optional: true,
    description: 'open, won, lost, or on-hold, on status options',
  },
  winRate: {
    type: 'number',
    optional: true,
    nullable: true,
    description: 'Win rate of a status option',
  },
} as const satisfies Record<string, OutputProperty>

/** A saved view on a list. */
export const SAVED_VIEW_OUTPUT_PROPERTIES = {
  id: { type: 'number', description: "The saved view's unique identifier" },
  name: { type: 'string', description: 'The saved view name' },
  type: { type: 'string', description: 'sheet, board, or dashboard' },
  createdAt: { type: 'string', description: 'When the saved view was created' },
} as const satisfies Record<string, OutputProperty>

/** An internal user. Email addresses and role require the Manage Users permission. */
export const USER_OUTPUT_PROPERTIES = {
  id: { type: 'number', description: "The user's unique identifier, shared with their person ID" },
  firstName: { type: 'string', description: "The user's first name" },
  lastName: { type: 'string', nullable: true, description: "The user's last name" },
  primaryEmailAddress: {
    type: 'string',
    nullable: true,
    description: "The user's primary email address",
  },
  emailAddresses: {
    type: 'array',
    optional: true,
    description: 'Every email address, for callers with the Manage Users permission',
  },
  photoUrl: { type: 'string', nullable: true, description: "URL of the user's photo" },
  status: { type: 'string', description: 'active, invited, or deactivated' },
  role: {
    type: 'string',
    optional: true,
    description: 'Account role, for callers with the Manage Users permission',
  },
} as const satisfies Record<string, OutputProperty>

/** A relationship between two persons, scored by interaction strength. */
export const RELATIONSHIP_OUTPUT_PROPERTIES = {
  person1: {
    type: 'object',
    description: 'One side of the relationship',
    properties: PERSON_REFERENCE_OUTPUT_PROPERTIES,
  },
  person2: {
    type: 'object',
    description: 'The other side of the relationship',
    properties: PERSON_REFERENCE_OUTPUT_PROPERTIES,
  },
  interactionScore: {
    type: 'number',
    description: 'Strength of the relationship, between 0.0 and 1.0',
  },
  linkedIn: {
    type: 'json',
    nullable: true,
    description: 'When the two connected on LinkedIn, as {connectedOn}',
  },
} as const satisfies Record<string, OutputProperty>

/** A single company or person merge. */
export const MERGE_OUTPUT_PROPERTIES = {
  id: { type: 'number', description: "The merge's unique identifier" },
  status: { type: 'string', description: 'in-progress, success, or failed' },
  taskId: { type: 'string', description: 'Task that groups this merge with its siblings' },
  startedAt: { type: 'string', description: 'When the merge started' },
  completedAt: { type: 'string', nullable: true, description: 'When the merge finished' },
  errorMessage: { type: 'string', nullable: true, description: 'Why the merge failed' },
  primaryCompanyId: {
    type: 'number',
    optional: true,
    description: 'Company kept by a company merge',
  },
  duplicateCompanyId: {
    type: 'number',
    optional: true,
    description: 'Company folded in by a company merge',
  },
  primaryPersonId: { type: 'number', optional: true, description: 'Person kept by a person merge' },
  duplicatePersonId: {
    type: 'number',
    optional: true,
    description: 'Person folded in by a person merge',
  },
} as const satisfies Record<string, OutputProperty>

/** A merge task, summarizing the merges it groups. */
export const MERGE_TASK_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: "The task's unique identifier" },
  status: { type: 'string', description: 'in-progress, success, or failed' },
  resultsSummary: {
    type: 'json',
    description: 'Counts of the grouped merges as {total, inProgress, success, failed}',
  },
} as const satisfies Record<string, OutputProperty>

/** A one-time or recurring reminder. */
export const REMINDER_OUTPUT_PROPERTIES = {
  id: { type: 'number', description: "The reminder's unique identifier" },
  type: { type: 'string', description: 'one-time or recurring' },
  status: { type: 'string', description: 'active, overdue, or completed' },
  content: { type: 'string', nullable: true, description: 'The reminder text' },
  dueDate: { type: 'string', description: 'When the reminder is due' },
  creator: { type: 'json', description: 'User who created the reminder, as {id}' },
  owner: { type: 'json', description: 'User the reminder is assigned to, as {id}' },
  completer: { type: 'json', nullable: true, description: 'User who completed it, as {id}' },
  company: { type: 'json', nullable: true, description: 'Tagged company, as {id}' },
  person: { type: 'json', nullable: true, description: 'Tagged person, as {id}' },
  opportunity: { type: 'json', nullable: true, description: 'Tagged opportunity, as {id}' },
  completedAt: { type: 'string', nullable: true, description: 'When the reminder was completed' },
  recurrence: {
    type: 'json',
    nullable: true,
    description: 'Recurrence as {resetTrigger, periodDays}, null on a one-time reminder',
  },
  createdAt: { type: 'string', description: 'When the reminder was created' },
  updatedAt: { type: 'string', nullable: true, description: 'When the reminder was last updated' },
} as const satisfies Record<string, OutputProperty>

/** One spoken segment of a transcript. */
export const TRANSCRIPT_FRAGMENT_OUTPUT_PROPERTIES = {
  content: { type: 'string', description: 'What was said' },
  speaker: { type: 'string', description: 'Who said it' },
  startTimestamp: { type: 'string', description: 'When the segment starts' },
  endTimestamp: { type: 'string', description: 'When the segment ends' },
} as const satisfies Record<string, OutputProperty>

/** A single change to a field value, for delta sync. */
export const FIELD_VALUE_CHANGE_OUTPUT_PROPERTIES = {
  id: { type: 'number', description: "The change's unique identifier" },
  type: { type: 'string', description: 'The value type the change applies to' },
  field: { type: 'json', description: 'The changed field as {id, entityType, name, type}' },
  entity: { type: 'json', description: 'The entity whose field changed, as {id}' },
  listEntry: {
    type: 'json',
    nullable: true,
    description: 'The list entry the change happened on, for list fields',
  },
  changer: { type: 'json', nullable: true, description: 'User who made the change' },
  changedAt: { type: 'string', description: 'When the change happened' },
  actionType: { type: 'string', description: 'add, update, or delete' },
  value: { type: 'json', description: 'The value that was added, set, or removed' },
} as const satisfies Record<string, OutputProperty>

/** Inferred connections, grouped by the person you want to reach. */
export const CONNECTION_GROUP_OUTPUT_PROPERTIES = {
  target: {
    type: 'json',
    description: 'The person to reach, as {fullName, title, linkedinUrl, currentCompany}',
  },
  connections: {
    type: 'array',
    description:
      'People in your Affinity data who might know the target, each with the inference that links them',
  },
} as const satisfies Record<string, OutputProperty>

/** A call interaction. */
export const CALL_OUTPUT_PROPERTIES = {
  id: { type: 'number', description: "The call's unique identifier" },
  loggingType: { type: 'string', description: 'How the call was logged' },
  title: { type: 'string', nullable: true, description: 'The call title' },
  startTime: { type: 'string', description: 'When the call started' },
  endTime: { type: 'string', nullable: true, description: 'When the call ended' },
  allDay: { type: 'boolean', description: 'Whether the call spans the whole day' },
  creator: { type: 'json', nullable: true, description: 'Who logged the call' },
  createdAt: { type: 'string', description: 'When the record was created' },
  updatedAt: { type: 'string', nullable: true, description: 'When the record was last updated' },
  attendeesPreview: { type: 'json', description: 'Attendees, with a total count' },
} as const satisfies Record<string, OutputProperty>

/** A meeting interaction. */
export const MEETING_OUTPUT_PROPERTIES = {
  ...CALL_OUTPUT_PROPERTIES,
  loggingType: { type: 'string', description: 'automated or manual' },
  organizer: { type: 'json', nullable: true, description: 'Who organized the meeting' },
} as const satisfies Record<string, OutputProperty>

/** An email interaction. Bodies are never exposed by the API — only metadata. */
export const EMAIL_OUTPUT_PROPERTIES = {
  id: { type: 'number', description: "The email's unique identifier" },
  sentAt: { type: 'string', description: 'When the email was sent' },
  loggingType: { type: 'string', description: 'How the email was logged' },
  direction: { type: 'string', description: 'sent or received' },
  subject: { type: 'string', nullable: true, description: 'The subject line' },
  createdAt: { type: 'string', description: 'When the record was created' },
  updatedAt: { type: 'string', nullable: true, description: 'When the record was last updated' },
  from: { type: 'json', description: 'Sender, as {emailAddress, person}' },
  toParticipantsPreview: { type: 'json', description: 'To recipients, with a total count' },
  ccParticipantsPreview: { type: 'json', description: 'Cc recipients, with a total count' },
} as const satisfies Record<string, OutputProperty>

/** A chat message interaction. */
export const CHAT_MESSAGE_OUTPUT_PROPERTIES = {
  id: { type: 'number', description: "The chat message's unique identifier" },
  sentAt: { type: 'string', description: 'When the message was sent' },
  loggingType: { type: 'string', description: 'How the message was logged' },
  direction: { type: 'string', description: 'sent or received' },
  creator: {
    type: 'object',
    description: 'Person who sent the message',
    properties: PERSON_REFERENCE_OUTPUT_PROPERTIES,
  },
  createdAt: { type: 'string', description: 'When the record was created' },
  updatedAt: { type: 'string', nullable: true, description: 'When the record was last updated' },
  participantsPreview: { type: 'json', description: 'Participants, with a total count' },
} as const satisfies Record<string, OutputProperty>

/** A transcript with its first 100 fragments inlined. */
export const TRANSCRIPT_OUTPUT_PROPERTIES = {
  id: { type: 'number', description: "The transcript's unique identifier" },
  note: { type: 'json', description: 'The AI Notetaker note the transcript belongs to' },
  createdAt: { type: 'string', description: 'When the transcript was created' },
  languageCode: { type: 'string', description: 'Language the meeting was held in' },
  fragmentsPreview: {
    type: 'json',
    description: 'The first 100 fragments, with a total count',
  },
} as const satisfies Record<string, OutputProperty>

/** Transcript metadata as returned by the collection endpoint, which omits the fragments. */
export const TRANSCRIPT_SUMMARY_OUTPUT_PROPERTIES = {
  id: TRANSCRIPT_OUTPUT_PROPERTIES.id,
  note: TRANSCRIPT_OUTPUT_PROPERTIES.note,
  createdAt: TRANSCRIPT_OUTPUT_PROPERTIES.createdAt,
  languageCode: TRANSCRIPT_OUTPUT_PROPERTIES.languageCode,
} as const satisfies Record<string, OutputProperty>

/** A company scored by semantic search. */
export const SEMANTIC_SEARCH_COMPANY_OUTPUT_PROPERTIES = {
  ...COMPANY_REFERENCE_OUTPUT_PROPERTIES,
  domains: { type: 'array', description: 'Every domain associated with the company' },
  isGlobal: {
    type: 'boolean',
    description: 'Whether this is an Affinity Data global company profile',
  },
  score: { type: 'string', description: 'How well the company matched the prompt' },
} as const satisfies Record<string, OutputProperty>

/** Outputs of every tool whose endpoint returns `204 No Content`. */
export const ACKNOWLEDGEMENT_OUTPUTS = {
  success: { type: 'boolean', description: 'Whether Affinity accepted the change' },
  id: { type: 'string', description: 'Identifier of the resource that was changed' },
} as const satisfies Record<string, OutputProperty>
