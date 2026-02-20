import type { ToolResponse } from '@/tools/types'

// ---------------------------------------------------------------------------
// Shared output property constants for JSM tools (following Confluence pattern)
// ---------------------------------------------------------------------------

/** Reusable date output properties with ISO 8601, friendly, and epoch formats */
export const DATE_OUTPUT_PROPERTIES = {
  iso8601: { type: 'string', description: 'ISO 8601 formatted date' },
  friendly: { type: 'string', description: 'Human-readable date' },
  epochMillis: { type: 'number', description: 'Unix epoch milliseconds' },
} as const

/** Reusable user output properties */
export const USER_OUTPUT_PROPERTIES = {
  accountId: { type: 'string', description: 'Atlassian account ID' },
  displayName: { type: 'string', description: 'User display name' },
  emailAddress: { type: 'string', description: 'User email address', optional: true },
  active: { type: 'boolean', description: 'Whether the account is active' },
} as const

/** Output properties for a service desk item */
export const SERVICE_DESK_ITEM_PROPERTIES = {
  id: { type: 'string', description: 'Service desk ID' },
  projectId: { type: 'string', description: 'Associated Jira project ID' },
  projectName: { type: 'string', description: 'Associated project name' },
  projectKey: { type: 'string', description: 'Associated project key' },
  name: { type: 'string', description: 'Service desk name' },
  description: { type: 'string', description: 'Service desk description', optional: true },
  leadDisplayName: { type: 'string', description: 'Project lead display name', optional: true },
} as const

/** Output properties for a request type item */
export const REQUEST_TYPE_ITEM_PROPERTIES = {
  id: { type: 'string', description: 'Request type ID' },
  name: { type: 'string', description: 'Request type name' },
  description: { type: 'string', description: 'Request type description' },
  helpText: { type: 'string', description: 'Help text for customers', optional: true },
  issueTypeId: { type: 'string', description: 'Associated Jira issue type ID' },
  serviceDeskId: { type: 'string', description: 'Parent service desk ID' },
  groupIds: { type: 'json', description: 'Groups this request type belongs to' },
  icon: { type: 'json', description: 'Request type icon with id and links', optional: true },
  restrictionStatus: { type: 'string', description: 'OPEN or RESTRICTED', optional: true },
} as const

/** Output properties for a request field value */
export const REQUEST_FIELD_VALUE_PROPERTIES = {
  fieldId: { type: 'string', description: 'Field identifier' },
  label: { type: 'string', description: 'Human-readable field label' },
  value: { type: 'json', description: 'Field value' },
  renderedValue: { type: 'json', description: 'HTML-rendered field value', optional: true },
} as const

/** Output properties for a request status */
export const REQUEST_STATUS_PROPERTIES = {
  status: { type: 'string', description: 'Status name' },
  statusCategory: { type: 'string', description: 'Status category (NEW, INDETERMINATE, DONE)' },
  statusDate: {
    type: 'json',
    description: 'Status change date with iso8601, friendly, epochMillis',
  },
} as const

/** Output properties for a request (ticket) item */
export const REQUEST_ITEM_PROPERTIES = {
  issueId: { type: 'string', description: 'Jira issue ID' },
  issueKey: { type: 'string', description: 'Issue key (e.g., SD-123)' },
  requestTypeId: { type: 'string', description: 'Request type ID' },
  serviceDeskId: { type: 'string', description: 'Service desk ID' },
  createdDate: {
    type: 'json',
    description: 'Creation date with iso8601, friendly, epochMillis',
  },
  currentStatus: {
    type: 'object',
    description: 'Current request status',
    properties: REQUEST_STATUS_PROPERTIES,
  },
  reporter: {
    type: 'object',
    description: 'Reporter user details',
    properties: USER_OUTPUT_PROPERTIES,
  },
  requestFieldValues: {
    type: 'array',
    description: 'Request field values',
    items: {
      type: 'object',
      properties: REQUEST_FIELD_VALUE_PROPERTIES,
    },
  },
} as const

/** Output properties for a comment item */
export const COMMENT_ITEM_PROPERTIES = {
  id: { type: 'string', description: 'Comment ID' },
  body: { type: 'string', description: 'Comment body text' },
  public: { type: 'boolean', description: 'Whether the comment is public' },
  author: {
    type: 'object',
    description: 'Comment author',
    properties: USER_OUTPUT_PROPERTIES,
  },
  created: {
    type: 'json',
    description: 'Creation date with iso8601, friendly, epochMillis',
  },
  renderedBody: {
    type: 'json',
    description: 'HTML-rendered comment body (when expand=renderedBody)',
    optional: true,
  },
} as const

/** Output properties for a queue item */
export const QUEUE_ITEM_PROPERTIES = {
  id: { type: 'string', description: 'Queue ID' },
  name: { type: 'string', description: 'Queue name' },
  jql: { type: 'string', description: 'JQL filter for the queue' },
  fields: { type: 'json', description: 'Fields displayed in the queue' },
  issueCount: { type: 'number', description: 'Number of issues in the queue' },
} as const

/** Output properties for an SLA item */
export const SLA_ITEM_PROPERTIES = {
  id: { type: 'string', description: 'SLA metric ID' },
  name: { type: 'string', description: 'SLA metric name' },
  completedCycles: {
    type: 'json',
    description:
      'Completed SLA cycles with startTime, stopTime, breachTime, breached, goalDuration, elapsedTime, remainingTime (each time as DateDTO, durations as DurationDTO)',
  },
  ongoingCycle: {
    type: 'json',
    description:
      'Ongoing SLA cycle with startTime, breachTime, breached, paused, withinCalendarHours, goalDuration, elapsedTime, remainingTime',
    optional: true,
  },
} as const

/** Output properties for a transition item */
export const TRANSITION_ITEM_PROPERTIES = {
  id: { type: 'string', description: 'Transition ID' },
  name: { type: 'string', description: 'Transition name' },
} as const

/** Output properties for a participant item */
export const PARTICIPANT_ITEM_PROPERTIES = {
  accountId: { type: 'string', description: 'Atlassian account ID' },
  displayName: { type: 'string', description: 'Display name' },
  emailAddress: { type: 'string', description: 'Email address', optional: true },
  active: { type: 'boolean', description: 'Whether the account is active' },
} as const

/** Output properties for an organization item */
export const ORGANIZATION_ITEM_PROPERTIES = {
  id: { type: 'string', description: 'Organization ID' },
  name: { type: 'string', description: 'Organization name' },
} as const

/** Output properties for a customer item */
export const CUSTOMER_ITEM_PROPERTIES = {
  accountId: { type: 'string', description: 'Atlassian account ID' },
  displayName: { type: 'string', description: 'Display name' },
  emailAddress: { type: 'string', description: 'Email address' },
  active: { type: 'boolean', description: 'Whether the account is active' },
  timeZone: { type: 'string', description: 'User timezone', optional: true },
} as const

/** Output properties for an approver item */
export const APPROVER_ITEM_PROPERTIES = {
  approver: {
    type: 'object',
    description: 'Approver user details',
    properties: USER_OUTPUT_PROPERTIES,
  },
  approverDecision: { type: 'string', description: 'Decision: pending, approved, or declined' },
} as const

/** Output properties for an approval item */
export const APPROVAL_ITEM_PROPERTIES = {
  id: { type: 'string', description: 'Approval ID' },
  name: { type: 'string', description: 'Approval description' },
  finalDecision: { type: 'string', description: 'Final decision: pending, approved, or declined' },
  canAnswerApproval: { type: 'boolean', description: 'Whether current user can respond' },
  approvers: {
    type: 'array',
    description: 'List of approvers with their decisions',
    items: {
      type: 'object',
      properties: APPROVER_ITEM_PROPERTIES,
    },
  },
  createdDate: {
    type: 'json',
    description: 'Creation date',
    optional: true,
  },
  completedDate: {
    type: 'json',
    description: 'Completion date',
    optional: true,
  },
} as const

/** Output properties for a request type field */
export const REQUEST_TYPE_FIELD_PROPERTIES = {
  fieldId: {
    type: 'string',
    description: 'Field identifier (e.g., summary, description, customfield_10010)',
  },
  name: { type: 'string', description: 'Human-readable field name' },
  description: { type: 'string', description: 'Help text for the field', optional: true },
  required: { type: 'boolean', description: 'Whether the field is required' },
  visible: { type: 'boolean', description: 'Whether the field is visible' },
  validValues: { type: 'json', description: 'Allowed values for select fields' },
  presetValues: { type: 'json', description: 'Pre-populated values', optional: true },
  defaultValues: { type: 'json', description: 'Default values for the field', optional: true },
  jiraSchema: {
    type: 'json',
    description: 'Jira field schema with type, system, custom, customId',
  },
} as const

/** Output properties for a knowledge base article */
export const KNOWLEDGE_BASE_ARTICLE_PROPERTIES = {
  title: { type: 'string', description: 'Article title' },
  excerpt: { type: 'string', description: 'Article excerpt/summary' },
  sourceType: { type: 'string', description: 'Source type (e.g., confluence)' },
  sourcePageId: { type: 'string', description: 'Source page ID', optional: true },
  sourceSpaceKey: { type: 'string', description: 'Source space key', optional: true },
  contentUrl: { type: 'string', description: 'URL to rendered content', optional: true },
} as const

/** Output properties for a request status history entry */
export const REQUEST_STATUS_HISTORY_PROPERTIES = {
  status: { type: 'string', description: 'Status name' },
  statusCategory: { type: 'string', description: 'Status category (NEW, INDETERMINATE, DONE)' },
  statusDate: {
    type: 'json',
    description: 'Status change date with iso8601, friendly, epochMillis',
  },
} as const

/** Output properties for CSAT feedback */
export const FEEDBACK_PROPERTIES = {
  rating: { type: 'number', description: 'CSAT rating (1-5)' },
  comment: { type: 'string', description: 'Feedback comment', optional: true },
  type: { type: 'string', description: 'Feedback type (e.g., csat)' },
} as const

// ---------------------------------------------------------------------------
// Data model interfaces
// ---------------------------------------------------------------------------

/** Common parameters for all JSM API calls */
export interface JsmBaseParams {
  accessToken: string
  domain: string
  cloudId?: string
}

/** Service Desk representation */
export interface JsmServiceDesk {
  id: string
  projectId: string
  projectName: string
  projectKey: string
  name: string
  description?: string
  leadDisplayName?: string
}

/** Request Type representation */
export interface JsmRequestType {
  id: string
  name: string
  description: string
  helpText?: string
  issueTypeId?: string
  serviceDeskId: string
  groupIds: string[]
  icon: {
    id: string
    name: string
  }
}

/** Customer representation */
export interface JsmCustomer {
  accountId: string
  name: string
  key: string
  emailAddress: string
  displayName: string
  active: boolean
  timeZone: string
}

/** Organization representation */
export interface JsmOrganization {
  id: string
  name: string
}

/** Queue representation */
export interface JsmQueue {
  id: string
  name: string
  jql: string
  fields: string[]
  issueCount: number
}

/** SLA representation */
export interface JsmSla {
  id: string
  name: string
  completedCycles: Array<{
    startTime: { iso8601: string; friendly: string; epochMillis: number }
    stopTime: { iso8601: string; friendly: string; epochMillis: number }
    breachTime?: { iso8601: string; friendly: string; epochMillis: number }
    breached: boolean
    goalDuration?: { millis: number; friendly: string }
    elapsedTime?: { millis: number; friendly: string }
    remainingTime?: { millis: number; friendly: string }
  }>
  ongoingCycle?: {
    startTime: { iso8601: string }
    breachTime?: { iso8601: string }
    breached: boolean
    paused: boolean
    withinCalendarHours: boolean
    goalDuration?: { millis: number; friendly: string }
    elapsedTime?: { millis: number; friendly: string }
    remainingTime?: { millis: number; friendly: string }
  }
}

/** Request (ticket) representation */
export interface JsmRequest {
  issueId: string
  issueKey: string
  requestTypeId: string
  serviceDeskId: string
  createdDate: { iso8601: string; friendly: string }
  reporter: JsmCustomer
  requestFieldValues: Array<{
    fieldId: string
    label: string
    value: unknown
  }>
  currentStatus: {
    status: string
    statusCategory: string
    statusDate: { iso8601: string; friendly: string }
  }
}

/** Comment representation */
export interface JsmComment {
  id: string
  body: string
  public: boolean
  author: {
    accountId: string
    displayName: string
    emailAddress?: string
  }
  created: { iso8601: string; friendly: string }
}

/** Transition representation */
export interface JsmTransition {
  id: string
  name: string
}

/** Participant representation */
export interface JsmParticipant {
  accountId: string
  displayName: string
  emailAddress?: string
  active: boolean
}

/** Approver representation */
export interface JsmApprover {
  accountId: string
  displayName: string
  emailAddress?: string
  approverDecision: 'pending' | 'approved' | 'declined'
}

/** Approval representation */
export interface JsmApproval {
  id: string
  name: string
  finalDecision: 'pending' | 'approved' | 'declined'
  canAnswerApproval: boolean
  approvers: JsmApprover[]
  createdDate?: { iso8601: string; friendly: string }
  completedDate?: { iso8601: string; friendly: string }
}

/** Request type field representation */
export interface JsmRequestTypeField {
  fieldId: string
  name: string
  description?: string
  required: boolean
  visible?: boolean
  validValues: Array<{ value: string; label: string; children?: unknown[] }>
  presetValues?: unknown[]
  defaultValues?: unknown[]
  jiraSchema: { type: string; system?: string; custom?: string; customId?: number }
}

/** Knowledge base article representation */
export interface JsmKnowledgeBaseArticle {
  title: string
  excerpt: string
  sourceType: string
  sourcePageId?: string
  sourceSpaceKey?: string
  contentUrl?: string
}

/** Request status history entry */
export interface JsmRequestStatusHistory {
  status: string
  statusCategory: string
  statusDate: { iso8601: string; friendly: string; epochMillis: number }
}

/** CSAT feedback representation */
export interface JsmFeedback {
  rating: number
  comment?: string
  type: string
}

// ---------------------------------------------------------------------------
// Params interfaces
// ---------------------------------------------------------------------------

export interface JsmGetServiceDesksParams extends JsmBaseParams {
  expand?: string
  start?: number
  limit?: number
}

export interface JsmGetRequestTypesParams extends JsmBaseParams {
  serviceDeskId: string
  searchQuery?: string
  groupId?: string
  expand?: string
  start?: number
  limit?: number
}

export interface JsmCreateRequestParams extends JsmBaseParams {
  serviceDeskId: string
  requestTypeId: string
  summary: string
  description?: string
  requestFieldValues?: Record<string, unknown>
  raiseOnBehalfOf?: string
  requestParticipants?: string[]
  channel?: string
}

export interface JsmGetRequestParams extends JsmBaseParams {
  issueIdOrKey: string
  expand?: string
}

export interface JsmGetRequestsParams extends JsmBaseParams {
  serviceDeskId?: string
  requestOwnership?: 'OWNED_REQUESTS' | 'PARTICIPATED_REQUESTS' | 'APPROVER' | 'ALL_REQUESTS'
  requestStatus?: 'OPEN_REQUESTS' | 'CLOSED_REQUESTS' | 'ALL_REQUESTS'
  requestTypeId?: string
  searchTerm?: string
  expand?: string
  start?: number
  limit?: number
}

export interface JsmAddCommentParams extends JsmBaseParams {
  issueIdOrKey: string
  body: string
  isPublic: boolean
}

export interface JsmGetCommentsParams extends JsmBaseParams {
  issueIdOrKey: string
  isPublic?: boolean
  internal?: boolean
  expand?: string
  start?: number
  limit?: number
}

export interface JsmGetCustomersParams extends JsmBaseParams {
  serviceDeskId: string
  query?: string
  start?: number
  limit?: number
}

export interface JsmAddCustomerParams extends JsmBaseParams {
  serviceDeskId: string
  accountIds?: string
  emails?: string
}

export interface JsmGetOrganizationsParams extends JsmBaseParams {
  serviceDeskId: string
  start?: number
  limit?: number
}

export interface JsmGetQueuesParams extends JsmBaseParams {
  serviceDeskId: string
  includeCount?: boolean
  start?: number
  limit?: number
}

export interface JsmGetSlaParams extends JsmBaseParams {
  issueIdOrKey: string
  start?: number
  limit?: number
}

export interface JsmTransitionRequestParams extends JsmBaseParams {
  issueIdOrKey: string
  transitionId: string
  comment?: string
}

export interface JsmGetTransitionsParams extends JsmBaseParams {
  issueIdOrKey: string
  start?: number
  limit?: number
}

export interface JsmCreateOrganizationParams extends JsmBaseParams {
  name: string
}

export interface JsmAddOrganizationParams extends JsmBaseParams {
  serviceDeskId: string
  organizationId: string
}

export interface JsmGetParticipantsParams extends JsmBaseParams {
  issueIdOrKey: string
  start?: number
  limit?: number
}

export interface JsmAddParticipantsParams extends JsmBaseParams {
  issueIdOrKey: string
  accountIds: string
}

export interface JsmGetApprovalsParams extends JsmBaseParams {
  issueIdOrKey: string
  start?: number
  limit?: number
}

export interface JsmAnswerApprovalParams extends JsmBaseParams {
  issueIdOrKey: string
  approvalId: string
  decision: 'approve' | 'decline'
}

export interface JsmGetRequestTypeFieldsParams extends JsmBaseParams {
  serviceDeskId: string
  requestTypeId: string
}

export interface JsmRemoveCustomerParams extends JsmBaseParams {
  serviceDeskId: string
  accountIds?: string
  emails?: string
}

export interface JsmRemoveOrganizationParams extends JsmBaseParams {
  serviceDeskId: string
  organizationId: string
}

export interface JsmRemoveParticipantsParams extends JsmBaseParams {
  issueIdOrKey: string
  accountIds: string
}

export interface JsmGetQueueIssuesParams extends JsmBaseParams {
  serviceDeskId: string
  queueId: string
  start?: number
  limit?: number
}

export interface JsmCreateCustomerParams extends JsmBaseParams {
  email: string
  displayName: string
}

export interface JsmDeleteOrganizationParams extends JsmBaseParams {
  organizationId: string
}

export interface JsmGetOrganizationParams extends JsmBaseParams {
  organizationId: string
}

export interface JsmGetOrganizationUsersParams extends JsmBaseParams {
  organizationId: string
  start?: number
  limit?: number
}

export interface JsmAddOrganizationUsersParams extends JsmBaseParams {
  organizationId: string
  accountIds: string
}

export interface JsmRemoveOrganizationUsersParams extends JsmBaseParams {
  organizationId: string
  accountIds: string
}

export interface JsmSearchKnowledgeBaseParams extends JsmBaseParams {
  serviceDeskId?: string
  query: string
  highlight?: boolean
  start?: number
  limit?: number
}

export interface JsmGetRequestStatusParams extends JsmBaseParams {
  issueIdOrKey: string
  start?: number
  limit?: number
}

export interface JsmGetFeedbackParams extends JsmBaseParams {
  issueIdOrKey: string
}

export interface JsmAddFeedbackParams extends JsmBaseParams {
  issueIdOrKey: string
  rating: number
  comment?: string
}

// ---------------------------------------------------------------------------
// Response interfaces
// ---------------------------------------------------------------------------

export interface JsmGetServiceDesksResponse extends ToolResponse {
  output: {
    ts: string
    serviceDesks: JsmServiceDesk[]
    total: number
    isLastPage: boolean
  }
}

export interface JsmGetRequestTypesResponse extends ToolResponse {
  output: {
    ts: string
    requestTypes: JsmRequestType[]
    total: number
    isLastPage: boolean
  }
}

export interface JsmCreateRequestResponse extends ToolResponse {
  output: {
    ts: string
    issueId: string
    issueKey: string
    requestTypeId: string
    serviceDeskId: string
    createdDate: { iso8601: string; friendly: string; epochMillis: number } | null
    currentStatus: {
      status: string
      statusCategory: string
      statusDate?: { iso8601: string; friendly: string }
    } | null
    reporter: { accountId: string; displayName: string; emailAddress?: string } | null
    success: boolean
    url: string
  }
}

export interface JsmGetRequestResponse extends ToolResponse {
  output: {
    ts: string
    issueId: string
    issueKey: string
    requestTypeId: string
    serviceDeskId: string
    createdDate: { iso8601: string; friendly: string; epochMillis: number } | null
    currentStatus: {
      status: string
      statusCategory: string
      statusDate: { iso8601: string; friendly: string }
    } | null
    reporter: {
      accountId: string
      displayName: string
      emailAddress?: string
      active: boolean
    } | null
    requestFieldValues: Array<{ fieldId: string; label: string; value: unknown }>
    url: string
    request?: Record<string, unknown>
  }
}

export interface JsmGetRequestsResponse extends ToolResponse {
  output: {
    ts: string
    requests: JsmRequest[]
    total: number
    isLastPage: boolean
  }
}

export interface JsmAddCommentResponse extends ToolResponse {
  output: {
    ts: string
    issueIdOrKey: string
    commentId: string
    body: string
    isPublic: boolean
    author: { accountId: string; displayName: string; emailAddress?: string } | null
    createdDate: { iso8601: string; friendly: string } | null
    success: boolean
  }
}

export interface JsmGetCommentsResponse extends ToolResponse {
  output: {
    ts: string
    issueIdOrKey: string
    comments: JsmComment[]
    total: number
    isLastPage: boolean
  }
}

export interface JsmGetCustomersResponse extends ToolResponse {
  output: {
    ts: string
    customers: JsmCustomer[]
    total: number
    isLastPage: boolean
  }
}

export interface JsmAddCustomerResponse extends ToolResponse {
  output: {
    ts: string
    serviceDeskId: string
    success: boolean
  }
}

export interface JsmGetOrganizationsResponse extends ToolResponse {
  output: {
    ts: string
    organizations: JsmOrganization[]
    total: number
    isLastPage: boolean
  }
}

export interface JsmGetQueuesResponse extends ToolResponse {
  output: {
    ts: string
    queues: JsmQueue[]
    total: number
    isLastPage: boolean
  }
}

export interface JsmGetSlaResponse extends ToolResponse {
  output: {
    ts: string
    issueIdOrKey: string
    slas: JsmSla[]
    total: number
    isLastPage: boolean
  }
}

export interface JsmTransitionRequestResponse extends ToolResponse {
  output: {
    ts: string
    issueIdOrKey: string
    transitionId: string
    success: boolean
  }
}

export interface JsmGetTransitionsResponse extends ToolResponse {
  output: {
    ts: string
    issueIdOrKey: string
    transitions: JsmTransition[]
    total: number
    isLastPage: boolean
  }
}

export interface JsmCreateOrganizationResponse extends ToolResponse {
  output: {
    ts: string
    organizationId: string
    name: string
    success: boolean
  }
}

export interface JsmAddOrganizationResponse extends ToolResponse {
  output: {
    ts: string
    serviceDeskId: string
    organizationId: string
    success: boolean
  }
}

export interface JsmGetParticipantsResponse extends ToolResponse {
  output: {
    ts: string
    issueIdOrKey: string
    participants: JsmParticipant[]
    total: number
    isLastPage: boolean
  }
}

export interface JsmAddParticipantsResponse extends ToolResponse {
  output: {
    ts: string
    issueIdOrKey: string
    participants: JsmParticipant[]
    success: boolean
  }
}

export interface JsmGetApprovalsResponse extends ToolResponse {
  output: {
    ts: string
    issueIdOrKey: string
    approvals: JsmApproval[]
    total: number
    isLastPage: boolean
  }
}

export interface JsmAnswerApprovalResponse extends ToolResponse {
  output: {
    ts: string
    issueIdOrKey: string
    approvalId: string
    decision: string
    id: string | null
    name: string | null
    finalDecision: string | null
    canAnswerApproval: boolean | null
    approvers: Array<{
      approver: {
        accountId: string
        displayName: string
        emailAddress?: string
        active?: boolean
      }
      approverDecision: string
    }> | null
    createdDate: { iso8601: string; friendly: string; epochMillis: number } | null
    completedDate: { iso8601: string; friendly: string; epochMillis: number } | null
    approval?: Record<string, unknown>
    success: boolean
  }
}

export interface JsmGetRequestTypeFieldsResponse extends ToolResponse {
  output: {
    ts: string
    serviceDeskId: string
    requestTypeId: string
    canAddRequestParticipants: boolean
    canRaiseOnBehalfOf: boolean
    requestTypeFields: JsmRequestTypeField[]
  }
}

export interface JsmRemoveCustomerResponse extends ToolResponse {
  output: {
    ts: string
    serviceDeskId: string
    success: boolean
  }
}

export interface JsmRemoveOrganizationResponse extends ToolResponse {
  output: {
    ts: string
    serviceDeskId: string
    organizationId: string
    success: boolean
  }
}

export interface JsmRemoveParticipantsResponse extends ToolResponse {
  output: {
    ts: string
    issueIdOrKey: string
    participants: JsmParticipant[]
    success: boolean
  }
}

export interface JsmGetQueueIssuesResponse extends ToolResponse {
  output: {
    ts: string
    serviceDeskId: string
    queueId: string
    issues: JsmRequest[]
    total: number
    isLastPage: boolean
  }
}

export interface JsmCreateCustomerResponse extends ToolResponse {
  output: {
    ts: string
    accountId: string
    displayName: string
    emailAddress: string
    active: boolean
    timeZone: string | null
    success: boolean
  }
}

export interface JsmDeleteOrganizationResponse extends ToolResponse {
  output: {
    ts: string
    organizationId: string
    success: boolean
  }
}

export interface JsmGetOrganizationResponse extends ToolResponse {
  output: {
    ts: string
    id: string
    name: string
  }
}

export interface JsmGetOrganizationUsersResponse extends ToolResponse {
  output: {
    ts: string
    organizationId: string
    users: JsmCustomer[]
    total: number
    isLastPage: boolean
  }
}

export interface JsmAddOrganizationUsersResponse extends ToolResponse {
  output: {
    ts: string
    organizationId: string
    success: boolean
  }
}

export interface JsmRemoveOrganizationUsersResponse extends ToolResponse {
  output: {
    ts: string
    organizationId: string
    success: boolean
  }
}

export interface JsmSearchKnowledgeBaseResponse extends ToolResponse {
  output: {
    ts: string
    articles: JsmKnowledgeBaseArticle[]
    total: number
    isLastPage: boolean
  }
}

export interface JsmGetRequestStatusResponse extends ToolResponse {
  output: {
    ts: string
    issueIdOrKey: string
    statuses: JsmRequestStatusHistory[]
    total: number
    isLastPage: boolean
  }
}

export interface JsmGetFeedbackResponse extends ToolResponse {
  output: {
    ts: string
    issueIdOrKey: string
    rating: number | null
    comment: string | null
    type: string | null
  }
}

export interface JsmAddFeedbackResponse extends ToolResponse {
  output: {
    ts: string
    issueIdOrKey: string
    rating: number
    comment: string | null
    type: string
    success: boolean
  }
}

// ---------------------------------------------------------------------------
// Union type for all JSM responses
// ---------------------------------------------------------------------------

/** Union type for all JSM responses */
export type JsmResponse =
  | JsmGetServiceDesksResponse
  | JsmGetRequestTypesResponse
  | JsmCreateRequestResponse
  | JsmGetRequestResponse
  | JsmGetRequestsResponse
  | JsmAddCommentResponse
  | JsmGetCommentsResponse
  | JsmGetCustomersResponse
  | JsmAddCustomerResponse
  | JsmRemoveCustomerResponse
  | JsmGetOrganizationsResponse
  | JsmCreateOrganizationResponse
  | JsmAddOrganizationResponse
  | JsmRemoveOrganizationResponse
  | JsmDeleteOrganizationResponse
  | JsmGetOrganizationResponse
  | JsmGetOrganizationUsersResponse
  | JsmAddOrganizationUsersResponse
  | JsmRemoveOrganizationUsersResponse
  | JsmGetQueuesResponse
  | JsmGetQueueIssuesResponse
  | JsmGetSlaResponse
  | JsmTransitionRequestResponse
  | JsmGetTransitionsResponse
  | JsmGetParticipantsResponse
  | JsmAddParticipantsResponse
  | JsmRemoveParticipantsResponse
  | JsmGetApprovalsResponse
  | JsmAnswerApprovalResponse
  | JsmGetRequestTypeFieldsResponse
  | JsmCreateCustomerResponse
  | JsmSearchKnowledgeBaseResponse
  | JsmGetRequestStatusResponse
  | JsmGetFeedbackResponse
  | JsmAddFeedbackResponse
