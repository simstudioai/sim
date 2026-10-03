import type { OperationUseCase } from '@/lib/core/application/operation'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { getBaseUrl } from '@/lib/core/utils/urls'
import {
  authorizeSlackSearchInstallation,
  requireSlackInstallationPrincipal,
} from '@/lib/knowledge/application/slack-search/authorization'
import { receiveSlackSearchMessage } from '@/lib/knowledge/application/slack-search/process-message'
import { organizationRoutes } from '@/lib/navigation/paths'
import { SEARCH_CONNECTORS } from '@/lib/sim-search/connectors'
import { type SlackSearchCommand, slackSearchCommandEventId } from '@/lib/slack-search/commands'

const operation = Object.freeze({
  id: 'knowledge.slack.command',
  capability: 'knowledge.use',
  principalKinds: ['slack_installation'] as const,
})

/** Commits search intake before acknowledging; the worker creates the real private Slack thread. */
export const receiveSlackSearchCommand: OperationUseCase<
  typeof operation,
  SlackSearchCommand,
  { response_type: 'ephemeral'; text: string; turnId?: string }
> = {
  operation,
  async execute({ principal, input }) {
    requireSlackInstallationPrincipal(principal)
    if (
      principal.appId !== input.api_app_id ||
      principal.teamId !== input.team_id ||
      principal.eventId !== slackSearchCommandEventId(input)
    )
      throw new OrchestrationError(
        'forbidden',
        'Slack command does not match its verified identity'
      )
    const context = await authorizeSlackSearchInstallation(principal)
    if (!context)
      return {
        response_type: 'ephemeral',
        text: 'An admin needs to enable Sim Search for this Slack workspace.',
      }
    if (input.command === '/connect') {
      const url = new URL(
        organizationRoutes(context.installation.organizationId).integrations,
        getBaseUrl()
      )
      const requested = input.text.trim()
      if (requested) {
        const provider = SEARCH_CONNECTORS.find(
          (entry) => entry.type === requested || entry.providerId === requested
        )
        if (!provider)
          return {
            response_type: 'ephemeral',
            text: 'Choose an integration in Sim to connect your account.',
          }
        url.searchParams.set('connectorType', provider.type)
      }
      return { response_type: 'ephemeral', text: `<${url.href}|Connect your sources in Sim>` }
    }
    const query = input.text.trim()
    if (!query) return { response_type: 'ephemeral', text: 'Use /query followed by your question.' }
    const turnId = await receiveSlackSearchMessage.execute({
      principal,
      input: {
        appId: input.api_app_id,
        teamId: input.team_id,
        eventId: principal.eventId,
        userId: input.user_id,
        channelId: input.channel_id,
        command: '/query',
        messageTs: null,
        query: query.length > 2000 ? '' : query,
        queryTooLong: query.length > 2000,
      },
    })
    return {
      response_type: 'ephemeral',
      text: 'I’ll answer in a private Sim Search DM thread.',
      turnId,
    }
  },
}
