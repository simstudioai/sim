import { getErrorMessage } from '@sim/utils/errors'
import type { PiEvent } from '@/executor/handlers/pi/events'

/** Redacts exact secret values and their URL-encoded forms from surfaced text. */
export function scrubPiSecrets(text: string, secrets: readonly string[]): string {
  let scrubbed = text
  const representations = new Set(
    secrets.flatMap((secret) => (secret ? [secret, encodeURIComponent(secret)] : []))
  )
  for (const representation of [...representations].sort(
    (left, right) => right.length - left.length
  )) {
    scrubbed = scrubbed.split(representation).join('***')
  }
  return scrubbed
}

/** Redacts secrets from every string-bearing normalized Pi event. */
export function scrubPiEvent(event: PiEvent | null, secrets: readonly string[]): PiEvent | null {
  if (!event) return event
  switch (event.type) {
    case 'text':
    case 'thinking':
      return { ...event, text: scrubPiSecrets(event.text, secrets) }
    case 'tool_start':
    case 'tool_end':
      return { ...event, toolName: scrubPiSecrets(event.toolName, secrets) }
    case 'error':
      return { ...event, message: scrubPiSecrets(event.message, secrets) }
    default:
      return event
  }
}

/** Extracts an unknown error message without allowing exact secrets to escape. */
export function getScrubbedPiErrorMessage(
  error: unknown,
  secrets: readonly string[],
  fallback = 'Pi run failed'
): string {
  return scrubPiSecrets(getErrorMessage(error, fallback), secrets)
}

/** Creates a boundary-safe error without retaining a potentially secret-bearing cause. */
export function createScrubbedPiError(
  error: unknown,
  secrets: readonly string[],
  fallback?: string
): Error {
  return new Error(getScrubbedPiErrorMessage(error, secrets, fallback))
}
