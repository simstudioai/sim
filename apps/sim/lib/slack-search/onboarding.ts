import { getBaseUrl } from '@/lib/core/utils/urls'
import { organizationRoutes } from '@/lib/navigation/paths'

export function slackSearchOnboardingPath(token: string) {
  return `/slack-search/connect/${encodeURIComponent(token)}`
}

/** Keeps Slack retry context on the existing source connection page. */
export function slackSearchIntegrationsPath(organizationId: string, token: string) {
  return `${organizationRoutes(organizationId).integrations}?${new URLSearchParams({ slack: token })}`
}

/** The destination is application-authored; model-generated links never enter onboarding. */
export function slackSearchOnboardingUrl(token: string) {
  return new URL(slackSearchOnboardingPath(token), getBaseUrl()).href
}

export const SLACK_SEARCH_CONNECT_ACCOUNT =
  'Get started with Sim to search your organization from Slack. Sign in or create an account using your Slack email, then complete your organization’s invitation or SSO setup.'
export const SLACK_SEARCH_CONNECT_SOURCES =
  'There are no indexed documents I can search for you yet. Connect your sources in Sim, or wait for an existing connection to finish indexing, then retry this question.'
