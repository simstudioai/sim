export interface InputFormatField {
  name?: string
  type?: 'string' | 'number' | 'boolean' | 'object' | 'array' | 'file[]' | string
  description?: string
  value?: unknown
}

export const USER_FILE_ACCESSIBLE_PROPERTIES = [
  'id',
  'name',
  'url',
  'size',
  'type',
  'base64',
  /**
   * Path to the file on the sandbox filesystem, mounted on demand.
   *
   * The counterpart to `base64`: that one inlines the bytes and is JavaScript-
   * only, while this one hands any language a real path to open — which is what
   * a CLI or a library like pandas or ffmpeg actually needs. Referencing it runs
   * the block in the remote sandbox, since the isolated VM has no filesystem.
   */
  'path',
] as const

export type UserFileAccessibleProperty = (typeof USER_FILE_ACCESSIBLE_PROPERTIES)[number]

export const USER_FILE_PROPERTY_TYPES: Record<UserFileAccessibleProperty, string> = {
  id: 'string',
  name: 'string',
  url: 'string',
  size: 'number',
  type: 'string',
  base64: 'string',
  path: 'string',
} as const

export const START_BLOCK_RESERVED_FIELDS = ['input', 'conversationId', 'files'] as const

export type StartBlockReservedField = (typeof START_BLOCK_RESERVED_FIELDS)[number]

export type LoopType = 'for' | 'forEach' | 'while' | 'doWhile'

export type ParallelType = 'collection' | 'count'
