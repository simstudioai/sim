import { SSE_HEADERS } from '@/lib/core/utils/sse'

const encoder = new TextEncoder()

export function encodeSSEEnvelope(envelope: unknown): Uint8Array {
  return encoder.encode(`data: ${JSON.stringify(envelope)}\n\n`)
}

export const SSE_RESPONSE_HEADERS = {
  ...SSE_HEADERS,
  'Content-Encoding': 'none',
} as const
