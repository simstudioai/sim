import type { SessionPrincipal } from '@sim/auth/principal'
import { db } from '@sim/db'
import { copilotMessages } from '@sim/db/schema'
import { toRecord } from '@sim/utils/object'
import { and, eq, isNull, sql } from 'drizzle-orm'
import { defineWorkspaceOperation } from '@/lib/core/application'
import { defineOrganizationOperation } from '@/lib/core/application/organization-operation'
import {
  getLatestRunForStream,
  TERMINAL_RUN_STATUSES,
} from '@/lib/mothership/async-runs/repository'
import { defineAuthorizedChatUseCase } from '@/lib/mothership/chat/application/authorized-chat-use-case'
import { resolveOwnedChatContext } from '@/lib/mothership/chat/application/context'
import { recordSteeringDisposition } from '@/lib/mothership/chat/messages-store'
import type { SteeringFinalDisposition } from '@/lib/mothership/chat/steering'
import { requestSteeringDisposition } from '@/lib/mothership/request/session/steer'

/**
 * A steering message as Sim recorded it before asking the worker: the run it was
 * sent into and its text, with the worker's final answer once one is known.
 */
export interface SteeringRecord {
  streamId: string
  content: string
  disposition?: SteeringFinalDisposition
}

/**
 * What a read of a recorded steering message found:
 * - `applied`: a run applied it, so it is in the conversation;
 * - `held`: the run it steered still holds it and may yet apply it;
 * - `not_held`: no run holds it or ever will, so it was not delivered.
 */
type SteeringReading =
  | { status: 'applied'; eventSeq?: number; textOffset?: number }
  | { status: 'held' }
  | { status: 'not_held' }

/**
 * What a turn whose message id is a steering id may do:
 * - `send`: no run applied the message, so it goes out as this turn;
 * - `applied`: a run already applied it, so it is in the conversation already;
 * - `busy`: the run it steered (`streamId`) still holds it and may yet apply it.
 */
type SteeringFallback = { kind: 'send' } | { kind: 'applied' } | { kind: 'busy'; streamId: string }

const steeringRow = (chatId: string, messageId: string) =>
  and(
    eq(copilotMessages.chatId, chatId),
    eq(copilotMessages.messageId, messageId),
    isNull(copilotMessages.deletedAt),
    sql`${copilotMessages.content} ? 'steering'`
  )

/** The final disposition a record stored, as the `disposition` field of a record, if any. */
function readFinalDisposition(stored: unknown): { disposition?: SteeringFinalDisposition } {
  const disposition = toRecord(stored)
  if (disposition.status === 'not_applied') return { disposition: { status: 'not_applied' } }
  if (disposition.status !== 'applied') return {}
  const { eventSeq, textOffset } = disposition
  return {
    disposition: {
      status: 'applied',
      ...(typeof eventSeq === 'number' ? { eventSeq } : {}),
      ...(typeof textOffset === 'number' ? { textOffset } : {}),
    },
  }
}

/** The steering record a chat holds under `messageId`, if that id was sent as steering. */
export async function loadSteeringRecord(
  chatId: string,
  messageId: string
): Promise<SteeringRecord | undefined> {
  const [row] = await db
    .select({ content: copilotMessages.content })
    .from(copilotMessages)
    .where(steeringRow(chatId, messageId))
    .limit(1)
  if (!row) return undefined
  const message = toRecord(row.content)
  const steering = toRecord(message.steering)
  if (typeof steering.streamId !== 'string' || typeof message.content !== 'string') return undefined
  /* Re-marked after the worker refused its turn as already applied: it is that turn's
     own message, not a record anything still delivers. */
  if (steering.streamId === messageId) return undefined
  return {
    streamId: steering.streamId,
    content: message.content,
    ...readFinalDisposition(steering.disposition),
  }
}

/**
 * Whether Sim recorded a steered run as over. A worker can keep answering `queued`
 * for a run whose owner died, which will never apply it, and waiting on that would
 * hold the message forever.
 */
export async function steeredRunHasEnded(streamId: string, userId: string): Promise<boolean> {
  const run = await getLatestRunForStream(streamId, userId)
  return !run || TERMINAL_RUN_STATUSES.includes(run.status)
}

/**
 * Reads what became of a recorded steering message without sending it, so no read
 * can deliver it. A final answer is kept on the record and answers later reads. A
 * `queued` answer counts only while Sim still runs that turn: a run Sim recorded as
 * ended (one whose worker owner died, say) never applies it, and waiting on it
 * would hold the message forever. `unknown` (nothing accepted yet) is held the same
 * way: the steer that recorded it may still be on its way to the worker, and a
 * record dropped under it would leave a message the model has with no row.
 *
 * A worker without the read decides from Sim's run alone, never by re-sending the
 * message: a live run may hold it, and an ended one can no longer apply it. If it
 * did apply it, a turn sent under its id is refused by the worker (`input_applied`)
 * and settles as already applied, so nothing runs twice.
 */
export async function readSteeringRecord(params: {
  chatId: string
  messageId: string
  record: SteeringRecord
  userId: string
}): Promise<SteeringReading> {
  const { chatId, messageId, record, userId } = params
  if (record.disposition?.status === 'applied') return record.disposition
  if (record.disposition) return { status: 'not_held' }
  const answer = await requestSteeringDisposition({
    streamId: record.streamId,
    userId,
    chatId,
    steeringId: messageId,
  })
  if (answer.status === 'unsupported') {
    return (await steeredRunHasEnded(record.streamId, userId))
      ? { status: 'not_held' }
      : { status: 'held' }
  }
  if (answer.status === 'queued' || answer.status === 'unknown') {
    if (!(await steeredRunHasEnded(record.streamId, userId))) return { status: 'held' }
    await recordSteeringDisposition(chatId, [messageId], { status: 'not_applied' })
    return { status: 'not_held' }
  }
  await recordSteeringDisposition(chatId, [messageId], answer)
  return answer.status === 'applied' ? answer : { status: 'not_held' }
}

/** Removes a steering record nothing delivers any more; a turn's own row is never matched. */
export async function dropSteeringRecord(chatId: string, messageId: string): Promise<void> {
  await db.delete(copilotMessages).where(steeringRow(chatId, messageId))
}

/**
 * Settles a turn sent under the id of a steering message the user sent into an
 * earlier turn, before it is admitted: the chat-send operation's own step, run
 * after the chat's ownership is authorized and before admission. A message no run
 * holds loses its steering record, so the turn's own message is stored after the
 * turn it failed to steer rather than at the place the record holds.
 */
export async function resolveSteeringFallback(params: {
  chatId: string
  messageId: string
  userId: string
}): Promise<SteeringFallback> {
  const { chatId, messageId, userId } = params
  const record = await loadSteeringRecord(chatId, messageId)
  if (!record) return { kind: 'send' }
  const reading = await readSteeringRecord({ chatId, messageId, record, userId })
  if (reading.status === 'applied') return { kind: 'applied' }
  if (reading.status === 'held') return { kind: 'busy', streamId: record.streamId }
  await dropSteeringRecord(chatId, messageId)
  return { kind: 'send' }
}

/**
 * Decides whether a turn the client marked as a steering message going out on its
 * own may be admitted (`resolveSteeringFallback`), under the chat owner's current
 * access. Only marked turns take this, so an ordinary send pays nothing for it.
 */
export const settleSteeringFallback = defineAuthorizedChatUseCase({
  operation: defineWorkspaceOperation({
    id: 'mothership.chats.settle_steering_fallback',
    capability: 'copilot.use',
    minimumRole: 'read',
    workspaceApiKey: 'deny',
    principalKinds: ['session'],
  }),
  organizationOperation: defineOrganizationOperation({
    id: 'mothership.chats.settle_steering_fallback',
    capability: 'copilot.use',
    minimumRole: 'member',
    principalKinds: ['session'],
  }),
  resolveContext: ({
    principal,
    input,
  }: {
    principal: SessionPrincipal
    input: { chatId: string; messageId: string }
  }) => resolveOwnedChatContext(principal, input.chatId),
  authorizationOptions: {},
  execute: ({ input, context }) =>
    resolveSteeringFallback({
      chatId: context.chatId,
      messageId: input.messageId,
      userId: context.userId,
    }),
})

/**
 * Drops a steering message the user gave up on (a Not delivered message's Dismiss).
 * The same reading decides as for a turn going out under its id, and it only reads,
 * so dismissing never delivers the message. One a run applied, or may yet apply,
 * stays where it is; anything else loses its record, and a row that is a turn's own
 * message is never touched.
 */
export const dismissSteeringMessage = defineAuthorizedChatUseCase({
  operation: defineWorkspaceOperation({
    id: 'mothership.chats.dismiss_steering',
    capability: 'copilot.use',
    minimumRole: 'read',
    workspaceApiKey: 'deny',
    principalKinds: ['session'],
  }),
  organizationOperation: defineOrganizationOperation({
    id: 'mothership.chats.dismiss_steering',
    capability: 'copilot.use',
    minimumRole: 'member',
    principalKinds: ['session'],
  }),
  resolveContext: ({
    principal,
    input,
  }: {
    principal: SessionPrincipal
    input: { chatId: string; messageId: string }
  }) => resolveOwnedChatContext(principal, input.chatId),
  authorizationOptions: {},
  async execute({ input, context }) {
    const fallback = await resolveSteeringFallback({
      chatId: context.chatId,
      messageId: input.messageId,
      userId: context.userId,
    })
    if (fallback.kind === 'busy') return { status: 'busy' as const, streamId: fallback.streamId }
    return { status: fallback.kind === 'applied' ? ('applied' as const) : ('dismissed' as const) }
  },
})

/**
 * Reads what became of a steering message for its sender, after the turn it was sent
 * into ended or when the user retries it. It only reads, so it never delivers the
 * message: one no run holds answers `not_applied`, and the sender decides whether it
 * goes out as a turn. An id with no record was never stored as steering, so nothing
 * holds it either.
 */
export const readSteeringMessage = defineAuthorizedChatUseCase({
  operation: defineWorkspaceOperation({
    id: 'mothership.chats.read_steering',
    capability: 'copilot.use',
    minimumRole: 'read',
    workspaceApiKey: 'deny',
    principalKinds: ['session'],
  }),
  organizationOperation: defineOrganizationOperation({
    id: 'mothership.chats.read_steering',
    capability: 'copilot.use',
    minimumRole: 'member',
    principalKinds: ['session'],
  }),
  resolveContext: ({
    principal,
    input,
  }: {
    principal: SessionPrincipal
    input: { chatId: string; messageId: string }
  }) => resolveOwnedChatContext(principal, input.chatId),
  authorizationOptions: {},
  async execute({ input, context }) {
    const steeringId = input.messageId
    const record = await loadSteeringRecord(context.chatId, steeringId)
    if (!record) return { steeringId, status: 'not_applied' as const }
    const reading = await readSteeringRecord({
      chatId: context.chatId,
      messageId: steeringId,
      record,
      userId: context.userId,
    })
    if (reading.status === 'held') return { steeringId, status: 'queued' as const }
    if (reading.status === 'not_held') return { steeringId, status: 'not_applied' as const }
    return { steeringId, ...reading }
  },
})
