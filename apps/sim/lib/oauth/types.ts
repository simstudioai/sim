import type { ReactNode } from 'react'

/**
 * Stable identifier for the Atlassian service account provider. Used as the
 * `providerId` on credential rows and as the `serviceAccountProviderId` on
 * Jira/Confluence service configs.
 */
export const ATLASSIAN_SERVICE_ACCOUNT_PROVIDER_ID = 'atlassian-service-account' as const

/**
 * Stable identifier for a Google service account credential (JSON key → JWT
 * token exchange). Used as the `providerId` on credential rows and the
 * `serviceAccountProviderId` on Google service configs.
 */
export const GOOGLE_SERVICE_ACCOUNT_PROVIDER_ID = 'google-service-account' as const

/**
 * Discriminator stored inside the encrypted Atlassian service account secret blob.
 */
export const ATLASSIAN_SERVICE_ACCOUNT_SECRET_TYPE = 'atlassian_service_account' as const

/**
 * Stable identifier for a reusable custom Slack bot credential — a
 * `service_account`-type credential whose encrypted blob holds the bring-your-own
 * app's signing secret + bot token + derived team_id/bot_user_id. Used as the
 * `providerId` on credential rows and the `serviceAccountProviderId` on the Slack
 * service config, so it folds into the same Slack credential dropdown.
 */
export const SLACK_CUSTOM_BOT_PROVIDER_ID = 'slack-custom-bot' as const

/** Discriminator stored inside the encrypted Slack custom bot secret blob. */
export const SLACK_CUSTOM_BOT_SECRET_TYPE = 'slack_custom_bot' as const

export type OAuthProvider =
  | 'github-repositories'
  | 'google'
  | 'google-email'
  | 'google-drive'
  | 'google-docs'
  | 'google-sheets'
  | 'google-calendar'
  | 'google-contacts'
  | 'google-ads'
  | 'google-bigquery'
  | 'google-tasks'
  | 'google-vault'
  | 'google-forms'
  | 'google-groups'
  | 'google-meet'
  | 'google-chat'
  | 'vertex-ai'
  | 'x'
  | 'tiktok'
  | 'confluence'
  | 'airtable'
  | 'bitbucket'
  | 'notion'
  | 'jira'
  | 'atlassian-service-account'
  | 'box'
  | 'dropbox'
  | 'microsoft'
  | 'microsoft-ad'
  | 'microsoft-dataverse'
  | 'microsoft-excel'
  | 'microsoft-planner'
  | 'microsoft-teams'
  | 'microsoft-word'
  | 'outlook'
  | 'onedrive'
  | 'sharepoint'
  | 'clickup'
  | 'linear'
  | 'slack'
  | 'reddit'
  | 'trello'
  | 'wealthbox'
  | 'webflow'
  | 'asana'
  | 'attio'
  | 'pipedrive'
  | 'quickbooks'
  | 'hubspot'
  | 'harmonic'
  | 'salesforce'
  | 'linkedin'
  | 'instagram'
  | 'shopify'
  | 'zoom'
  | 'wordpress'
  | 'spotify'
  | 'calcom'
  | 'docusign'
  | 'manageengine-sdp'
  | 'zoho-desk'

export type OAuthService =
  | 'github-repositories'
  | 'google'
  | 'google-email'
  | 'google-drive'
  | 'google-docs'
  | 'google-sheets'
  | 'google-calendar'
  | 'google-contacts'
  | 'google-ads'
  | 'google-bigquery'
  | 'google-tasks'
  | 'google-vault'
  | 'google-forms'
  | 'google-groups'
  | 'google-meet'
  | 'google-chat'
  | 'vertex-ai'
  | 'x'
  | 'tiktok'
  | 'confluence'
  | 'airtable'
  | 'bitbucket'
  | 'notion'
  | 'jira'
  | 'atlassian-service-account'
  | 'box'
  | 'dropbox'
  | 'microsoft-ad'
  | 'microsoft-dataverse'
  | 'microsoft-excel'
  | 'microsoft-teams'
  | 'microsoft-planner'
  | 'microsoft-word'
  | 'sharepoint'
  | 'outlook'
  | 'clickup'
  | 'linear'
  | 'slack'
  | 'reddit'
  | 'wealthbox'
  | 'onedrive'
  | 'webflow'
  | 'trello'
  | 'asana'
  | 'attio'
  | 'pipedrive'
  | 'quickbooks'
  | 'hubspot'
  | 'harmonic'
  | 'salesforce'
  | 'linkedin'
  | 'instagram'
  | 'shopify'
  | 'zoom'
  | 'wordpress'
  | 'spotify'
  | 'calcom'
  | 'docusign'
  | 'github'
  | 'monday'
  | 'manageengine-sdp'
  | 'zoho-desk'

export interface OAuthProviderConfig {
  name: string
  icon: (props: { className?: string }) => ReactNode
  services: Record<string, OAuthServiceConfig>
  defaultService: string
}

export type OAuthAuthType = 'oauth' | 'service_account'

export interface OAuthClientConfigurationField {
  id: 'clientId' | 'clientSecret' | 'environment' | 'webhookVerifierToken'
  label: string
  placeholder: string
  secret: boolean
  options?: readonly { value: string; label: string }[]
  hint?: string
}

export interface OAuthServiceConfig {
  name: string
  description: string
  providerId: string
  icon: (props: { className?: string }) => ReactNode
  baseProviderIcon: (props: { className?: string }) => ReactNode
  scopes: string[]
  authType?: OAuthAuthType
  serviceAccountProviderId?: string
  /**
   * Further OAuth provider ids whose credentials authenticate this same
   * service. Used when one integration is reachable through more than one
   * authorization server and Better Auth therefore needs a separate static
   * provider registration for each — Salesforce production
   * (`login.salesforce.com`) versus sandbox (`test.salesforce.com`).
   *
   * Credentials stored under any of these ids resolve to this service, so they
   * appear in the same block credential picker and group under the same
   * integration. Distinct from {@link serviceAccountProviderId}, which is the
   * one non-OAuth credential family the service accepts.
   */
  additionalProviderIds?: readonly string[]
  /**
   * Labels for the connect modal's authorization-server picker, keyed by
   * provider id and including the primary {@link providerId}. Required
   * whenever {@link additionalProviderIds} is set — without it the picker has
   * nothing to render and the alternate server is unreachable from the UI.
   */
  providerIdLabels?: Readonly<Record<string, string>>
  /**
   * One-line guidance under the authorization-server picker. Earns its place
   * because picking the wrong server fails as an ordinary bad-password error,
   * which does not hint that the environment was the problem.
   */
  providerIdPickerHint?: string
  /** Write-only OAuth app fields a user must supply before provider authorization starts. */
  clientConfiguration?: {
    fields: readonly OAuthClientConfigurationField[]
    redirectPath?: `/${string}`
  }
}

/**
 * Service metadata without React components - safe for server-side use
 */
export interface OAuthServiceMetadata {
  serviceId: string
  providerId: string
  serviceAccountProviderId?: string
  additionalProviderIds?: readonly string[]
  name: string
  description: string
  baseProvider: string
  clientConfiguration?: OAuthServiceConfig['clientConfiguration']
  authType: OAuthAuthType
}

export interface Credential {
  id: string
  name: string
  provider: OAuthProvider
  type?: 'oauth' | 'service_account'
  serviceId?: string
  lastUsed?: string
  isDefault?: boolean
  scopes?: string[]
}

export interface ProviderConfig {
  baseProvider: string
  featureType: string
}
