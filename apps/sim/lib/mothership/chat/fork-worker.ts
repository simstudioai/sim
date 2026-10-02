import { isRetryableNetworkError } from '@/lib/core/errors/retryable-infrastructure'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { type ForkChatRequest, ForkChatResponse } from '@/lib/mothership/generated/protocol'
import { fetchGo } from '@/lib/mothership/request/go/fetch'
import { mothershipRequestHeaders } from '@/lib/mothership/request/headers'
import { getMothershipBaseURL } from '@/lib/mothership/server/agent-url'

/**
 * How long one attempt waits for the copy. The worker rolls a copy back once its caller's
 * connection closes, so an attempt that times out leaves no conversation behind.
 */
const ATTEMPT_TIMEOUT_MS = 45_000

/** Gateway failures: the request may never have reached a worker, so one more attempt is safe. */
const RETRYABLE_STATUSES = new Set([502, 503, 504])

/** The worker's typed refusals, each one the caller can act on. */
function workerRefusal(status: number): Error {
  if (status === 404) return new OrchestrationError('not_found', 'Chat not found')
  if (status === 409)
    return new OrchestrationError(
      'conflict',
      'The selected response has not finished. Retry the fork once it completes.'
    )
  if (status === 413)
    return new OrchestrationError(
      'payload_too_large',
      'This conversation is too long to fork. Fork from an earlier message.'
    )
  return new Error('The conversation could not be copied. Retry the fork.')
}

type Attempt = { kind: 'receipt'; body: unknown } | { kind: 'status'; status: number }

/**
 * A lost copy acknowledgement retries the same destination and immutable request; the
 * worker answers a repeat with the first attempt's receipt. Only a refused, reset or dropped
 * socket or a gateway status is retried: a timed-out attempt may still be copying.
 */
export async function copyWorkerConversation(request: ForkChatRequest): Promise<void> {
  const baseURL = await getMothershipBaseURL({ userId: request.userId })
  const body = JSON.stringify(request)
  for (let attempt = 0; ; attempt++) {
    const canRetry = attempt === 0
    let outcome: Attempt
    try {
      const response = await fetchGo(`${baseURL}/api/chats/fork`, {
        method: 'POST',
        headers: mothershipRequestHeaders(),
        body,
        signal: AbortSignal.timeout(ATTEMPT_TIMEOUT_MS),
        spanName: 'sim → worker /api/chats/fork',
        operation: 'fork_chat',
      })
      if (response.ok) outcome = { kind: 'receipt', body: await response.json() }
      else {
        outcome = { kind: 'status', status: response.status }
        // Releasing the unread error body is best effort; the status is already the answer.
        await response.body?.cancel().catch(() => undefined)
      }
    } catch (error) {
      if (canRetry && isRetryableNetworkError(error)) continue
      throw error
    }
    if (outcome.kind === 'status') {
      if (canRetry && RETRYABLE_STATUSES.has(outcome.status)) continue
      throw workerRefusal(outcome.status)
    }
    const receipt = ForkChatResponse.parse(outcome.body)
    if (receipt.chatId !== request.newChatId) throw new Error('The fork returned a different chat')
    return
  }
}
