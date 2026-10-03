import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { isRetryableNetworkError } from '@/lib/core/errors/retryable-infrastructure'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { type ForkChatRequest, ForkChatResponse } from '@/lib/mothership/generated/protocol'
import { fetchGo } from '@/lib/mothership/request/go/fetch'
import { mothershipRequestHeaders } from '@/lib/mothership/request/headers'
import { getMothershipBaseURL } from '@/lib/mothership/server/agent-url'

const logger = createLogger('ForkWorker')

/**
 * How long one attempt waits for the copy. The worker refuses a cut above 50,000 events
 * with 413, and measured locally it copies 15,000 events in 1.5–2 s and 50,000 in 5–9 s;
 * production databases are slower by an estimated factor of up to eight, which puts the
 * ceiling at 40–70 s. 120 s leaves headroom above that, and the load balancers on both
 * sides keep idle connections far longer. A legitimate fork therefore finishes inside one
 * attempt, and one that does not is abandoned: the worker rolls a copy back once its
 * caller's connection closes, so a timed-out attempt is never retried and never published.
 */
const ATTEMPT_TIMEOUT_MS = 120_000

/** Cleanup is a small archive-and-purge of one chat, never a copy. */
const DISCARD_TIMEOUT_MS = 10_000

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

/**
 * Removes the worker's copy of a fork that will not be published, so the worker keeps no
 * conversation Sim has no chat for. Best effort: a failure is logged, never thrown, since
 * the caller is already reporting the fork's own failure.
 *
 * The worker rolls back a copy whose caller disconnected, so after a timed-out attempt
 * this is normally a no-op. A worker that commits in the instant between its last
 * disconnect check and its commit, or one deployed before that rollback existed, can
 * commit after this call runs; that conversation then stays on the worker, unreachable
 * from Sim.
 */
export async function discardWorkerConversation(
  request: Pick<ForkChatRequest, 'newChatId' | 'userId'>
): Promise<void> {
  try {
    const baseURL = await getMothershipBaseURL({ userId: request.userId })
    const response = await fetchGo(`${baseURL}/api/tasks/cleanup`, {
      method: 'POST',
      headers: mothershipRequestHeaders(),
      body: JSON.stringify({ chatIds: [request.newChatId] }),
      signal: AbortSignal.timeout(DISCARD_TIMEOUT_MS),
      spanName: 'sim → worker /api/tasks/cleanup',
      operation: 'discard_fork',
    })
    await response.body?.cancel().catch(() => undefined)
    if (!response.ok)
      logger.warn('Worker refused to discard an unpublished fork', {
        chatId: request.newChatId,
        status: response.status,
      })
  } catch (error) {
    logger.warn('Failed to discard an unpublished fork on the worker', {
      chatId: request.newChatId,
      error: getErrorMessage(error),
    })
  }
}
