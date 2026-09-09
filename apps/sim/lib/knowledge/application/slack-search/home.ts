import type { SlackInstallationPrincipal } from '@sim/auth/principal'
import type { OperationUseCase } from '@/lib/core/application/operation'
import { getInlineJobQueue } from '@/lib/core/async-jobs'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { getBaseUrl } from '@/lib/core/utils/urls'
import { requestSlackApi } from '@/lib/internal/slack/client'
import { getSlackSearchSender } from '@/lib/internal/slack/search-client'
import { listSearchSources } from '@/lib/knowledge/application/search-sources'
import {
  authorizeSlackSearchInstallation,
  requireSlackInstallationPrincipal,
} from '@/lib/knowledge/application/slack-search/authorization'
import {
  resolveSlackSearchMember,
  SlackSearchIdentityError,
} from '@/lib/knowledge/application/slack-search/identity'
import { slackSearchMemberPrincipal } from '@/lib/knowledge/application/slack-search/member-principal'
import { organizationRoutes } from '@/lib/navigation/paths'
import {
  renderSlackSearchHome,
  SLACK_SEARCH_HOME_MAX_AGE_MS,
  SLACK_SEARCH_HOME_MAX_SOURCES,
  type SlackSearchHomeEvent,
  type SlackSearchHomeJob,
  type SlackSearchHomeSource,
  slackSearchHomeJobSchema,
  slackSearchHomeSource,
} from '@/lib/slack-search/home'

const operation = Object.freeze({
  id: 'knowledge.slack.home.publish',
  capability: 'knowledge.use',
  principalKinds: ['slack_installation'] as const,
})

function requireHomeBinding(principal: SlackInstallationPrincipal, event: SlackSearchHomeEvent) {
  if (
    principal.appId !== event.appId ||
    principal.teamId !== event.teamId ||
    principal.eventId !== event.eventId ||
    principal.receivedAt.getTime() < Date.now() - SLACK_SEARCH_HOME_MAX_AGE_MS
  )
    throw new OrchestrationError('forbidden', 'Slack Home event authority is no longer valid')
}

/** Persists a deduplicated, bounded app-process job so Slack can acknowledge Home opens promptly. */
export const receiveSlackSearchHome: OperationUseCase<
  typeof operation,
  SlackSearchHomeEvent,
  void
> = {
  operation,
  async execute({ principal, input }) {
    requireSlackInstallationPrincipal(principal)
    requireHomeBinding(principal, input)
    const context = await authorizeSlackSearchInstallation(principal)
    if (!context || input.userId === context.installation.botUserId) return
    const job: SlackSearchHomeJob = {
      installationId: context.installation.id,
      revision: context.installation.revision,
      credentialId: principal.credentialId,
      credentialVersion: principal.credentialVersion,
      receivedAt: principal.receivedAt.getTime(),
      event: input,
    }
    await (await getInlineJobQueue()).enqueue('slack-search', job, {
      jobId: `slack-search-home:${job.installationId}:${input.eventId}`,
      maxAttempts: 1,
      maxDurationSeconds: 30,
      concurrencyKey: `slack-search-home:${job.installationId}`,
      concurrencyLimit: 2,
      async runner(payload, signal) {
        const queued = slackSearchHomeJobSchema.parse(payload)
        await publishSlackSearchHome.execute({
          principal: {
            kind: 'slack_installation',
            credentialId: queued.credentialId,
            credentialVersion: queued.credentialVersion,
            appId: queued.event.appId,
            teamId: queued.event.teamId,
            eventId: queued.event.eventId,
            receivedAt: new Date(queued.receivedAt),
          },
          input: { job: queued, signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]) },
        })
      },
    })
  },
}

/** Resolves the event's member, reads the product's authorized source list, and publishes only to that Slack user. */
export const publishSlackSearchHome: OperationUseCase<
  typeof operation,
  { job: SlackSearchHomeJob; signal: AbortSignal },
  void
> = {
  operation,
  async execute({ principal, input: { job, signal } }) {
    requireSlackInstallationPrincipal(principal)
    requireHomeBinding(principal, job.event)
    signal.throwIfAborted()
    const context = await authorizeSlackSearchInstallation(principal, job)
    if (!context) return
    const { installation, secret } = context
    const sender = await getSlackSearchSender(
      secret.botToken,
      job.event.userId,
      installation.teamId,
      signal
    )
    if (!sender) throw new SlackSearchIdentityError()
    const sources: SlackSearchHomeSource[] = []
    let userId: string | undefined
    try {
      userId = await resolveSlackSearchMember(
        installation.organizationId,
        installation.teamId,
        job.event.userId,
        sender.email
      )
    } catch (error) {
      if (!(error instanceof SlackSearchIdentityError)) throw error
    }
    let hasMore = false
    let memberPrincipal: ReturnType<typeof slackSearchMemberPrincipal> | undefined
    if (userId) {
      memberPrincipal = slackSearchMemberPrincipal(
        { installationId: installation.id, message: { eventId: job.event.eventId } },
        installation.organizationId,
        userId
      )
      let cursor: string | undefined
      /** Bound sparse pages as well as visible rows; the existing Sources page handles the remainder. */
      for (let page = 0; page < 4; page++) {
        signal.throwIfAborted()
        const result = await listSearchSources.execute({
          principal: memberPrincipal,
          input: { organizationId: installation.organizationId, cursor },
        })
        const visible = result.sources.flatMap((source) => {
          const row = slackSearchHomeSource(source)
          return row ? [row] : []
        })
        const remaining = SLACK_SEARCH_HOME_MAX_SOURCES - sources.length
        sources.push(...visible.slice(0, remaining))
        hasMore = Boolean(result.nextCursor) || visible.length > remaining
        if (!result.nextCursor || sources.length === SLACK_SEARCH_HOME_MAX_SOURCES) break
        cursor = result.nextCursor
      }
    }
    const current = await authorizeSlackSearchInstallation(principal, job)
    if (!current) return
    if (memberPrincipal) {
      const currentUserId = await resolveSlackSearchMember(
        installation.organizationId,
        installation.teamId,
        job.event.userId,
        sender.email
      )
      if (currentUserId !== userId) throw new SlackSearchIdentityError('identity_conflict')
      await listSearchSources.authorize({
        principal: memberPrincipal,
        input: { organizationId: installation.organizationId },
      })
    }
    signal.throwIfAborted()
    const response = await requestSlackApi({
      accessToken: current.secret.botToken,
      method: 'views.publish',
      body: {
        user_id: job.event.userId,
        ...(job.event.viewHash ? { hash: job.event.viewHash } : {}),
        view: renderSlackSearchHome({
          sourcesUrl: new URL(
            organizationRoutes(installation.organizationId).integrations,
            getBaseUrl()
          ).href,
          sources,
          hasMore,
          accountRequired: !userId,
        }),
      },
      signal,
    })
    if (response.status !== 200 || response.data.ok !== true)
      throw new Error('Could not publish the Slack Search Home tab')
  },
}
