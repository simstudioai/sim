import {
  BOX_SERVICE_ACCOUNT_PROVIDER_ID,
  CLIENT_CREDENTIAL_ACCOUNT_SECRET_TYPE,
  type ClientCredentialAccountProviderId,
  getClientCredentialAccountDescriptor,
  isClientCredentialAccountProviderId,
  NETSUITE_SERVICE_ACCOUNT_PROVIDER_ID,
  ORACLE_FUSION_SERVICE_ACCOUNT_PROVIDER_ID,
  partitionClientCredentialFields,
  SALESFORCE_SERVICE_ACCOUNT_PROVIDER_ID,
  ZOHO_DESK_SERVICE_ACCOUNT_PROVIDER_ID,
  ZOOM_SERVICE_ACCOUNT_PROVIDER_ID,
} from '@/lib/credentials/client-credential-accounts/descriptors'
import { mintBoxServiceAccountToken } from '@/lib/credentials/client-credential-accounts/minters/box'
import { mintNetSuiteServiceAccountToken } from '@/lib/credentials/client-credential-accounts/minters/netsuite'
import { mintOracleFusionServiceAccountToken } from '@/lib/credentials/client-credential-accounts/minters/oracle-fusion'
import { mintSalesforceServiceAccountToken } from '@/lib/credentials/client-credential-accounts/minters/salesforce'
import { mintZohoDeskServiceAccountToken } from '@/lib/credentials/client-credential-accounts/minters/zoho-desk'
import { mintZoomServiceAccountToken } from '@/lib/credentials/client-credential-accounts/minters/zoom'
import type { ServiceAccountPrincipal } from '@/lib/credentials/principal'

/** Raw fields a client-credential minter receives (already trimmed). */
export interface ClientCredentialAccountFields {
  clientId: string
  /** Certificate mapping identifier used as the JWT `kid` by NetSuite. */
  certificateId?: string
  /**
   * Absent when the provider authenticates with key material instead of a
   * shared secret (for example NetSuite or Salesforce JWT bearer).
   */
  clientSecret?: string
  /**
   * Provider-specific org identifier (Zoom Account ID, Box Enterprise ID,
   * Salesforce My Domain host, Zoho Desk organization ID, or NetSuite
   * SuiteTalk origin).
   */
  orgId: string
  /**
   * Optional provider region selector. Only Zoho Desk uses it (the Self Client
   * mints against a per-data-center accounts server); every other provider
   * ignores it, and a blank value keeps the provider's default region.
   */
  dataCenter?: string
  /**
   * Which grant the provider's minter should use, for providers that offer
   * more than one. Only Salesforce does (`client_credentials` | `jwt_bearer`);
   * every other minter ignores it. Absent means the provider's default, which
   * is what credentials created before the field existed carry.
   */
  authMethod?: string
  /**
   * PEM private key signing the assertion for key-based providers and grants
   * (NetSuite or Salesforce JWT bearer). Mutually exclusive with
   * {@link clientSecret} in practice.
   */
  privateKey?: string
  /** Username a key-based grant authenticates as (Salesforce JWT `sub`). */
  username?: string
  /** Canonical provider API origin forwarded to tools after minting. */
  instanceUrl?: string
  /** Provider OAuth token endpoint. */
  tokenUrl?: string
  /** Space-delimited OAuth scope string submitted to the token endpoint. */
  scope?: string
}

/** Identity derived from a successful mint, used at connect time. */
export interface ClientCredentialAccountIdentity {
  /** Default display name when the user didn't provide one. */
  displayName: string
  /**
   * Identity the minted token acts as, or `null` when the provider exposes
   * none. Required (never optional) so a new minter cannot be written without
   * deciding. `verifyAndBuildServiceAccountSecret` mirrors it into both
   * `auditMetadata` and `storedMetadata`, so minters must not repeat it.
   */
  principal: ServiceAccountPrincipal | null
  /**
   * Non-secret identifiers recorded in the audit log that are NOT the
   * principal (e.g. the enterprise id behind a service-account user).
   */
  auditMetadata: Record<string, string>
  /**
   * Non-secret metadata persisted inside the encrypted blob alongside the
   * credentials (e.g. regional API host, granted scopes) for debugging.
   */
  storedMetadata?: Record<string, string>
}

/** Result of a successful client-credentials token mint. */
export interface ClientCredentialAccountMintResult {
  accessToken: string
  expiresInSeconds: number
  /**
   * Provider API origin the minted token must be used against (Salesforce or
   * NetSuite), forwarded to tools alongside the token.
   */
  instanceUrl?: string
  /**
   * Data-center-scoped REST API base the minted token must be used against
   * (Zoho Desk), forwarded to tools as their `apiDomain` param. Distinct from
   * {@link instanceUrl} because the two reach different tool params.
   */
  apiDomain?: string
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
  /** Optional caller cancellation for providers using abort-aware secure fetches. */
  signal?: AbortSignal
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
  [ZOHO_DESK_SERVICE_ACCOUNT_PROVIDER_ID]: mintZohoDeskServiceAccountToken,
  [NETSUITE_SERVICE_ACCOUNT_PROVIDER_ID]: mintNetSuiteServiceAccountToken,
  [ORACLE_FUSION_SERVICE_ACCOUNT_PROVIDER_ID]: mintOracleFusionServiceAccountToken,
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
  certificateId?: string
  /** Absent on key-based credentials, which carry a {@link privateKey} instead. */
  clientSecret?: string
  orgId: string
  /** Optional region selector; absent on every credential created before it existed. */
  dataCenter?: string
  /** Absent on every credential created before multi-grant support existed. */
  authMethod?: string
  privateKey?: string
  username?: string
  instanceUrl?: string
  tokenUrl?: string
  scope?: string
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
  const descriptor = getClientCredentialAccountDescriptor(expectedProviderId)
  if (
    parsed.type !== CLIENT_CREDENTIAL_ACCOUNT_SECRET_TYPE ||
    parsed.providerId !== expectedProviderId ||
    !descriptor
  ) {
    throw malformed
  }
  const { required } = partitionClientCredentialFields(descriptor, parsed.authMethod)
  if (
    required.some((field) => {
      const value = parsed[field.id]
      return typeof value !== 'string' || !value.trim()
    })
  ) {
    throw malformed
  }
  return parsed
}
