import type { SlackInstallationPrincipal } from '@sim/auth/principal'
import type { OperationUseCase } from '@/lib/core/application/operation'
import { getInlineJobQueue } from '@/lib/core/async-jobs'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { getBaseUrl } from '@/lib/core/utils/urls'
import { requestSlackApi } from '@/lib/internal/slack/client'
import {
  authorizeSlackSearchInstallation,
  requireSlackInstallationPrincipal,
} from '@/lib/knowledge/application/slack-search/authorization'
import { organizationRoutes } from '@/lib/navigation/paths'
import {
  renderSlackSearchHome,
  SLACK_SEARCH_HOME_MAX_AGE_MS,
  type SlackSearchHomeEvent,
  type SlackSearchHomeJob,
  slackSearchHomeJobSchema,
  slackSearchHomeViewKey,
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

/** Current views acknowledge immediately; first visits and obsolete layouts queue one static publication. */
export const receiveSlackSearchHome: OperationUseCase<
  typeof operation,
  SlackSearchHomeEvent,
  void
> = {
  operation,
  async execute({ principal, input }) {
    requireSlackInstallationPrincipal(principal)
    requireHomeBinding(principal, input)
    if (
      input.viewKey ===
      slackSearchHomeViewKey(principal.credentialId, principal.credentialVersion, getBaseUrl())
    )
      return
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

/** Publishes a static organization link with no member, account, or source lookup. Sim authorizes the click. */
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
    const baseUrl = getBaseUrl()
    signal.throwIfAborted()
    const response = await requestSlackApi({
      accessToken: secret.botToken,
      method: 'views.publish',
      body: {
        user_id: job.event.userId,
        ...(job.event.viewHash ? { hash: job.event.viewHash } : {}),
        view: renderSlackSearchHome({
          sourcesUrl: new URL(organizationRoutes(installation.organizationId).integrations, baseUrl)
            .href,
          viewKey: slackSearchHomeViewKey(
            principal.credentialId,
            principal.credentialVersion,
            baseUrl
          ),
        }),
      },
      signal,
    })
    if (response.status !== 200 || response.data.ok !== true)
      throw new Error('Could not publish the Slack Search Home tab')
  },
}
