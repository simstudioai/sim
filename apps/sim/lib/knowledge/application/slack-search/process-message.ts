import type {
  OrganizationDelegatedPrincipal,
  SlackInstallationPrincipal,
} from '@sim/auth/principal'
import { createLogger } from '@sim/logger'
import type { OperationUseCase } from '@/lib/core/application/operation'
import { authorizeOrganizationOperation } from '@/lib/core/application/organization-authorization'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { getBaseUrl } from '@/lib/core/utils/urls'
import { postSlackMessage, type SlackMessage } from '@/lib/internal/slack/client'
import { getSlackSearchSender, SlackSearchProviderError } from '@/lib/internal/slack/search-client'
import { KnowledgeUsageLimitExceededError } from '@/lib/knowledge/application/billing'
import { knowledgeOperations } from '@/lib/knowledge/application/operations'
import {
  authorizeSlackSearchInstallation,
  requireSlackInstallationPrincipal,
} from '@/lib/knowledge/application/slack-search/authorization'
import {
  resolveSlackSearchMember,
  SlackSearchIdentityError,
} from '@/lib/knowledge/application/slack-search/identity'
import { recordSlackSearchOutcome } from '@/lib/knowledge/application/slack-search/repository'
import { searchScopedKnowledge } from '@/lib/knowledge/application/workspace-search'
import { renderSlackSearchResults, slackSearchReply } from '@/lib/slack-search/messages'
import { enqueueSlackSearch } from '@/lib/slack-search/queue'
import type { SlackSearchJob, SlackSearchMessage } from '@/lib/slack-search/types'

const logger = createLogger('SlackSearch')
const receiveOperation = Object.freeze({
  id: 'knowledge.slack.receive',
  capability: 'knowledge.use',
  principalKinds: ['slack_installation'] as const,
})
const respondOperation = Object.freeze({
  id: 'knowledge.slack.respond',
  capability: 'knowledge.use',
  principalKinds: ['slack_installation'] as const,
})

function requireMessageBinding(principal: SlackInstallationPrincipal, message: SlackSearchMessage) {
  if (
    principal.appId !== message.appId ||
    principal.teamId !== message.teamId ||
    principal.eventId !== message.eventId
  )
    throw new OrchestrationError(
      'forbidden',
      'Slack event does not match its authenticated context'
    )
}

export const receiveSlackSearchMessage: OperationUseCase<
  typeof receiveOperation,
  SlackSearchMessage,
  void
> = {
  operation: receiveOperation,
  async execute({ principal, input }) {
    requireSlackInstallationPrincipal(principal)
    requireMessageBinding(principal, input)
    const context = await authorizeSlackSearchInstallation(principal)
    if (!context || input.userId === context.installation.botUserId) return
    await enqueueSlackSearch({
      installationId: context.installation.id,
      revision: context.installation.revision,
      credentialId: principal.credentialId,
      credentialVersion: principal.credentialVersion,
      receivedAt: principal.receivedAt.getTime(),
      message: input,
    })
  },
}

interface RespondInput {
  job: SlackSearchJob
  signal: AbortSignal
  rateLimited: boolean
}

export const respondToSlackSearchMessage: OperationUseCase<
  typeof respondOperation,
  RespondInput,
  void
> = {
  operation: respondOperation,
  async execute({ principal, input }) {
    requireSlackInstallationPrincipal(principal)
    const { job, signal } = input
    const message = job.message
    requireMessageBinding(principal, message)
    const context = await authorizeSlackSearchInstallation(principal, job)
    if (!context || message.userId === context.installation.botUserId) return
    const { installation, secret } = context
    let reply: SlackMessage
    let outcome = 'success'
    let memberIdentity:
      | { userId: string; email: string; principal: OrganizationDelegatedPrincipal }
      | undefined
    try {
      if (input.rateLimited) {
        outcome = 'rate_limited'
        reply = slackSearchReply(
          message,
          'You are searching too quickly. Please wait a moment and try again.'
        )
      } else if (message.queryTooLong || !message.query) {
        outcome = 'invalid_query'
        reply = slackSearchReply(message, 'Send a search query between 1 and 2,000 characters.')
      } else {
        const sender = await getSlackSearchSender(
          secret.botToken,
          message.userId,
          installation.teamId,
          signal
        )
        if (!sender) throw new SlackSearchIdentityError()
        const userId = await resolveSlackSearchMember(
          installation.organizationId,
          installation.teamId,
          message.userId,
          sender.email
        )
        const issuedAt = new Date()
        const memberPrincipal: OrganizationDelegatedPrincipal = {
          kind: 'organization_delegated',
          serviceId: 'slack-search',
          organizationId: installation.organizationId,
          subjectUserId: userId,
          delegationId: `${installation.id}:${message.eventId}`,
          audience: 'sim:knowledge',
          issuedAt,
          expiresAt: new Date(issuedAt.getTime() + 60_000),
          resourceScope: { installationId: installation.id, eventId: message.eventId },
        }
        memberIdentity = { userId, email: sender.email, principal: memberPrincipal }
        const result = await searchScopedKnowledge.execute({
          principal: memberPrincipal,
          input: {
            organizationId: installation.organizationId,
            query: message.query,
            topK: 20,
            surface: 'slack',
            signal,
          },
        })
        reply = renderSlackSearchResults(
          message,
          installation.organizationId,
          result.results,
          getBaseUrl()
        )
        if (!result.results.length) outcome = 'no_results'
      }
    } catch (error) {
      signal.throwIfAborted()
      outcome =
        error instanceof SlackSearchIdentityError
          ? 'identity_required'
          : error instanceof KnowledgeUsageLimitExceededError
            ? 'usage_limit'
            : 'search_failed'
      reply = slackSearchReply(
        message,
        error instanceof SlackSearchIdentityError
          ? error.message
          : error instanceof KnowledgeUsageLimitExceededError
            ? 'Search has reached its usage limit. Ask your administrator to check the organization’s usage.'
            : 'Search could not complete. Please try again later or ask your administrator to check Search and the Slack connection.'
      )
    }
    /** Sending is outside the search catch: an ambiguous send is never followed by another message. */
    try {
      signal.throwIfAborted()
      if (!(await authorizeSlackSearchInstallation(principal, job))) return
      if (memberIdentity && (outcome === 'success' || outcome === 'no_results')) {
        const currentUserId = await resolveSlackSearchMember(
          installation.organizationId,
          installation.teamId,
          message.userId,
          memberIdentity.email
        )
        if (currentUserId !== memberIdentity.userId) throw new SlackSearchIdentityError()
        await authorizeOrganizationOperation(
          memberIdentity.principal,
          knowledgeOperations.search.organizationOperation,
          installation
        )
      }
      const sent = await postSlackMessage(secret.botToken, reply, signal)
      if (sent.status < 200 || sent.status >= 300 || sent.data.ok !== true)
        throw new SlackSearchProviderError()
      await recordSlackSearchOutcome(installation, outcome)
      logger.info('Slack search completed', {
        installationId: installation.id,
        eventId: message.eventId,
        outcome,
        latencyMs: Date.now() - job.receivedAt,
      })
    } catch (error) {
      await recordSlackSearchOutcome(installation, 'delivery_failed')
      throw error
    }
  },
}
