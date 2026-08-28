import { isRecordLike } from '@sim/utils/object'
import { readResponseTextWithLimit } from '@/lib/core/utils/stream-limits'

export const MAX_WHATSAPP_GRAPH_RESPONSE_BYTES = 256 * 1024

export async function readWhatsAppGraphResponse(
  response: Response,
  label: string,
  signal?: AbortSignal
): Promise<Record<string, unknown>> {
  const text = await readResponseTextWithLimit(response, {
    maxBytes: MAX_WHATSAPP_GRAPH_RESPONSE_BYTES,
    label,
    signal,
  })
  const parsed = text ? (JSON.parse(text) as unknown) : {}
  return isRecordLike(parsed) ? parsed : {}
}
