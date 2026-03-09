// Common types for Elasticsearch tools
import type { ToolResponse } from '@/tools/types'

// Base params for all Elasticsearch tools
export interface ElasticsearchBaseParams {
  // Connection configuration
  deploymentType: 'self_hosted' | 'cloud'
  host?: string // For self-hosted
  cloudId?: string // For Elastic Cloud
  // Authentication
  authMethod: 'api_key' | 'basic_auth'
  apiKey?: string
  username?: string
  password?: string
}

// Document Operations
export interface ElasticsearchIndexDocumentParams extends ElasticsearchBaseParams {
  index: string
  documentId?: string
  document: string // JSON string
  refresh?: 'true' | 'false' | 'wait_for'
}

export interface ElasticsearchGetDocumentParams extends ElasticsearchBaseParams {
  index: string
  documentId: string
  sourceIncludes?: string
  sourceExcludes?: string
}

export interface ElasticsearchUpdateDocumentParams extends ElasticsearchBaseParams {
  index: string
  documentId: string
  document: string // JSON string (partial document)
  retryOnConflict?: number
}

export interface ElasticsearchDeleteDocumentParams extends ElasticsearchBaseParams {
  index: string
  documentId: string
  refresh?: 'true' | 'false' | 'wait_for'
}

export interface ElasticsearchBulkParams extends ElasticsearchBaseParams {
  index?: string
  operations: string // NDJSON string
  refresh?: 'true' | 'false' | 'wait_for'
}

// Search Operations
export interface ElasticsearchSearchParams extends ElasticsearchBaseParams {
  index: string
  query?: string // JSON string
  from?: number
  size?: number
  sort?: string // JSON string
  sourceIncludes?: string
  sourceExcludes?: string
  trackTotalHits?: boolean
}

export interface ElasticsearchCountParams extends ElasticsearchBaseParams {
  index: string
  query?: string // JSON string
}

// Index Management Operations
export interface ElasticsearchCreateIndexParams extends ElasticsearchBaseParams {
  index: string
  settings?: string // JSON string
  mappings?: string // JSON string
}

export interface ElasticsearchDeleteIndexParams extends ElasticsearchBaseParams {
  index: string
}

export interface ElasticsearchGetIndexParams extends ElasticsearchBaseParams {
  index: string
}

export interface ElasticsearchIndexExistsParams extends ElasticsearchBaseParams {
  index: string
}

export interface ElasticsearchRefreshIndexParams extends ElasticsearchBaseParams {
  index: string
}

export interface ElasticsearchIndexStatsParams extends ElasticsearchBaseParams {
  index: string
}

// Mapping Operations
export interface ElasticsearchPutMappingParams extends ElasticsearchBaseParams {
  index: string
  mappings: string // JSON string
}

export interface ElasticsearchGetMappingParams extends ElasticsearchBaseParams {
  index: string
}

// Cluster Operations
export interface ElasticsearchClusterHealthParams extends ElasticsearchBaseParams {
  waitForStatus?: 'green' | 'yellow' | 'red'
  timeout?: string
}

export interface ElasticsearchClusterStatsParams extends ElasticsearchBaseParams {}

export interface ElasticsearchListIndicesParams extends ElasticsearchBaseParams {}

export interface ElasticsearchIndexInfo {
  index: string
  health: string
  status: string
  docsCount: number
  storeSize: string
  primaryShards: number
  replicaShards: number
}

// Response types
export interface ElasticsearchDocumentResponse extends ToolResponse {
  output: {
    _index: string
    _id: string
    _version?: number
    result?: 'created' | 'updated' | 'deleted' | 'not_found' | 'noop'
    _source?: Record<string, unknown>
    found?: boolean
  }
}

export interface ElasticsearchSearchResponse extends ToolResponse {
  output: {
    took: number
    timed_out: boolean
    hits: {
      total: { value: number; relation: string }
      max_score: number | null
      hits: Array<{
        _index: string
        _id: string
        _score: number | null
        _source: Record<string, unknown>
      }>
    }
    aggregations?: Record<string, unknown>
  }
}

export interface ElasticsearchCountResponse extends ToolResponse {
  output: {
    count: number
    _shards: {
      total: number
      successful: number
      skipped: number
      failed: number
    }
  }
}

export interface ElasticsearchBulkResponse extends ToolResponse {
  output: {
    took: number
    errors: boolean
    items: Array<{
      index?: { _index: string; _id: string; result: string; status: number }
      create?: { _index: string; _id: string; result: string; status: number }
      update?: { _index: string; _id: string; result: string; status: number }
      delete?: { _index: string; _id: string; result: string; status: number }
    }>
  }
}

export interface ElasticsearchIndexResponse extends ToolResponse {
  output: {
    acknowledged: boolean
    shards_acknowledged?: boolean
    index?: string
  }
}

export interface ElasticsearchIndexInfoResponse extends ToolResponse {
  output: Record<
    string,
    {
      aliases: Record<string, unknown>
      mappings: Record<string, unknown>
      settings: Record<string, unknown>
    }
  >
}

export interface ElasticsearchIndexExistsResponse extends ToolResponse {
  output: {
    exists: boolean
  }
}

export interface ElasticsearchMappingResponse extends ToolResponse {
  output: Record<string, { mappings: Record<string, unknown> }>
}

export interface ElasticsearchClusterHealthResponse extends ToolResponse {
  output: {
    cluster_name: string
    status: 'green' | 'yellow' | 'red'
    timed_out: boolean
    number_of_nodes: number
    number_of_data_nodes: number
    active_primary_shards: number
    active_shards: number
    relocating_shards: number
    initializing_shards: number
    unassigned_shards: number
    delayed_unassigned_shards: number
    number_of_pending_tasks: number
    number_of_in_flight_fetch: number
    task_max_waiting_in_queue_millis: number
    active_shards_percent_as_number: number
  }
}

export interface ElasticsearchClusterStatsResponse extends ToolResponse {
  output: {
    cluster_name: string
    cluster_uuid: string
    status: string
    nodes: {
      count: { total: number; data: number; master: number }
      versions: string[]
    }
    indices: {
      count: number
      docs: { count: number; deleted: number }
      store: { size_in_bytes: number }
      shards: { total: number; primaries: number }
    }
  }
}

export interface ElasticsearchRefreshResponse extends ToolResponse {
  output: {
    _shards: {
      total: number
      successful: number
      failed: number
    }
  }
}

export interface ElasticsearchIndexStatsResponse extends ToolResponse {
  output: {
    _all: {
      primaries: {
        docs: { count: number; deleted: number }
        store: { size_in_bytes: number }
        indexing: { index_total: number }
        search: { query_total: number }
      }
      total: {
        docs: { count: number; deleted: number }
        store: { size_in_bytes: number }
        indexing: { index_total: number }
        search: { query_total: number }
      }
    }
    indices: Record<string, unknown>
  }
}

export interface ElasticsearchListIndicesResponse extends ToolResponse {
  output: {
    message: string
    indices: ElasticsearchIndexInfo[]
  }
  error?: string
}

// Union type for all Elasticsearch responses
export type ElasticsearchResponse =
  | ElasticsearchDocumentResponse
  | ElasticsearchSearchResponse
  | ElasticsearchCountResponse
  | ElasticsearchBulkResponse
  | ElasticsearchIndexResponse
  | ElasticsearchIndexInfoResponse
  | ElasticsearchIndexExistsResponse
  | ElasticsearchMappingResponse
  | ElasticsearchClusterHealthResponse
  | ElasticsearchClusterStatsResponse
  | ElasticsearchRefreshResponse
  | ElasticsearchIndexStatsResponse
  | ElasticsearchListIndicesResponse
