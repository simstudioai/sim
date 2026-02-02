import type { OutputProperty, ToolResponse } from '@/tools/types'

/**
 * Shared output property definitions for Mem0 API responses.
 * Based on official Mem0 REST API documentation.
 * @see https://docs.mem0.ai/api-reference
 */

/**
 * Output definition for memory objects returned by add operations.
 * Add responses include event type indicating what operation was performed.
 * @see https://docs.mem0.ai/api-reference/memory/add-memories
 */
export const ADD_MEMORY_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'Unique identifier for the memory' },
  memory: { type: 'string', description: 'The content of the memory' },
  event: {
    type: 'string',
    description: 'Event type indicating operation performed (ADD, UPDATE, DELETE, NOOP)',
  },
  metadata: {
    type: 'json',
    description: 'Custom metadata associated with the memory',
    optional: true,
  },
} as const satisfies Record<string, OutputProperty>

/**
 * Complete add memory object output definition
 */
export const ADD_MEMORY_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Memory object returned from add operation with event type',
  properties: ADD_MEMORY_OUTPUT_PROPERTIES,
}

/**
 * Output definition for memory objects returned by get operations.
 * Get responses include full memory details with timestamps and ownership info.
 * @see https://docs.mem0.ai/api-reference/memory/get-memories
 */
export const MEMORY_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'Unique identifier for the memory' },
  memory: { type: 'string', description: 'The content of the memory' },
  user_id: { type: 'string', description: 'User ID associated with this memory', optional: true },
  agent_id: { type: 'string', description: 'Agent ID associated with this memory', optional: true },
  app_id: { type: 'string', description: 'App ID associated with this memory', optional: true },
  run_id: {
    type: 'string',
    description: 'Run/session ID associated with this memory',
    optional: true,
  },
  hash: { type: 'string', description: 'Hash of the memory content', optional: true },
  metadata: {
    type: 'json',
    description: 'Custom metadata associated with the memory',
    optional: true,
  },
  categories: {
    type: 'json',
    description: 'Auto-assigned categories for the memory',
    optional: true,
  },
  created_at: { type: 'string', description: 'ISO 8601 timestamp when the memory was created' },
  updated_at: {
    type: 'string',
    description: 'ISO 8601 timestamp when the memory was last updated',
  },
  owner: { type: 'string', description: 'Owner of the memory', optional: true },
  organization: {
    type: 'string',
    description: 'Organization associated with the memory',
    optional: true,
  },
  immutable: { type: 'boolean', description: 'Whether the memory can be modified', optional: true },
  expiration_date: {
    type: 'string',
    description: 'Expiration date after which memory is not retrieved',
    optional: true,
  },
} as const satisfies Record<string, OutputProperty>

/**
 * Complete memory object output definition
 */
export const MEMORY_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Memory object with full details including timestamps and ownership',
  properties: MEMORY_OUTPUT_PROPERTIES,
}

/**
 * Output definition for search result objects returned by search operations.
 * Search responses include similarity score in addition to memory details.
 * @see https://docs.mem0.ai/api-reference/memory/search-memories
 */
export const SEARCH_RESULT_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'Unique identifier for the memory' },
  memory: { type: 'string', description: 'The content of the memory' },
  user_id: { type: 'string', description: 'User ID associated with this memory', optional: true },
  agent_id: { type: 'string', description: 'Agent ID associated with this memory', optional: true },
  app_id: { type: 'string', description: 'App ID associated with this memory', optional: true },
  run_id: {
    type: 'string',
    description: 'Run/session ID associated with this memory',
    optional: true,
  },
  hash: { type: 'string', description: 'Hash of the memory content', optional: true },
  metadata: {
    type: 'json',
    description: 'Custom metadata associated with the memory',
    optional: true,
  },
  categories: {
    type: 'json',
    description: 'Auto-assigned categories for the memory',
    optional: true,
  },
  created_at: { type: 'string', description: 'ISO 8601 timestamp when the memory was created' },
  updated_at: {
    type: 'string',
    description: 'ISO 8601 timestamp when the memory was last updated',
  },
  score: { type: 'number', description: 'Similarity score from vector search' },
} as const satisfies Record<string, OutputProperty>

/**
 * Complete search result object output definition
 */
export const SEARCH_RESULT_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Search result with memory details and similarity score',
  properties: SEARCH_RESULT_OUTPUT_PROPERTIES,
}

export interface Mem0Response extends ToolResponse {
  output: {
    ids?: string[]
    memories?: Array<{
      id: string
      memory: string
      event?: string
      user_id?: string
      agent_id?: string
      app_id?: string
      run_id?: string
      hash?: string
      metadata?: Record<string, unknown>
      categories?: string[]
      created_at?: string
      updated_at?: string
      owner?: string
      organization?: string
      immutable?: boolean
      expiration_date?: string
    }>
    searchResults?: Array<{
      id: string
      memory: string
      user_id?: string
      agent_id?: string
      app_id?: string
      run_id?: string
      hash?: string
      metadata?: Record<string, unknown>
      categories?: string[]
      created_at?: string
      updated_at?: string
      score: number
    }>
  }
}
