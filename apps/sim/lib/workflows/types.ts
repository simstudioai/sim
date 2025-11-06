export interface InputFormatField {
  name?: string
  type?: 'string' | 'number' | 'boolean' | 'object' | 'array' | 'files' | string
  value?: unknown
}

export const USER_FILE_ACCESSIBLE_PROPERTIES = ['id', 'name', 'url', 'size', 'type'] as const

export type UserFileAccessibleProperty = (typeof USER_FILE_ACCESSIBLE_PROPERTIES)[number]

export const USER_FILE_PROPERTY_TYPES: Record<UserFileAccessibleProperty, string> = {
  id: 'string',
  name: 'string',
  url: 'string',
  size: 'number',
  type: 'string',
} as const

export const START_BLOCK_RESERVED_FIELDS = ['input', 'conversationId', 'files'] as const

export type StartBlockReservedField = (typeof START_BLOCK_RESERVED_FIELDS)[number]

export type LoopType = 'for' | 'forEach' | 'while' | 'doWhile'

export type ParallelType = 'collection' | 'count'
