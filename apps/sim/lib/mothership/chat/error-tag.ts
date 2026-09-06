import type { MothershipStreamV1ErrorPayload } from '@/lib/mothership/generated/mothership-stream-v1'

/** One display encoding for live, replayed and persisted assistant failures. */
export function buildMothershipErrorTag(payload: MothershipStreamV1ErrorPayload): string {
  const message =
    payload.displayMessage || payload.message || payload.error || 'An unexpected error occurred'
  return `<mothership-error>${JSON.stringify({
    message,
    ...(payload.code ? { code: payload.code } : {}),
    ...(payload.provider ? { provider: payload.provider } : {}),
  })}</mothership-error>`
}
