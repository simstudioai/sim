import { OrchestrationError } from '@/lib/core/orchestration/types'
import { decryptSecret } from '@/lib/core/security/encryption'
import { readResponseJsonWithLimit } from '@/lib/core/utils/stream-limits'
import { tenantPrincipal } from '@/lib/credentials/principal'
import type { CredentialRow } from '@/lib/credentials/queries'
import {
  fetchProvider,
  isTransientProviderStatus,
  TokenServiceAccountValidationError,
} from '@/lib/credentials/token-service-accounts/errors'
import {
  PLAID_SERVICE_ACCOUNT_PROVIDER_ID,
  PLAID_SERVICE_ACCOUNT_SECRET_TYPE,
} from '@/lib/oauth/types'

export const PLAID_ENVIRONMENTS = ['production', 'sandbox'] as const
export type PlaidEnvironment = (typeof PLAID_ENVIRONMENTS)[number]

const PLAID_BASE_URLS: Record<PlaidEnvironment, string> = {
  production: 'https://production.plaid.com',
  sandbox: 'https://sandbox.plaid.com',
}
const PLAID_API_VERSION = '2020-09-14'
const PLAID_VALIDATION_STEP = 'plaid_item_get'
const PLAID_VALIDATION_RESPONSE_MAX_BYTES = 1024 * 1024

export interface PlaidServiceAccountFields {
  clientId: string
  clientSecret: string
  environment: PlaidEnvironment
  accessToken: string
}

export interface PlaidServiceAccountValidationResult {
  itemId: string
  institutionId?: string
  displayName: string
  principal: ReturnType<typeof tenantPrincipal>
  auditMetadata: Record<string, string>
}

export interface PlaidServiceAccountSecretBlob extends PlaidServiceAccountFields {
  type: typeof PLAID_SERVICE_ACCOUNT_SECRET_TYPE
  providerId: typeof PLAID_SERVICE_ACCOUNT_PROVIDER_ID
  itemId: string
  institutionId?: string
  metadata: Record<string, string>
}

type PlaidCredentialRow = Pick<CredentialRow, 'type' | 'providerId' | 'encryptedServiceAccountKey'>

interface PlaidItemGetPayload {
  item?: unknown
  error_code?: unknown
}

function recordOf(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

function requiredString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

export function normalizePlaidEnvironment(value: string): PlaidEnvironment | undefined {
  const normalized = value.trim().toLowerCase()
  return PLAID_ENVIRONMENTS.includes(normalized as PlaidEnvironment)
    ? (normalized as PlaidEnvironment)
    : undefined
}

export function plaidServiceAccountDisplayName(itemId: string, institutionId?: string): string {
  return institutionId ? `Plaid ${institutionId} (${itemId})` : `Plaid Item ${itemId}`
}

/**
 * Verifies the complete Plaid credential against the same Item endpoint used at runtime.
 * Hosts are selected exclusively from the environment allowlist, response bodies are bounded,
 * and provider error messages are never retained because they are not needed to classify the
 * submitted credential.
 */
export async function validatePlaidServiceAccount(
  fields: PlaidServiceAccountFields
): Promise<PlaidServiceAccountValidationResult> {
  const environment = normalizePlaidEnvironment(fields.environment)
  if (!environment) {
    throw new TokenServiceAccountValidationError('invalid_credentials', 400, {
      step: PLAID_VALIDATION_STEP,
      reason: 'environment must be production or sandbox',
    })
  }

  const response = await fetchProvider(
    `${PLAID_BASE_URLS[environment]}/item/get`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'PLAID-CLIENT-ID': fields.clientId,
        'PLAID-SECRET': fields.clientSecret,
        'Plaid-Version': PLAID_API_VERSION,
      },
      body: JSON.stringify({ access_token: fields.accessToken }),
      redirect: 'error',
    },
    PLAID_VALIDATION_STEP
  )

  let payload: PlaidItemGetPayload
  try {
    payload = await readResponseJsonWithLimit<PlaidItemGetPayload>(response, {
      maxBytes: PLAID_VALIDATION_RESPONSE_MAX_BYTES,
      label: 'Plaid Item validation response',
    })
  } catch {
    throw new TokenServiceAccountValidationError('provider_unavailable', 502, {
      step: PLAID_VALIDATION_STEP,
      reason: 'provider returned an invalid or oversized response',
    })
  }

  if (!response.ok) {
    const errorCode = requiredString(payload.error_code)
    const unavailable = response.status >= 500 || isTransientProviderStatus(response.status)
    throw new TokenServiceAccountValidationError(
      unavailable ? 'provider_unavailable' : 'invalid_credentials',
      response.status,
      {
        step: PLAID_VALIDATION_STEP,
        environment,
        ...(errorCode ? { plaidErrorCode: errorCode } : {}),
      }
    )
  }

  const item = recordOf(payload.item)
  const itemId = requiredString(item?.item_id)
  if (!itemId) {
    throw new TokenServiceAccountValidationError('provider_unavailable', 502, {
      step: PLAID_VALIDATION_STEP,
      environment,
      reason: 'provider response did not contain item.item_id',
    })
  }
  const institutionId = requiredString(item?.institution_id)
  const principal = tenantPrincipal(itemId, institutionId)
  const auditMetadata = {
    plaidItemId: itemId,
    plaidEnvironment: environment,
    ...(institutionId ? { plaidInstitutionId: institutionId } : {}),
  }
  return {
    itemId,
    ...(institutionId ? { institutionId } : {}),
    displayName: plaidServiceAccountDisplayName(itemId, institutionId),
    principal,
    auditMetadata,
  }
}

/** Parses a decrypted Plaid credential and fails closed on provider or shape mismatch. */
export function parsePlaidServiceAccountSecretBlob(
  decrypted: string
): PlaidServiceAccountSecretBlob {
  let value: unknown
  try {
    value = JSON.parse(decrypted)
  } catch {
    throw new Error('Stored Plaid service-account secret is malformed')
  }
  const parsed = recordOf(value)
  const environment =
    typeof parsed?.environment === 'string'
      ? normalizePlaidEnvironment(parsed.environment)
      : undefined
  const clientId = requiredString(parsed?.clientId)
  const clientSecret = requiredString(parsed?.clientSecret)
  const accessToken = requiredString(parsed?.accessToken)
  const itemId = requiredString(parsed?.itemId)
  if (
    parsed?.type !== PLAID_SERVICE_ACCOUNT_SECRET_TYPE ||
    parsed.providerId !== PLAID_SERVICE_ACCOUNT_PROVIDER_ID ||
    !environment ||
    !clientId ||
    !clientSecret ||
    !accessToken ||
    !itemId
  ) {
    throw new Error('Stored Plaid service-account secret is malformed')
  }
  const institutionId = requiredString(parsed.institutionId)
  const metadata = recordOf(parsed.metadata)
  const stringMetadata = metadata
    ? Object.fromEntries(
        Object.entries(metadata).filter(
          (entry): entry is [string, string] => typeof entry[1] === 'string'
        )
      )
    : {}
  return {
    type: PLAID_SERVICE_ACCOUNT_SECRET_TYPE,
    providerId: PLAID_SERVICE_ACCOUNT_PROVIDER_ID,
    clientId,
    clientSecret,
    environment,
    accessToken,
    itemId,
    ...(institutionId ? { institutionId } : {}),
    metadata: stringMetadata,
  }
}

/** Decrypts one authorized Plaid credential without projecting any secret material. */
export async function decryptPlaidServiceAccountCredential(
  credential: PlaidCredentialRow
): Promise<PlaidServiceAccountSecretBlob> {
  if (
    credential.type !== 'service_account' ||
    credential.providerId !== PLAID_SERVICE_ACCOUNT_PROVIDER_ID ||
    !credential.encryptedServiceAccountKey
  ) {
    throw new OrchestrationError('not_found', 'Credential not found')
  }

  try {
    const { decrypted } = await decryptSecret(credential.encryptedServiceAccountKey)
    return parsePlaidServiceAccountSecretBlob(decrypted)
  } catch (error) {
    if (error instanceof OrchestrationError) throw error
    throw new OrchestrationError(
      'unauthorized',
      'Plaid credential is no longer usable; reconnect it from Integrations'
    )
  }
}
