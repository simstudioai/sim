import { isHosted } from '@/lib/core/config/env-flags'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import {
  exchangeSlackBotAuthorization,
  validateSlackBotAuthorization,
} from '@/lib/internal/slack/oauth'
import { SLACK_SHARED_SEARCH_BOT_SCOPES } from '@/lib/slack-search/constants'
import { getSharedSlackSearchAppConfiguration } from '@/lib/slack-search/shared-app-env'

/**
 * Completes installation in Slack without binding it to Sim or retaining tokens.
 * Organization setup later obtains its own grant through the admin's state-bound OAuth flow.
 */
export async function authenticateSlackPublicInstallation(code: string) {
  const app = isHosted ? getSharedSlackSearchAppConfiguration() : null
  if (!app) throw new OrchestrationError('forbidden', 'The Sim Search app is unavailable')
  const grant = await exchangeSlackBotAuthorization({
    clientId: app.clientId,
    clientSecret: app.clientSecret,
    code,
  })
  validateSlackBotAuthorization(grant, SLACK_SHARED_SEARCH_BOT_SCOPES)
  if (grant.app_id !== app.id)
    throw new OrchestrationError('forbidden', 'Slack returned a different app')
  return { teamId: grant.team.id }
}
