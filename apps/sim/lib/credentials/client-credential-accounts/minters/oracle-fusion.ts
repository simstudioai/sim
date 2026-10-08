import { normalizeOracleFusionApplicationOrigin } from '@/lib/credentials/client-credential-accounts/descriptors'
import type {
  ClientCredentialAccountFields,
  ClientCredentialAccountMintOptions,
  ClientCredentialAccountMintResult,
} from '@/lib/credentials/client-credential-accounts/server'
import { TokenServiceAccountValidationError } from '@/lib/credentials/token-service-accounts/errors'

const BASIC_CREDENTIAL_CACHE_TTL_SECONDS = 5 * 60
const ORACLE_FUSION_CREDENTIAL_STEP = 'oracle_fusion_credential_validation'
const USERNAME_MAX_LENGTH = 255
const PASSWORD_MAX_LENGTH = 1024
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/

function invalidCredential(reason: string): TokenServiceAccountValidationError {
  return new TokenServiceAccountValidationError('invalid_credentials', 400, {
    step: ORACLE_FUSION_CREDENTIAL_STEP,
    reason,
  })
}

/**
 * Resolves locally validated Oracle Basic credentials through the shared
 * client-credential minter contract. Oracle does not expose a documented,
 * privilege-neutral identity probe, so authentication occurs on first use.
 */
export async function mintOracleFusionServiceAccountToken(
  fields: ClientCredentialAccountFields,
  options?: ClientCredentialAccountMintOptions
): Promise<ClientCredentialAccountMintResult> {
  const instanceUrl = normalizeOracleFusionApplicationOrigin(fields.orgId)
  if (!instanceUrl) {
    throw new TokenServiceAccountValidationError('site_not_found', 400, {
      step: ORACLE_FUSION_CREDENTIAL_STEP,
      reason: 'Fusion Applications URL must be a canonical Oracle-assigned HTTPS origin',
    })
  }

  const username = fields.clientId.trim()
  const password = fields.clientSecret
  if (!username || username.length > USERNAME_MAX_LENGTH || CONTROL_CHARACTER.test(username)) {
    throw invalidCredential('integration username is invalid')
  }
  if (username.includes(':')) {
    throw invalidCredential('integration username must not contain a colon')
  }
  if (!password || password.length > PASSWORD_MAX_LENGTH || CONTROL_CHARACTER.test(password)) {
    throw invalidCredential('password is invalid')
  }

  const accessToken = Buffer.from(`${username}:${password}`, 'utf8').toString('base64')
  const tenant = new URL(instanceUrl).hostname.split('.')[0]
  return {
    instanceUrl,
    accessToken,
    expiresInSeconds: BASIC_CREDENTIAL_CACHE_TTL_SECONDS,
    ...(!options?.skipIdentity
      ? {
          identity: {
            displayName: `Oracle Fusion ${tenant}`,
            principal: null,
            auditMetadata: { oracleFusionApplicationOrigin: instanceUrl },
            storedMetadata: { applicationOrigin: instanceUrl },
          },
        }
      : {}),
  }
}
