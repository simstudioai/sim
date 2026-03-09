import type { ToolResponse } from '@/tools/types'

export interface Neo4jConnectionConfig {
  host: string
  port: number
  database: string
  username: string
  password: string
  encryption?: 'enabled' | 'disabled'
}

export interface Neo4jQueryParams extends Neo4jConnectionConfig {
  cypherQuery: string
  parameters?: Record<string, unknown>
}

export interface Neo4jCreateParams extends Neo4jConnectionConfig {
  cypherQuery: string
  parameters?: Record<string, unknown>
}

export interface Neo4jMergeParams extends Neo4jConnectionConfig {
  cypherQuery: string
  parameters?: Record<string, unknown>
}

export interface Neo4jUpdateParams extends Neo4jConnectionConfig {
  cypherQuery: string
  parameters?: Record<string, unknown>
}

export interface Neo4jDeleteParams extends Neo4jConnectionConfig {
  cypherQuery: string
  parameters?: Record<string, unknown>
  detach?: boolean
}

export interface Neo4jExecuteParams extends Neo4jConnectionConfig {
  cypherQuery: string
  parameters?: Record<string, unknown>
}

export interface Neo4jBaseResponse extends ToolResponse {
  output: {
    message: string
    records?: unknown[]
    recordCount?: number
    summary?: {
      resultAvailableAfter: number
      resultConsumedAfter: number
      counters?: {
        nodesCreated: number
        nodesDeleted: number
        relationshipsCreated: number
        relationshipsDeleted: number
        propertiesSet: number
        labelsAdded: number
        labelsRemoved: number
        indexesAdded: number
        indexesRemoved: number
        constraintsAdded: number
        constraintsRemoved: number
      }
    }
  }
  error?: string
}

export interface Neo4jQueryResponse extends Neo4jBaseResponse {}
export interface Neo4jCreateResponse extends Neo4jBaseResponse {}
export interface Neo4jMergeResponse extends Neo4jBaseResponse {}
export interface Neo4jUpdateResponse extends Neo4jBaseResponse {}
export interface Neo4jDeleteResponse extends Neo4jBaseResponse {}
export interface Neo4jExecuteResponse extends Neo4jBaseResponse {}
export interface Neo4jResponse extends Neo4jBaseResponse {}

export interface Neo4jIntrospectParams extends Neo4jConnectionConfig {}

export interface Neo4jNodeSchema {
  label: string
  properties: Array<{ name: string; types: string[] }>
}

export interface Neo4jRelationshipSchema {
  type: string
  properties: Array<{ name: string; types: string[] }>
}

export interface Neo4jIntrospectResponse extends ToolResponse {
  output: {
    message: string
    labels: string[]
    relationshipTypes: string[]
    nodeSchemas: Neo4jNodeSchema[]
    relationshipSchemas: Neo4jRelationshipSchema[]
    constraints: Array<{ name: string; type: string; entityType: string; properties: string[] }>
    indexes: Array<{ name: string; type: string; entityType: string; properties: string[] }>
  }
  error?: string
}
