import type { OutputProperty, ToolResponse } from '@/tools/types'

/**
 * Shared output property definitions for Zep API responses.
 * Based on Zep Cloud API v2 documentation.
 * @see https://help.getzep.com/sdk-reference/thread/list-all
 * @see https://help.getzep.com/sdk-reference/user/add
 * @see https://help.getzep.com/adding-messages
 */

/**
 * Output definition for thread objects returned by Zep API.
 * @see https://help.getzep.com/threads
 * @see https://help.getzep.com/sdk-reference/thread/list-all
 */
export const THREAD_OUTPUT_PROPERTIES = {
  threadId: { type: 'string', description: 'Thread identifier' },
  userId: { type: 'string', description: 'Associated user ID' },
  uuid: { type: 'string', description: 'Internal UUID' },
  createdAt: { type: 'string', description: 'Creation timestamp (ISO 8601)' },
  updatedAt: { type: 'string', description: 'Last update timestamp (ISO 8601)' },
  projectUuid: { type: 'string', description: 'Project UUID' },
  metadata: {
    type: 'object',
    description: 'Custom metadata (dynamic key-value pairs)',
    optional: true,
  },
} as const satisfies Record<string, OutputProperty>

/**
 * Complete thread object output definition.
 */
export const THREAD_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Zep thread object',
  properties: THREAD_OUTPUT_PROPERTIES,
}

/**
 * Threads array output definition for list endpoints.
 * @see https://help.getzep.com/sdk-reference/thread/list-all
 */
export const THREADS_ARRAY_OUTPUT: OutputProperty = {
  type: 'array',
  description: 'Array of thread objects',
  items: {
    type: 'object',
    properties: THREAD_OUTPUT_PROPERTIES,
  },
}

/**
 * Output definition for user objects returned by Zep API.
 * @see https://help.getzep.com/users
 * @see https://help.getzep.com/sdk-reference/user/add
 * @see https://help.getzep.com/sdk-reference/user/get
 */
export const USER_OUTPUT_PROPERTIES = {
  userId: { type: 'string', description: 'User identifier' },
  email: { type: 'string', description: 'User email address', optional: true },
  firstName: { type: 'string', description: 'User first name', optional: true },
  lastName: { type: 'string', description: 'User last name', optional: true },
  uuid: { type: 'string', description: 'Internal UUID' },
  createdAt: { type: 'string', description: 'Creation timestamp (ISO 8601)' },
  updatedAt: { type: 'string', description: 'Last update timestamp (ISO 8601)', optional: true },
  metadata: {
    type: 'object',
    description: 'User metadata (dynamic key-value pairs)',
    optional: true,
  },
} as const satisfies Record<string, OutputProperty>

/**
 * Complete user object output definition.
 */
export const USER_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Zep user object',
  properties: USER_OUTPUT_PROPERTIES,
}

/**
 * Output definition for message objects returned by Zep API.
 * @see https://help.getzep.com/adding-messages
 * @see https://help.getzep.com/sdk-reference/thread/message/update
 */
export const MESSAGE_OUTPUT_PROPERTIES = {
  uuid: { type: 'string', description: 'Message UUID' },
  role: { type: 'string', description: 'Message role (user, assistant, system, tool)' },
  roleType: { type: 'string', description: 'Role type (AI, human, tool)', optional: true },
  content: { type: 'string', description: 'Message content' },
  name: { type: 'string', description: 'Sender name', optional: true },
  createdAt: { type: 'string', description: 'Timestamp (RFC3339 format)' },
  metadata: {
    type: 'object',
    description: 'Message metadata (dynamic key-value pairs)',
    optional: true,
  },
  processed: { type: 'boolean', description: 'Whether message has been processed', optional: true },
} as const satisfies Record<string, OutputProperty>

/**
 * Complete message object output definition.
 */
export const MESSAGE_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Zep message object',
  properties: MESSAGE_OUTPUT_PROPERTIES,
}

/**
 * Messages array output definition for list endpoints.
 * @see https://help.getzep.com/sdk-reference/thread/message/get-messages
 */
export const MESSAGES_ARRAY_OUTPUT: OutputProperty = {
  type: 'array',
  description: 'Array of message objects',
  items: {
    type: 'object',
    properties: MESSAGE_OUTPUT_PROPERTIES,
  },
}

/**
 * Pagination output properties for list endpoints.
 * @see https://help.getzep.com/sdk-reference/thread/list-all
 */
export const PAGINATION_OUTPUT_PROPERTIES = {
  responseCount: {
    type: 'number',
    description: 'Number of items in this response',
    optional: true,
  },
  totalCount: { type: 'number', description: 'Total number of items available', optional: true },
  rowCount: { type: 'number', description: 'Number of rows returned', optional: true },
} as const satisfies Record<string, OutputProperty>

// Zep v3 Response Type
export interface ZepResponse extends ToolResponse {
  output: {
    // Thread operations
    threadId?: string
    uuid?: string
    createdAt?: string
    updatedAt?: string
    projectUuid?: string
    threads?: ZepThread[]
    deleted?: boolean

    // Message operations
    messages?: ZepMessage[]
    messageIds?: string[]
    added?: boolean

    // Context operations
    context?: string

    // User operations
    userId?: string
    email?: string
    firstName?: string
    lastName?: string
    metadata?: Record<string, unknown>

    // Counts
    totalCount?: number
    responseCount?: number
    rowCount?: number
  }
}

/**
 * Thread object interface for type safety.
 */
export interface ZepThread {
  threadId: string
  userId: string
  uuid?: string
  createdAt?: string
  updatedAt?: string
  projectUuid?: string
  metadata?: Record<string, unknown>
}

/**
 * User object interface for type safety.
 */
export interface ZepUser {
  userId: string
  email?: string
  firstName?: string
  lastName?: string
  uuid?: string
  createdAt?: string
  updatedAt?: string
  metadata?: Record<string, unknown>
}

/**
 * Message object interface for type safety.
 */
export interface ZepMessage {
  uuid: string
  role: string
  roleType?: string
  content: string
  name?: string
  createdAt: string
  metadata?: Record<string, unknown>
  processed?: boolean
}
