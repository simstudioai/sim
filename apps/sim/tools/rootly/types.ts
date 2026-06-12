import type { ToolResponse } from '@/tools/types'

/** Base parameters for all Rootly API operations */
interface RootlyBaseParams {
  apiKey: string
}

/** Create Incident */
export interface RootlyCreateIncidentParams extends RootlyBaseParams {
  title?: string
  summary?: string
  severityId?: string
  status?: string
  kind?: string
  serviceIds?: string
  environmentIds?: string
  groupIds?: string
  incidentTypeIds?: string
  functionalityIds?: string
  labels?: string
  private?: boolean
}

interface RootlyIncidentData {
  id: string | null
  sequentialId: number | null
  title: string
  slug: string | null
  kind: string | null
  summary: string | null
  status: string | null
  private: boolean
  url: string | null
  shortUrl: string | null
  severityName: string | null
  severityId: string | null
  createdAt: string
  updatedAt: string
  startedAt: string | null
  mitigatedAt: string | null
  resolvedAt: string | null
  closedAt: string | null
}

export interface RootlyCreateIncidentResponse extends ToolResponse {
  output: {
    incident: RootlyIncidentData
  }
}

/** Get Incident */
export interface RootlyGetIncidentParams extends RootlyBaseParams {
  incidentId: string
}

export interface RootlyGetIncidentResponse extends ToolResponse {
  output: {
    incident: RootlyIncidentData
  }
}

/** Update Incident */
export interface RootlyUpdateIncidentParams extends RootlyBaseParams {
  incidentId: string
  title?: string
  summary?: string
  severityId?: string
  status?: string
  kind?: string
  private?: boolean
  serviceIds?: string
  environmentIds?: string
  groupIds?: string
  incidentTypeIds?: string
  functionalityIds?: string
  labels?: string
  mitigationMessage?: string
  resolutionMessage?: string
  cancellationMessage?: string
}

export interface RootlyUpdateIncidentResponse extends ToolResponse {
  output: {
    incident: RootlyIncidentData
  }
}

/** List Incidents */
export interface RootlyListIncidentsParams extends RootlyBaseParams {
  status?: string
  severity?: string
  search?: string
  services?: string
  teams?: string
  environments?: string
  sort?: string
  pageSize?: number
  pageNumber?: number
}

export interface RootlyListIncidentsResponse extends ToolResponse {
  output: {
    incidents: RootlyIncidentData[]
    totalCount: number
  }
}

/** Create Alert */
export interface RootlyCreateAlertParams extends RootlyBaseParams {
  summary: string
  source?: string
  description?: string
  status?: string
  serviceIds?: string
  groupIds?: string
  environmentIds?: string
  externalId?: string
  externalUrl?: string
  deduplicationKey?: string
}

interface RootlyAlertData {
  id: string | null
  shortId: string | null
  summary: string
  description: string | null
  source: string | null
  status: string | null
  externalId: string | null
  externalUrl: string | null
  deduplicationKey: string | null
  createdAt: string
  updatedAt: string
  startedAt: string | null
  endedAt: string | null
}

export interface RootlyCreateAlertResponse extends ToolResponse {
  output: {
    alert: RootlyAlertData
  }
}

/** List Alerts */
export interface RootlyListAlertsParams extends RootlyBaseParams {
  status?: string
  source?: string
  services?: string
  environments?: string
  groups?: string
  pageSize?: number
  pageNumber?: number
}

export interface RootlyListAlertsResponse extends ToolResponse {
  output: {
    alerts: RootlyAlertData[]
    totalCount: number
  }
}

/** Add Incident Event */
export interface RootlyAddIncidentEventParams extends RootlyBaseParams {
  incidentId: string
  event: string
  visibility?: string
}

export interface RootlyAddIncidentEventResponse extends ToolResponse {
  output: {
    eventId: string
    event: string
    visibility: string | null
    occurredAt: string | null
    createdAt: string
    updatedAt: string
  }
}

/** List Services */
export interface RootlyListServicesParams extends RootlyBaseParams {
  search?: string
  pageSize?: number
  pageNumber?: number
}

interface RootlyServiceData {
  id: string | null
  name: string
  slug: string | null
  description: string | null
  color: string | null
  createdAt: string
  updatedAt: string
}

export interface RootlyListServicesResponse extends ToolResponse {
  output: {
    services: RootlyServiceData[]
    totalCount: number
  }
}

/** List Severities */
export interface RootlyListSeveritiesParams extends RootlyBaseParams {
  search?: string
  pageSize?: number
  pageNumber?: number
}

interface RootlySeverityData {
  id: string | null
  name: string
  slug: string | null
  description: string | null
  severity: string | null
  color: string | null
  position: number | null
  createdAt: string
  updatedAt: string
}

export interface RootlyListSeveritiesResponse extends ToolResponse {
  output: {
    severities: RootlySeverityData[]
    totalCount: number
  }
}

/** List Retrospectives */
export interface RootlyListRetrospectivesParams extends RootlyBaseParams {
  status?: string
  search?: string
  pageSize?: number
  pageNumber?: number
}

interface RootlyRetrospectiveData {
  id: string | null
  title: string
  status: string | null
  url: string | null
  startedAt: string | null
  mitigatedAt: string | null
  resolvedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface RootlyListRetrospectivesResponse extends ToolResponse {
  output: {
    retrospectives: RootlyRetrospectiveData[]
    totalCount: number
  }
}

/** List Teams */
export interface RootlyListTeamsParams extends RootlyBaseParams {
  search?: string
  pageSize?: number
  pageNumber?: number
}

interface RootlyTeamData {
  id: string | null
  name: string
  slug: string | null
  description: string | null
  color: string | null
  createdAt: string
  updatedAt: string
}

export interface RootlyListTeamsResponse extends ToolResponse {
  output: {
    teams: RootlyTeamData[]
    totalCount: number
  }
}

/** List Environments */
export interface RootlyListEnvironmentsParams extends RootlyBaseParams {
  search?: string
  pageSize?: number
  pageNumber?: number
}

interface RootlyEnvironmentData {
  id: string | null
  name: string
  slug: string | null
  description: string | null
  color: string | null
  createdAt: string
  updatedAt: string
}

export interface RootlyListEnvironmentsResponse extends ToolResponse {
  output: {
    environments: RootlyEnvironmentData[]
    totalCount: number
  }
}

/** List Incident Types */
export interface RootlyListIncidentTypesParams extends RootlyBaseParams {
  search?: string
  pageSize?: number
  pageNumber?: number
}

interface RootlyIncidentTypeData {
  id: string | null
  name: string
  slug: string | null
  description: string | null
  color: string | null
  createdAt: string
  updatedAt: string
}

export interface RootlyListIncidentTypesResponse extends ToolResponse {
  output: {
    incidentTypes: RootlyIncidentTypeData[]
    totalCount: number
  }
}

/** List Causes */
export interface RootlyListCausesParams extends RootlyBaseParams {
  search?: string
  pageSize?: number
  pageNumber?: number
}

interface RootlyCauseData {
  id: string | null
  name: string
  slug: string | null
  description: string | null
  position: number | null
  createdAt: string
  updatedAt: string
}

export interface RootlyListCausesResponse extends ToolResponse {
  output: {
    causes: RootlyCauseData[]
    totalCount: number
  }
}

/** List Playbooks */
export interface RootlyListPlaybooksParams extends RootlyBaseParams {
  pageSize?: number
  pageNumber?: number
}

interface RootlyPlaybookData {
  id: string | null
  title: string
  summary: string | null
  externalUrl: string | null
  createdAt: string
  updatedAt: string
}

export interface RootlyListPlaybooksResponse extends ToolResponse {
  output: {
    playbooks: RootlyPlaybookData[]
    totalCount: number
  }
}

/** Delete Incident */
export interface RootlyDeleteIncidentParams extends RootlyBaseParams {
  incidentId: string
}

export interface RootlyDeleteIncidentResponse extends ToolResponse {
  output: {
    success: boolean
    message: string
  }
}

/** Action Item Data */
interface RootlyActionItemData {
  id: string | null
  summary: string
  description: string | null
  kind: string | null
  priority: string | null
  status: string | null
  dueDate: string | null
  createdAt: string
  updatedAt: string
}

/** Create Action Item */
export interface RootlyCreateActionItemParams extends RootlyBaseParams {
  incidentId: string
  summary: string
  description?: string
  kind?: string
  priority?: string
  status?: string
  assignedToUserId?: string
  dueDate?: string
}

export interface RootlyCreateActionItemResponse extends ToolResponse {
  output: {
    actionItem: RootlyActionItemData
  }
}

/** List Action Items */
export interface RootlyListActionItemsParams extends RootlyBaseParams {
  incidentId: string
  pageSize?: number
  pageNumber?: number
}

export interface RootlyListActionItemsResponse extends ToolResponse {
  output: {
    actionItems: RootlyActionItemData[]
    totalCount: number
  }
}

/** List Functionalities */
export interface RootlyListFunctionalitiesParams extends RootlyBaseParams {
  search?: string
  pageSize?: number
  pageNumber?: number
}

interface RootlyFunctionalityData {
  id: string | null
  name: string
  slug: string | null
  description: string | null
  color: string | null
  createdAt: string
  updatedAt: string
}

export interface RootlyListFunctionalitiesResponse extends ToolResponse {
  output: {
    functionalities: RootlyFunctionalityData[]
    totalCount: number
  }
}

/** Get Alert */
export interface RootlyGetAlertParams extends RootlyBaseParams {
  alertId: string
}

export interface RootlyGetAlertResponse extends ToolResponse {
  output: {
    alert: RootlyAlertData
  }
}

/** Update Alert */
export interface RootlyUpdateAlertParams extends RootlyBaseParams {
  alertId: string
  summary?: string
  description?: string
  source?: string
  serviceIds?: string
  groupIds?: string
  environmentIds?: string
  externalId?: string
  externalUrl?: string
  deduplicationKey?: string
}

export interface RootlyUpdateAlertResponse extends ToolResponse {
  output: {
    alert: RootlyAlertData
  }
}

/** Acknowledge Alert */
export interface RootlyAcknowledgeAlertParams extends RootlyBaseParams {
  alertId: string
}

export interface RootlyAcknowledgeAlertResponse extends ToolResponse {
  output: {
    alert: RootlyAlertData
  }
}

/** Resolve Alert */
export interface RootlyResolveAlertParams extends RootlyBaseParams {
  alertId: string
  resolutionMessage?: string
  resolveRelatedIncidents?: boolean
}

export interface RootlyResolveAlertResponse extends ToolResponse {
  output: {
    alert: RootlyAlertData
  }
}

/** List Users */
export interface RootlyListUsersParams extends RootlyBaseParams {
  search?: string
  email?: string
  pageSize?: number
  pageNumber?: number
}

interface RootlyUserData {
  id: string | null
  email: string
  firstName: string | null
  lastName: string | null
  fullName: string | null
  timeZone: string | null
  createdAt: string
  updatedAt: string
}

export interface RootlyListUsersResponse extends ToolResponse {
  output: {
    users: RootlyUserData[]
    totalCount: number
  }
}

/** List On-Calls */
export interface RootlyListOnCallsParams extends RootlyBaseParams {
  scheduleIds?: string
  escalationPolicyIds?: string
  userIds?: string
  serviceIds?: string
}

interface RootlyOnCallData {
  id: string | null
  userId: string | null
  userName: string | null
  scheduleId: string | null
  scheduleName: string | null
  escalationPolicyId: string | null
  startTime: string | null
  endTime: string | null
}

export interface RootlyListOnCallsResponse extends ToolResponse {
  output: {
    onCalls: RootlyOnCallData[]
    totalCount: number
  }
}

/** List Schedules */
export interface RootlyListSchedulesParams extends RootlyBaseParams {
  search?: string
  pageSize?: number
  pageNumber?: number
}

interface RootlyScheduleData {
  id: string | null
  name: string
  description: string | null
  allTimeCoverage: boolean | null
  createdAt: string
  updatedAt: string
}

export interface RootlyListSchedulesResponse extends ToolResponse {
  output: {
    schedules: RootlyScheduleData[]
    totalCount: number
  }
}

/** List Escalation Policies */
export interface RootlyListEscalationPoliciesParams extends RootlyBaseParams {
  search?: string
  pageSize?: number
  pageNumber?: number
}

interface RootlyEscalationPolicyData {
  id: string | null
  name: string
  description: string | null
  repeatCount: number | null
  groupIds: string[] | null
  serviceIds: string[] | null
  createdAt: string
  updatedAt: string
}

export interface RootlyListEscalationPoliciesResponse extends ToolResponse {
  output: {
    escalationPolicies: RootlyEscalationPolicyData[]
    totalCount: number
  }
}

/** Shared incident-action response (returns the standard incident object) */
export interface RootlyIncidentActionResponse extends ToolResponse {
  output: {
    incident: RootlyIncidentData
  }
}

/** Shared alert-action response (returns the standard alert object) */
export interface RootlyAlertActionResponse extends ToolResponse {
  output: {
    alert: RootlyAlertData
  }
}

/** Mitigate Incident */
export interface RootlyMitigateIncidentParams extends RootlyBaseParams {
  incidentId: string
  mitigationMessage?: string
}

/** Resolve Incident */
export interface RootlyResolveIncidentParams extends RootlyBaseParams {
  incidentId: string
  resolutionMessage?: string
}

/** Assign Incident Role */
export interface RootlyAssignIncidentRoleParams extends RootlyBaseParams {
  incidentId: string
  userId: string
  incidentRoleId: string
}

/** Unassign Incident Role */
export interface RootlyUnassignIncidentRoleParams extends RootlyBaseParams {
  incidentId: string
  userId: string
  incidentRoleId: string
}

/** Add Subscribers */
export interface RootlyAddSubscribersParams extends RootlyBaseParams {
  incidentId: string
  userIds: string
}

/** Remove Subscribers */
export interface RootlyRemoveSubscribersParams extends RootlyBaseParams {
  incidentId: string
  userIds: string
}

/** Create Status Page Event */
export interface RootlyCreateStatusPageEventParams extends RootlyBaseParams {
  incidentId: string
  event: string
  statusPageId?: string
  status?: string
  notifySubscribers?: boolean
  shouldTweet?: boolean
}

interface RootlyStatusPageEventData {
  id: string | null
  event: string
  statusPageId: string | null
  status: string | null
  notifySubscribers: boolean | null
  shouldTweet: boolean | null
  startedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface RootlyCreateStatusPageEventResponse extends ToolResponse {
  output: {
    statusPageEvent: RootlyStatusPageEventData
  }
}

/** Update Action Item */
export interface RootlyUpdateActionItemParams extends RootlyBaseParams {
  actionItemId: string
  summary?: string
  description?: string
  kind?: string
  priority?: string
  status?: string
  assignedToUserId?: string
  dueDate?: string
}

export interface RootlyUpdateActionItemResponse extends ToolResponse {
  output: {
    actionItem: RootlyActionItemData
  }
}

/** Delete Action Item */
export interface RootlyDeleteActionItemParams extends RootlyBaseParams {
  actionItemId: string
}

export interface RootlyDeleteActionItemResponse extends ToolResponse {
  output: {
    success: boolean
    message: string
  }
}

/** Snooze Alert */
export interface RootlySnoozeAlertParams extends RootlyBaseParams {
  alertId: string
  delayMinutes: number
}

/** Escalate Alert */
export interface RootlyEscalateAlertParams extends RootlyBaseParams {
  alertId: string
  escalationPolicyId?: string
  escalationPolicyLevel?: number
}

/** List Incident Events */
export interface RootlyListIncidentEventsParams extends RootlyBaseParams {
  incidentId: string
  pageSize?: number
  pageNumber?: number
}

interface RootlyIncidentEventData {
  id: string | null
  event: string
  visibility: string | null
  occurredAt: string | null
  createdAt: string
  updatedAt: string
}

export interface RootlyListIncidentEventsResponse extends ToolResponse {
  output: {
    events: RootlyIncidentEventData[]
    totalCount: number
  }
}

/** Run Workflow */
export interface RootlyRunWorkflowParams extends RootlyBaseParams {
  workflowId: string
  incidentId?: string
  alertId?: string
  immediate?: boolean
  checkConditions?: boolean
}

interface RootlyWorkflowRunData {
  id: string | null
  workflowId: string | null
  status: string | null
  statusMessage: string | null
  triggeredBy: string | null
  incidentId: string | null
  alertId: string | null
  startedAt: string | null
  completedAt: string | null
  failedAt: string | null
  canceledAt: string | null
}

export interface RootlyRunWorkflowResponse extends ToolResponse {
  output: {
    workflowRun: RootlyWorkflowRunData
  }
}

/** List Incident Roles */
export interface RootlyListIncidentRolesParams extends RootlyBaseParams {
  search?: string
  pageSize?: number
  pageNumber?: number
}

interface RootlyIncidentRoleData {
  id: string | null
  name: string
  slug: string | null
  summary: string | null
  description: string | null
  position: number | null
  optional: boolean | null
  enabled: boolean | null
  createdAt: string
  updatedAt: string
}

export interface RootlyListIncidentRolesResponse extends ToolResponse {
  output: {
    incidentRoles: RootlyIncidentRoleData[]
    totalCount: number
  }
}

/** Union of all responses */
export type RootlyResponse =
  | RootlyCreateIncidentResponse
  | RootlyGetIncidentResponse
  | RootlyUpdateIncidentResponse
  | RootlyDeleteIncidentResponse
  | RootlyListIncidentsResponse
  | RootlyCreateAlertResponse
  | RootlyGetAlertResponse
  | RootlyUpdateAlertResponse
  | RootlyAcknowledgeAlertResponse
  | RootlyResolveAlertResponse
  | RootlyListAlertsResponse
  | RootlyAddIncidentEventResponse
  | RootlyCreateActionItemResponse
  | RootlyListActionItemsResponse
  | RootlyListServicesResponse
  | RootlyListSeveritiesResponse
  | RootlyListRetrospectivesResponse
  | RootlyListTeamsResponse
  | RootlyListEnvironmentsResponse
  | RootlyListIncidentTypesResponse
  | RootlyListFunctionalitiesResponse
  | RootlyListCausesResponse
  | RootlyListPlaybooksResponse
  | RootlyListUsersResponse
  | RootlyListOnCallsResponse
  | RootlyListSchedulesResponse
  | RootlyListEscalationPoliciesResponse
  | RootlyIncidentActionResponse
  | RootlyAlertActionResponse
  | RootlyCreateStatusPageEventResponse
  | RootlyUpdateActionItemResponse
  | RootlyDeleteActionItemResponse
  | RootlyListIncidentEventsResponse
  | RootlyRunWorkflowResponse
  | RootlyListIncidentRolesResponse
