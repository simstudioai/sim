import { getErrorMessage } from '@sim/utils/errors'
import type { CodexEvent } from '@/executor/handlers/codex/core/events'

/** Redacts exact credential values and URL-encoded forms from Codex boundaries. */
export function scrubCodexSecrets(text: string, secrets: readonly string[]): string {
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

/** Redacts credentials from every event field that can contain provider or shell text. */
export function scrubCodexEvent(event: CodexEvent, secrets: readonly string[]): CodexEvent {
  switch (event.type) {
    case 'text':
    case 'thinking':
      return { ...event, text: scrubCodexSecrets(event.text, secrets) }
    case 'error':
      return { ...event, message: scrubCodexSecrets(event.message, secrets) }
    case 'tool_start':
      return event.summary
        ? { ...event, summary: scrubCodexSecrets(event.summary, secrets) }
        : event
    case 'tool_end':
      return {
        ...event,
        ...(event.summary ? { summary: scrubCodexSecrets(event.summary, secrets) } : {}),
        ...(event.output ? { output: scrubCodexSecrets(event.output, secrets) } : {}),
      }
    default:
      return event
  }
}

/** Creates a boundary-safe error without retaining a secret-bearing cause. */
export function createScrubbedCodexError(
  error: unknown,
  secrets: readonly string[],
  fallback = 'Codex run failed'
): Error {
  return new Error(scrubCodexSecrets(getErrorMessage(error, fallback), secrets))
}
