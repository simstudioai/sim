import { OrchestrationError } from '@/lib/core/orchestration/types'
import {
  SLACK_MANAGED_USER_CONFIGURATION_CALLBACK_PATH,
  SLACK_MANAGED_USER_ENROLLMENT_CALLBACK_PATH,
  SLACK_SEARCH_USER_SCOPES,
} from '@/lib/credential-groups/slack-managed-user-scopes'
import { SLACK_SEARCH_SCOPES } from '@/lib/slack-search/constants'

export const SLACK_SEARCH_CALLBACK_PATH = '/api/knowledge/slack/oauth/callback'
export const SLACK_SEARCH_WEBHOOK_PATH = '/api/webhooks/slack'
export const SLACK_SEARCH_DEFAULT_NAME = 'Sim Search'
export const SLACK_SEARCH_DEFAULT_DESCRIPTION =
  'Ask questions about your organization’s knowledge and get answers with sources.'

/** Bot conversations and member indexing share one manifest and app identity. */
export function createSlackSearchManifest(
  name: string,
  description: string,
  origin: string,
  existingUserScopes: readonly string[] = []
) {
  const url = new URL(origin)
  if (url.protocol !== 'https:') {
    throw new OrchestrationError(
      'validation',
      'Slack needs a public HTTPS URL to send messages to Sim. Configure this instance with a public HTTPS app URL, then retry setup. Localhost is not reachable from Slack.'
    )
  }
  const webhookUrl = new URL(SLACK_SEARCH_WEBHOOK_PATH, url).href
  return {
    display_information: { name, description },
    features: {
      bot_user: { display_name: name, always_online: false },
      app_home: {
        home_tab_enabled: false,
        messages_tab_enabled: true,
        messages_tab_read_only_enabled: false,
      },
      agent_view: { agent_description: description },
    },
    oauth_config: {
      redirect_urls: [
        SLACK_SEARCH_CALLBACK_PATH,
        SLACK_MANAGED_USER_CONFIGURATION_CALLBACK_PATH,
        SLACK_MANAGED_USER_ENROLLMENT_CALLBACK_PATH,
      ].map((path) => new URL(path, url).href),
      scopes: {
        bot: [...SLACK_SEARCH_SCOPES],
        user: [...new Set([...SLACK_SEARCH_USER_SCOPES, ...existingUserScopes])],
      },
    },
    settings: {
      event_subscriptions: {
        request_url: webhookUrl,
        bot_events: ['app_home_opened', 'message.im', 'app_mention', 'agent_session_stopped'],
      },
      interactivity: { is_enabled: true, request_url: webhookUrl },
      org_deploy_enabled: false,
      socket_mode_enabled: false,
      token_rotation_enabled: false,
    },
  }
}
