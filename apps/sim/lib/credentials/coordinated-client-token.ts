import { createHash } from 'node:crypto'
import { db } from '@sim/db'
import { clientCredentialToken } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { isRecordLike } from '@sim/utils/object'
import { and, eq, inArray, lt, sql } from 'drizzle-orm'
import { decryptSecret, encryptSecret } from '@/lib/core/security/encryption'
import {
  assessTokenRequestFailure,
  classifyTokenRequestFailure,
  requestTokenWithRetry,
  TOKEN_EXPIRY_MARGIN_MS,
  TOKEN_FAILURE_STREAK_RETENTION_MS,
} from '@/lib/credentials/token-request-resilience'
import { TokenServiceAccountValidationError } from '@/lib/credentials/token-service-accounts/errors'
import { acquireAdvisoryXactLock } from '@/lib/db/advisory-locks'

const logger = createLogger('CoordinatedClientToken')

/** A stored token is refreshed once less than this much of its lifetime remains. */
const MIN_REMAINING_MS = 5 * 60 * 1000
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
  /**
   * Remaining lifetime below which a stored token is refreshed. Defaults to five minutes. If the
   * refresh fails with an outage or throttling, the token is still served until 30 seconds (or
   * this value, when smaller) before it expires.
   */
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

/**
 * A remembered exchange failure, replayed until its row's `expiresAt`. Builds before failure
 * kinds stored `{ code, status }` only and ignore other keys, so `consecutiveFailures` is
 * written only for outages and throttling, to grow their backoff while they continue.
 */
interface StoredFailure {
  code: 'invalid_credentials' | 'grant_not_permitted' | 'site_not_found' | 'provider_unavailable'
  status: number
  consecutiveFailures?: number
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
 * Deletes a bounded batch of failure memos (rows without a token digest) that expired more than
 * {@link TOKEN_FAILURE_STREAK_RETENTION_MS} ago; a more recently expired one is kept so the next
 * failure continues its backoff. Run it outside the transaction that takes an application lock,
 * so its row locks are released before any provider call.
 */
async function deleteExpiredClientTokenFailures(): Promise<void> {
  const retentionSeconds = TOKEN_FAILURE_STREAK_RETENTION_MS / 1000
  await db.execute(sql`
    DELETE FROM ${clientCredentialToken} WHERE ${clientCredentialToken.id} IN (
      SELECT ${clientCredentialToken.id} FROM ${clientCredentialToken}
      WHERE ${clientCredentialToken.accessTokenDigest} IS NULL
        AND ${clientCredentialToken.expiresAt} < now() - make_interval(secs => ${retentionSeconds})
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
  return {
    code: parsed.code as StoredFailure['code'],
    status: parsed.status,
    ...(Number.isSafeInteger(parsed.consecutiveFailures) && Number(parsed.consecutiveFailures) > 0
      ? { consecutiveFailures: Number(parsed.consecutiveFailures) }
      : {}),
  }
}

/** The error a remembered failure is replayed as, with how long it is still replayed. */
function replayedFailure(
  failure: StoredFailure,
  step: string,
  replayMs: number
): TokenServiceAccountValidationError {
  return new TokenServiceAccountValidationError(
    failure.code,
    failure.status,
    { step },
    { retryAfterMs: Math.max(replayMs, 0) }
  )
}

/**
 * Outages and throttled answers in a row before this exchange, read from the application's last
 * failure memo for this secret once its replay has ended. Anything unreadable starts a new streak.
 */
async function consecutiveFailuresBefore(
  row: typeof clientCredentialToken.$inferSelect | undefined,
  step: string
): Promise<number> {
  if (!row || Date.now() - row.expiresAt.getTime() > TOKEN_FAILURE_STREAK_RETENTION_MS) return 0
  try {
    const failure = decodeFailure((await decryptSecret(row.encryptedValue)).decrypted, step)
    if (classifyTokenRequestFailure(replayedFailure(failure, step, 0)) === 'permanent') return 0
    return failure.consecutiveFailures ?? 1
  } catch {
    return 0
  }
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
 * provider rejects is expired through {@link invalidateCoordinatedClientToken}.
 *
 * A quick outage is retried once inside the exchange. An exchange that still fails validation is
 * remembered for every worker, with the policy the per-instance mint cache applies (see
 * `assessTokenRequestFailure`): a refusal of the credentials for 30 seconds, a throttled answer as
 * long as its `Retry-After` asks (at most five minutes), and an outage for 5 seconds growing to 30
 * while it continues, so a hot workflow neither hammers the token endpoint with a revoked secret
 * nor floods a struggling one. While an outage or throttling is remembered, the stored token for
 * the same secret is still served until shortly before it actually expires; a refusal is
 * reported at once. Tokens are encrypted at rest.
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

  /**
   * The stored token for this secret while it has not yet run out, to serve when its refresh
   * fails with an outage. Anything that would not be served fresh (a record that does not decode
   * or verify) is never a fallback.
   */
  const stillValid = async (row: typeof clientCredentialToken.$inferSelect | undefined) => {
    if (!row || !isServable(row.expiresAt, Math.min(TOKEN_EXPIRY_MARGIN_MS, minRemainingMs)))
      return undefined
    try {
      const stored = decodeApplicationToken(
        (await decryptSecret(row.encryptedValue)).decrypted,
        step
      )
      pinnedState?.verify(stored.record)
      if (stored.secretFingerprint !== secretFingerprint) return undefined
      return { accessToken: stored.accessToken, expiresInSeconds: remainingSeconds(row.expiresAt) }
    } catch {
      return undefined
    }
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
    const outcome = await db.transaction<
      CoordinatedClientToken | { failure: TokenServiceAccountValidationError }
    >(async (tx) => {
      await tx.execute(sql`SET LOCAL lock_timeout = '15s'`)
      await acquireAdvisoryXactLock(tx, `${namespace}_client_token`, applicationKey)
      signal?.throwIfAborted()
      const entries = await tx
        .select()
        .from(clientCredentialToken)
        .where(inArray(clientCredentialToken.id, [applicationKey, failureKey]))
      const applicationRow = entries.find((entry) => entry.id === applicationKey)
      const minted = await serveIfFresh(applicationRow, true)
      if (minted) return minted
      const failureRow = entries.find((entry) => entry.id === failureKey)
      if (failureRow && failureRow.expiresAt.getTime() > Date.now()) {
        const failure = replayedFailure(
          decodeFailure((await decryptSecret(failureRow.encryptedValue)).decrypted, step),
          step,
          failureRow.expiresAt.getTime() - Date.now()
        )
        if (classifyTokenRequestFailure(failure) !== 'permanent') {
          const fallback = await stillValid(applicationRow)
          if (fallback) return fallback
        }
        return { failure }
      }
      signal?.throwIfAborted()
      try {
        const exchanged = await requestTokenWithRetry(() => input.exchange(signal), signal)
        const { encrypted } = await encryptSecret(
          JSON.stringify({
            accessToken: exchanged.accessToken,
            secretFingerprint,
            ...pinnedState?.values,
          })
        )
        const values = {
          encryptedValue: encrypted,
          accessTokenDigest: accessTokenDigestOf(exchanged.accessToken, input.accessTokenDigestTag),
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
        const assessed = assessTokenRequestFailure(
          error,
          await consecutiveFailuresBefore(failureRow, step)
        )
        const failure: StoredFailure = {
          code: STORED_FAILURE_CODES.has(error.code)
            ? (error.code as StoredFailure['code'])
            : 'provider_unavailable',
          status: error.status,
          ...(assessed.kind === 'permanent'
            ? {}
            : { consecutiveFailures: assessed.consecutiveFailures }),
        }
        const { encrypted } = await encryptSecret(JSON.stringify(failure))
        const expiresAt = new Date(Date.now() + assessed.replayMs)
        await tx
          .insert(clientCredentialToken)
          .values({ id: failureKey, encryptedValue: encrypted, expiresAt })
          .onConflictDoUpdate({
            target: clientCredentialToken.id,
            set: { encryptedValue: encrypted, expiresAt, updatedAt: new Date() },
          })
        if (assessed.kind !== 'permanent') {
          const fallback = await stillValid(applicationRow)
          if (fallback) {
            logger.warn('Serving a still-valid client-credentials token after its refresh failed', {
              namespace,
              failure: assessed.kind,
              retryInMs: assessed.replayMs,
            })
            return fallback
          }
        }
        return { failure: replayedFailure(failure, step, assessed.replayMs) }
      }
    })
    signal?.throwIfAborted()
    if ('failure' in outcome) throw outcome.failure
    return outcome
  } catch (error) {
    signal?.throwIfAborted()
    if (error instanceof TokenServiceAccountValidationError) throw error
    throw unavailable(step, 'token coordination or exchange failed')
  }
}
