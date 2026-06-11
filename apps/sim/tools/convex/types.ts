import type { ToolResponse } from '@/tools/types'

/**
 * Shared parameter and response definitions for Convex tools.
 * Based on the official Convex HTTP API documentation.
 * @see https://docs.convex.dev/http-api/
 */

export interface ConvexBaseParams {
  deploymentUrl: string
  deployKey: string
}

export interface ConvexFunctionCallParams extends ConvexBaseParams {
  functionPath: string
  args?: Record<string, unknown> | string
}

export interface ConvexFunctionCallResponse extends ToolResponse {
  output: {
    value: unknown
    logLines: string[]
  }
}

export interface ConvexListTablesParams extends ConvexBaseParams {}

export interface ConvexListTablesResponse extends ToolResponse {
  output: {
    tables: string[]
    schemas: Record<string, unknown>
  }
}

export interface ConvexListDocumentsParams extends ConvexBaseParams {
  tableName?: string
  snapshot?: string
  pageCursor?: string
}

export interface ConvexListDocumentsResponse extends ToolResponse {
  output: {
    documents: unknown[]
    hasMore: boolean
    snapshot: string | null
    pageCursor: string | null
  }
}

export interface ConvexDocumentDeltasParams extends ConvexBaseParams {
  cursor: string
  tableName?: string
}

export interface ConvexDocumentDeltasResponse extends ToolResponse {
  output: {
    documents: unknown[]
    hasMore: boolean
    cursor: string | null
  }
}

/**
 * Raw wire shape of Convex function-call responses (`/api/query`, `/api/mutation`,
 * `/api/action`, `/api/run/{identifier}`).
 * @see https://docs.convex.dev/http-api/#post-apiquery-apimutation-apiaction
 */
export interface ConvexFunctionCallApiResponse {
  status?: 'success' | 'error'
  value?: unknown
  logLines?: string[]
  errorMessage?: string
  errorData?: unknown
}

/** Raw wire shape of `/api/list_snapshot` responses. */
export interface ConvexListSnapshotApiResponse {
  values?: unknown[]
  hasMore?: boolean
  snapshot?: number | string | null
  cursor?: number | string | null
}

/** Raw wire shape of `/api/document_deltas` responses. */
export interface ConvexDocumentDeltasApiResponse {
  values?: unknown[]
  hasMore?: boolean
  cursor?: number | string | null
}

export interface ConvexResponse extends ToolResponse {
  output: {
    value?: unknown
    logLines?: string[]
    tables?: string[]
    schemas?: Record<string, unknown>
    documents?: unknown[]
    hasMore?: boolean
    snapshot?: string | null
    pageCursor?: string | null
    cursor?: string | null
  }
}
