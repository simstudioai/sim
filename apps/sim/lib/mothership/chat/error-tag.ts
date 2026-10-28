import type { MothershipStreamV1ErrorPayload } from '@/lib/mothership/generated/mothership-stream-v1'

/**
 * The text a user reads for a worker error. `displayMessage` is the worker's copy for
 * people; `message` is its diagnostic, shown only when no copy was written.
 */
export function mothershipErrorText(payload: MothershipStreamV1ErrorPayload): string | undefined {
  return payload.displayMessage || payload.message || payload.error || undefined
}

/** One display encoding for live, replayed and persisted assistant failures. */
export function buildMothershipErrorTag(payload: MothershipStreamV1ErrorPayload): string {
  const message = mothershipErrorText(payload) ?? 'An unexpected error occurred'
  return `<mothership-error>${JSON.stringify({
    message,
    ...(payload.code ? { code: payload.code } : {}),
    ...(payload.provider ? { provider: payload.provider } : {}),
  })}</mothership-error>`
}
