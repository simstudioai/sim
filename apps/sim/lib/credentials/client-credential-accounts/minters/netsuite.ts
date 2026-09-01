import { createPrivateKey, type KeyObject } from 'node:crypto'
import { generateId } from '@sim/utils/id'
import { truncate } from '@sim/utils/string'
import { SignJWT } from 'jose'
import {
  DEFAULT_MAX_ERROR_BODY_BYTES,
  readResponseJsonWithLimit,
  readResponseTextWithLimit,
} from '@/lib/core/utils/stream-limits'
import { normalizeNetSuiteSuiteTalkOrigin } from '@/lib/credentials/client-credential-accounts/descriptors'
import type {
  ClientCredentialAccountFields,
  ClientCredentialAccountMintOptions,
  ClientCredentialAccountMintResult,
} from '@/lib/credentials/client-credential-accounts/server'
import { tenantPrincipal } from '@/lib/credentials/principal'
import {
  isTransientProviderStatus,
  TokenServiceAccountValidationError,
} from '@/lib/credentials/token-service-accounts/errors'

const TOKEN_PATH = '/services/rest/auth/oauth2/v1/token'
const TOKEN_EXCHANGE_TIMEOUT_MS = 30_000
const TOKEN_RESPONSE_MAX_BYTES = 1024 * 1024
const DEFAULT_TOKEN_EXPIRES_IN_SECONDS = 3_600
const JWT_ASSERTION_LIFETIME_SECONDS = 300
const TOKEN_MINT_STEP = 'netsuite_token_mint'
const SUPPORTED_RSA_MODULUS_LENGTHS = new Set([3072, 4096])
const EC_ALGORITHM_BY_CURVE = new Map<string, 'ES256' | 'ES384' | 'ES512'>([
  ['prime256v1', 'ES256'],
  ['secp256r1', 'ES256'],
  ['p-256', 'ES256'],
  ['secp384r1', 'ES384'],
  ['p-384', 'ES384'],
  ['secp521r1', 'ES512'],
  ['p-521', 'ES512'],
])

interface NetSuiteTokenResponse {
  access_token?: unknown
  expires_in?: unknown
  token_type?: unknown
}

type NetSuiteJwtAlgorithm = 'PS256' | 'ES256' | 'ES384' | 'ES512'

function invalidCredentials(reason: string): TokenServiceAccountValidationError {
  return new TokenServiceAccountValidationError('invalid_credentials', 400, {
    step: TOKEN_MINT_STEP,
    reason,
  })
}

function loadNetSuitePrivateKey(privateKeyPem: string | undefined): KeyObject {
  if (!privateKeyPem?.trim()) {
    throw invalidCredentials('private key is required')
  }
  if (/ENCRYPTED PRIVATE KEY/.test(privateKeyPem)) {
    throw invalidCredentials('private key must not be passphrase-protected')
  }
  try {
    return createPrivateKey(privateKeyPem.trim())
  } catch {
    throw invalidCredentials('private key is not a readable PEM key')
  }
}

function getNetSuiteJwtAlgorithm(privateKey: KeyObject): NetSuiteJwtAlgorithm {
  const keyType = privateKey.asymmetricKeyType
  if (keyType === 'rsa' || keyType === 'rsa-pss') {
    const modulusLength = privateKey.asymmetricKeyDetails?.modulusLength
    if (modulusLength && SUPPORTED_RSA_MODULUS_LENGTHS.has(modulusLength)) return 'PS256'
    throw invalidCredentials('RSA private key must be 3072 or 4096 bits')
  }

  if (keyType === 'ec') {
    const namedCurve = privateKey.asymmetricKeyDetails?.namedCurve?.toLowerCase()
    const algorithm = namedCurve ? EC_ALGORITHM_BY_CURVE.get(namedCurve) : undefined
    if (algorithm) return algorithm
    throw invalidCredentials('EC private key must use P-256, P-384, or P-521')
  }

  throw invalidCredentials(
    'private key must use 3072- or 4096-bit RSA or the P-256, P-384, or P-521 EC curve'
  )
}

function sanitizeNetSuiteTokenError(
  value: string,
  fields: ClientCredentialAccountFields,
  assertion?: string
): string {
  let sanitized = value
    .replace(/-----BEGIN [^-]+-----[\s\S]*?-----END [^-]+-----/g, '[REDACTED]')
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[REDACTED]')
  for (const credential of [fields.clientId, fields.certificateId, fields.privateKey, assertion]) {
    const secret = credential?.trim()
    if (secret && secret.length >= 3) sanitized = sanitized.split(secret).join('[REDACTED]')
  }
  return truncate(sanitized.replace(/\s+/g, ' ').trim(), 500) || 'empty provider error'
}

async function exchangeNetSuiteToken(
  tokenUrl: string,
  assertion: string,
  fields: ClientCredentialAccountFields
): Promise<{ accessToken: string; expiresInSeconds: number }> {
  const signal = AbortSignal.timeout(TOKEN_EXCHANGE_TIMEOUT_MS)
  let response: Response
  try {
    response = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
        client_assertion: assertion,
      }).toString(),
      redirect: 'error',
      signal,
    })
  } catch {
    throw new TokenServiceAccountValidationError('provider_unavailable', 502, {
      step: TOKEN_MINT_STEP,
      reason: 'network error reaching provider',
    })
  }

  if (!response.ok) {
    let body = ''
    try {
      body = await readResponseTextWithLimit(response, {
        maxBytes: DEFAULT_MAX_ERROR_BODY_BYTES,
        label: 'NetSuite token error response',
        signal,
      })
    } catch {
      body = 'provider error response exceeded the allowed size or could not be read'
    }
    const code =
      response.status >= 400 && response.status < 500 && !isTransientProviderStatus(response.status)
        ? 'invalid_credentials'
        : 'provider_unavailable'
    throw new TokenServiceAccountValidationError(code, response.status, {
      step: TOKEN_MINT_STEP,
      body: sanitizeNetSuiteTokenError(body, fields, assertion),
    })
  }

  let payload: NetSuiteTokenResponse
  try {
    payload = await readResponseJsonWithLimit<NetSuiteTokenResponse>(response, {
      maxBytes: TOKEN_RESPONSE_MAX_BYTES,
      label: 'NetSuite token response',
      signal,
    })
  } catch {
    throw new TokenServiceAccountValidationError('provider_unavailable', 502, {
      step: TOKEN_MINT_STEP,
      reason: 'provider returned an invalid or oversized token response',
    })
  }
  if (
    typeof payload !== 'object' ||
    payload === null ||
    Array.isArray(payload) ||
    typeof payload.access_token !== 'string' ||
    !payload.access_token.trim()
  ) {
    throw new TokenServiceAccountValidationError('provider_unavailable', 502, {
      step: TOKEN_MINT_STEP,
      reason: 'token response missing access_token',
    })
  }
  if (
    typeof payload.expires_in !== 'number' ||
    !Number.isFinite(payload.expires_in) ||
    payload.expires_in <= 0
  ) {
    throw new TokenServiceAccountValidationError('provider_unavailable', 502, {
      step: TOKEN_MINT_STEP,
      reason: 'token response missing a positive finite expires_in',
    })
  }
  if (
    typeof payload.token_type !== 'string' ||
    payload.token_type.trim().toLowerCase() !== 'bearer'
  ) {
    throw new TokenServiceAccountValidationError('provider_unavailable', 502, {
      step: TOKEN_MINT_STEP,
      reason: 'token response missing bearer token_type',
    })
  }
  return {
    accessToken: payload.access_token.trim(),
    expiresInSeconds: Math.min(payload.expires_in, DEFAULT_TOKEN_EXPIRES_IN_SECONDS),
  }
}

/**
 * Mints a short-lived SuiteTalk REST token with NetSuite's OAuth 2.0
 * client-credentials certificate flow. The account-specific SuiteTalk origin
 * determines both the token audience and the API origin returned to tools, so
 * no bearer token can be redirected to a caller-controlled host.
 */
export async function mintNetSuiteServiceAccountToken(
  fields: ClientCredentialAccountFields,
  options?: ClientCredentialAccountMintOptions
): Promise<ClientCredentialAccountMintResult> {
  const origin = normalizeNetSuiteSuiteTalkOrigin(fields.orgId)
  if (!origin) {
    throw new TokenServiceAccountValidationError('site_not_found', 400, {
      step: 'netsuite_host_validation',
      reason: 'SuiteTalk URL must be an account-specific HTTPS origin with no extra URL parts',
    })
  }
  const clientId = fields.clientId.trim()
  const certificateId = fields.certificateId?.trim()
  if (!clientId || !certificateId) {
    throw invalidCredentials('client ID and certificate ID are required')
  }

  const privateKey = loadNetSuitePrivateKey(fields.privateKey)
  const algorithm = getNetSuiteJwtAlgorithm(privateKey)
  const tokenUrl = `${origin}${TOKEN_PATH}`
  const now = Math.floor(Date.now() / 1000)
  let assertion: string
  try {
    assertion = await new SignJWT({ scope: 'rest_webservices' })
      .setProtectedHeader({ typ: 'JWT', alg: algorithm, kid: certificateId })
      .setIssuer(clientId)
      .setAudience(tokenUrl)
      .setJti(generateId())
      .setIssuedAt(now)
      .setExpirationTime(now + JWT_ASSERTION_LIFETIME_SECONDS)
      .sign(privateKey)
  } catch {
    throw invalidCredentials('private key could not sign a NetSuite client assertion')
  }

  const minted = await exchangeNetSuiteToken(tokenUrl, assertion, fields)
  const hostname = new URL(origin).hostname
  const accountId = hostname.slice(0, -'.suitetalk.api.netsuite.com'.length)

  return {
    ...minted,
    instanceUrl: origin,
    ...(!options?.skipIdentity
      ? {
          identity: {
            displayName: `Oracle NetSuite ${accountId}`,
            principal: tenantPrincipal(accountId, hostname),
            auditMetadata: {
              netSuiteAccountId: accountId,
              netSuiteSuiteTalkOrigin: origin,
            },
            storedMetadata: { accountId, suiteTalkOrigin: origin },
          },
        }
      : {}),
  }
}
