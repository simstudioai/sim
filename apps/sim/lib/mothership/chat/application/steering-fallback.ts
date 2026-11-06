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
import type { SteerV2Request } from '@/lib/mothership/generated/protocol'
import type { PreparedSteeringInput } from '@/lib/mothership/request/application/steering-input'
import { requestStreamSteering } from '@/lib/mothership/request/session/steer'

/**
 * A steering message as Sim recorded it before asking the worker: the run it was
 * sent into, its text, and the exact input the worker was sent, so a read of its
 * disposition re-sends identical bytes (the worker refuses a retry whose input
 * differs). Once the disposition is final it is recorded here and the input is gone.
 */
export interface SteeringRecord {
  streamId: string
  content: string
  input: Pick<PreparedSteeringInput, 'context' | 'assistantImages'>
  disposition?: SteeringFinalDisposition
}

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
  const input = toRecord(steering.input)
  return {
    streamId: steering.streamId,
    content: message.content,
    input: {
      context: Array.isArray(input.context)
        ? (input.context as PreparedSteeringInput['context'])
        : [],
      ...(Array.isArray(input.assistantImages)
        ? { assistantImages: input.assistantImages as SteerV2Request['assistantImages'] }
        : {}),
    },
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
 * Settles a turn sent under the id of a steering message the user sent into an
 * earlier turn, before it is admitted: the chat-send operation's own step, run
 * after the chat's ownership is authorized and before admission. The worker's
 * durable disposition of that id decides, read with the recorded input. A
 * `queued` answer counts only while Sim still runs that turn: a run Sim recorded
 * as ended (one whose worker owner died, say) never applies it, and waiting on it
 * would hold the message forever. A message no run applied (or one the worker
 * refused) loses its steering record, so the turn's own message is stored after
 * the turn it failed to steer rather than at the place the record holds.
 */
export async function resolveSteeringFallback(params: {
  chatId: string
  messageId: string
  userId: string
}): Promise<SteeringFallback> {
  const { chatId, messageId, userId } = params
  const record = await loadSteeringRecord(chatId, messageId)
  if (!record) return { kind: 'send' }
  if (record.disposition?.status === 'applied') return { kind: 'applied' }
  if (!record.disposition) {
    const disposition = await requestStreamSteering({
      streamId: record.streamId,
      userId,
      chatId,
      steeringId: messageId,
      content: record.content,
      ...record.input,
    })
    if (disposition.status === 'applied') {
      await recordSteeringDisposition(chatId, [messageId], disposition)
      return { kind: 'applied' }
    }
    if (disposition.status === 'queued' && !(await steeredRunHasEnded(record.streamId, userId))) {
      return { kind: 'busy', streamId: record.streamId }
    }
  }
  await db.delete(copilotMessages).where(steeringRow(chatId, messageId))
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
 * The same reading decides as for a turn going out under its id, so a message a
 * run applied, or may yet apply, stays where it is. Anything else loses its record,
 * and a row that is a turn's own message is never touched.
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
