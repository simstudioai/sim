import type { SlackInstallationPrincipal } from '@sim/auth/principal'
import { db } from '@sim/db'
import { slackSearchInstallation, slackSearchTurn } from '@sim/db/schema'
import { and, eq } from 'drizzle-orm'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { openSlackDm, postSlackMessage, slackString } from '@/lib/internal/slack/client'
import { authorizeSlackSearchInstallation } from '@/lib/knowledge/application/slack-search/authorization'
import { SLACK_SEARCH_QUERY_TOO_LONG } from '@/lib/slack-search/constants'
import { slackSearchConversationKey } from '@/lib/slack-search/conversation'
import { type SlackSearchJob, slackSearchJobSchema } from '@/lib/slack-search/types'

/**
 * A channel mention starts a private DM thread before any knowledge is retrieved.
 * The durable turn moves to that DM identity, so ordinary replies, FIFO, Stop, and
 * private history use the existing DM path. Failed or ambiguous sends are terminal.
 */
export async function routeSlackSearchMentionToDm(
  principal: SlackInstallationPrincipal,
  input: { job: SlackSearchJob; turnId: string; leaseId: string; signal: AbortSignal }
): Promise<SlackSearchJob> {
  const { job, turnId, leaseId, signal } = input
  const command = job.message.command === '/sim-search' && job.message.messageTs === null
  if (job.message.channelId.startsWith('D') && !command) return job
  if (
    (!command && (!job.message.origin || job.message.origin.channelId !== job.message.channelId)) ||
    principal.eventId !== job.message.eventId
  )
    throw new OrchestrationError('forbidden', 'Slack mention identity is inconsistent')
  const context = await authorizeSlackSearchInstallation(principal, job)
  if (!context) throw new OrchestrationError('forbidden', 'Slack Search binding changed')
  const channelId = await openSlackDm(
    context.secret.botToken,
    job.message.userId,
    AbortSignal.any([signal, AbortSignal.timeout(10_000)])
  )
  if (!/^D[A-Z0-9]+$/.test(channelId))
    throw new Error('Could not open a private Slack conversation')
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
    const [turn] = await tx
      .select()
      .from(slackSearchTurn)
      .where(
        and(eq(slackSearchTurn.id, turnId), eq(slackSearchTurn.installationId, job.installationId))
      )
      .for('update')
      .limit(1)
    if (
      !turn ||
      turn.status !== 'running' ||
      turn.leaseId !== leaseId ||
      !turn.leaseExpiresAt ||
      turn.leaseExpiresAt.getTime() <= Date.now()
    )
      throw new OrchestrationError('forbidden', 'Slack turn ownership was lost')
    const saved = slackSearchJobSchema.parse(turn.payload)
    if (JSON.stringify(saved) !== JSON.stringify(job))
      throw new Error('Slack mention changed before delivery')
    signal.throwIfAborted()
    /** Holding the installation lock also orders immediate DM follow-ups after this root. */
    const response = await postSlackMessage(
      context.secret.botToken,
      {
        channel: channelId,
        text: job.message.queryTooLong
          ? SLACK_SEARCH_QUERY_TOO_LONG
          : 'Your question for Sim Search',
        blocks: [
          {
            type: 'section',
            text: {
              type: 'plain_text',
              text: job.message.queryTooLong ? SLACK_SEARCH_QUERY_TOO_LONG : job.message.query,
            },
          },
        ],
        unfurl_links: false,
        unfurl_media: false,
      },
      AbortSignal.any([signal, AbortSignal.timeout(2000)])
    )
    const threadTs = slackString(response.data, 'ts')
    if (
      response.status !== 200 ||
      response.data.ok !== true ||
      !threadTs ||
      slackString(response.data, 'channel') !== channelId
    )
      throw new Error('Could not create the private Slack question thread')
    const routed = slackSearchJobSchema.parse({
      ...job,
      message: {
        ...job.message,
        channelId,
        threadTs,
        messageTs: job.message.messageTs ?? threadTs,
      },
    })
    await tx
      .update(slackSearchTurn)
      .set({
        payload: routed,
        conversationKey: slackSearchConversationKey(job.installationId, channelId, threadTs),
        updatedAt: new Date(),
      })
      .where(and(eq(slackSearchTurn.id, turnId), eq(slackSearchTurn.leaseId, leaseId)))
    return routed
  })
}
