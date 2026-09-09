import type { SlackInstallationPrincipal } from '@sim/auth/principal'
import type { OperationUseCase } from '@/lib/core/application/operation'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { runSlackSearchAssistant } from '@/lib/knowledge/application/slack-search/assistant'
import {
  authorizeSlackSearchInstallation,
  requireSlackInstallationPrincipal,
} from '@/lib/knowledge/application/slack-search/authorization'
import { routeSlackSearchMentionToDm } from '@/lib/knowledge/application/slack-search/mention'
import { dispatchSlackSearchTurn } from '@/lib/knowledge/application/slack-search/outbox'
import { persistSlackSearchTurn } from '@/lib/knowledge/application/slack-search/turns'
import type { SlackSearchJob, SlackSearchMessage } from '@/lib/slack-search/types'

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
    const mention = !input.channelId.startsWith('D')
    const query = mention
      ? input.query.replaceAll(`<@${context.installation.botUserId}>`, '').trim()
      : input.query
    if (!query && !input.queryTooLong) return
    const turnId = await persistSlackSearchTurn({
      installationId: context.installation.id,
      revision: context.installation.revision,
      credentialId: principal.credentialId,
      credentialVersion: principal.credentialVersion,
      receivedAt: principal.receivedAt.getTime(),
      message: { ...input, query },
    })
    await dispatchSlackSearchTurn(turnId)
  },
}

interface RespondInput {
  job: SlackSearchJob
  turnId: string
  leaseId: string
  controller: AbortController
}

export const respondToSlackSearchMessage: OperationUseCase<
  typeof respondOperation,
  RespondInput,
  void
> = {
  operation: respondOperation,
  async execute({ principal, input }) {
    requireSlackInstallationPrincipal(principal)
    requireMessageBinding(principal, input.job.message)
    if (input.job.message.queryTooLong || !input.job.message.query)
      throw new OrchestrationError(
        'validation',
        'Send a search query between 1 and 2,000 characters'
      )
    const job = await routeSlackSearchMentionToDm(principal, {
      ...input,
      signal: input.controller.signal,
    })
    await runSlackSearchAssistant(principal, { ...input, job })
  },
}
