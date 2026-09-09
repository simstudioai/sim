import { db } from '@sim/db'
import { outboxEvent, slackSearchInstallation, slackSearchTurn } from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import { and, asc, eq, inArray, lt, sql } from 'drizzle-orm'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { enqueueOutboxEvent } from '@/lib/core/outbox/service'
import {
  findSlackSearchChatRecord,
  requireSlackSearchConversationSender,
  resolveSlackSearchChatRecord,
} from '@/lib/knowledge/application/slack-search/chat'
import {
  SLACK_SEARCH_CONCURRENCY,
  SLACK_SEARCH_MAX_DURATION_SECONDS,
  SLACK_SEARCH_MAX_PENDING_TURNS,
} from '@/lib/slack-search/constants'
import {
  slackSearchConversation,
  slackSearchConversationKey,
  slackSearchConversationSchema,
} from '@/lib/slack-search/conversation'
import { type SlackSearchJob, slackSearchJobSchema } from '@/lib/slack-search/types'

export const SLACK_SEARCH_TURN_EVENT = 'slack-search.turn'
export function slackSearchTurnOutboxId(turnId: string) {
  return `slack-search-turn:${turnId}`
}

/** Commits the turn and its retryable dispatch together; only dispatch, never execution, is retried. */
export async function persistSlackSearchTurn(job: SlackSearchJob, expectedUserId?: string) {
  return db.transaction(async (tx) => {
    const [installation] = await tx
      .select()
      .from(slackSearchInstallation)
      .where(eq(slackSearchInstallation.id, job.installationId))
      .for('update')
      .limit(1)
    if (
      !installation?.enabled ||
      installation.revision !== job.revision ||
      installation.credentialVersion !== job.credentialVersion
    )
      throw new OrchestrationError('forbidden', 'Slack Search binding changed')
    const [duplicate] = await tx
      .select({
        id: slackSearchTurn.id,
        conversationKey: slackSearchTurn.conversationKey,
        payload: slackSearchTurn.payload,
      })
      .from(slackSearchTurn)
      .where(
        and(
          eq(slackSearchTurn.installationId, installation.id),
          eq(slackSearchTurn.eventId, job.message.eventId)
        )
      )
      .limit(1)
    const conversation = slackSearchConversation(job)
    const conversationKey = slackSearchConversationKey(
      installation.id,
      conversation.channelId,
      conversation.threadTs
    )
    if (duplicate && job.message.origin) {
      const original = slackSearchJobSchema.parse(duplicate.payload)
      if (
        original.message.userId !== job.message.userId ||
        original.message.query !== job.message.query ||
        original.message.queryTooLong !== job.message.queryTooLong ||
        JSON.stringify(original.message.origin) !== JSON.stringify(job.message.origin)
      )
        throw new OrchestrationError('forbidden', 'Slack event identity changed')
      return duplicate.id
    }
    if (duplicate && duplicate.conversationKey !== conversationKey)
      throw new OrchestrationError('forbidden', 'Slack event conversation changed')
    await requireSlackSearchConversationSender(tx, conversation)
    const chat = expectedUserId
      ? await resolveSlackSearchChatRecord(tx, {
          organizationId: installation.organizationId,
          userId: expectedUserId,
          conversation,
        })
      : await findSlackSearchChatRecord(tx, conversation)
    if (
      chat &&
      (chat.organizationId !== installation.organizationId ||
        chat.type !== 'mothership' ||
        chat.deletedAt)
    )
      throw new OrchestrationError('not_found', 'The private conversation is no longer available')
    if (duplicate) return duplicate.id
    const lastStopTs = chat
      ? slackSearchConversationSchema.parse(chat.externalConversationMetadata).lastStopTs
      : null
    const [pending] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(slackSearchTurn)
      .where(
        and(
          eq(slackSearchTurn.conversationKey, conversationKey),
          eq(slackSearchTurn.status, 'pending')
        )
      )
    if (pending.count >= SLACK_SEARCH_MAX_PENDING_TURNS)
      throw new OrchestrationError('validation', 'This thread already has twenty queued questions')
    const id = generateId()
    const cancelled = lastStopTs !== null && Number(job.message.messageTs) <= Number(lastStopTs)
    await tx.insert(slackSearchTurn).values({
      id,
      installationId: installation.id,
      conversationKey,
      eventId: job.message.eventId,
      payload: job,
      ...(cancelled ? { status: 'cancelled' as const, outcome: 'stopped' } : {}),
    })
    await enqueueOutboxEvent(
      tx,
      SLACK_SEARCH_TURN_EVENT,
      { turnId: id },
      { id: slackSearchTurnOutboxId(id) }
    )
    return id
  })
}

/** An installation row lock serializes cross-worker concurrency and per-thread FIFO admission. */
export async function claimSlackSearchTurn(turnId: string) {
  const [candidate] = await db
    .select()
    .from(slackSearchTurn)
    .where(eq(slackSearchTurn.id, turnId))
    .limit(1)
  if (!candidate) return null
  return db.transaction(async (tx) => {
    await tx
      .select({ id: slackSearchInstallation.id })
      .from(slackSearchInstallation)
      .where(eq(slackSearchInstallation.id, candidate.installationId))
      .for('update')
    await tx
      .update(slackSearchTurn)
      .set({ status: 'failed', outcome: 'worker_expired', updatedAt: new Date() })
      .where(
        and(
          eq(slackSearchTurn.installationId, candidate.installationId),
          eq(slackSearchTurn.status, 'running'),
          lt(slackSearchTurn.leaseExpiresAt, new Date())
        )
      )
    const [turn] = await tx
      .select()
      .from(slackSearchTurn)
      .where(eq(slackSearchTurn.id, turnId))
      .for('update')
      .limit(1)
    if (!turn || turn.status !== 'pending') return null
    const active = await tx
      .select({ conversationKey: slackSearchTurn.conversationKey })
      .from(slackSearchTurn)
      .where(
        and(
          eq(slackSearchTurn.installationId, turn.installationId),
          eq(slackSearchTurn.status, 'running')
        )
      )
      .limit(SLACK_SEARCH_CONCURRENCY)
    if (
      active.length >= SLACK_SEARCH_CONCURRENCY ||
      active.some((row) => row.conversationKey === turn.conversationKey)
    )
      return null
    const [head] = await tx
      .select({ id: slackSearchTurn.id })
      .from(slackSearchTurn)
      .where(
        and(
          eq(slackSearchTurn.conversationKey, turn.conversationKey),
          eq(slackSearchTurn.status, 'pending')
        )
      )
      .orderBy(asc(slackSearchTurn.ordinal))
      .limit(1)
    if (head?.id !== turn.id) return null
    const leaseId = generateId()
    const [claimed] = await tx
      .update(slackSearchTurn)
      .set({
        status: 'running',
        leaseId,
        leaseExpiresAt: new Date(Date.now() + (SLACK_SEARCH_MAX_DURATION_SECONDS + 30) * 1000),
        updatedAt: new Date(),
      })
      .where(eq(slackSearchTurn.id, turn.id))
      .returning()
    return { turn: claimed, job: slackSearchJobSchema.parse(turn.payload), leaseId }
  })
}

export async function requireSlackSearchTurnLease(turnId: string, leaseId: string) {
  const [turn] = await db
    .select()
    .from(slackSearchTurn)
    .where(eq(slackSearchTurn.id, turnId))
    .limit(1)
  if (
    !turn ||
    turn.status !== 'running' ||
    turn.leaseId !== leaseId ||
    !turn.leaseExpiresAt ||
    turn.leaseExpiresAt.getTime() <= Date.now()
  )
    throw new OrchestrationError('forbidden', 'Slack Search turn is no longer active')
  return turn
}

export async function finishSlackSearchTurn(
  turnId: string,
  leaseId: string,
  status: 'completed' | 'failed',
  outcome: string
) {
  await db
    .update(slackSearchTurn)
    .set({ status, outcome, updatedAt: new Date() })
    .where(
      and(
        eq(slackSearchTurn.id, turnId),
        eq(slackSearchTurn.leaseId, leaseId),
        eq(slackSearchTurn.status, 'running')
      )
    )
}

/** Only a persisted native Stop is presented as user cancellation in private history. */
export async function wasSlackSearchTurnStopped(turnId: string, leaseId: string) {
  const [turn] = await db
    .select({ id: slackSearchTurn.id })
    .from(slackSearchTurn)
    .where(
      and(
        eq(slackSearchTurn.id, turnId),
        eq(slackSearchTurn.leaseId, leaseId),
        eq(slackSearchTurn.status, 'cancelled'),
        eq(slackSearchTurn.outcome, 'stopped')
      )
    )
    .limit(1)
  return Boolean(turn)
}

export async function readySlackSearchDispatches(installationId: string) {
  const pending = await db
    .select({ id: slackSearchTurn.id })
    .from(slackSearchTurn)
    .where(
      and(eq(slackSearchTurn.installationId, installationId), eq(slackSearchTurn.status, 'pending'))
    )
    .orderBy(asc(slackSearchTurn.ordinal))
    .limit(20)
  const ids = pending.map((turn) => slackSearchTurnOutboxId(turn.id))
  if (ids.length)
    await db
      .update(outboxEvent)
      .set({ availableAt: new Date() })
      .where(and(inArray(outboxEvent.id, ids), eq(outboxEvent.status, 'pending')))
  return ids
}
