import type { Principal, SlackInstallationPrincipal } from '@sim/auth/principal'
import { db } from '@sim/db'
import { copilotChats, slackSearchTurn, user } from '@sim/db/schema'
import { isOrgAdminRole } from '@sim/platform-authz/workspace'
import { normalizeEmail } from '@sim/utils/string'
import { and, eq } from 'drizzle-orm'
import {
  assertOperationPrincipal,
  defineOperation,
  type OperationUseCase,
} from '@/lib/core/application/operation'
import { authorizeOrganizationOperation } from '@/lib/core/application/organization-authorization'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { postSlackMessage, requestSlackApi, slackString } from '@/lib/internal/slack/client'
import { getSlackSearchSender } from '@/lib/internal/slack/search-client'
import { knowledgeOperations } from '@/lib/knowledge/application/operations'
import { authorizeSlackSearchInstallation } from '@/lib/knowledge/application/slack-search/authorization'
import {
  resolveSlackSearchMember,
  SlackSearchIdentityError,
} from '@/lib/knowledge/application/slack-search/identity'
import { dispatchSlackSearchTurn } from '@/lib/knowledge/application/slack-search/outbox'
import { recordSlackSearchOutcome } from '@/lib/knowledge/application/slack-search/repository'
import { getSlackSearchSourceStatus } from '@/lib/knowledge/application/slack-search/source-status'
import {
  persistSlackSearchTurn,
  requireSlackSearchTurnLease,
} from '@/lib/knowledge/application/slack-search/turns'
import {
  slackSearchConversationKey,
  slackSearchConversationSchema,
} from '@/lib/slack-search/conversation'
import {
  SLACK_SEARCH_CONNECT_ACCOUNT,
  SLACK_SEARCH_CONNECT_SOURCES,
  slackSearchOnboardingUrl,
} from '@/lib/slack-search/onboarding'
import {
  readSlackSearchOnboardingState,
  storeSlackSearchOnboardingState,
} from '@/lib/slack-search/onboarding-state'
import { type SlackSearchJob, slackSearchJobSchema } from '@/lib/slack-search/types'

export const slackSearchOnboardingOperations = {
  /**
   * permission-group-exempt: exposes only the signed-in sender's onboarding state before membership; organization reads separately authorize knowledge.use.
   */
  read: defineOperation({
    id: 'knowledge.slack.onboarding.read',
    capability: 'none',
    principalKinds: ['session'],
  }),
  retry: defineOperation({
    id: 'knowledge.slack.onboarding.retry',
    capability: 'knowledge.use',
    principalKinds: ['session'],
  }),
} as const

/** A deterministic setup reply is a separate control message, never a fallback for a failed answer. */
export async function sendSlackSearchOnboarding(
  principal: SlackInstallationPrincipal,
  input: {
    job: SlackSearchJob
    turnId: string
    leaseId: string
    email: string
    reason: 'account' | 'sources'
    signal: AbortSignal
  }
) {
  const { job, turnId, leaseId, email, reason, signal } = input
  const context = await authorizeSlackSearchInstallation(principal, job)
  if (!context) throw new OrchestrationError('forbidden', 'Slack Search is disabled')
  const sender = await getSlackSearchSender(
    context.secret.botToken,
    job.message.userId,
    job.message.teamId,
    signal
  )
  if (!sender || sender.email !== email) throw new SlackSearchIdentityError('identity_conflict')
  const link = await requestSlackApi({
    accessToken: context.secret.botToken,
    method: 'chat.getPermalink',
    httpMethod: 'GET',
    query: {
      channel: job.message.channelId,
      message_ts: job.message.threadTs ?? job.message.messageTs,
    },
    signal,
  })
  const permalink = slackString(link.data, 'permalink')
  if (link.status !== 200 || link.data.ok !== true || !permalink)
    throw new Error('Could not resolve the Slack question link')
  const slackUrl = new URL(permalink)
  if (
    slackUrl.protocol !== 'https:' ||
    !slackUrl.hostname.endsWith('.slack.com') ||
    slackUrl.username ||
    slackUrl.password
  )
    throw new Error('Slack returned an invalid question link')
  slackUrl.searchParams.set('thread_ts', job.message.threadTs ?? job.message.messageTs)
  slackUrl.searchParams.set('cid', job.message.channelId)
  const token = await storeSlackSearchOnboardingState({
    turnId,
    email,
    slackUrl: slackUrl.href,
    createdAt: Date.now(),
  })
  const text = reason === 'account' ? SLACK_SEARCH_CONNECT_ACCOUNT : SLACK_SEARCH_CONNECT_SOURCES
  const url = slackSearchOnboardingUrl(token)
  await requireSlackSearchTurnLease(turnId, leaseId)
  if (!(await authorizeSlackSearchInstallation(principal, job)))
    throw new OrchestrationError('forbidden', 'Slack Search is disabled')
  const message = {
    channel: job.message.channelId,
    text,
    blocks: [
      { type: 'section', text: { type: 'plain_text', text } },
      {
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: {
              type: 'plain_text',
              text: reason === 'account' ? 'Get started with Sim' : 'Connect sources',
            },
            url,
            action_id: 'slack_search_onboarding',
          },
        ],
      },
    ],
  }
  /** Channel-level ephemeral prompts also display before the first persistent thread reply exists. */
  const response =
    reason === 'sources'
      ? await requestSlackApi({
          accessToken: context.secret.botToken,
          method: 'chat.postEphemeral',
          body: { ...message, user: job.message.userId },
          signal,
        })
      : await postSlackMessage(
          context.secret.botToken,
          {
            ...message,
            thread_ts: job.message.threadTs ?? job.message.messageTs,
            unfurl_links: false,
            unfurl_media: false,
          },
          signal
        )
  if (response.status !== 200 || response.data.ok !== true)
    throw new Error('Could not deliver Slack onboarding')
  if (reason === 'sources') {
    await requireSlackSearchTurnLease(turnId, leaseId)
    if (!(await authorizeSlackSearchInstallation(principal, job)))
      throw new OrchestrationError('forbidden', 'Slack Search is disabled')
    signal.throwIfAborted()
    const reply = await postSlackMessage(
      context.secret.botToken,
      {
        channel: job.message.channelId,
        thread_ts: job.message.threadTs ?? job.message.messageTs,
        text: 'I don’t have any sources I can search for you yet. Check the “Connect sources” message in our DM to get set up, then retry this question.',
        unfurl_links: false,
        unfurl_media: false,
      },
      signal
    )
    if (reply.status !== 200 || reply.data.ok !== true)
      throw new Error('Could not deliver the Slack sources notice')
  }
  await recordSlackSearchOutcome(
    context.installation,
    reason === 'account' ? 'account_required' : 'sources_required'
  )
  return { text, url }
}

type OnboardingBlocked = {
  status: 'wrong_account' | 'verify_email' | 'membership_required' | 'identity_conflict'
}
interface OnboardingReady {
  status: 'needs_sources' | 'ready' | 'retried'
  organizationId: string
  isAdmin: boolean
  question: string
  slackUrl: string
}

async function resolveOnboarding(principal: Principal, token: string) {
  assertOperationPrincipal(principal, slackSearchOnboardingOperations.read)
  const state = await readSlackSearchOnboardingState(token)
  const [viewer] = await db
    .select({ email: user.email, emailVerified: user.emailVerified })
    .from(user)
    .where(eq(user.id, principal.userId))
    .limit(1)
  if (!viewer || normalizeEmail(viewer.email) !== state.email)
    return { view: { status: 'wrong_account' } as OnboardingBlocked }
  if (!viewer.emailVerified) return { view: { status: 'verify_email' } as OnboardingBlocked }
  const [turn] = await db
    .select()
    .from(slackSearchTurn)
    .where(eq(slackSearchTurn.id, state.turnId))
    .limit(1)
  if (!turn || turn.status !== 'completed')
    throw new OrchestrationError(
      'validation',
      'This question cannot be retried. Send it to the Slack bot again.'
    )
  const job = slackSearchJobSchema.parse(turn.payload)
  const slackPrincipal: SlackInstallationPrincipal = {
    kind: 'slack_installation',
    credentialId: job.credentialId,
    credentialVersion: job.credentialVersion,
    appId: job.message.appId,
    teamId: job.message.teamId,
    eventId: job.message.eventId,
    receivedAt: new Date(job.receivedAt),
  }
  const context = await authorizeSlackSearchInstallation(slackPrincipal, job)
  if (!context)
    throw new OrchestrationError(
      'forbidden',
      'Slack Search is disabled. Ask your administrator to reconnect it.'
    )
  const sender = await getSlackSearchSender(
    context.secret.botToken,
    job.message.userId,
    job.message.teamId,
    AbortSignal.timeout(10_000)
  )
  if (!sender || sender.email !== state.email)
    return { view: { status: 'identity_conflict' } as OnboardingBlocked }
  try {
    const userId = await resolveSlackSearchMember(
      context.installation.organizationId,
      job.message.teamId,
      job.message.userId,
      sender.email
    )
    if (userId !== principal.userId)
      return { view: { status: 'identity_conflict' } as OnboardingBlocked }
  } catch (error) {
    if (!(error instanceof SlackSearchIdentityError)) throw error
    return {
      view: {
        status:
          error.reason === 'membership_required' ? 'membership_required' : 'identity_conflict',
      } as OnboardingBlocked,
    }
  }
  const membership = await authorizeOrganizationOperation(
    principal,
    knowledgeOperations.search.organizationOperation,
    context.installation
  )
  const conversationKey = slackSearchConversationKey(
    job.installationId,
    job.message.channelId,
    job.message.threadTs ?? job.message.messageTs
  )
  if (turn.conversationKey !== conversationKey)
    throw new OrchestrationError('forbidden', 'The Slack conversation binding changed')
  const [chat] = await db
    .select()
    .from(copilotChats)
    .where(eq(copilotChats.externalConversationKey, conversationKey))
    .limit(1)
  if (chat) {
    const binding = slackSearchConversationSchema.parse(chat.externalConversationMetadata)
    if (
      chat.userId !== principal.userId ||
      chat.organizationId !== context.installation.organizationId ||
      chat.type !== 'mothership' ||
      chat.deletedAt ||
      binding.installationId !== job.installationId ||
      binding.slackUserId !== job.message.userId ||
      binding.channelId !== job.message.channelId ||
      binding.threadTs !== (job.message.threadTs ?? job.message.messageTs)
    )
      throw new OrchestrationError('forbidden', 'The Slack thread belongs to a different account')
  }
  const retryEventId = `slack-onboarding:${turn.id}`
  const [retried] = await db
    .select({ id: slackSearchTurn.id })
    .from(slackSearchTurn)
    .where(
      and(
        eq(slackSearchTurn.installationId, job.installationId),
        eq(slackSearchTurn.eventId, retryEventId)
      )
    )
    .limit(1)
  const sources = await getSlackSearchSourceStatus.execute({
    principal,
    input: { organizationId: context.installation.organizationId },
  })
  const view: OnboardingReady = {
    status: retried ? 'retried' : sources.hasSearchableDocuments ? 'ready' : 'needs_sources',
    organizationId: context.installation.organizationId,
    isAdmin: isOrgAdminRole(membership.role),
    question: job.message.query,
    slackUrl: state.slackUrl,
  }
  return { view, job, retryEventId, retryTurnId: retried?.id }
}

export const getSlackSearchOnboarding: OperationUseCase<
  typeof slackSearchOnboardingOperations.read,
  { token: string },
  OnboardingBlocked | OnboardingReady
> = {
  operation: slackSearchOnboardingOperations.read,
  async execute({ principal, input }) {
    return (await resolveOnboarding(principal, input.token)).view
  },
}

/** One explicit retry per original question; durable event identity and outbox insertion make repeated clicks harmless. */
export const retrySlackSearchOnboarding: OperationUseCase<
  typeof slackSearchOnboardingOperations.retry,
  { token: string },
  { slackUrl: string }
> = {
  operation: slackSearchOnboardingOperations.retry,
  async execute({ principal, input }) {
    assertOperationPrincipal(principal, slackSearchOnboardingOperations.retry)
    const resolved = await resolveOnboarding(principal, input.token)
    if (!resolved.job || !('slackUrl' in resolved.view))
      throw new OrchestrationError('forbidden', 'Complete your Sim account setup before retrying')
    if (resolved.view.status === 'needs_sources')
      throw new OrchestrationError(
        'validation',
        'Connect a source and wait for indexing before retrying'
      )
    let turnId = resolved.retryTurnId
    if (!turnId) {
      const now = Date.now()
      turnId = await persistSlackSearchTurn(
        {
          ...resolved.job,
          receivedAt: now,
          message: {
            ...resolved.job.message,
            eventId: resolved.retryEventId,
            threadTs: resolved.job.message.threadTs ?? resolved.job.message.messageTs,
            messageTs: `${Math.floor(now / 1000)}.${String((now % 1000) * 1000).padStart(6, '0')}`,
          },
        },
        principal.userId
      )
    }
    await dispatchSlackSearchTurn(turnId)
    return { slackUrl: resolved.view.slackUrl }
  },
}
