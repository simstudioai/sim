import { backoffWithJitter } from '@sim/utils/retry'
import { getMothershipAttachmentPreviewUrl } from '@/lib/mothership/chat/attachment-preview'
import { isChatContext } from '@/lib/mothership/chat/context'
import { sendPayload } from '@/app/workspace/[workspaceId]/home/hooks/send-payload'
import type {
  ChatMessage,
  ChatMessageContext,
  SendPayload,
} from '@/app/workspace/[workspaceId]/home/types'
import type { MothershipChatHistory } from '@/hooks/queries/mothership-chats'
import type { JournaledOutgoing } from '@/stores/mothership-outgoing/store'
import type { ChatContext } from '@/stores/panel'

/** The worker's cap on steering text; a longer message goes out as a turn. */
const MAX_STEERING_CONTENT_LENGTH = 32_768
/** Sends that came back without delivering a message before it shows as not delivered. */
export const MAX_OUTGOING_DELIVERY_ATTEMPTS = 8
/** Reads of a turn's end that still found a message held before it shows as not delivered. */
const MAX_DISPOSITION_READS = 8
const OUTGOING_RETRY_BASE_MS = 1000
const OUTGOING_RETRY_MAX_MS = 30_000
/**
 * How long after it was written a steering record no live surface delivers still
 * goes out on its own. Past this the user has moved on, so it shows as not
 * delivered and only their Retry sends it: a tab closed days ago must not open a
 * billed turn when the chat is next read.
 */
export const ORPHAN_AUTO_SEND_MAX_AGE_MS = 10 * 60 * 1000

/**
 * A message the user sent while a turn ran, or that could not go out yet, on its
 * way into a running turn as steering or out as the next turn of its own. It
 * shows in the transcript from the moment it is sent; no one can edit or reorder
 * it, and nothing waits on the user to release it.
 *
 * - `pending`: waits to be steered into the running turn, or sent once none runs;
 * - `steering`: its steer request is out;
 * - `steered`: the worker took (or may have taken) it into `streamId`, and that
 *   turn's end decides whether it was applied or must go out on its own;
 * - `sending`: going out as a turn of its own, which shows it; kept until the
 *   server admits it so a remount resends it under the same id (deduplicated);
 * - `applied`: the worker applied it at `textOffset` of that turn's answer; it is
 *   shown there until the chat's history holds the turn's own marker for it;
 * - `failed`: automatic delivery gave up; it shows as not delivered until the
 *   user retries it (`retryMessage`) or dismisses it (`dismissMessage`).
 *
 * Every entry of a chat is journaled per tab (`useMothershipOutgoingStore`), so a
 * remount or reload resumes delivery under the same ids.
 */
export interface OutgoingMessage {
  /**
   * Its steering id, and the id it goes out under as a turn of its own: the worker
   * refuses that turn (`input_applied`) if a run already applied it, so it can
   * never land twice. Every attempt reuses it.
   */
  id: string
  chatKey: string
  payload: SendPayload
  display: ChatMessage
  status: 'pending' | 'sending' | 'steering' | 'steered' | 'applied' | 'failed'
  /**
   * An attempt got no answer, so the server may already hold it under this id. One
   * still `pending` may be a turn in its own right, so it only ever goes out as
   * that turn, never as steering; one `steered` may yet be applied, so nothing
   * written after it may overtake it.
   */
  unconfirmed?: boolean
  streamId?: string
  /** Where the turn applied it: the length of the turn's answer at that point (UTF-16). */
  textOffset?: number
  /** A turn that refused it: it waits for that turn to end rather than steering it again. */
  refusedBy?: string
  /** Sends that came back without delivering it (no answer, or the chat was busy). */
  attempts: number
  /** Reads after its turn ended that found it still held; they say nothing about a send. */
  reads: number
  /** Epoch ms it was written, which decides whether it may still go out on its own. */
  writtenAt: number
  /** Epoch ms before which it is not tried again. */
  notBefore?: number
  /** Restored past the age limit: if no turn took it, it waits for the user rather than going out. */
  noAutoSend?: boolean
}

/** What became of a steer, as the client reads it; `unknown`: no answer, so it may be held. */
export type SteeringOutcome =
  | { status: 'queued' | 'not_applied' | 'unknown' }
  | { status: 'applied'; textOffset?: number }

/** The contexts a message shows, with each table context naming the view it was sent from. */
export function toMessageContexts(
  contexts: ChatContext[] | undefined
): ChatMessageContext[] | undefined {
  return contexts?.map((context) => ({
    ...context,
    ...(context.kind === 'table'
      ? {
          viewId: (context.currentView ? context.currentView.viewId : context.viewId) ?? undefined,
        }
      : {}),
  }))
}

/** The user bubble a message shows as from the moment it is sent. */
export function optimisticUserMessageFor(id: string, payload: SendPayload): ChatMessage {
  const { content, fileAttachments } = payload
  const messageContexts = toMessageContexts(payload.contexts)
  return {
    id,
    role: 'user',
    requestMode: payload.requestMode ?? 'agent',
    content,
    attachments: fileAttachments?.length
      ? fileAttachments.map((file) => ({
          id: file.id,
          filename: file.filename,
          media_type: file.media_type,
          size: file.size,
          previewUrl: getMothershipAttachmentPreviewUrl(file),
        }))
      : undefined,
    fileAttachments,
    ...(messageContexts && messageContexts.length > 0 ? { contexts: messageContexts } : {}),
  }
}

/**
 * Whether a message can be steered: steering carries its files and mentions like a
 * turn, but needs text, so a message of files alone goes out as a turn. It has no
 * search scope, so a message asking for one (a Summarize of found documents) goes
 * out as a turn too, rather than running without it.
 */
export function canSteer(payload: SendPayload): boolean {
  return (
    !payload.assistantSearch &&
    payload.content.trim().length > 0 &&
    payload.content.length <= MAX_STEERING_CONTENT_LENGTH
  )
}

/** The journal entry an outgoing message is restored from; a steer in flight restores as sent. */
export function toJournaled(message: OutgoingMessage): JournaledOutgoing {
  return {
    id: message.id,
    payload: message.payload,
    status:
      message.status === 'steering'
        ? 'steered'
        : message.status === 'sending'
          ? 'pending'
          : message.status,
    ...(message.streamId ? { streamId: message.streamId } : {}),
    ...(message.refusedBy ? { refusedBy: message.refusedBy } : {}),
    ...(message.unconfirmed || message.status === 'steering' || message.status === 'sending'
      ? { unconfirmed: true }
      : {}),
    ...(message.textOffset !== undefined ? { textOffset: message.textOffset } : {}),
    writtenAt: message.writtenAt,
  }
}

/**
 * The entry a journal restores. Past the age limit (a browser session restored days
 * later) nothing goes out until the user asks: one that never reached a turn shows as
 * not delivered, with no network call. One steered stays steered, because its turn may
 * well have applied it, and only a read saying no turn took it shows it as not delivered.
 */
export function fromJournaled(
  chatKey: string,
  entry: JournaledOutgoing,
  now: number
): OutgoingMessage {
  const pastAgeLimit = now - entry.writtenAt >= ORPHAN_AUTO_SEND_MAX_AGE_MS
  return {
    ...entry,
    ...(pastAgeLimit && entry.status === 'pending' ? { status: 'failed' as const } : {}),
    ...(pastAgeLimit && entry.status === 'steered' ? { noAutoSend: true } : {}),
    chatKey,
    display: optimisticUserMessageFor(entry.id, entry.payload),
    attempts: 0,
    reads: 0,
  }
}

export function outgoingRetryDelay(attempts: number): number {
  return backoffWithJitter(attempts, null, {
    baseMs: OUTGOING_RETRY_BASE_MS,
    maxMs: OUTGOING_RETRY_MAX_MS,
  })
}

/**
 * Where the rest of a new chat's messages wait once its surface is gone: the handoff
 * carries one message, and whichever surface resumes that one takes these behind it.
 */
export function handedOffJournalKey(resumedId: string): string {
  return `handoff:${resumedId}`
}

/**
 * What a new chat's message goes on to the next surface as. Nothing took it, since
 * its chat never existed, so it starts over; one shown as not delivered stays that
 * way until the user asks.
 */
export function toHandedOff(message: OutgoingMessage): JournaledOutgoing {
  return {
    id: message.id,
    payload: message.payload,
    status: message.status === 'failed' ? 'failed' : 'pending',
    ...(message.unconfirmed ? { unconfirmed: true } : {}),
    writtenAt: message.writtenAt,
  }
}

type PersistedRow = MothershipChatHistory['messages'][number]

/**
 * The ids a chat's history holds as a turn of their own: a user row without a
 * steering marker, or one re-marked after the worker refused its turn as already
 * applied (`streamId` is its own id). A message under such an id is delivered.
 */
export function admittedMessageIds(history: MothershipChatHistory | undefined): Set<string> {
  const admitted = new Set<string>()
  for (const row of history?.messages ?? []) {
    if (row.role !== 'user') continue
    if (!row.steering || row.steering.streamId === row.id) admitted.add(row.id)
  }
  return admitted
}

/**
 * Whether the chat's history shows this message is a turn of its own, whatever this
 * tab last knew: another tab sent it, or a send that got no answer was admitted.
 */
export function isDeliveredAsTurn(
  message: OutgoingMessage,
  admittedIds: ReadonlySet<string>
): boolean {
  return (
    (message.status === 'failed' || message.status === 'steered') && admittedIds.has(message.id)
  )
}

export type OutgoingStep =
  /** Nothing can go now: nothing is pending, or what is first must wait. */
  | { kind: 'idle' }
  /** It is already a turn of its own; nothing is left to deliver. */
  | { kind: 'drop'; message: OutgoingMessage }
  | { kind: 'steer'; message: OutgoingMessage; streamId: string }
  | { kind: 'send'; message: OutgoingMessage }

/**
 * What to do next for a chat's messages, in the order they were written. While a
 * turn runs, the first pending one steers it; one that cannot (it refused it, it
 * may be a turn itself, it cannot carry its content), and every one after it, waits
 * for the turn to end. With nothing running, the first goes out as a turn of its
 * own. A message that may yet be applied holds back those written after it; one
 * shown as not delivered holds nothing back.
 */
export function nextOutgoingStep(
  inChat: readonly OutgoingMessage[],
  view: { liveStreamId: string | undefined; admittedIds: ReadonlySet<string>; now: number }
): OutgoingStep {
  const index = inChat.findIndex((message) => message.status === 'pending')
  if (index < 0) return { kind: 'idle' }
  const message = inChat[index]
  const { liveStreamId } = view
  if (liveStreamId === message.id || view.admittedIds.has(message.id)) {
    return { kind: 'drop', message }
  }
  if ((message.notBefore ?? 0) > view.now) return { kind: 'idle' }
  const earlier = inChat.slice(0, index)
  if (liveStreamId) {
    const wouldOvertake = earlier.some(
      (candidate) =>
        candidate.status === 'steering' || (candidate.status === 'steered' && candidate.unconfirmed)
    )
    if (
      wouldOvertake ||
      !canSteer(message.payload) ||
      message.unconfirmed ||
      message.refusedBy === liveStreamId
    ) {
      return { kind: 'idle' }
    }
    return { kind: 'steer', message, streamId: liveStreamId }
  }
  const settled = earlier.every(
    (candidate) => candidate.status === 'applied' || candidate.status === 'failed'
  )
  return settled ? { kind: 'send', message } : { kind: 'idle' }
}

/**
 * A message no turn took, with no attempt outstanding: back to waiting for that
 * turn's end, or shown as not delivered when the turn errored, since nothing goes
 * out on its own after an error.
 */
export function notSteered(streamId: string, turnErrored: boolean): Partial<OutgoingMessage> {
  return {
    status: turnErrored ? 'failed' : 'pending',
    refusedBy: streamId,
    streamId: undefined,
    unconfirmed: false,
    notBefore: undefined,
  }
}

/** A send that got no answer: it may be a turn already, and is retried on a growing delay. */
export function afterUnsentAttempt(
  message: OutgoingMessage,
  environment: { online: boolean; now: number }
): Partial<OutgoingMessage> {
  const attempts = message.attempts + 1
  if (attempts >= MAX_OUTGOING_DELIVERY_ATTEMPTS) {
    return { status: 'failed', attempts, unconfirmed: true, notBefore: undefined }
  }
  return {
    status: 'pending',
    attempts,
    unconfirmed: true,
    notBefore: environment.online
      ? environment.now + outgoingRetryDelay(attempts)
      : Number.POSITIVE_INFINITY,
  }
}

/** A disposition read for a message steered into a turn no longer running. */
export function afterDispositionRead(
  message: OutgoingMessage,
  outcome: SteeringOutcome,
  context: { streamId: string; turnErrored: boolean; now: number }
): Partial<OutgoingMessage> {
  if (outcome.status === 'applied') {
    return {
      status: 'applied',
      notBefore: undefined,
      ...(outcome.textOffset !== undefined ? { textOffset: outcome.textOffset } : {}),
    }
  }
  if (outcome.status === 'not_applied') {
    const refused = notSteered(context.streamId, context.turnErrored || message.noAutoSend === true)
    return {
      ...refused,
      ...(refused.status === 'pending' && message.attempts > 0
        ? { notBefore: context.now + outgoingRetryDelay(message.attempts) }
        : {}),
    }
  }
  /* Still held (or no answer): read again later. A run that never settles it, such
     as one whose owner died, does not keep it waiting forever. */
  const reads = message.reads + 1
  return reads >= MAX_DISPOSITION_READS
    ? { status: 'failed', reads, notBefore: undefined }
    : {
        reads,
        unconfirmed: outcome.status === 'unknown',
        notBefore: context.now + outgoingRetryDelay(reads),
      }
}

/**
 * When a delivery pass next has to run for a chat's messages: the earliest delay
 * that was still running when the last pass began, so that pass could have skipped
 * it. A delay already over by then decides nothing: what still waits after it waits
 * on a turn's end or the network, which wake delivery themselves, and arming for it
 * would run passes back to back until they do. Infinite when nothing is due.
 */
export function nextOutgoingWake(inChat: readonly OutgoingMessage[], passBegan: number): number {
  return Math.min(
    ...inChat.flatMap((message) =>
      (message.status === 'pending' || message.status === 'steered') &&
      message.notBefore !== undefined &&
      message.notBefore > passBegan
        ? [message.notBefore]
        : []
    )
  )
}

/**
 * The user asked again: one steered reads its disposition again rather than going
 * out twice, and what never reached a turn goes out, through the steering gate if a
 * turn refused it.
 */
export function afterRetry(message: OutgoingMessage): Partial<OutgoingMessage> {
  return {
    status: message.streamId ? 'steered' : 'pending',
    attempts: 0,
    reads: 0,
    notBefore: undefined,
    noAutoSend: undefined,
  }
}

/**
 * The turn ended in an error, which the user sees: what was waiting on it stops
 * there, shown as not delivered, rather than going out on its own after a failure.
 * What the worker may hold keeps its read; a Stop is not an error, so it never
 * comes here.
 */
export function holdAfterErroredTurn(
  current: readonly OutgoingMessage[],
  chatKey: string
): OutgoingMessage[] {
  return current.map((message) =>
    message.chatKey === chatKey && message.status === 'pending'
      ? { ...message, status: 'failed', notBefore: undefined }
      : message
  )
}

/**
 * Steering records in a chat no turn marked and no entry here delivers (an earlier
 * mount's, or another tab's), whose turn is over. A record re-marked as a turn's
 * own message (`streamId` is its own id) is already in the transcript.
 */
export function orphanSteeringRows(
  history: MothershipChatHistory | undefined,
  context: {
    known: ReadonlySet<string>
    applied: ReadonlySet<string>
    marked: ReadonlySet<string>
    liveStreamId: string | undefined
  }
): PersistedRow[] {
  return (history?.messages ?? []).filter((row) => {
    const streamId = row.steering?.streamId
    return (
      row.role === 'user' &&
      streamId !== undefined &&
      streamId !== row.id &&
      !context.marked.has(row.id) &&
      !context.applied.has(row.id) &&
      !context.known.has(row.id) &&
      streamId !== context.liveStreamId &&
      streamId !== history?.activeStreamId
    )
  })
}

/**
 * The entry a steering record no live surface delivers becomes. A recent one is
 * settled like one of this mount's own: its disposition is read, and it is kept or
 * sent as a turn. An old one only shows as not delivered until the user acts on it.
 */
export function adoptOrphanRow(row: PersistedRow, chatKey: string, now: number): OutgoingMessage {
  const contexts = row.contexts?.filter(isChatContext)
  const payload = sendPayload({
    content: row.content,
    ...(row.fileAttachments?.length ? { fileAttachments: row.fileAttachments } : {}),
    ...(contexts?.length ? { contexts } : {}),
    ...(row.requestMode ? { requestMode: row.requestMode } : {}),
  })
  const writtenAt = Date.parse(row.timestamp) || 0
  return {
    id: row.id,
    chatKey,
    payload,
    display: optimisticUserMessageFor(row.id, payload),
    status: now - writtenAt < ORPHAN_AUTO_SEND_MAX_AGE_MS ? 'steered' : 'failed',
    streamId: row.steering?.streamId,
    unconfirmed: true,
    attempts: 0,
    reads: 0,
    writtenAt,
  }
}

/**
 * Whether a finished turn leaves work for the chat: a message that goes out next or
 * whose disposition is still open. One the turn itself applied (its frame is in
 * `applied`) is done, and one shown as not delivered waits for the user.
 */
export function hasOutgoingFollowUp(
  inChat: readonly OutgoingMessage[],
  applied: ReadonlySet<string>
): boolean {
  return inChat.some(
    (message) =>
      message.status !== 'applied' && message.status !== 'failed' && !applied.has(message.id)
  )
}

/** How a message's bubble says where it stands; nothing once it is simply part of the chat. */
export function deliveryOf(
  message: OutgoingMessage,
  turnRunning: boolean
): ChatMessage['delivery'] {
  if (message.status === 'failed') return 'failed'
  if (message.status === 'applied' || (message.status === 'steered' && !message.unconfirmed)) {
    return undefined
  }
  if (
    message.status === 'pending' &&
    turnRunning &&
    (!canSteer(message.payload) || message.unconfirmed || message.refusedBy)
  ) {
    return 'waiting'
  }
  return 'sending'
}
