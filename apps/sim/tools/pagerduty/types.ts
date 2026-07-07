import type { ToolResponse } from '@/tools/types'

/**
 * Base params shared by all PagerDuty endpoints.
 */
interface PagerDutyBaseParams {
  apiKey: string
}

/**
 * Params that require a From header for write operations.
 */
interface PagerDutyWriteParams extends PagerDutyBaseParams {
  fromEmail: string
}

/**
 * List Incidents params.
 */
export interface PagerDutyListIncidentsParams extends PagerDutyBaseParams {
  statuses?: string
  urgencies?: string
  serviceIds?: string
  since?: string
  until?: string
  sortBy?: string
  limit?: string
  offset?: string
}

export interface PagerDutyListIncidentsResponse extends ToolResponse {
  output: {
    incidents: Array<{
      id: string
      incidentNumber: number
      title: string
      status: string
      urgency: string
      createdAt: string
      updatedAt: string | null
      serviceName: string | null
      serviceId: string | null
      assigneeName: string | null
      assigneeId: string | null
      escalationPolicyName: string | null
      htmlUrl: string | null
    }>
    total: number | null
    more: boolean
    offset: number
  }
}

/**
 * Get Incident params.
 */
export interface PagerDutyGetIncidentParams extends PagerDutyBaseParams {
  incidentId: string
}

export interface PagerDutyGetIncidentResponse extends ToolResponse {
  output: {
    id: string
    incidentNumber: number
    title: string
    status: string
    urgency: string
    createdAt: string
    updatedAt: string | null
    resolvedAt: string | null
    serviceName: string | null
    serviceId: string | null
    assigneeName: string | null
    assigneeId: string | null
    escalationPolicyName: string | null
    escalationPolicyId: string | null
    incidentKey: string | null
    htmlUrl: string | null
  }
}

/**
 * Create Incident params.
 */
export interface PagerDutyCreateIncidentParams extends PagerDutyWriteParams {
  title: string
  serviceId: string
  urgency?: string
  body?: string
  escalationPolicyId?: string
  assigneeId?: string
  incidentKey?: string
}

export interface PagerDutyCreateIncidentResponse extends ToolResponse {
  output: {
    id: string
    incidentNumber: number
    title: string
    status: string
    urgency: string
    createdAt: string
    serviceName: string | null
    serviceId: string | null
    htmlUrl: string | null
  }
}

/**
 * Update Incident params.
 */
export interface PagerDutyUpdateIncidentParams extends PagerDutyWriteParams {
  incidentId: string
  status?: string
  title?: string
  urgency?: string
  escalationLevel?: string
  resolution?: string
}

export interface PagerDutyUpdateIncidentResponse extends ToolResponse {
  output: {
    id: string
    incidentNumber: number
    title: string
    status: string
    urgency: string
    updatedAt: string | null
    htmlUrl: string | null
  }
}

/**
 * Add Note to Incident params.
 */
export interface PagerDutyAddNoteParams extends PagerDutyWriteParams {
  incidentId: string
  content: string
}

export interface PagerDutyAddNoteResponse extends ToolResponse {
  output: {
    id: string
    content: string
    createdAt: string
    userName: string | null
  }
}

/**
 * List Services params.
 */
export interface PagerDutyListServicesParams extends PagerDutyBaseParams {
  query?: string
  limit?: string
  offset?: string
}

export interface PagerDutyListServicesResponse extends ToolResponse {
  output: {
    services: Array<{
      id: string
      name: string
      description: string | null
      status: string
      escalationPolicyName: string | null
      escalationPolicyId: string | null
      createdAt: string
      htmlUrl: string | null
    }>
    total: number | null
    more: boolean
    offset: number
  }
}

/**
 * Get Service params.
 */
export interface PagerDutyGetServiceParams extends PagerDutyBaseParams {
  serviceId: string
}

export interface PagerDutyGetServiceResponse extends ToolResponse {
  output: {
    id: string
    name: string
    description: string | null
    status: string
    autoResolveTimeout: number | null
    acknowledgementTimeout: number | null
    createdAt: string | null
    lastIncidentTimestamp: string | null
    escalationPolicyName: string | null
    escalationPolicyId: string | null
    htmlUrl: string | null
  }
}

/**
 * List On-Calls params.
 */
export interface PagerDutyListOncallsParams extends PagerDutyBaseParams {
  escalationPolicyIds?: string
  scheduleIds?: string
  since?: string
  until?: string
  limit?: string
  offset?: string
}

export interface PagerDutyListOncallsResponse extends ToolResponse {
  output: {
    oncalls: Array<{
      userName: string | null
      userId: string | null
      escalationLevel: number
      escalationPolicyName: string | null
      escalationPolicyId: string | null
      scheduleName: string | null
      scheduleId: string | null
      start: string | null
      end: string | null
    }>
    total: number | null
    more: boolean
    offset: number
  }
}

/**
 * List Escalation Policies params.
 */
export interface PagerDutyListEscalationPoliciesParams extends PagerDutyBaseParams {
  query?: string
  limit?: string
  offset?: string
}

export interface PagerDutyListEscalationPoliciesResponse extends ToolResponse {
  output: {
    escalationPolicies: Array<{
      id: string
      name: string
      description: string | null
      numLoops: number
      onCallHandoffNotifications: string | null
      htmlUrl: string | null
    }>
    total: number | null
    more: boolean
    offset: number
  }
}

/**
 * List Schedules params.
 */
export interface PagerDutyListSchedulesParams extends PagerDutyBaseParams {
  query?: string
  limit?: string
  offset?: string
}

export interface PagerDutyListSchedulesResponse extends ToolResponse {
  output: {
    schedules: Array<{
      id: string
      name: string
      description: string | null
      timeZone: string | null
      htmlUrl: string | null
    }>
    total: number | null
    more: boolean
    offset: number
  }
}

/**
 * List Users params.
 */
export interface PagerDutyListUsersParams extends PagerDutyBaseParams {
  query?: string
  limit?: string
  offset?: string
}

export interface PagerDutyListUsersResponse extends ToolResponse {
  output: {
    users: Array<{
      id: string
      name: string
      email: string
      role: string | null
      jobTitle: string | null
      timeZone: string | null
      htmlUrl: string | null
    }>
    total: number | null
    more: boolean
    offset: number
  }
}

/**
 * Snooze Incident params.
 */
export interface PagerDutySnoozeIncidentParams extends PagerDutyWriteParams {
  incidentId: string
  duration: string
}

export interface PagerDutySnoozeIncidentResponse extends ToolResponse {
  output: {
    id: string
    incidentNumber: number
    status: string
    htmlUrl: string | null
  }
}

/**
 * Merge Incidents params.
 */
export interface PagerDutyMergeIncidentsParams extends PagerDutyWriteParams {
  targetIncidentId: string
  sourceIncidentIds: string
}

export interface PagerDutyMergeIncidentsResponse extends ToolResponse {
  output: {
    id: string
    incidentNumber: number
    title: string
    status: string
    htmlUrl: string | null
  }
}

/**
 * List Incident Alerts params.
 */
export interface PagerDutyListIncidentAlertsParams extends PagerDutyBaseParams {
  incidentId: string
  statuses?: string
  limit?: string
  offset?: string
}

export interface PagerDutyListIncidentAlertsResponse extends ToolResponse {
  output: {
    alerts: Array<{
      id: string
      summary: string | null
      status: string
      severity: string | null
      createdAt: string
      alertKey: string | null
      serviceName: string | null
      serviceId: string | null
      htmlUrl: string | null
    }>
    total: number | null
    more: boolean
    offset: number
  }
}

/**
 * Send Event (Events API v2) params.
 */
export interface PagerDutySendEventParams {
  routingKey: string
  eventAction: string
  summary?: string
  source?: string
  severity?: string
  dedupKey?: string
  component?: string
  group?: string
  class?: string
}

export interface PagerDutySendEventResponse extends ToolResponse {
  output: {
    status: string
    message: string | null
    dedupKey: string | null
  }
}
