import { isRecordLike } from '@sim/utils/object'
import { SSE_HEADERS } from '@/lib/core/utils/sse'
import { presentChatResourceForBrowser } from '@/lib/mothership/resources/presentation'

const encoder = new TextEncoder()

export function encodeSSEEnvelope(envelope: unknown): Uint8Array {
  let presented = envelope
  if (isRecordLike(envelope) && envelope.type === 'resource' && isRecordLike(envelope.payload)) {
    const resource = presentChatResourceForBrowser(envelope.payload.resource)
    if (resource !== envelope.payload.resource)
      presented = { ...envelope, payload: { ...envelope.payload, resource } }
  }
  return encoder.encode(`data: ${JSON.stringify(presented)}\n\n`)
}

export const SSE_RESPONSE_HEADERS = {
  ...SSE_HEADERS,
  'Content-Encoding': 'none',
} as const
