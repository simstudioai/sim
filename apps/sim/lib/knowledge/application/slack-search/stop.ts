import { db } from '@sim/db'
import { copilotChats, slackSearchInstallation, slackSearchTurn } from '@sim/db/schema'
import { and, asc, eq, inArray, sql } from 'drizzle-orm'
import { z } from 'zod'
import { abortActiveStream } from '@/lib/copilot/request/session/abort'
import type { OperationUseCase } from '@/lib/core/application/operation'
import { authorizeOrganizationOperation } from '@/lib/core/application/organization-authorization'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { getSlackSearchSender } from '@/lib/internal/slack/search-client'
import {
  authorizeSlackSearchInstallation,
  requireSlackInstallationPrincipal,
} from '@/lib/knowledge/application/slack-search/authorization'
import {
  resolveSlackSearchChatRecord,
  slackSearchChatOperation,
} from '@/lib/knowledge/application/slack-search/chat'
import {
  resolveSlackSearchMember,
  SlackSearchIdentityError,
} from '@/lib/knowledge/application/slack-search/identity'
import {
  slackSearchConversation,
  slackSearchConversationKey,
} from '@/lib/slack-search/conversation'
import { slackSearchJobSchema } from '@/lib/slack-search/types'
import { setSlackAgentSessionStatus } from '@/lib/webhooks/slack-agent-api'

const timestamp = z.string().regex(/^\d{1,12}\.\d{1,9}$/)
export const slackSearchStopSchema = z.object({
  type: z.literal('event_callback'),
  api_app_id: z.string().min(1).max(200),
  team_id: z.string().min(1).max(200),
  event_id: z.string().min(1).max(200),
  event: z.object({
    type: z.literal('agent_session_stopped'),
    channel: z.string().regex(/^D[A-Z0-9]+$/),
    thread_ts: timestamp,
    event_ts: timestamp,
    user: z.string().min(1).max(200),
  }),
})
const operation = Object.freeze({
  id: 'knowledge.slack.stop',
  capability: 'knowledge.use',
  principalKinds: ['slack_installation'] as const,
})

/** A signed native Stop cancels only its current verified sender's thread; replay cannot cancel later messages. */
export const stopSlackSearchThread: OperationUseCase<
  typeof operation,
  z.infer<typeof slackSearchStopSchema>,
  void
> = {
  operation,
  async execute({ principal, input }) {
    requireSlackInstallationPrincipal(principal)
    if (
      principal.appId !== input.api_app_id ||
      principal.teamId !== input.team_id ||
      principal.eventId !== input.event_id
    )
      throw new OrchestrationError('forbidden', 'Slack Stop binding changed')
    const context = await authorizeSlackSearchInstallation(principal)
    if (!context) return
    const { installation, secret } = context
    const conversationKey = slackSearchConversationKey(
      installation.id,
      input.event.channel,
      input.event.thread_ts
    )
    const [first] = await db
      .select()
      .from(slackSearchTurn)
      .where(eq(slackSearchTurn.conversationKey, conversationKey))
      .orderBy(asc(slackSearchTurn.ordinal))
      .limit(1)
    if (!first) return
    const job = slackSearchJobSchema.parse(first.payload)
    if (
      slackSearchConversationKey(
        job.installationId,
        job.message.channelId,
        job.message.threadTs ?? job.message.messageTs
      ) !== conversationKey
    )
      throw new Error('Persisted Slack event has an inconsistent conversation identity')
    if (job.message.userId !== input.event.user) throw new SlackSearchIdentityError()
    const sender = await getSlackSearchSender(
      secret.botToken,
      input.event.user,
      installation.teamId,
      AbortSignal.timeout(10_000)
    )
    if (!sender) throw new SlackSearchIdentityError()
    const userId = await resolveSlackSearchMember(
      installation.organizationId,
      installation.teamId,
      input.event.user,
      sender.email
    )
    const issuedAt = new Date()
    await authorizeOrganizationOperation(
      {
        kind: 'organization_delegated',
        serviceId: 'slack-search',
        organizationId: installation.organizationId,
        subjectUserId: userId,
        delegationId: input.event_id,
        audience: 'sim:knowledge',
        issuedAt,
        expiresAt: new Date(issuedAt.getTime() + 60_000),
        resourceScope: { installationId: installation.id, eventId: input.event_id },
      },
      slackSearchChatOperation,
      installation
    )
    const cancelled = await db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(slackSearchInstallation)
        .where(eq(slackSearchInstallation.id, installation.id))
        .for('update')
        .limit(1)
      if (
        !current?.enabled ||
        current.revision !== installation.revision ||
        current.credentialVersion !== installation.credentialVersion
      )
        throw new OrchestrationError('forbidden', 'Slack Search binding changed')
      const chat = await resolveSlackSearchChatRecord(tx, {
        organizationId: installation.organizationId,
        userId,
        conversation: slackSearchConversation(job),
      })
      const [updated] = await tx
        .update(copilotChats)
        .set({
          externalConversationMetadata: sql`jsonb_set(${copilotChats.externalConversationMetadata}, '{lastStopTs}', to_jsonb(${input.event.event_ts}::text))`,
        })
        .where(
          and(
            eq(copilotChats.id, chat.id),
            sql`(${copilotChats.externalConversationMetadata}->>'lastStopTs' IS NULL OR (${copilotChats.externalConversationMetadata}->>'lastStopTs')::numeric < ${input.event.event_ts}::numeric)`
          )
        )
        .returning({ id: copilotChats.id })
      if (!updated) return null
      return tx
        .update(slackSearchTurn)
        .set({ status: 'cancelled', outcome: 'stopped', updatedAt: new Date() })
        .where(
          and(
            eq(slackSearchTurn.conversationKey, conversationKey),
            inArray(slackSearchTurn.status, ['pending', 'running']),
            sql`(${slackSearchTurn.payload} #>> '{message,messageTs}')::numeric <= ${input.event.event_ts}::numeric`
          )
        )
        .returning({ id: slackSearchTurn.id })
    })
    if (!cancelled) return
    await Promise.all(cancelled.map((turn) => abortActiveStream(turn.id)))
    if (await authorizeSlackSearchInstallation(principal))
      await setSlackAgentSessionStatus(
        secret.botToken,
        { channel: input.event.channel, threadTs: input.event.thread_ts },
        'active',
        AbortSignal.timeout(10_000)
      )
  },
}
