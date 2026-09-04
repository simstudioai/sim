import type {
  ClientCredentialAccountFields,
  ClientCredentialAccountMintOptions,
  ClientCredentialAccountMintResult,
} from '@/lib/credentials/client-credential-accounts/server'
import {
  requireClientSecret,
  TokenServiceAccountValidationError,
} from '@/lib/credentials/token-service-accounts/errors'
import { normalizeOracleEpmDestination } from '@/lib/internal/oracle-epm/destination'

const SYNTHETIC_TOKEN_TTL_SECONDS = 600
const MAX_USERNAME_BYTES = 255
const MAX_AUTH_VALUE_BYTES = 1_024
const FORBIDDEN_CREDENTIAL_TEXT = /[\u0000-\u001f\u007f]/

function invalidCredentials(reason: string): TokenServiceAccountValidationError {
  return new TokenServiceAccountValidationError('invalid_credentials', 400, {
    step: 'oracle_epm_basic_auth',
    reason,
  })
}

/**
 * Builds credential-bound Basic authentication locally. Oracle EPM does not
 * expose a token mint for this v1 flow, so connect performs no network probe.
 */
export async function mintOracleEpmServiceAccountToken(
  fields: ClientCredentialAccountFields,
  _options?: ClientCredentialAccountMintOptions
): Promise<ClientCredentialAccountMintResult> {
  let instanceUrl: string
  try {
    instanceUrl = normalizeOracleEpmDestination(fields.orgId)
  } catch {
    throw new TokenServiceAccountValidationError('site_not_found', 400, {
      step: 'oracle_epm_destination_validation',
      reason: 'environment URL must be a valid HTTPS Oracle EPM destination',
    })
  }

  const username = fields.clientId.trim()
  const password = requireClientSecret(
    fields.clientSecret,
    'oracle_epm_basic_auth',
    'Oracle EPM Cloud'
  )
  if (
    !username ||
    username.includes(':') ||
    FORBIDDEN_CREDENTIAL_TEXT.test(username) ||
    Buffer.byteLength(username, 'utf8') > MAX_USERNAME_BYTES
  ) {
    throw invalidCredentials('integration username is invalid')
  }
  if (
    !password ||
    FORBIDDEN_CREDENTIAL_TEXT.test(password) ||
    Buffer.byteLength(password, 'utf8') > MAX_AUTH_VALUE_BYTES
  ) {
    throw invalidCredentials('password is invalid')
  }

  const hostname = new URL(instanceUrl).hostname
  return {
    accessToken: Buffer.from(`${username}:${password}`, 'utf8').toString('base64'),
    expiresInSeconds: SYNTHETIC_TOKEN_TTL_SECONDS,
    instanceUrl,
    identity: {
      displayName: `Oracle EPM ${hostname}`,
      principal: null,
      auditMetadata: { environmentUrl: instanceUrl },
      storedMetadata: { environmentUrl: instanceUrl },
    },
  }
}
