import { isRecordLike } from '@sim/utils/object'
import { MAX_JSON_API_RESPONSE_BYTES } from '@/lib/core/security/input-validation.server'
import { readResponseJsonWithLimit } from '@/lib/core/utils/stream-limits'
import { DiscordOperationError } from '@/lib/internal/discord/errors'

export async function sendDiscordMessage(
  botToken: string,
  channelId: string,
  body: BodyInit,
  contentType: 'json' | 'multipart',
  signal?: AbortSignal
): Promise<Record<string, unknown>> {
  signal?.throwIfAborted()
  const response = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bot ${botToken}`,
      ...(contentType === 'json' ? { 'Content-Type': 'application/json' } : {}),
    },
    body,
    signal,
  })
  let data: unknown
  try {
    data = await readResponseJsonWithLimit<unknown>(response, {
      maxBytes: MAX_JSON_API_RESPONSE_BYTES,
      label: 'Discord message response',
      signal,
    })
  } catch (error) {
    signal?.throwIfAborted()
    data = null
  }
  if (!response.ok) {
    const message = isRecordLike(data) && typeof data.message === 'string' ? data.message : null
    throw new DiscordOperationError(
      message ||
        (contentType === 'multipart'
          ? 'Failed to send message with files'
          : 'Failed to send message'),
      response.status
    )
  }
  return isRecordLike(data) ? data : {}
}
