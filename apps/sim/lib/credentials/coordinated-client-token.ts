import { createHash } from 'node:crypto'
import { db } from '@sim/db'
import { clientCredentialToken } from '@sim/db/schema'
import { isRecordLike } from '@sim/utils/object'
import { and, eq, inArray, lt, sql } from 'drizzle-orm'
import { decryptSecret, encryptSecret } from '@/lib/core/security/encryption'
import { TokenServiceAccountValidationError } from '@/lib/credentials/token-service-accounts/errors'
import { acquireAdvisoryXactLock } from '@/lib/db/advisory-locks'

/** A stored token is only handed out while at least this much of its lifetime remains. */
const MIN_REMAINING_MS = 5 * 60 * 1000
const FAILURE_TTL_MS = 30_000
const DEFAULT_ACCESS_TOKEN_DIGEST_TAG = 'coordinated_client_token'

/** The provider token a coordinated exchange produced. */
interface CoordinatedClientTokenExchange {
  accessToken: string
  expiresAt: Date
}

export interface CoordinatedClientTokenInput {
  /** Provider label for the coordination key and lock, e.g. `shopify`. */
  namespace: string
  /**
   * Every value that names the provider application and the account it acts on (never the
   * secret), so every saved credential for one application shares one token chain.
   */
  application: readonly string[]
  /** The secret the token is minted with; a token minted with another secret is never served. */
  clientSecret: string
  /** Step name recorded on validation errors. */
  step: string
  /** Performs the provider exchange. Throws `TokenServiceAccountValidationError` on refusal. */
  exchange: (signal?: AbortSignal) => Promise<CoordinatedClientTokenExchange>
  signal?: AbortSignal
  /** Shortest remaining lifetime a stored token is still served with. Defaults to five minutes. */
  minRemainingMs?: number
  /**
   * A request setting beyond the secret that a remembered exchange failure is specific to, so a
   * refusal for one setting does not block another.
   */
  failureKeyQualifier?: string
  /**
   * Tag mixed into the access-token digest that invalidation matches on. Pass the same tag to
   * {@link invalidateCoordinatedClientToken}. Defaults to a tag shared by every caller.
   */
  accessTokenDigestTag?: string
  /**
   * Settings the application's first mint fixes for every later resolution, stored with its token.
   * `verify` sees every stored token record (expired ones too, once the lock is held) and throws to
   * refuse it: a validation error for a mismatch, `provider_unavailable` for a malformed record.
   */
  pinnedState?: {
    values: Readonly<Record<string, string>>
    verify: (stored: Readonly<Record<string, unknown>>) => void
  }
}

export interface CoordinatedClientToken {
  accessToken: string
  expiresInSeconds: number
}

interface StoredApplicationToken {
  accessToken: string
  secretFingerprint: string
  record: Readonly<Record<string, unknown>>
}

interface StoredFailure {
  code: 'invalid_credentials' | 'grant_not_permitted' | 'site_not_found' | 'provider_unavailable'
  status: number
}

const STORED_FAILURE_CODES: ReadonlySet<string> = new Set([
  'invalid_credentials',
  'grant_not_permitted',
  'site_not_found',
  'provider_unavailable',
])

function digest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

/** Identifies a stored token by its value alone, so a provider rejection can expire it. */
function accessTokenDigestOf(accessToken: string, tag = DEFAULT_ACCESS_TOKEN_DIGEST_TAG): string {
  return digest([tag, accessToken])
}

/**
 * Deletes a bounded batch of expired failure memos (rows without a token digest). Run it outside
 * the transaction that takes an application lock, so its row locks are released before any
 * provider call.
 */
async function deleteExpiredClientTokenFailures(): Promise<void> {
  await db.execute(sql`
    DELETE FROM ${clientCredentialToken} WHERE ${clientCredentialToken.id} IN (
      SELECT ${clientCredentialToken.id} FROM ${clientCredentialToken}
      WHERE ${clientCredentialToken.accessTokenDigest} IS NULL
        AND ${clientCredentialToken.expiresAt} < now()
      ORDER BY ${clientCredentialToken.expiresAt} LIMIT 100 FOR UPDATE SKIP LOCKED
    )`)
}

interface InvalidateCoordinatedClientTokenOptions {
  /**
   * Keeps the token when it was minted less than this long ago. For rejections that may come from
   * the endpoint rather than the token, so a call that keeps failing cannot re-mint on every try.
   */
  minimumAgeMs?: number
  /** The `accessTokenDigestTag` the token was resolved with. */
  accessTokenDigestTag?: string
}

/**
 * Expires a stored token the provider rejected before its stated expiry (an app reinstall, a scope
 * change, a revocation), so the next resolution mints a replacement. Only that exact token is
 * expired: a replacement another worker already minted stays in service.
 */
export async function invalidateCoordinatedClientToken(
  accessToken: string,
  options: InvalidateCoordinatedClientTokenOptions = {}
): Promise<void> {
  const matchesToken = eq(
    clientCredentialToken.accessTokenDigest,
    accessTokenDigestOf(accessToken, options.accessTokenDigestTag)
  )
  await db
    .update(clientCredentialToken)
    .set({ expiresAt: new Date(0), updatedAt: new Date() })
    .where(
      options.minimumAgeMs
        ? and(
            matchesToken,
            lt(clientCredentialToken.updatedAt, new Date(Date.now() - options.minimumAgeMs))
          )
        : matchesToken
    )
}

function unavailable(step: string, reason: string): TokenServiceAccountValidationError {
  return new TokenServiceAccountValidationError('provider_unavailable', 503, { step, reason })
}

function decodeApplicationToken(value: string, step: string): StoredApplicationToken {
  const parsed: unknown = JSON.parse(value)
  if (
    !isRecordLike(parsed) ||
    typeof parsed.accessToken !== 'string' ||
    !parsed.accessToken ||
    typeof parsed.secretFingerprint !== 'string'
  )
    throw unavailable(step, 'stored application token is malformed')
  return {
    accessToken: parsed.accessToken,
    secretFingerprint: parsed.secretFingerprint,
    record: parsed,
  }
}

function decodeFailure(value: string, step: string): StoredFailure {
  const parsed: unknown = JSON.parse(value)
  if (
    !isRecordLike(parsed) ||
    typeof parsed.code !== 'string' ||
    !STORED_FAILURE_CODES.has(parsed.code) ||
    typeof parsed.status !== 'number'
  )
    throw unavailable(step, 'stored token failure is malformed')
  return { code: parsed.code as StoredFailure['code'], status: parsed.status }
}

function remainingSeconds(expiresAt: Date): number {
  return Math.floor((expiresAt.getTime() - Date.now()) / 1000)
}

function isServable(expiresAt: Date, minRemainingMs: number): boolean {
  return expiresAt.getTime() - Date.now() > minRemainingMs
}

/**
 * Serves one client-credentials token per provider application across every saved credential,
 * worker, and connect, until shortly before it expires. Used for providers that do not document
 * whether minting a new token leaves the previous one valid, and for providers that ask clients
 * to reuse one token rather than accumulate them. Minting happens only under a
 * transaction-scoped advisory lock keyed by the application, so two workers never race two
 * tokens into existence; a token minted with a different secret is never served, and a token the
 * provider rejects is expired through {@link invalidateCoordinatedClientToken}. An exchange that
 * fails validation, whether refused for the credentials or answered with an outage, is remembered
 * for 30 seconds, the same backoff the per-instance mint cache applies, so a hot workflow neither
 * hammers the token endpoint with a revoked secret nor floods a struggling one. Tokens are
 * encrypted at rest.
 */
export async function resolveCoordinatedClientToken(
  input: CoordinatedClientTokenInput
): Promise<CoordinatedClientToken> {
  const { namespace, step, signal, pinnedState } = input
  const minRemainingMs = input.minRemainingMs ?? MIN_REMAINING_MS
  signal?.throwIfAborted()
  const applicationKey = `${namespace}:${digest(input.application)}`
  const secretFingerprint = digest([...input.application, input.clientSecret])
  const failureKey = `${applicationKey}:${digest(
    input.failureKeyQualifier === undefined
      ? secretFingerprint
      : [secretFingerprint, input.failureKeyQualifier]
  )}`

  const serveIfFresh = async (
    row: typeof clientCredentialToken.$inferSelect | undefined,
    verifyExpired = false
  ) => {
    if (!row) return undefined
    const servable = isServable(row.expiresAt, minRemainingMs)
    if (!servable && !(verifyExpired && pinnedState)) return undefined
    const stored = decodeApplicationToken((await decryptSecret(row.encryptedValue)).decrypted, step)
    pinnedState?.verify(stored.record)
    if (!servable || stored.secretFingerprint !== secretFingerprint) return undefined
    return { accessToken: stored.accessToken, expiresInSeconds: remainingSeconds(row.expiresAt) }
  }

  try {
    const [current] = await db
      .select()
      .from(clientCredentialToken)
      .where(eq(clientCredentialToken.id, applicationKey))
      .limit(1)
    const fresh = await serveIfFresh(current)
    if (fresh) return fresh

    await deleteExpiredClientTokenFailures()
    const outcome = await db.transaction<CoordinatedClientToken | { failure: StoredFailure }>(
      async (tx) => {
        await tx.execute(sql`SET LOCAL lock_timeout = '15s'`)
        await acquireAdvisoryXactLock(tx, `${namespace}_client_token`, applicationKey)
        signal?.throwIfAborted()
        const entries = await tx
          .select()
          .from(clientCredentialToken)
          .where(inArray(clientCredentialToken.id, [applicationKey, failureKey]))
        const minted = await serveIfFresh(
          entries.find((entry) => entry.id === applicationKey),
          true
        )
        if (minted) return minted
        const failure = entries.find(
          (entry) => entry.id === failureKey && entry.expiresAt.getTime() > Date.now()
        )
        if (failure) {
          return {
            failure: decodeFailure((await decryptSecret(failure.encryptedValue)).decrypted, step),
          }
        }
        signal?.throwIfAborted()
        try {
          const exchanged = await input.exchange(signal)
          const { encrypted } = await encryptSecret(
            JSON.stringify({
              accessToken: exchanged.accessToken,
              secretFingerprint,
              ...pinnedState?.values,
            })
          )
          const values = {
            encryptedValue: encrypted,
            accessTokenDigest: accessTokenDigestOf(
              exchanged.accessToken,
              input.accessTokenDigestTag
            ),
            expiresAt: exchanged.expiresAt,
            updatedAt: new Date(),
          }
          await tx
            .insert(clientCredentialToken)
            .values({ id: applicationKey, ...values })
            .onConflictDoUpdate({ target: clientCredentialToken.id, set: values })
          await tx.delete(clientCredentialToken).where(eq(clientCredentialToken.id, failureKey))
          return {
            accessToken: exchanged.accessToken,
            expiresInSeconds: remainingSeconds(exchanged.expiresAt),
          }
        } catch (error) {
          if (!(error instanceof TokenServiceAccountValidationError)) throw error
          const failure: StoredFailure = {
            code: STORED_FAILURE_CODES.has(error.code)
              ? (error.code as StoredFailure['code'])
              : 'provider_unavailable',
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
    signal?.throwIfAborted()
    if ('failure' in outcome) {
      throw new TokenServiceAccountValidationError(outcome.failure.code, outcome.failure.status, {
        step,
      })
    }
    return outcome
  } catch (error) {
    signal?.throwIfAborted()
    if (error instanceof TokenServiceAccountValidationError) throw error
    throw unavailable(step, 'token coordination or exchange failed')
  }
}
