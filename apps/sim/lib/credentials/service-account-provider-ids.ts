import { isClientCredentialAccountProviderId } from '@/lib/credentials/client-credential-accounts/descriptors'
import { isTokenServiceAccountProviderId } from '@/lib/credentials/token-service-accounts/descriptors'
import {
  ATLASSIAN_SERVICE_ACCOUNT_PROVIDER_ID,
  GOOGLE_SERVICE_ACCOUNT_PROVIDER_ID,
  SLACK_CUSTOM_BOT_PROVIDER_ID,
} from '@/lib/oauth/types'
import type { ServiceAccountProviderId } from '@/app/workspace/[workspaceId]/integrations/components/connect-service-account-modal'

/**
 * Narrows a runtime provider-id string to the {@link ServiceAccountProviderId}
 * union. Anything outside the union is unsupported by
 * `ConnectServiceAccountModal`.
 *
 * Lives here rather than beside the integration catalog so callers that only
 * need the predicate — not a slug — avoid pulling in `integrations.json` and
 * the `OAUTH_PROVIDERS` walk.
 */
export function asServiceAccountProviderId(
  value: string | undefined
): ServiceAccountProviderId | undefined {
  if (
    value === GOOGLE_SERVICE_ACCOUNT_PROVIDER_ID ||
    value === ATLASSIAN_SERVICE_ACCOUNT_PROVIDER_ID ||
    value === SLACK_CUSTOM_BOT_PROVIDER_ID ||
    isTokenServiceAccountProviderId(value) ||
    isClientCredentialAccountProviderId(value)
  ) {
    return value
  }
  return undefined
}

/**
 * Whether a string is itself a service-account provider id
 * (`slack-custom-bot`, `notion-service-account`, …) rather than an OAuth
 * provider value.
 *
 * Note this asks what the id *is*, not whether the named integration happens
 * to offer a service-account flow: `slack` is an OAuth provider value and
 * returns false even though Slack also supports a custom bot.
 */
export function isServiceAccountProviderId(value: string): boolean {
  return asServiceAccountProviderId(value.toLowerCase().trim()) !== undefined
}
