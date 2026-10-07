import { backoffWithJitter } from '@sim/utils/retry'
import type { SendPayload } from '@/app/workspace/[workspaceId]/home/types'
import type { QueuedMothershipMessage, ScheduledRetry } from '@/stores/mothership-queue/types'

/**
 * Why a send came back to its caller instead of going out:
 * - `withdrawn`: an unmount cleanup withdrew it before the server answered;
 * - `offline`: its POST got no answer and the browser is offline;
 * - `unreachable`: its POST failed at the network while the browser reports
 *   itself online (a dropped connection), so no `online` event will come;
 * - `busy`: the server refused it because another turn held the chat;
 * - `stop-failed`: the Stop it waited on did not settle, so it was not sent.
 */
export type WithdrawalReason = 'withdrawn' | 'offline' | 'unreachable' | 'busy' | 'stop-failed'

/** A withdrawal, or `failed`: the send failed outright and the user decides what next. */
export type RequeueReason = WithdrawalReason | 'failed'

/** The queue fields that say when, and on which surface, a re-queued message goes out. */
type RequeueFields = Pick<
  QueuedMothershipMessage,
  'retryRequired' | 'heldUntilOnline' | 'sendRetries' | 'notBefore' | 'heldSurface'
>

const SEND_RETRY_BASE_MS = 1_000
const SEND_RETRY_MAX_MS = 30_000

/** Queue fields for the `attempt`th automatic retry of a message: when it may be sent again. */
export function sendRetry(attempt: number): ScheduledRetry {
  return {
    sendRetries: attempt,
    notBefore:
      Date.now() +
      backoffWithJitter(attempt, null, { baseMs: SEND_RETRY_BASE_MS, maxMs: SEND_RETRY_MAX_MS }),
  }
}

/**
 * The one re-queue policy, for a message going back to its queue:
 * - `offline` waits for the browser to come back online (or the user);
 * - `unreachable` and `busy` retry on a growing delay after `previousAttempts`;
 * - `stop-failed` and `failed` wait for the user;
 * - `withdrawn` goes out again as soon as the queue drains.
 *
 * A message re-queued on a chatless surface carries that surface
 * (`chatlessSurface`), whose queue key dies with its mount, so the next mount of
 * it adopts the message. That holds for every reason: a re-queue can land after
 * the surface unmounted, when nothing else marks the dead key's queue.
 */
export function requeuedFields(
  reason: RequeueReason,
  previousAttempts: number,
  chatlessSurface: string | undefined
): RequeueFields {
  const surface = chatlessSurface ? { heldSurface: chatlessSurface } : {}
  switch (reason) {
    case 'offline':
      return { retryRequired: true, heldUntilOnline: true, ...surface }
    case 'unreachable':
    case 'busy':
      return { ...sendRetry(previousAttempts + 1), ...surface }
    case 'stop-failed':
    case 'failed':
      return { retryRequired: true, ...surface }
    case 'withdrawn':
      return {}
  }
}

/**
 * A queue entry without the fields an earlier outcome set, so a re-queue applies
 * only the policy for the outcome it is handling. A stale `heldUntilOnline`, for
 * one, would let the browser coming online send a message waiting for the user.
 */
export function withoutRequeueFields(entry: QueuedMothershipMessage): QueuedMothershipMessage {
  const {
    retryRequired: _retryRequired,
    heldUntilOnline: _heldUntilOnline,
    sendRetries: _sendRetries,
    notBefore: _notBefore,
    heldSurface: _heldSurface,
    ...rest
  } = entry
  return rest
}

/** The payload of a send, without fields it does not set. */
export function sendPayload(source: SendPayload): SendPayload {
  return {
    content: source.content,
    ...(source.fileAttachments ? { fileAttachments: source.fileAttachments } : {}),
    ...(source.contexts ? { contexts: source.contexts } : {}),
    ...(source.requestMode ? { requestMode: source.requestMode } : {}),
    ...(source.assistantSearch ? { assistantSearch: source.assistantSearch } : {}),
    ...(source.assistantSearchLevel !== undefined
      ? { assistantSearchLevel: source.assistantSearchLevel }
      : {}),
  }
}
