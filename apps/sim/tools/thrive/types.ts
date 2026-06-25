import type { OutputProperty, ToolResponse } from '@/tools/types'

/**
 * Credentials and region shared by every Thrive tool.
 * Thrive uses HTTP Basic auth (Tenant ID as username, API key as password).
 */
export interface ThriveBaseParams {
  tenantId: string
  apiKey: string
  /** Region-specific API host, e.g. `public.api.learn.link`. Defaults to Production. */
  host?: string
}

export interface ThrivePagination {
  totalResults: number
  totalPages: number
  page: number
  perPage: number
}

export const THRIVE_PAGINATION_OUTPUT_PROPERTIES: Record<string, OutputProperty> = {
  totalResults: { type: 'number', description: 'Total number of results matching the query' },
  totalPages: { type: 'number', description: 'Total number of pages available' },
  page: { type: 'number', description: 'Current page number' },
  perPage: { type: 'number', description: 'Number of results per page' },
}

const USER_POSITION_OUTPUT_PROPERTIES: Record<string, OutputProperty> = {
  id: { type: 'string', description: 'The user ID' },
  manager: {
    type: 'object',
    description: 'Line manager details',
    properties: {
      id: { type: 'string', description: "The manager's user ID", nullable: true },
      name: { type: 'string', description: "The manager's full name", nullable: true },
      ref: { type: 'string', description: "The manager's unique reference", nullable: true },
    },
  },
  ouId: { type: 'string', description: 'The organisational unit ID', nullable: true },
  isActive: { type: 'boolean', description: 'Whether the position is active' },
  startDate: { type: 'string', description: 'Start date (ISO 8601)', nullable: true },
  endDate: { type: 'string', description: 'End date (ISO 8601)', nullable: true },
  createdAt: { type: 'string', description: 'Creation timestamp (ISO 8601)', nullable: true },
  updatedAt: { type: 'string', description: 'Last-update timestamp (ISO 8601)', nullable: true },
}

/** Full `User` schema returned by search-users and get-user-by-id. */
export const THRIVE_USER_OUTPUT_PROPERTIES: Record<string, OutputProperty> = {
  id: { type: 'string', description: "The user's ID" },
  ref: { type: 'string', description: "The user's ref", nullable: true },
  firstName: { type: 'string', description: "The user's first name", nullable: true },
  lastName: { type: 'string', description: "The user's last name", nullable: true },
  email: { type: 'string', description: "The user's email", nullable: true },
  role: { type: 'string', description: "The user's role", nullable: true },
  status: { type: 'string', description: "The user's status", nullable: true },
  positions: {
    type: 'array',
    description: "The user's positions",
    items: { type: 'object', properties: USER_POSITION_OUTPUT_PROPERTIES },
  },
  additionalFields: { type: 'json', description: 'Custom field values', nullable: true },
  languageCode: { type: 'string', description: "The user's language code", nullable: true },
  deleted: { type: 'boolean', description: 'Whether the user has been deleted' },
  compliance: { type: 'number', description: "The user's compliance score" },
  level: { type: 'number', description: "The user's level" },
  firstLogin: { type: 'string', description: 'First login timestamp (ISO 8601)', nullable: true },
  lastLogin: { type: 'string', description: 'Last login timestamp (ISO 8601)', nullable: true },
  tags: { type: 'json', description: 'Tag membership (e.g. skills)' },
  usersFollowing: {
    type: 'array',
    description: 'IDs of users this user follows',
    items: { type: 'string' },
  },
  tagsFollowing: {
    type: 'array',
    description: 'Tags this user follows',
    items: { type: 'string' },
  },
  createdAt: { type: 'string', description: 'Creation timestamp (ISO 8601)', nullable: true },
  updatedAt: { type: 'string', description: 'Last-update timestamp (ISO 8601)', nullable: true },
  hasPicture: { type: 'boolean', description: 'Whether the user has a profile picture' },
  timeZone: { type: 'string', description: "The user's time zone", nullable: true },
  summary: { type: 'string', description: "The user's summary", nullable: true },
  relevancy: { type: 'number', description: "The user's relevancy score" },
  rank: { type: 'json', description: "The user's rank details" },
  agreedTerms: {
    type: 'boolean',
    description: 'Whether the user agreed to the terms',
    nullable: true,
  },
  onboarded: {
    type: 'boolean',
    description: 'Whether the user has been onboarded',
    nullable: true,
  },
  audiences: {
    type: 'array',
    description: 'Audience IDs the user belongs to',
    items: { type: 'string' },
  },
  singleSignOn: { type: 'boolean', description: 'Whether the user uses single sign-on' },
}

/** Smaller `BasicUser` schema returned by get-user-by-ref. */
export const THRIVE_BASIC_USER_OUTPUT_PROPERTIES: Record<string, OutputProperty> = {
  id: { type: 'string', description: "The user's ID" },
  ref: { type: 'string', description: "The user's ref", nullable: true },
  firstName: { type: 'string', description: "The user's first name", nullable: true },
  lastName: { type: 'string', description: "The user's last name", nullable: true },
  email: { type: 'string', description: "The user's email", nullable: true },
  role: { type: 'string', description: "The user's role", nullable: true },
  status: { type: 'string', description: "The user's status", nullable: true },
  positions: {
    type: 'array',
    description: "The user's positions",
    items: { type: 'object', properties: USER_POSITION_OUTPUT_PROPERTIES },
  },
  additionalFields: { type: 'json', description: 'Custom field values', nullable: true },
  languageCode: { type: 'string', description: "The user's language code", nullable: true },
}

/** `UserLifecycleResource` returned by create/update/suspend user. */
export const THRIVE_USER_LIFECYCLE_OUTPUT_PROPERTIES: Record<string, OutputProperty> = {
  id: { type: 'string', description: 'The user ID' },
  loginMethod: { type: 'string', description: 'How the user logs in' },
  ref: { type: 'string', description: "Your organisation's unique identifier for the user" },
  email: { type: 'string', description: 'The email address for the user' },
  firstName: { type: 'string', description: 'The given name of the individual' },
  lastName: { type: 'string', description: 'The family name of the individual' },
  role: { type: 'string', description: 'Role assigned to this individual' },
  jobTitle: { type: 'string', description: "Name of this individual's role" },
  managerRef: { type: 'string', description: "The line manager's ref", nullable: true },
  startDate: { type: 'string', description: 'Date started with the organisation', nullable: true },
  endDate: { type: 'string', description: 'Date left the organisation', nullable: true },
  timeZone: { type: 'string', description: "The user's preferred timezone" },
  languageCode: { type: 'string', description: "The user's preferred language" },
  active: { type: 'boolean', description: 'Whether the account is active or suspended' },
  createdAt: { type: 'string', description: 'Date/time the user was created' },
  updatedAt: { type: 'string', description: 'Date/time the user was last modified' },
  sso: { type: 'boolean', description: 'Whether the account is managed by an auth provider' },
  domain: {
    type: 'string',
    description: 'Domain this individual is associated with',
    nullable: true,
  },
  additionalFields: {
    type: 'json',
    description: 'Custom field values for this user',
    nullable: true,
  },
}

export const THRIVE_AUDIENCE_OUTPUT_PROPERTIES: Record<string, OutputProperty> = {
  id: { type: 'string', description: 'The id of the audience' },
  name: { type: 'string', description: 'The name of the audience' },
  reference: { type: 'string', description: 'The external reference for the audience' },
  apiControlled: { type: 'boolean', description: 'Whether the audience is API controlled' },
  category: { type: 'string', description: 'Either "audience" or "structure"' },
  type: { type: 'string', description: 'Either "manual" or "smart"' },
  parent: {
    type: 'object',
    description: 'Parent audience/structure information',
    nullable: true,
    properties: {
      name: { type: 'string', description: 'The name of the parent audience' },
      reference: { type: 'string', description: 'The external reference for the parent' },
      id: { type: 'string', description: 'The id of the parent audience/structure' },
    },
  },
  createdAt: { type: 'string', description: 'Creation timestamp (ISO 8601)' },
  updatedAt: { type: 'string', description: 'Last-update timestamp (ISO 8601)' },
}

export const THRIVE_AUDIENCE_MEMBER_OUTPUT_PROPERTIES: Record<string, OutputProperty> = {
  userId: { type: 'string', description: "The user's id" },
  reference: { type: 'string', description: "The user's reference" },
  email: { type: 'string', description: "The user's email" },
}

export const THRIVE_AUDIENCE_MANAGER_OUTPUT_PROPERTIES: Record<string, OutputProperty> = {
  userId: { type: 'string', description: "The user's id" },
  reference: { type: 'string', description: "The user's reference" },
  email: { type: 'string', description: "The user's email" },
  permissions: {
    type: 'object',
    description: 'The manager permissions',
    properties: {
      audienceManager: { type: 'json', description: 'Audience manager permissions' },
      peopleManager: { type: 'json', description: 'People manager permissions' },
      administrator: {
        type: 'json',
        description: 'Administrator permissions (structures only)',
        nullable: true,
      },
    },
  },
}

/** Superset of SuccessAddUsers / PartialSuccessAddUsers. */
export const THRIVE_ADD_USERS_OUTPUT_PROPERTIES: Record<string, OutputProperty> = {
  success: {
    type: 'object',
    description: 'Successfully processed entities',
    properties: {
      count: { type: 'number', description: 'Number of successfully processed entities' },
      entities: {
        type: 'array',
        description: 'The successfully processed entities',
        items: {
          type: 'object',
          properties: { reference: { type: 'string', description: 'The entity reference' } },
        },
      },
    },
  },
  failure: {
    type: 'object',
    description: 'Unsuccessfully processed entities',
    optional: true,
    properties: {
      count: { type: 'number', description: 'Number of unsuccessfully processed entities' },
      entities: {
        type: 'array',
        description: 'The unsuccessfully processed entities',
        items: {
          type: 'object',
          properties: {
            reason: { type: 'string', description: 'The reason for the failure' },
            reference: { type: 'string', description: 'The entity reference' },
          },
        },
      },
    },
  },
}

export const THRIVE_ASSIGNMENT_OUTPUT_PROPERTIES: Record<string, OutputProperty> = {
  id: { type: 'string', description: 'The assignment ID' },
  audienceId: { type: 'string', description: 'The audience ID' },
  primaryContentId: { type: 'string', description: 'The content ID for the primary content' },
  alternativeContentIds: {
    type: 'array',
    description: 'Content IDs that can also complete the assignment',
    items: { type: 'string' },
  },
  hideAlternativeContent: {
    type: 'boolean',
    description: 'Whether to hide the alternative content',
  },
  completionPeriod: {
    type: 'number',
    description: 'Number of days required to complete the assignment',
  },
  recurrence: {
    type: 'number',
    description: 'Number of days until the assignment reoccurs',
    nullable: true,
  },
  isActive: { type: 'boolean', description: 'Whether the assignment is active' },
  isDeleted: { type: 'boolean', description: 'Whether the assignment is deleted' },
  createdAt: { type: 'string', description: 'Creation timestamp (ISO 8601)', nullable: true },
  deletedAt: { type: 'string', description: 'Deletion timestamp (ISO 8601)', nullable: true },
  updatedAt: { type: 'string', description: 'Last-update timestamp (ISO 8601)', nullable: true },
}

export const THRIVE_ENROLMENT_OUTPUT_PROPERTIES: Record<string, OutputProperty> = {
  id: { type: 'string', description: 'The enrolment ID' },
  userId: { type: 'string', description: 'The assignee user ID' },
  assignmentId: { type: 'string', description: 'The assignment ID' },
  audienceId: { type: 'string', description: 'The audience ID' },
  primaryContentId: { type: 'string', description: 'The assigned content ID' },
  status: { type: 'string', description: 'Enrolment status' },
  availableDate: { type: 'string', description: 'Date a scheduled enrolment becomes open' },
  dueDate: { type: 'string', description: 'Date after which a scheduled enrolment is overdue' },
  lastCompletedAt: { type: 'string', description: 'Date a scheduled enrolment was last completed' },
  history: {
    type: 'array',
    description: 'Event-log history entries',
    items: {
      type: 'object',
      properties: {
        type: { type: 'string', description: 'The type of the logged event' },
        completionId: { type: 'string', description: 'The completion ID' },
        previousStatus: { type: 'string', description: 'The previous enrolment status' },
        nextStatus: { type: 'string', description: 'The next enrolment status' },
        createdAt: { type: 'string', description: 'Date the event was logged' },
        updatedAt: { type: 'string', description: 'Date the event was last modified' },
      },
    },
  },
  updatedAt: { type: 'string', description: 'Date the enrolment was last updated' },
}

export const THRIVE_COMPLETION_OUTPUT_PROPERTIES: Record<string, OutputProperty> = {
  id: { type: 'string', description: 'The completion ID' },
  userId: { type: 'string', description: 'The user ID' },
  contentId: { type: 'string', description: 'The content ID for the content completed' },
  contentVersion: { type: 'number', description: 'The version of the content' },
  skills: {
    type: 'array',
    description: 'The skills acquired by completing this content',
    items: { type: 'string' },
  },
  completionType: { type: 'string', description: 'The type of completion record' },
  hadDueDate: { type: 'boolean', description: 'Whether the completion had a due date' },
  isRPL: { type: 'boolean', description: 'Whether the completion was imported via RPL' },
  completedAt: { type: 'string', description: 'Timestamp when the completion occurred (ISO 8601)' },
  activeUntil: {
    type: 'string',
    description: 'Timestamp the completion is valid until (ISO 8601)',
  },
}

const CONTENT_HISTORY_OUTPUT_PROPERTIES: Record<string, OutputProperty> = {
  action: { type: 'string', description: 'Type of change or event recorded' },
  timestamp: { type: 'string', description: 'When the action occurred (ISO 8601)' },
  performedBy: {
    type: 'object',
    description: 'The actor that performed the action',
    properties: {
      type: { type: 'string', description: 'Kind of actor (e.g. user or system)' },
      value: { type: 'string', description: 'Identifier or value of the actor' },
    },
  },
}

export const THRIVE_CONTENT_OUTPUT_PROPERTIES: Record<string, OutputProperty> = {
  id: { type: 'string', description: 'Unique identifier for the content' },
  title: { type: 'string', description: 'Title of the content' },
  description: { type: 'string', description: 'Detailed description (may contain HTML)' },
  tags: {
    type: 'array',
    description: 'Tags associated with this content',
    items: { type: 'string' },
  },
  type: { type: 'string', description: 'The kind of artifact associated with this content' },
  createdAt: { type: 'string', description: 'Creation timestamp (ISO 8601)' },
  updatedAt: { type: 'string', description: 'Last-update timestamp (ISO 8601)' },
  author: { type: 'string', description: 'User ID who authored the content', nullable: true },
  isOfficial: { type: 'boolean', description: 'Whether the content is recognised as official' },
  duration: {
    type: 'object',
    description: 'Expected time to complete the content',
    nullable: true,
    properties: {
      value: { type: 'number', description: 'Duration value', nullable: true },
      unit: { type: 'string', description: "The unit of the duration (always 'minutes')" },
    },
  },
  contentHistory: {
    type: 'array',
    description: 'Chronological history of actions on this content',
    items: { type: 'object', properties: CONTENT_HISTORY_OUTPUT_PROPERTIES },
  },
}

export const THRIVE_ACTIVITY_OUTPUT_PROPERTIES: Record<string, OutputProperty> = {
  type: { type: 'string', description: 'The activity action type' },
  name: { type: 'string', description: 'The name of the activity' },
  id: { type: 'string', description: 'Unique ID for this activity record' },
  user: { type: 'string', description: 'User ID who triggered the activity' },
  date: { type: 'string', description: 'Timestamp when the activity occurred (ISO 8601)' },
  contextId: { type: 'string', description: 'Identifier for the context item' },
  contextType: { type: 'string', description: 'What this activity was in relation to' },
  data: { type: 'json', description: 'Unstructured activity data; shape varies by type' },
  with: { type: 'json', description: 'Additional context information', nullable: true },
}

export const THRIVE_CPD_CATEGORY_OUTPUT_PROPERTIES: Record<string, OutputProperty> = {
  categoryId: { type: 'string', description: 'Unique ID for this category record' },
  name: { type: 'string', description: 'Name of the category of CPD activity' },
}

export const THRIVE_CPD_ENTRY_OUTPUT_PROPERTIES: Record<string, OutputProperty> = {
  logEntryId: { type: 'string', description: 'Unique ID for this activity record' },
  userId: { type: 'string', description: 'User ID who triggered this activity record' },
  activity: {
    type: 'object',
    description: 'The content item associated with the CPD log entry',
    properties: {
      type: { type: 'string', description: 'The type of content (e.g. file, article, video)' },
      name: { type: 'string', description: 'The name of the content item' },
    },
  },
  category: {
    type: 'object',
    description: 'The CPD category',
    properties: {
      categoryId: { type: 'string', description: 'Unique ID for this category record' },
      name: { type: 'string', description: 'Name of the category of CPD activity' },
    },
  },
  entryDate: {
    type: 'string',
    description: 'The date and time the CPD entry was logged (ISO 8601)',
  },
  durationMinutes: { type: 'number', description: 'Minutes logged as CPD from this activity' },
  description: { type: 'string', description: 'Summary or reflective statement', nullable: true },
  isVerified: {
    type: 'boolean',
    description: 'Whether the activity was generated from verified system activity',
  },
}

export const THRIVE_CPD_REQUIREMENT_OUTPUT_PROPERTIES: Record<string, OutputProperty> = {
  audienceRequirementId: { type: 'string', description: 'Unique ID for this requirement record' },
  audienceId: { type: 'string', description: 'ID of the audience this requirement applies to' },
  requiredMinutes: { type: 'number', description: 'Number of minutes required for CPD completion' },
  createdAt: { type: 'string', description: 'Creation timestamp (ISO 8601)' },
  updatedAt: { type: 'string', description: 'Last-update timestamp (ISO 8601)', nullable: true },
}

export const THRIVE_CPD_USER_SUMMARY_OUTPUT_PROPERTIES: Record<string, OutputProperty> = {
  userId: { type: 'string', description: 'ID of the user this summary is for' },
  durationMinutes: {
    type: 'number',
    description: 'Total CPD minutes logged by the user in the period',
  },
}

export const THRIVE_TAG_OUTPUT_PROPERTIES: Record<string, OutputProperty> = {
  tag: { type: 'string', description: 'The name of the tag' },
  id: { type: 'string', description: 'The ID of the tag' },
  contents: {
    type: 'array',
    description: 'IDs of contents using this tag',
    items: { type: 'string' },
  },
  campaigns: {
    type: 'array',
    description: 'IDs of campaigns using this tag',
    items: { type: 'string' },
  },
  interests: {
    type: 'array',
    description: 'IDs of users interested in this tag',
    items: { type: 'string' },
  },
  skills: {
    type: 'array',
    description: 'IDs of users skilled in this tag',
    items: { type: 'string' },
  },
}

export const THRIVE_SKILL_LEVEL_OUTPUT_PROPERTIES: Record<string, OutputProperty> = {
  name: { type: 'string', description: 'The name of the skill level' },
  isEnabled: { type: 'boolean', description: 'Whether the skill level is enabled' },
  value: { type: 'number', description: 'The numeric value of the skill level' },
}

// ─── Users ───────────────────────────────────────────────────────────────────

export interface ThriveCreateUserParams extends ThriveBaseParams {
  ref: string
  firstName: string
  lastName: string
  email?: string
  loginMethod?: string
  role?: string
  jobTitle?: string
  managerRef?: string
  startDate?: string
  endDate?: string
  timeZone?: string
  languageCode?: string
  sso?: boolean
  domain?: string
  additionalFields?: string
}

export interface ThriveUpdateUserParams extends ThriveBaseParams {
  ref: string
  firstName?: string
  lastName?: string
  email?: string
  loginMethod?: string
  role?: string
  jobTitle?: string
  managerRef?: string
  startDate?: string
  endDate?: string
  timeZone?: string
  languageCode?: string
  sso?: boolean
  domain?: string
  additionalFields?: string
}

export interface ThriveDeleteUserParams extends ThriveBaseParams {
  ref: string
}

export interface ThriveSuspendUserParams extends ThriveBaseParams {
  ref: string
  endDate?: string
}

export interface ThriveSearchUsersParams extends ThriveBaseParams {
  page?: number
  perPage?: number
  updatedSince?: string
  statuses?: string
  omitStatuses?: string
  status?: string
}

export interface ThriveGetUserByIdParams extends ThriveBaseParams {
  id: string
}

export interface ThriveGetUserByRefParams extends ThriveBaseParams {
  ref: string
}

export interface ThriveUserResponse extends ToolResponse {
  output: { user: Record<string, any> }
}

export interface ThriveSearchUsersResponse extends ToolResponse {
  output: { results: Record<string, any>[]; pagination: ThrivePagination | null }
}

export interface ThriveDeleteResponse extends ToolResponse {
  output: { success: boolean }
}

// ─── Audiences ─────────────────────────────────────────────────────────────

export interface ThriveListAudiencesParams extends ThriveBaseParams {
  apiControlled?: boolean
  updatedSince?: string
  page?: number
  perPage?: number
  limit?: number
}

export interface ThriveCreateAudienceParams extends ThriveBaseParams {
  name?: string
  reference?: string
  parentId?: string
  category?: string
}

export interface ThriveGetAudienceParams extends ThriveBaseParams {
  audienceId: string
}

export interface ThriveUpdateAudienceParams extends ThriveBaseParams {
  audienceId: string
  name?: string
  reference?: string
  parentId?: string
}

export interface ThriveDeleteAudienceParams extends ThriveBaseParams {
  audienceId: string
}

export interface ThriveListAudienceMembersParams extends ThriveBaseParams {
  audienceId: string
  page?: number
  perPage?: number
  limit?: number
}

export interface ThriveAudienceUsersParams extends ThriveBaseParams {
  audienceId: string
  users: string
}

export interface ThriveRemoveAudienceMemberParams extends ThriveBaseParams {
  audienceId: string
  userRef: string
}

export interface ThriveListAudienceManagersParams extends ThriveBaseParams {
  audienceId: string
}

export interface ThriveAudienceManagersParams extends ThriveBaseParams {
  audienceId: string
  managers: string
}

export interface ThriveRemoveAudienceManagerParams extends ThriveBaseParams {
  audienceId: string
  userId: string
}

export interface ThriveAudienceResponse extends ToolResponse {
  output: { audience: Record<string, any> }
}

export interface ThriveListAudiencesResponse extends ToolResponse {
  output: { results: Record<string, any>[]; pagination: ThrivePagination | null }
}

export interface ThriveListAudienceMembersResponse extends ToolResponse {
  output: { results: Record<string, any>[]; pagination: ThrivePagination | null }
}

export interface ThriveListAudienceManagersResponse extends ToolResponse {
  output: { managers: Record<string, any>[] }
}

export interface ThriveAddUsersResponse extends ToolResponse {
  output: { result: { success: Record<string, any> | null; failure?: Record<string, any> } }
}

export interface ThriveMessageResponse extends ToolResponse {
  output: { status: number; message: string }
}

// ─── Assignments & Enrolments ──────────────────────────────────────────────

export interface ThriveListAssignmentsParams extends ThriveBaseParams {
  audienceId?: string
  updatedSince?: string
  page?: number
  perPage?: number
  limit?: number
}

export interface ThriveCreateAssignmentParams extends ThriveBaseParams {
  audienceId: string
  contentId: string
  alternativeContentIds?: string
  hideAlternativeContent?: boolean
  completionPeriod?: number
  recurrence?: number
}

export interface ThriveGetAssignmentParams extends ThriveBaseParams {
  assignmentId: string
}

export interface ThriveUpdateAssignmentParams extends ThriveBaseParams {
  assignmentId: string
  audienceId: string
  contentId?: string
  completionPeriod?: number
  recurrence?: number
  alternativeContentIds?: string
}

export interface ThriveDeleteAssignmentParams extends ThriveBaseParams {
  assignmentId: string
  audienceId: string
}

export interface ThriveListEnrolmentsParams extends ThriveBaseParams {
  assignmentId: string
  updatedAtFrom?: string
  updatedAtTo?: string
  status?: string
  page?: number
  perPage?: number
  limit?: number
}

export interface ThriveGetEnrolmentParams extends ThriveBaseParams {
  assignmentId: string
  enrolmentId: string
}

export interface ThriveAssignmentResponse extends ToolResponse {
  output: { assignment: Record<string, any> }
}

export interface ThriveListAssignmentsResponse extends ToolResponse {
  output: { assignments: Record<string, any>[] }
}

export interface ThriveEnrolmentResponse extends ToolResponse {
  output: { enrolment: Record<string, any> }
}

export interface ThriveListEnrolmentsResponse extends ToolResponse {
  output: { enrolments: Record<string, any>[] }
}

// ─── Completions ───────────────────────────────────────────────────────────

export interface ThriveListCompletionsParams extends ThriveBaseParams {
  contentId?: string
  isRPL?: boolean
  userId?: string
  completedDateRangeStart?: string
  completedDateRangeEnd?: string
  page?: number
  perPage?: number
  limit?: number
}

export interface ThriveGetCompletionParams extends ThriveBaseParams {
  id: string
}

export interface ThriveCreateCompletionParams extends ThriveBaseParams {
  userId: string
  contentId: string
  completedAt: string
}

export interface ThriveCompletionResponse extends ToolResponse {
  output: { completion: Record<string, any> }
}

export interface ThriveListCompletionsResponse extends ToolResponse {
  output: { completions: Record<string, any>[] }
}

export interface ThriveCreateCompletionResponse extends ToolResponse {
  output: { statementId: string | null }
}

// ─── Content ───────────────────────────────────────────────────────────────

export interface ThriveGetContentParams extends ThriveBaseParams {
  id: string
}

export interface ThriveQueryContentParams extends ThriveBaseParams {
  page?: number
  perPage?: number
  types?: string
  omitTypes?: string
  updatedSince?: string
}

export interface ThriveContentResponse extends ToolResponse {
  output: { content: Record<string, any> }
}

export interface ThriveQueryContentResponse extends ToolResponse {
  output: { results: Record<string, any>[]; pagination: ThrivePagination | null }
}

// ─── Activities ────────────────────────────────────────────────────────────

export interface ThriveGetActivityParams extends ThriveBaseParams {
  id: string
}

export interface ThriveQueryActivitiesParams extends ThriveBaseParams {
  page?: number
  perPage?: number
  actions?: string
  omitActions?: string
  contentIds?: string
  contentType?: string
  timestampFrom?: string
  timestampTo?: string
}

export interface ThriveActivityResponse extends ToolResponse {
  output: { activity: Record<string, any> }
}

export interface ThriveQueryActivitiesResponse extends ToolResponse {
  output: { results: Record<string, any>[]; pagination: ThrivePagination | null }
}

// ─── CPD ───────────────────────────────────────────────────────────────────

export interface ThriveGetCpdCategoryParams extends ThriveBaseParams {
  categoryId: string
}

export interface ThriveQueryCpdCategoriesParams extends ThriveBaseParams {
  page?: number
  perPage?: number
  updatedSince?: string
}

export interface ThriveGetCpdEntryParams extends ThriveBaseParams {
  logEntryId: string
}

export interface ThriveQueryCpdEntriesParams extends ThriveBaseParams {
  page?: number
  perPage?: number
  entryDateFrom?: string
  entryDateTo?: string
}

export interface ThriveGetCpdRequirementParams extends ThriveBaseParams {
  audienceRequirementId: string
}

export interface ThriveQueryCpdRequirementsParams extends ThriveBaseParams {
  page?: number
  perPage?: number
  updatedSince?: string
}

export interface ThriveQueryCpdUserSummariesParams extends ThriveBaseParams {
  entryDateFrom: string
  entryDateTo: string
  userIds?: string
  page?: number
  perPage?: number
}

export interface ThriveCpdCategoryResponse extends ToolResponse {
  output: { category: Record<string, any> }
}

export interface ThriveCpdEntryResponse extends ToolResponse {
  output: { entry: Record<string, any> }
}

export interface ThriveCpdRequirementResponse extends ToolResponse {
  output: { requirement: Record<string, any> }
}

export interface ThriveCpdPaginatedResponse extends ToolResponse {
  output: { results: Record<string, any>[]; pagination: ThrivePagination | null }
}

// ─── Tags & Skills ─────────────────────────────────────────────────────────

export interface ThriveListTagsParams extends ThriveBaseParams {
  page?: number
  perPage?: number
  updatedSince?: string
}

export interface ThriveGetTagParams extends ThriveBaseParams {
  tagId: string
}

export interface ThriveAddUserTagsParams extends ThriveBaseParams {
  userId: string
  tags: string
}

export interface ThriveRemoveUserTagsParams extends ThriveBaseParams {
  userId: string
  tags: string
}

export interface ThriveUpdateUserSkillsParams extends ThriveBaseParams {
  userId: string
  skills: string
}

export interface ThriveGetSkillLevelsParams extends ThriveBaseParams {}

export interface ThriveTagResponse extends ToolResponse {
  output: { tag: Record<string, any> }
}

export interface ThriveListTagsResponse extends ToolResponse {
  output: { results: Record<string, any>[]; pagination: ThrivePagination | null }
}

export interface ThriveSkillLevelsResponse extends ToolResponse {
  output: { levels: Record<string, any>[] }
}
