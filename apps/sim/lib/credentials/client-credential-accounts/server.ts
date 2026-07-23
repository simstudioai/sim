import {
  BOX_SERVICE_ACCOUNT_PROVIDER_ID,
  CLIENT_CREDENTIAL_ACCOUNT_SECRET_TYPE,
  type ClientCredentialAccountProviderId,
  isClientCredentialAccountProviderId,
  SALESFORCE_SERVICE_ACCOUNT_PROVIDER_ID,
  ZOOM_SERVICE_ACCOUNT_PROVIDER_ID,
} from '@/lib/credentials/client-credential-accounts/descriptors'
import { mintBoxServiceAccountToken } from '@/lib/credentials/client-credential-accounts/minters/box'
import { mintSalesforceServiceAccountToken } from '@/lib/credentials/client-credential-accounts/minters/salesforce'
import { mintZoomServiceAccountToken } from '@/lib/credentials/client-credential-accounts/minters/zoom'

/** Raw fields a client-credential minter receives (already trimmed). */
export interface ClientCredentialAccountFields {
  clientId: string
  clientSecret: string
  /** Provider-specific org identifier (Zoom Account ID, Box Enterprise ID, Salesforce My Domain host). */
  orgId: string
}

/** Identity derived from a successful mint, used at connect time. */
export interface ClientCredentialAccountIdentity {
  /** Default display name when the user didn't provide one. */
  displayName: string
  /** Non-secret identifiers recorded in the audit log (e.g. account/enterprise id). */
  auditMetadata: Record<string, string>
  /**
   * Non-secret metadata persisted inside the encrypted blob alongside the
   * credentials (e.g. regional API host, service-account login) for debugging.
   */
  storedMetadata?: Record<string, string>
}

/** Result of a successful client-credentials token mint. */
export interface ClientCredentialAccountMintResult {
  accessToken: string
  expiresInSeconds: number
  /**
   * Provider API base URL the minted token must be used against (Salesforce
   * `instance_url`), forwarded to tools alongside the token.
   */
  instanceUrl?: string
  /** Scopes granted to the app, when the provider reports them. */
  grantedScopes?: string[]
  identity?: ClientCredentialAccountIdentity
}

/** Options controlling how much work a mint performs. */
export interface ClientCredentialAccountMintOptions {
  /**
   * Skips the best-effort identity lookup (extra provider round-trip on Box
   * and Salesforce). Execution-time token resolution discards `identity`, so
   * it passes `skipIdentity: true`; connect-time verification keeps the
   * lookup for the display name and audit metadata.
   */
  skipIdentity?: boolean
}

export type ClientCredentialAccountMinter = (
  fields: ClientCredentialAccountFields,
  options?: ClientCredentialAccountMintOptions
) => Promise<ClientCredentialAccountMintResult>

/**
 * Server-side minting registry for client-credential providers. Keys must stay
 * in lockstep with `CLIENT_CREDENTIAL_ACCOUNT_DESCRIPTORS` — a descriptor
 * without a minter fails loudly at create time. The same minter runs at
 * connect time (verification) and at execution time (token resolution).
 */
const CLIENT_CREDENTIAL_ACCOUNT_MINTERS: Record<
  ClientCredentialAccountProviderId,
  ClientCredentialAccountMinter
> = {
  [ZOOM_SERVICE_ACCOUNT_PROVIDER_ID]: mintZoomServiceAccountToken,
  [BOX_SERVICE_ACCOUNT_PROVIDER_ID]: mintBoxServiceAccountToken,
  [SALESFORCE_SERVICE_ACCOUNT_PROVIDER_ID]: mintSalesforceServiceAccountToken,
}

export function getClientCredentialAccountMinter(
  providerId: string
): ClientCredentialAccountMinter | undefined {
  return isClientCredentialAccountProviderId(providerId)
    ? CLIENT_CREDENTIAL_ACCOUNT_MINTERS[providerId]
    : undefined
}

/**
 * Shape of the decrypted secret blob persisted for client-credential accounts.
 * `providerId` is stored inside the blob so a mismatched credential row fails
 * loudly at resolution time instead of minting against another provider.
 */
export interface ClientCredentialAccountSecretBlob {
  type: typeof CLIENT_CREDENTIAL_ACCOUNT_SECRET_TYPE
  providerId: string
  clientId: string
  clientSecret: string
  orgId: string
  metadata?: Record<string, string>
}

export function parseClientCredentialAccountSecretBlob(
  decrypted: string,
  expectedProviderId: string
): ClientCredentialAccountSecretBlob {
  const malformed = new Error('Stored client-credential service-account secret is malformed')
  let parsed: ClientCredentialAccountSecretBlob
  try {
    parsed = JSON.parse(decrypted) as ClientCredentialAccountSecretBlob
  } catch {
    throw malformed
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw malformed
  }
  if (
    parsed.type !== CLIENT_CREDENTIAL_ACCOUNT_SECRET_TYPE ||
    parsed.providerId !== expectedProviderId ||
    !parsed.clientId ||
    !parsed.clientSecret ||
    !parsed.orgId
  ) {
    throw malformed
  }
  return parsed
}
