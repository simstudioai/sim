import { isRecordLike } from '@sim/utils/object'
import { readResponseJsonWithLimit } from '@/lib/core/utils/stream-limits'
import { VANTA_PERMISSION_OPTIONS } from '@/lib/credentials/client-credential-accounts/descriptors'
import {
  invalidateCoordinatedClientToken,
  resolveCoordinatedClientToken,
} from '@/lib/credentials/coordinated-client-token'
import {
  fetchProvider,
  isTransientProviderStatus,
  requireClientSecret,
  TokenServiceAccountValidationError,
} from '@/lib/credentials/token-service-accounts/errors'

const SCOPES = VANTA_PERMISSION_OPTIONS.map((option) => option.value)
const EXPIRY_BUFFER_MS = 30_000
const STEP = 'vanta_token_mint'

export interface VantaClientTokenFields {
  clientId: string
  clientSecret?: string
  dataCenter?: string
  scope?: string
}

export interface VantaClientTokenOptions {
  signal?: AbortSignal
}

export interface VantaClientTokenResult {
  accessToken: string
  expiresInSeconds: number
  apiDomain: string
}

/** Expires only the rejected token; a concurrent replacement remains usable. */
export async function invalidateVantaClientToken(
  accessToken: string,
  apiDomain: string
): Promise<void> {
  if (apiDomain !== 'https://api.vanta.com' && apiDomain !== 'https://api.vanta-gov.com') {
    throw new Error('Invalid Vanta API domain')
  }
  await invalidateCoordinatedClientToken(accessToken, { accessTokenDigestTag: apiDomain })
}

function unavailable(reason: string): TokenServiceAccountValidationError {
  return new TokenServiceAccountValidationError('provider_unavailable', 503, { step: STEP, reason })
}

class VantaScopeConflictError extends TokenServiceAccountValidationError {
  constructor() {
    super('permission_conflict', 400, {
      step: STEP,
      reason: 'application already uses different permissions',
    })
    this.message =
      'Use the same permissions for connections to this Vanta application, or create a separate Vanta application for different permissions.'
  }
}

async function exchangeToken(
  fields: VantaClientTokenFields,
  apiDomain: string,
  clientSecret: string,
  scope: string,
  signal?: AbortSignal
): Promise<{ accessToken: string; expiresAt: Date }> {
  const startedAt = Date.now()
  const response = await fetchProvider(
    `${apiDomain}/oauth/token`,
    {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: fields.clientId,
        client_secret: clientSecret,
        grant_type: 'client_credentials',
        scope,
      }),
      redirect: 'error',
      cache: 'no-store',
      signal,
    },
    STEP
  )
  if (!response.ok) {
    await response.body?.cancel()
    throw new TokenServiceAccountValidationError(
      response.status >= 400 && response.status < 500 && !isTransientProviderStatus(response.status)
        ? 'invalid_credentials'
        : 'provider_unavailable',
      response.status,
      { step: STEP, reason: 'provider rejected token exchange' }
    )
  }
  const payload = await readResponseJsonWithLimit<unknown>(response, {
    maxBytes: 64 * 1024,
    label: 'Vanta authentication response',
    signal,
  })
  if (
    !isRecordLike(payload) ||
    typeof payload.access_token !== 'string' ||
    !payload.access_token.trim() ||
    typeof payload.expires_in !== 'number' ||
    !Number.isFinite(payload.expires_in) ||
    payload.expires_in <= 30 ||
    payload.token_type !== 'Bearer'
  )
    throw unavailable('provider returned an invalid token response')
  return {
    accessToken: payload.access_token,
    expiresAt: new Date(startedAt + Math.min(payload.expires_in, 3600) * 1000),
  }
}

/**
 * Centralizes Vanta's single active token across saved credentials,
 * connects, and workers. The application identity owns the lock; secrets and permissions never
 * create parallel token chains. The first successful connection fixes the application's
 * permissions, independently of token expiry. Shared application state is encrypted at rest.
 * @see https://developer.vanta.com/docs/concepts/authentication
 */
export async function resolveVantaClientToken(
  fields: VantaClientTokenFields,
  options: VantaClientTokenOptions = {}
): Promise<VantaClientTokenResult> {
  options.signal?.throwIfAborted()
  const clientSecret = requireClientSecret(fields.clientSecret, STEP, 'Vanta')
  const scope = fields.scope || SCOPES[0]
  if (!fields.clientId || !SCOPES.some((allowed) => allowed === scope)) {
    throw new TokenServiceAccountValidationError('invalid_credentials', 400, {
      step: STEP,
      reason: 'invalid client ID or scope',
    })
  }
  if (fields.dataCenter && fields.dataCenter !== 'us' && fields.dataCenter !== 'gov') {
    throw new TokenServiceAccountValidationError('invalid_credentials', 400, {
      step: STEP,
      reason: 'invalid Vanta deployment',
    })
  }
  const apiDomain =
    fields.dataCenter === 'gov' ? 'https://api.vanta-gov.com' : 'https://api.vanta.com'
  const token = await resolveCoordinatedClientToken({
    namespace: 'vanta',
    application: [apiDomain, fields.clientId],
    clientSecret,
    step: STEP,
    signal: options.signal,
    minRemainingMs: EXPIRY_BUFFER_MS,
    failureKeyQualifier: scope,
    accessTokenDigestTag: apiDomain,
    pinnedState: {
      values: { scope },
      verify: (stored) => {
        if (typeof stored.scope !== 'string' || !SCOPES.some((known) => known === stored.scope))
          throw unavailable('stored application state is malformed')
        if (stored.scope !== scope) throw new VantaScopeConflictError()
      },
    },
    exchange: (signal) => exchangeToken(fields, apiDomain, clientSecret, scope, signal),
  })
  return { ...token, apiDomain }
}
