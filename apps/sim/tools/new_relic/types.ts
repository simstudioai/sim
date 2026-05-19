import type { ToolResponse } from '@/tools/types'

export type NewRelicRegion = 'us' | 'eu'

export interface NewRelicBaseParams {
  apiKey: string
  region?: NewRelicRegion
}

export interface NewRelicNrqlQueryParams extends NewRelicBaseParams {
  accountId: number
  nrql: string
  timeout?: number
}

export interface NewRelicNrqlQueryResponse extends ToolResponse {
  output: {
    results: Record<string, unknown>[]
    resultCount: number
  }
}

export interface NewRelicSearchEntitiesParams extends NewRelicBaseParams {
  query: string
  cursor?: string
}

export interface NewRelicEntity {
  guid: string | null
  name: string | null
  entityType: string | null
}

export interface NewRelicSearchEntitiesResponse extends ToolResponse {
  output: {
    count: number
    query: string
    entities: NewRelicEntity[]
    nextCursor: string | null
  }
}

export interface NewRelicGetEntityParams extends NewRelicBaseParams {
  guid: string
}

export interface NewRelicGetEntityResponse extends ToolResponse {
  output: {
    entity: NewRelicEntity | null
  }
}

export type NewRelicDeploymentType = 'basic' | 'blue green' | 'canary' | 'rolling' | 'shadow'

export type NewRelicCustomAttributes = Record<string, string | number | boolean>

export interface NewRelicCreateDeploymentEventParams extends NewRelicBaseParams {
  entityGuid: string
  version: string
  shortDescription?: string
  description?: string
  changelog?: string
  commit?: string
  deepLink?: string
  user?: string
  groupId?: string
  customAttributes?: NewRelicCustomAttributes
  deploymentType?: NewRelicDeploymentType
  timestamp?: number
}

export interface NewRelicChangeTrackingEvent {
  category: string | null
  categoryAndType: string | null
  changeTrackingId: string | null
  customAttributes?: Record<string, unknown> | null
  description: string | null
  groupId: string | null
  shortDescription: string | null
  timestamp: number | null
  type: string | null
  user: string | null
  entity: {
    guid: string | null
    name: string | null
  } | null
}

export interface NewRelicCreateDeploymentEventResponse extends ToolResponse {
  output: {
    event: NewRelicChangeTrackingEvent | null
    messages: string[]
  }
}

export type NewRelicResponse =
  | NewRelicNrqlQueryResponse
  | NewRelicSearchEntitiesResponse
  | NewRelicGetEntityResponse
  | NewRelicCreateDeploymentEventResponse
