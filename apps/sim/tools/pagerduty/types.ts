import type { ToolResponse } from '@/tools/types'

/**
 * Base params shared by all PagerDuty endpoints.
 */
export interface PagerDutyBaseParams {
  apiKey: string
}

/**
 * Params that require a From header for write operations.
 */
export interface PagerDutyWriteParams extends PagerDutyBaseParams {
  fromEmail: string
}

/**
 * List Incidents params.
 */
export interface PagerDutyListIncidentsParams extends PagerDutyBaseParams {
  statuses?: string
  serviceIds?: string
  since?: string
  until?: string
  sortBy?: string
  limit?: string
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
    total: number
    more: boolean
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
    total: number
    more: boolean
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
    total: number
    more: boolean
  }
}
