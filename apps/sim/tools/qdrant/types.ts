import type { OutputProperty, ToolResponse } from '@/tools/types'

/**
 * Shared output property definitions for Qdrant API responses.
 * Based on official Qdrant REST API documentation.
 * @see https://api.qdrant.tech/
 */

/**
 * Output definition for point objects returned by fetch/get operations
 */
export const POINT_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'Point ID (integer or UUID string)' },
  payload: { type: 'json', description: 'Point payload data (key-value pairs)', optional: true },
  vector: {
    type: 'json',
    description: 'Point vector(s) - single array or named vectors object',
    optional: true,
  },
  shard_key: { type: 'string', description: 'Shard key for routing', optional: true },
  order_value: {
    type: 'number',
    description: 'Order value for sorting',
    optional: true,
  },
} as const satisfies Record<string, OutputProperty>

/**
 * Complete point object output definition
 */
export const POINT_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Point object with ID, payload, and optional vector',
  properties: POINT_OUTPUT_PROPERTIES,
}

/**
 * Output definition for scored point objects returned by search/query operations
 */
export const SCORED_POINT_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'Point ID (integer or UUID string)' },
  version: { type: 'number', description: 'Point version number' },
  score: { type: 'number', description: 'Similarity score' },
  payload: { type: 'json', description: 'Point payload data (key-value pairs)', optional: true },
  vector: {
    type: 'json',
    description: 'Point vector(s) - single array or named vectors object',
    optional: true,
  },
  shard_key: { type: 'string', description: 'Shard key for routing', optional: true },
  order_value: {
    type: 'number',
    description: 'Order value for sorting',
    optional: true,
  },
} as const satisfies Record<string, OutputProperty>

/**
 * Complete scored point object output definition
 */
export const SCORED_POINT_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Scored point with ID, version, score, payload, and optional vector',
  properties: SCORED_POINT_OUTPUT_PROPERTIES,
}

/**
 * Output definition for upsert operation result
 */
export const UPSERT_RESULT_OUTPUT_PROPERTIES = {
  operation_id: { type: 'number', description: 'Operation ID for async tracking', optional: true },
  status: {
    type: 'string',
    description: 'Operation status (acknowledged, completed)',
    optional: true,
  },
} as const satisfies Record<string, OutputProperty>

/**
 * Complete upsert result output definition
 */
export const UPSERT_RESULT_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Upsert operation result with operation ID and status',
  properties: UPSERT_RESULT_OUTPUT_PROPERTIES,
}

/**
 * Common response properties for all Qdrant operations
 */
export const QDRANT_RESPONSE_OUTPUT_PROPERTIES = {
  status: { type: 'string', description: 'Operation status (ok, error)' },
  time: { type: 'number', description: 'Time spent processing request in seconds', optional: true },
} as const satisfies Record<string, OutputProperty>

export interface QdrantBaseParams {
  url: string
  apiKey?: string
  collection: string
}

export interface QdrantVector {
  id: string
  vector: number[]
  payload?: Record<string, any>
}

export interface QdrantUpsertParams extends QdrantBaseParams {
  points: QdrantVector[]
}

export interface QdrantSearchParams extends QdrantBaseParams {
  vector: number[]
  limit?: number
  filter?: Record<string, any>
  search_return_data?: string
  with_payload?: boolean
  with_vector?: boolean
}

export interface QdrantFetchParams extends QdrantBaseParams {
  ids: string[]
  fetch_return_data?: string
  with_payload?: boolean
  with_vector?: boolean
}

export interface QdrantResponse extends ToolResponse {
  output: {
    result?: any
    status?: string
    matches?: Array<{
      id: string
      score: number
      payload?: Record<string, any>
      vector?: number[]
    }>
    upsertedCount?: number
    data?: any
  }
}
