import { SIM_AGENT_API_URL } from '@/lib/copilot/constants'
import { env } from '@/lib/core/config/env'

export const DEFAULT_EXPLICIT_ABORT_TIMEOUT_MS = 3000

export async function requestExplicitStreamAbort(params: {
  streamId: string
  userId: string
  chatId?: string
  timeoutMs?: number
}): Promise<void> {
  const { streamId, userId, chatId, timeoutMs = DEFAULT_EXPLICIT_ABORT_TIMEOUT_MS } = params

  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (env.COPILOT_API_KEY) {
    headers['x-api-key'] = env.COPILOT_API_KEY
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort('timeout:go_explicit_abort_fetch'), timeoutMs)

  try {
    const response = await fetch(`${SIM_AGENT_API_URL}/api/streams/explicit-abort`, {
      method: 'POST',
      headers,
      signal: controller.signal,
      body: JSON.stringify({
        messageId: streamId,
        userId,
        ...(chatId ? { chatId } : {}),
      }),
    })

    if (!response.ok) {
      throw new Error(`Explicit abort marker request failed: ${response.status}`)
    }
  } finally {
    clearTimeout(timeout)
  }
}
