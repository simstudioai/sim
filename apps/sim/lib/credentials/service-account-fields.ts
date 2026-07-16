import { CLIENT_CREDENTIAL_ACCOUNT_REQUIRED_FIELDS } from '@/lib/credentials/client-credential-accounts/descriptors'
import { TOKEN_SERVICE_ACCOUNT_REQUIRED_FIELDS } from '@/lib/credentials/token-service-accounts/descriptors'
import {
  ATLASSIAN_SERVICE_ACCOUNT_PROVIDER_ID,
  GOOGLE_SERVICE_ACCOUNT_PROVIDER_ID,
  SLACK_CUSTOM_BOT_PROVIDER_ID,
} from '@/lib/oauth/types'

/** Every secret field a service-account credential create/reconnect can carry. */
export type ServiceAccountFieldId =
  | 'apiToken'
  | 'domain'
  | 'serviceAccountJson'
  | 'signingSecret'
  | 'botToken'
  | 'clientId'
  | 'clientSecret'
  | 'orgId'

/**
 * Required create-body fields per service-account provider — the client-safe
 * source of truth consumed by the `createCredentialBodySchema` superRefine.
 * (Server-side builders re-derive their own requirements: token-paste
 * providers from descriptor fields, bespoke providers inline.) Token-paste
 * providers contribute their entries from
 * `TOKEN_SERVICE_ACCOUNT_REQUIRED_FIELDS`, client-credential providers from
 * `CLIENT_CREDENTIAL_ACCOUNT_REQUIRED_FIELDS`; the three bespoke providers are
 * declared here.
 */
export const SERVICE_ACCOUNT_REQUIRED_FIELDS: Record<string, readonly ServiceAccountFieldId[]> = {
  [GOOGLE_SERVICE_ACCOUNT_PROVIDER_ID]: ['serviceAccountJson'],
  [ATLASSIAN_SERVICE_ACCOUNT_PROVIDER_ID]: ['apiToken', 'domain'],
  [SLACK_CUSTOM_BOT_PROVIDER_ID]: ['signingSecret', 'botToken'],
  ...TOKEN_SERVICE_ACCOUNT_REQUIRED_FIELDS,
  ...CLIENT_CREDENTIAL_ACCOUNT_REQUIRED_FIELDS,
}

/**
 * Legacy Google creates may omit `providerId` entirely (the original
 * service-account flow predates multi-provider support), so an unknown or
 * missing provider falls back to requiring the Google JSON key.
 */
export const FALLBACK_SERVICE_ACCOUNT_REQUIRED_FIELDS: readonly ServiceAccountFieldId[] = [
  'serviceAccountJson',
]

export function getServiceAccountRequiredFields(
  providerId: string | null | undefined
): readonly ServiceAccountFieldId[] {
  return providerId && Object.hasOwn(SERVICE_ACCOUNT_REQUIRED_FIELDS, providerId)
    ? SERVICE_ACCOUNT_REQUIRED_FIELDS[providerId]
    : FALLBACK_SERVICE_ACCOUNT_REQUIRED_FIELDS
}
