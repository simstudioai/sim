import { getErrorMessage } from '@sim/utils/errors'
import type { PiEvent } from '@/executor/handlers/pi/core/events'

/**
 * Redacts exact credential values and their URL-encoded forms from diagnostics that may echo
 * transport credentials. Never apply this to model, user, tool, or repository content: matching a
 * credential value does not prove that the content originated from that credential.
 */
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

/** Redacts credentials only from provider/SDK error events; ordinary Pi content stays verbatim. */
export function scrubPiEvent(event: PiEvent | null, secrets: readonly string[]): PiEvent | null {
  if (!event) return event
  return event.type === 'error'
    ? { ...event, message: scrubPiSecrets(event.message, secrets) }
    : event
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
