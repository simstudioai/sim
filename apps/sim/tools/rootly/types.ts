import type { ToolResponse } from '@/tools/types'

/** Base parameters for all Rootly API operations */
export interface RootlyBaseParams {
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

export interface RootlyIncidentData {
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
  source: string
  description?: string
  status?: string
  serviceIds?: string
  groupIds?: string
  environmentIds?: string
  externalId?: string
  externalUrl?: string
  deduplicationKey?: string
}

export interface RootlyAlertData {
  id: string | null
  summary: string
  description: string | null
  source: string | null
  status: string | null
  externalId: string | null
  externalUrl: string | null
  deduplicationKey: string | null
  createdAt: string
  updatedAt: string
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

export interface RootlyServiceData {
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

export interface RootlySeverityData {
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

export interface RootlyRetrospectiveData {
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

export interface RootlyTeamData {
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

export interface RootlyEnvironmentData {
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

export interface RootlyIncidentTypeData {
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

/** List Functionalities */
export interface RootlyListFunctionalitiesParams extends RootlyBaseParams {
  search?: string
  pageSize?: number
  pageNumber?: number
}

export interface RootlyFunctionalityData {
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

/** Union of all responses */
export type RootlyResponse =
  | RootlyCreateIncidentResponse
  | RootlyGetIncidentResponse
  | RootlyUpdateIncidentResponse
  | RootlyListIncidentsResponse
  | RootlyCreateAlertResponse
  | RootlyListAlertsResponse
  | RootlyAddIncidentEventResponse
  | RootlyListServicesResponse
  | RootlyListSeveritiesResponse
  | RootlyListRetrospectivesResponse
  | RootlyListTeamsResponse
  | RootlyListEnvironmentsResponse
  | RootlyListIncidentTypesResponse
  | RootlyListFunctionalitiesResponse
