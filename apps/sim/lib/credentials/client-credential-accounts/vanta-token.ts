import { createHash } from 'node:crypto'
import { db } from '@sim/db'
import { clientCredentialToken } from '@sim/db/schema'
import { isRecordLike } from '@sim/utils/object'
import { eq, inArray, sql } from 'drizzle-orm'
import { decryptSecret, encryptSecret } from '@/lib/core/security/encryption'
import { readResponseJsonWithLimit } from '@/lib/core/utils/stream-limits'
import { VANTA_PERMISSION_OPTIONS } from '@/lib/credentials/client-credential-accounts/descriptors'
import {
  fetchProvider,
  isTransientProviderStatus,
  requireClientSecret,
  TokenServiceAccountValidationError,
} from '@/lib/credentials/token-service-accounts/errors'
import { acquireAdvisoryXactLock } from '@/lib/db/advisory-locks'

const SCOPES = VANTA_PERMISSION_OPTIONS.map((option) => option.value)
const EXPIRY_BUFFER_MS = 30_000
const FAILURE_TTL_MS = 30_000
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

interface VantaTokenEnvelope {
  accessToken: string
  secretFingerprint: string
  scope: string
}

interface VantaTokenFailure {
  code: 'invalid_credentials' | 'provider_unavailable'
  status: number
}

export interface VantaClientTokenResult {
  accessToken: string
  expiresInSeconds: number
  apiDomain: string
}

function digest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

/** Expires only the rejected token; a concurrent replacement remains usable. */
export async function invalidateVantaClientToken(
  accessToken: string,
  apiDomain: string
): Promise<void> {
  if (apiDomain !== 'https://api.vanta.com' && apiDomain !== 'https://api.vanta-gov.com') {
    throw new Error('Invalid Vanta API domain')
  }
  await db
    .update(clientCredentialToken)
    .set({ expiresAt: new Date(0), updatedAt: new Date() })
    .where(eq(clientCredentialToken.accessTokenDigest, digest([apiDomain, accessToken])))
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

function decodeToken(value: string): VantaTokenEnvelope {
  const parsed: unknown = JSON.parse(value)
  if (
    !isRecordLike(parsed) ||
    typeof parsed.accessToken !== 'string' ||
    !parsed.accessToken ||
    typeof parsed.secretFingerprint !== 'string' ||
    typeof parsed.scope !== 'string' ||
    !SCOPES.some((scope) => scope === parsed.scope)
  )
    throw unavailable('stored token is malformed')
  return {
    accessToken: parsed.accessToken,
    secretFingerprint: parsed.secretFingerprint,
    scope: parsed.scope,
  }
}

function decodeFailure(value: string): VantaTokenFailure {
  const parsed: unknown = JSON.parse(value)
  if (
    !isRecordLike(parsed) ||
    (parsed.code !== 'invalid_credentials' && parsed.code !== 'provider_unavailable') ||
    typeof parsed.status !== 'number'
  )
    throw unavailable('stored token failure is malformed')
  return { code: parsed.code, status: parsed.status }
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
 * create parallel token chains. All shared cache material is encrypted at rest.
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
  const applicationKey = `vanta:${digest([apiDomain, fields.clientId])}`
  const secretFingerprint = digest([apiDomain, fields.clientId, clientSecret])
  const failureKey = `${applicationKey}:${digest([secretFingerprint, scope])}`
  try {
    // Release cleanup row locks before taking an application lock or calling the provider.
    await db.execute(sql`
      DELETE FROM ${clientCredentialToken} WHERE ${clientCredentialToken.id} IN (
        SELECT ${clientCredentialToken.id} FROM ${clientCredentialToken}
        WHERE ${clientCredentialToken.expiresAt} < now()
        ORDER BY ${clientCredentialToken.expiresAt} LIMIT 100 FOR UPDATE SKIP LOCKED
      )`)
    const outcome = await db.transaction<VantaClientTokenResult | { failure: VantaTokenFailure }>(
      async (tx) => {
        await tx.execute(sql`SET LOCAL lock_timeout = '15s'`)
        await acquireAdvisoryXactLock(tx, 'vanta_client_token', applicationKey)
        options.signal?.throwIfAborted()
        const entries = await tx
          .select()
          .from(clientCredentialToken)
          .where(inArray(clientCredentialToken.id, [applicationKey, failureKey]))
        const existing = entries.find((entry) => entry.id === applicationKey)
        const existingToken = existing
          ? decodeToken((await decryptSecret(existing.encryptedValue)).decrypted)
          : null
        const matchingSecret = existingToken?.secretFingerprint === secretFingerprint
        if (
          existingToken &&
          matchingSecret &&
          existing &&
          existing.expiresAt.getTime() > Date.now()
        ) {
          if (existingToken.scope !== scope) {
            throw new VantaScopeConflictError()
          }
          if (existing.expiresAt.getTime() - Date.now() > EXPIRY_BUFFER_MS)
            return {
              accessToken: existingToken.accessToken,
              expiresInSeconds: Math.floor((existing.expiresAt.getTime() - Date.now()) / 1000),
              apiDomain,
            }
        }
        const failure = entries.find(
          (entry) => entry.id === failureKey && entry.expiresAt.getTime() > Date.now()
        )
        if (failure)
          return { failure: decodeFailure((await decryptSecret(failure.encryptedValue)).decrypted) }
        options.signal?.throwIfAborted()
        try {
          const minted = await exchangeToken(fields, apiDomain, clientSecret, scope, options.signal)
          const accessTokenDigest = digest([apiDomain, minted.accessToken])
          const { encrypted } = await encryptSecret(
            JSON.stringify({ accessToken: minted.accessToken, secretFingerprint, scope })
          )
          await tx
            .insert(clientCredentialToken)
            .values({
              id: applicationKey,
              encryptedValue: encrypted,
              accessTokenDigest,
              expiresAt: minted.expiresAt,
            })
            .onConflictDoUpdate({
              target: clientCredentialToken.id,
              set: {
                encryptedValue: encrypted,
                accessTokenDigest,
                expiresAt: minted.expiresAt,
                updatedAt: new Date(),
              },
            })
          await tx.delete(clientCredentialToken).where(eq(clientCredentialToken.id, failureKey))
          return {
            accessToken: minted.accessToken,
            expiresInSeconds: Math.floor((minted.expiresAt.getTime() - Date.now()) / 1000),
            apiDomain,
          }
        } catch (error) {
          if (!(error instanceof TokenServiceAccountValidationError)) throw error
          const failure: VantaTokenFailure = {
            code:
              error.code === 'invalid_credentials' ? 'invalid_credentials' : 'provider_unavailable',
            status: error.status,
          }
          const { encrypted } = await encryptSecret(JSON.stringify(failure))
          const expiresAt = new Date(Date.now() + FAILURE_TTL_MS)
          await tx
            .insert(clientCredentialToken)
            .values({ id: failureKey, encryptedValue: encrypted, expiresAt })
            .onConflictDoUpdate({
              target: clientCredentialToken.id,
              set: { encryptedValue: encrypted, expiresAt, updatedAt: new Date() },
            })
          return { failure }
        }
      }
    )
    options.signal?.throwIfAborted()
    if ('failure' in outcome)
      throw new TokenServiceAccountValidationError(outcome.failure.code, outcome.failure.status, {
        step: STEP,
      })
    return outcome
  } catch (error) {
    options.signal?.throwIfAborted()
    if (error instanceof TokenServiceAccountValidationError) throw error
    throw unavailable('token coordination or exchange failed')
  }
}
