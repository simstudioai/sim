import type { ToolResponse } from '@/tools/types'

export interface AlgoliaBaseParams {
  applicationId: string
  apiKey: string
}

// Search
export interface AlgoliaSearchParams extends AlgoliaBaseParams {
  indexName: string
  query: string
  hitsPerPage?: number | string
  page?: number | string
  filters?: string
  attributesToRetrieve?: string
}

export interface AlgoliaSearchResponse extends ToolResponse {
  output: {
    hits: Record<string, unknown>[]
    nbHits: number
    page: number
    nbPages: number
    hitsPerPage: number
    processingTimeMS: number
    query: string
    parsedQuery: string | null
    facets: Record<string, Record<string, number>> | null
    facets_stats: Record<string, { min: number; max: number; avg: number; sum: number }> | null
    exhaustive: Record<string, boolean> | null
  }
}

// Add Record
export interface AlgoliaAddRecordParams extends AlgoliaBaseParams {
  indexName: string
  objectID?: string
  record: string | Record<string, unknown>
}

export interface AlgoliaAddRecordResponse extends ToolResponse {
  output: {
    taskID: number
    objectID: string
    createdAt: string | null
    updatedAt: string | null
  }
}

// Get Record
export interface AlgoliaGetRecordParams extends AlgoliaBaseParams {
  indexName: string
  objectID: string
  attributesToRetrieve?: string
}

export interface AlgoliaGetRecordResponse extends ToolResponse {
  output: {
    objectID: string
    record: Record<string, unknown>
  }
}

// Get Multiple Records
export interface AlgoliaGetRecordsParams extends AlgoliaBaseParams {
  indexName: string
  requests:
    | string
    | {
        objectID: string
        indexName?: string
        attributesToRetrieve?: string[]
      }[]
}

export interface AlgoliaGetRecordsResponse extends ToolResponse {
  output: {
    results: (Record<string, unknown> | null)[]
  }
}

// Delete Record
export interface AlgoliaDeleteRecordParams extends AlgoliaBaseParams {
  indexName: string
  objectID: string
}

export interface AlgoliaDeleteRecordResponse extends ToolResponse {
  output: {
    taskID: number
    deletedAt: string | null
  }
}

// Partial Update Record
export interface AlgoliaPartialUpdateRecordParams extends AlgoliaBaseParams {
  indexName: string
  objectID: string
  attributes: string | Record<string, unknown>
  createIfNotExists?: boolean
}

export interface AlgoliaPartialUpdateRecordResponse extends ToolResponse {
  output: {
    taskID: number
    objectID: string
    updatedAt: string | null
  }
}

// Browse Records
export interface AlgoliaBrowseRecordsParams extends AlgoliaBaseParams {
  indexName: string
  query?: string
  filters?: string
  attributesToRetrieve?: string
  hitsPerPage?: number | string
  cursor?: string
}

export interface AlgoliaBrowseRecordsResponse extends ToolResponse {
  output: {
    hits: Record<string, unknown>[]
    cursor: string | null
    nbHits: number
    page: number
    nbPages: number
    hitsPerPage: number
    processingTimeMS: number
  }
}

// Batch Operations
export interface AlgoliaBatchOperationsParams extends AlgoliaBaseParams {
  indexName: string
  requests:
    | string
    | {
        action: string
        body: Record<string, unknown>
      }[]
}

export interface AlgoliaBatchOperationsResponse extends ToolResponse {
  output: {
    taskID: number
    objectIDs: string[]
  }
}

// List Indices
export interface AlgoliaListIndicesParams extends AlgoliaBaseParams {
  page?: number | string
  hitsPerPage?: number | string
}

export interface AlgoliaListIndicesResponse extends ToolResponse {
  output: {
    indices: {
      name: string
      entries: number
      dataSize: number
      fileSize: number
      lastBuildTimeS: number
      numberOfPendingTasks: number
      pendingTask: boolean
      createdAt: string
      updatedAt: string
      primary: string | null
      replicas: string[]
      virtual: boolean
    }[]
    nbPages: number
  }
}

// Get Settings
export interface AlgoliaGetSettingsParams extends AlgoliaBaseParams {
  indexName: string
}

export interface AlgoliaGetSettingsResponse extends ToolResponse {
  output: {
    searchableAttributes: string[] | null
    attributesForFaceting: string[]
    ranking: string[]
    customRanking: string[]
    replicas: string[]
    hitsPerPage: number
    maxValuesPerFacet: number
    highlightPreTag: string
    highlightPostTag: string
    paginationLimitedTo: number
  }
}

// Update Settings
export interface AlgoliaUpdateSettingsParams extends AlgoliaBaseParams {
  indexName: string
  settings: string | Record<string, unknown>
  forwardToReplicas?: boolean
}

export interface AlgoliaUpdateSettingsResponse extends ToolResponse {
  output: {
    taskID: number
    updatedAt: string | null
  }
}

// Delete Index
export interface AlgoliaDeleteIndexParams extends AlgoliaBaseParams {
  indexName: string
}

export interface AlgoliaDeleteIndexResponse extends ToolResponse {
  output: {
    taskID: number
    deletedAt: string | null
  }
}

// Copy/Move Index
export interface AlgoliaCopyMoveIndexParams extends AlgoliaBaseParams {
  indexName: string
  operation: string
  destination: string
  scope?: string | string[]
}

export interface AlgoliaCopyMoveIndexResponse extends ToolResponse {
  output: {
    taskID: number
    updatedAt: string | null
  }
}

// Clear Records
export interface AlgoliaClearRecordsParams extends AlgoliaBaseParams {
  indexName: string
}

export interface AlgoliaClearRecordsResponse extends ToolResponse {
  output: {
    taskID: number
    updatedAt: string | null
  }
}

// Delete By Filter
export interface AlgoliaDeleteByFilterParams extends AlgoliaBaseParams {
  indexName: string
  filters: string
  facetFilters?: string | string[]
  numericFilters?: string | string[]
  tagFilters?: string | string[]
  aroundLatLng?: string
  aroundRadius?: number | string
  insideBoundingBox?: string | number[][]
  insidePolygon?: string | number[][]
}

export interface AlgoliaDeleteByFilterResponse extends ToolResponse {
  output: {
    taskID: number
    updatedAt: string | null
  }
}
