import { toError } from '@sim/utils/errors'
import type { Mem0Message } from '@/tools/mem0/types'

export type JsonRecord = Record<string, unknown>

export const isRecord = (value: unknown): value is JsonRecord =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

function isMem0Message(value: unknown): value is Mem0Message {
  return (
    value !== null &&
    typeof value === 'object' &&
    'role' in value &&
    'content' in value &&
    (value.role === 'user' || value.role === 'assistant') &&
    typeof value.content === 'string' &&
    value.content.length > 0
  )
}

export function parseMem0Messages(value: unknown): Mem0Message[] {
  let messages: unknown
  try {
    messages = typeof value === 'string' ? JSON.parse(value) : value
  } catch (error) {
    throw new Error(`Messages must be valid JSON: ${toError(error).message}`)
  }

  if (!Array.isArray(messages) || messages.length === 0) {
    throw new Error('Messages must be a non-empty array')
  }

  const validMessages: Mem0Message[] = []
  for (const message of messages) {
    if (!isMem0Message(message)) {
      throw new Error('Each message must have role user or assistant and non-empty content')
    }
    validMessages.push(message)
  }

  return validMessages
}
