import {
  getClientCredentialAccountDescriptor,
  isClientCredentialAccountProviderId,
} from '@/lib/credentials/client-credential-accounts/descriptors'
import {
  getTokenServiceAccountDescriptor,
  isTokenServiceAccountProviderId,
} from '@/lib/credentials/token-service-accounts/descriptors'
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

/**
 * The block type whose preview gate governs a service-account provider's setup
 * surface, or `null` when the provider is ungated. A custom Slack bot is only
 * usable through `slack_v2`, so its setup form must stay hidden wherever that
 * block is preview-hidden — both the in-chat connect button and the tool that
 * offers it read this so they can't disagree on availability.
 */
export function getServiceAccountGatingBlockType(providerId: string): string | null {
  return providerId === SLACK_CUSTOM_BOT_PROVIDER_ID ? 'slack_v2' : null
}

/**
 * Vendor-accurate noun for the credential a service-account provider collects
 * ("private app token", "server-to-server app", …), for connect-control labels
 * and agent-facing discovery. Token-paste and client-credential providers name
 * their own; bespoke providers (Google JSON key, Atlassian token) fall back to
 * the generic "service account". Single source shared by the connect hook and
 * the VFS catalog so the wording can't drift.
 */
export function getServiceAccountConnectNoun(providerId: string): string {
  if (providerId === SLACK_CUSTOM_BOT_PROVIDER_ID) return 'custom bot'
  const descriptor =
    getTokenServiceAccountDescriptor(providerId) ?? getClientCredentialAccountDescriptor(providerId)
  return descriptor?.connectNoun ?? 'service account'
}
