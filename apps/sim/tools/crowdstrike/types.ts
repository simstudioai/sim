import type { ToolResponse } from '@/tools/types'

export type CrowdStrikeCloud = 'us-1' | 'us-2' | 'eu-1' | 'us-gov-1' | 'us-gov-2'

export interface CrowdStrikeBaseParams {
  clientId: string
  clientSecret: string
  cloud: CrowdStrikeCloud
}

export interface CrowdStrikeQuerySensorsParams extends CrowdStrikeBaseParams {
  filter?: string
  limit?: number
  offset?: number
  sort?: string
}

export interface CrowdStrikeQueryCrowdScoreParams extends CrowdStrikeBaseParams {
  filter?: string
  limit?: number
  offset?: number
  sort?: string
}

export interface CrowdStrikeQueryIncidentsParams extends CrowdStrikeBaseParams {
  filter?: string
  limit?: number
  offset?: number
  sort?: string
}

export interface CrowdStrikeQueryBehaviorsParams extends CrowdStrikeBaseParams {
  filter?: string
  limit?: number
  offset?: number
  sort?: string
}

export interface CrowdStrikePagination {
  expiresAt: number | null
  limit: number | null
  offset: number | string | null
  total: number | null
}

export interface CrowdStrikeSensor {
  agentId: string | null
  hostname: string | null
  ipAddress: string | null
  macAddress: string | null
}

export interface CrowdStrikeCrowdScore {
  entityId: string | null
  entityType: string | null
  lastUpdated: string | null
  score: number | null
}

export interface CrowdStrikeIncident {
  createdTimestamp: string | null
  incidentId: string | null
  name: string | null
  severity: string | null
  status: string | null
}

export interface CrowdStrikeBehavior {
  behaviorId: string | null
  createdTimestamp: string | null
  incidentId: string | null
  name: string | null
}

export interface CrowdStrikeQuerySensorsResponse extends ToolResponse {
  output: {
    count: number
    pagination: CrowdStrikePagination | null
    sensors: CrowdStrikeSensor[]
  }
}

export interface CrowdStrikeQueryCrowdScoreResponse extends ToolResponse {
  output: {
    count: number
    crowdScores: CrowdStrikeCrowdScore[]
    pagination: CrowdStrikePagination | null
  }
}

export interface CrowdStrikeQueryIncidentsResponse extends ToolResponse {
  output: {
    count: number
    incidents: CrowdStrikeIncident[]
    pagination: CrowdStrikePagination | null
  }
}

export interface CrowdStrikeQueryBehaviorsResponse extends ToolResponse {
  output: {
    behaviors: CrowdStrikeBehavior[]
    count: number
    pagination: CrowdStrikePagination | null
  }
}

export type CrowdStrikeResponse =
  | CrowdStrikeQuerySensorsResponse
  | CrowdStrikeQueryCrowdScoreResponse
  | CrowdStrikeQueryIncidentsResponse
  | CrowdStrikeQueryBehaviorsResponse
