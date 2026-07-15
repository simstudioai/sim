import {
  AIRTABLE_SERVICE_ACCOUNT_PROVIDER_ID,
  ASANA_SERVICE_ACCOUNT_PROVIDER_ID,
  ATTIO_SERVICE_ACCOUNT_PROVIDER_ID,
  CALCOM_SERVICE_ACCOUNT_PROVIDER_ID,
  HUBSPOT_SERVICE_ACCOUNT_PROVIDER_ID,
  isTokenServiceAccountProviderId,
  LINEAR_SERVICE_ACCOUNT_PROVIDER_ID,
  MONDAY_SERVICE_ACCOUNT_PROVIDER_ID,
  NOTION_SERVICE_ACCOUNT_PROVIDER_ID,
  SHOPIFY_SERVICE_ACCOUNT_PROVIDER_ID,
  TOKEN_SERVICE_ACCOUNT_SECRET_TYPE,
  type TokenServiceAccountProviderId,
  TRELLO_SERVICE_ACCOUNT_PROVIDER_ID,
  WEALTHBOX_SERVICE_ACCOUNT_PROVIDER_ID,
  WEBFLOW_SERVICE_ACCOUNT_PROVIDER_ID,
} from '@/lib/credentials/token-service-accounts/descriptors'
import { validateAirtableServiceAccount } from '@/lib/credentials/token-service-accounts/validators/airtable'
import { validateAsanaServiceAccount } from '@/lib/credentials/token-service-accounts/validators/asana'
import { validateAttioServiceAccount } from '@/lib/credentials/token-service-accounts/validators/attio'
import { validateCalcomServiceAccount } from '@/lib/credentials/token-service-accounts/validators/calcom'
import { validateHubspotServiceAccount } from '@/lib/credentials/token-service-accounts/validators/hubspot'
import { validateLinearServiceAccount } from '@/lib/credentials/token-service-accounts/validators/linear'
import { validateMondayServiceAccount } from '@/lib/credentials/token-service-accounts/validators/monday'
import { validateNotionServiceAccount } from '@/lib/credentials/token-service-accounts/validators/notion'
import { validateShopifyServiceAccount } from '@/lib/credentials/token-service-accounts/validators/shopify'
import { validateTrelloServiceAccount } from '@/lib/credentials/token-service-accounts/validators/trello'
import { validateWealthboxServiceAccount } from '@/lib/credentials/token-service-accounts/validators/wealthbox'
import { validateWebflowServiceAccount } from '@/lib/credentials/token-service-accounts/validators/webflow'

/** Raw fields a token service-account validator receives (already trimmed). */
export interface TokenServiceAccountFields {
  apiToken: string
  domain?: string
}

/** Result of a successful provider verification. */
export interface TokenServiceAccountValidationResult {
  /** Default display name when the user didn't provide one. */
  displayName: string
  /** Non-secret identifiers recorded in the audit log (e.g. portal/workspace id). */
  auditMetadata: Record<string, string>
  /**
   * Non-secret metadata persisted inside the encrypted blob alongside the
   * token (e.g. normalized store domain, portal id) for later debugging.
   */
  storedMetadata?: Record<string, string>
  /** Normalized domain to persist instead of the raw user input (when collected). */
  normalizedDomain?: string
}

export type TokenServiceAccountValidator = (
  fields: TokenServiceAccountFields
) => Promise<TokenServiceAccountValidationResult>

/**
 * Server-side verification registry for token service-account providers. Keys
 * must stay in lockstep with `TOKEN_SERVICE_ACCOUNT_DESCRIPTORS` — a
 * descriptor without a validator fails loudly at create time.
 */
const TOKEN_SERVICE_ACCOUNT_VALIDATORS: Record<
  TokenServiceAccountProviderId,
  TokenServiceAccountValidator
> = {
  [HUBSPOT_SERVICE_ACCOUNT_PROVIDER_ID]: validateHubspotServiceAccount,
  [AIRTABLE_SERVICE_ACCOUNT_PROVIDER_ID]: validateAirtableServiceAccount,
  [NOTION_SERVICE_ACCOUNT_PROVIDER_ID]: validateNotionServiceAccount,
  [ASANA_SERVICE_ACCOUNT_PROVIDER_ID]: validateAsanaServiceAccount,
  [ATTIO_SERVICE_ACCOUNT_PROVIDER_ID]: validateAttioServiceAccount,
  [LINEAR_SERVICE_ACCOUNT_PROVIDER_ID]: validateLinearServiceAccount,
  [MONDAY_SERVICE_ACCOUNT_PROVIDER_ID]: validateMondayServiceAccount,
  [SHOPIFY_SERVICE_ACCOUNT_PROVIDER_ID]: validateShopifyServiceAccount,
  [WEBFLOW_SERVICE_ACCOUNT_PROVIDER_ID]: validateWebflowServiceAccount,
  [TRELLO_SERVICE_ACCOUNT_PROVIDER_ID]: validateTrelloServiceAccount,
  [CALCOM_SERVICE_ACCOUNT_PROVIDER_ID]: validateCalcomServiceAccount,
  [WEALTHBOX_SERVICE_ACCOUNT_PROVIDER_ID]: validateWealthboxServiceAccount,
}

export function getTokenServiceAccountValidator(
  providerId: string
): TokenServiceAccountValidator | undefined {
  return isTokenServiceAccountProviderId(providerId)
    ? TOKEN_SERVICE_ACCOUNT_VALIDATORS[providerId]
    : undefined
}

/**
 * Shape of the decrypted secret blob persisted for token service accounts.
 * `providerId` is stored inside the blob so a mismatched credential row fails
 * loudly at resolution time instead of returning another provider's token.
 */
export interface TokenServiceAccountSecretBlob {
  type: typeof TOKEN_SERVICE_ACCOUNT_SECRET_TYPE
  providerId: string
  apiToken: string
  domain?: string
  metadata?: Record<string, string>
}

export function parseTokenServiceAccountSecretBlob(
  decrypted: string,
  expectedProviderId: string
): TokenServiceAccountSecretBlob {
  const parsed = JSON.parse(decrypted) as TokenServiceAccountSecretBlob
  if (
    parsed.type !== TOKEN_SERVICE_ACCOUNT_SECRET_TYPE ||
    parsed.providerId !== expectedProviderId ||
    !parsed.apiToken
  ) {
    throw new Error('Stored token service-account secret is malformed')
  }
  return parsed
}
