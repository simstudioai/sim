import { parseAsString } from 'nuqs/server'

export const extensionChatParam = {
  key: 'chat',
  // A missing chat ID represents a new conversation until the first send is admitted.
  parser: parseAsString.withOptions({ history: 'replace' }),
} as const

/** Absent source addresses keep the cited-sources dialog closed. */
export const extensionSourceParams = {
  'source-message': parseAsString,
  'source-request': parseAsString,
} as const
