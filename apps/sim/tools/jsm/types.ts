import type { ToolResponse } from '@/tools/types'

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
}

/** Request Type representation */
export interface JsmRequestType {
  id: string
  name: string
  description: string
  helpText?: string
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
    startTime: { iso8601: string }
    stopTime: { iso8601: string }
    breached: boolean
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

export interface JsmGetServiceDesksParams extends JsmBaseParams {
  start?: number
  limit?: number
}

export interface JsmGetServiceDesksResponse extends ToolResponse {
  output: {
    ts: string
    serviceDesks: JsmServiceDesk[]
    total: number
    isLastPage: boolean
  }
}

export interface JsmGetRequestTypesParams extends JsmBaseParams {
  serviceDeskId: string
  start?: number
  limit?: number
}

export interface JsmGetRequestTypesResponse extends ToolResponse {
  output: {
    ts: string
    requestTypes: JsmRequestType[]
    total: number
    isLastPage: boolean
  }
}

export interface JsmCreateRequestParams extends JsmBaseParams {
  serviceDeskId: string
  requestTypeId: string
  summary: string
  description?: string
  requestFieldValues?: Record<string, unknown>
  raiseOnBehalfOf?: string
}

export interface JsmCreateRequestResponse extends ToolResponse {
  output: {
    ts: string
    issueId: string
    issueKey: string
    requestTypeId: string
    serviceDeskId: string
    success: boolean
    url: string
  }
}

export interface JsmGetRequestParams extends JsmBaseParams {
  issueIdOrKey: string
}

export interface JsmGetRequestResponse extends ToolResponse {
  output: {
    ts: string
    request: JsmRequest
  }
}

export interface JsmGetRequestsParams extends JsmBaseParams {
  serviceDeskId?: string
  requestOwnership?: 'OWNED_REQUESTS' | 'PARTICIPATED_REQUESTS' | 'ORGANIZATION' | 'ALL_REQUESTS'
  requestStatus?: 'OPEN' | 'CLOSED' | 'ALL'
  searchTerm?: string
  start?: number
  limit?: number
}

export interface JsmGetRequestsResponse extends ToolResponse {
  output: {
    ts: string
    requests: JsmRequest[]
    total: number
    isLastPage: boolean
  }
}

export interface JsmAddCommentParams extends JsmBaseParams {
  issueIdOrKey: string
  body: string
  isPublic: boolean
}

export interface JsmAddCommentResponse extends ToolResponse {
  output: {
    ts: string
    issueIdOrKey: string
    commentId: string
    body: string
    isPublic: boolean
    success: boolean
  }
}

export interface JsmGetCommentsParams extends JsmBaseParams {
  issueIdOrKey: string
  isPublic?: boolean
  internal?: boolean
  start?: number
  limit?: number
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

export interface JsmGetCustomersParams extends JsmBaseParams {
  serviceDeskId: string
  query?: string
  start?: number
  limit?: number
}

export interface JsmGetCustomersResponse extends ToolResponse {
  output: {
    ts: string
    customers: JsmCustomer[]
    total: number
    isLastPage: boolean
  }
}

export interface JsmAddCustomerParams extends JsmBaseParams {
  serviceDeskId: string
  emails: string
}

export interface JsmAddCustomerResponse extends ToolResponse {
  output: {
    ts: string
    serviceDeskId: string
    success: boolean
  }
}

export interface JsmGetOrganizationsParams extends JsmBaseParams {
  serviceDeskId: string
  start?: number
  limit?: number
}

export interface JsmGetOrganizationsResponse extends ToolResponse {
  output: {
    ts: string
    organizations: JsmOrganization[]
    total: number
    isLastPage: boolean
  }
}

export interface JsmGetQueuesParams extends JsmBaseParams {
  serviceDeskId: string
  includeCount?: boolean
  start?: number
  limit?: number
}

export interface JsmGetQueuesResponse extends ToolResponse {
  output: {
    ts: string
    queues: JsmQueue[]
    total: number
    isLastPage: boolean
  }
}

export interface JsmGetSlaParams extends JsmBaseParams {
  issueIdOrKey: string
  start?: number
  limit?: number
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

export interface JsmTransitionRequestParams extends JsmBaseParams {
  issueIdOrKey: string
  transitionId: string
  comment?: string
}

export interface JsmTransitionRequestResponse extends ToolResponse {
  output: {
    ts: string
    issueIdOrKey: string
    transitionId: string
    success: boolean
  }
}

export interface JsmGetTransitionsParams extends JsmBaseParams {
  issueIdOrKey: string
}

export interface JsmGetTransitionsResponse extends ToolResponse {
  output: {
    ts: string
    issueIdOrKey: string
    transitions: JsmTransition[]
  }
}

export interface JsmCreateOrganizationParams extends JsmBaseParams {
  name: string
}

export interface JsmCreateOrganizationResponse extends ToolResponse {
  output: {
    ts: string
    organizationId: string
    name: string
    success: boolean
  }
}

export interface JsmAddOrganizationParams extends JsmBaseParams {
  serviceDeskId: string
  organizationId: string
}

export interface JsmAddOrganizationResponse extends ToolResponse {
  output: {
    ts: string
    serviceDeskId: string
    organizationId: string
    success: boolean
  }
}

export interface JsmParticipant {
  accountId: string
  displayName: string
  emailAddress?: string
  active: boolean
}

export interface JsmGetParticipantsParams extends JsmBaseParams {
  issueIdOrKey: string
  start?: number
  limit?: number
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

export interface JsmAddParticipantsParams extends JsmBaseParams {
  issueIdOrKey: string
  accountIds: string
}

export interface JsmAddParticipantsResponse extends ToolResponse {
  output: {
    ts: string
    issueIdOrKey: string
    participants: JsmParticipant[]
    success: boolean
  }
}

export interface JsmApprover {
  accountId: string
  displayName: string
  emailAddress?: string
  approverDecision: 'pending' | 'approved' | 'declined'
}

export interface JsmApproval {
  id: string
  name: string
  finalDecision: 'pending' | 'approved' | 'declined'
  canAnswerApproval: boolean
  approvers: JsmApprover[]
  createdDate?: { iso8601: string; friendly: string }
  completedDate?: { iso8601: string; friendly: string }
}

export interface JsmGetApprovalsParams extends JsmBaseParams {
  issueIdOrKey: string
  start?: number
  limit?: number
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

export interface JsmAnswerApprovalParams extends JsmBaseParams {
  issueIdOrKey: string
  approvalId: string
  decision: 'approve' | 'decline'
}

export interface JsmAnswerApprovalResponse extends ToolResponse {
  output: {
    ts: string
    issueIdOrKey: string
    approvalId: string
    decision: string
    success: boolean
  }
}

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
  | JsmGetOrganizationsResponse
  | JsmGetQueuesResponse
  | JsmGetSlaResponse
  | JsmTransitionRequestResponse
  | JsmGetTransitionsResponse
  | JsmCreateOrganizationResponse
  | JsmAddOrganizationResponse
  | JsmGetParticipantsResponse
  | JsmAddParticipantsResponse
  | JsmGetApprovalsResponse
  | JsmAnswerApprovalResponse
