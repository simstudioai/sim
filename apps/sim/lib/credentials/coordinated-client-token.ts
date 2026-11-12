import { createHash } from 'node:crypto'
import { db } from '@sim/db'
import { clientCredentialToken } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { isRecordLike } from '@sim/utils/object'
import { and, eq, inArray, lt, sql } from 'drizzle-orm'
import { decryptSecret, encryptSecret } from '@/lib/core/security/encryption'
import {
  assessTokenRequestFailure,
  isPermanentTokenFailureCode,
  requestTokenWithRetry,
  TOKEN_EXPIRY_MARGIN_MS,
  TOKEN_FAILURE_STREAK_RETENTION_MS,
  type TokenRequestFailure,
} from '@/lib/credentials/token-request-resilience'
import {
  providerFailureCode,
  TokenServiceAccountValidationError,
} from '@/lib/credentials/token-service-accounts/errors'
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
   * The provider is asked for a token at most once per this interval while its exchanges fail:
   * a quick outage is not retried inside the exchange, and every failure is replayed at least this
   * long. For providers that rate-limit token minting itself (Vanta: 5 tokens a minute), where
   * every exchange the provider processes also revokes the application's previous token.
   */
  minExchangeIntervalMs?: number
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

type StoredRow = typeof clientCredentialToken.$inferSelect

interface StoredApplicationToken {
  accessToken: string
  secretFingerprint: string
  record: Readonly<Record<string, unknown>>
}

/**
 * A remembered exchange failure, replayed until its row's `expiresAt`. Builds before failure
 * kinds stored `{ code, status }` only and ignore other keys, so `consecutiveFailures` is
 * written only for outages and throttling, to grow their backoff while they continue, `throttled`
 * only for throttling, so its streak is kept apart from an outage's, and `refusal` only for a
 * refusal whose code those builds read as `provider_unavailable`.
 */
interface StoredFailure {
  code: 'invalid_credentials' | 'grant_not_permitted' | 'site_not_found' | 'provider_unavailable'
  status: number
  consecutiveFailures?: number
  throttled?: true
  refusal?: true
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
    ...(parsed.throttled === true ? { throttled: true } : {}),
    ...(parsed.refusal === true ? { refusal: true } : {}),
  }
}

/**
 * Whether a remembered failure refused the credentials, so no stored token is served for it. A
 * build before failure kinds stored a refusal whose code it could not store as
 * `provider_unavailable` with the provider's status and no streak count, so such a row whose
 * status names a refusal (a non-transient 4xx) is one too.
 */
function isRememberedRefusal(failure: StoredFailure): boolean {
  if (failure.refusal === true || isPermanentTokenFailureCode(failure.code)) return true
  return (
    failure.consecutiveFailures === undefined &&
    isPermanentTokenFailureCode(providerFailureCode(failure.status))
  )
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
    { replayForMs: Math.max(replayMs, 0) }
  )
}

/**
 * The outage or throttling streak before this exchange, read from the application's last failure
 * memo for this secret once its replay has ended. A refusal, or anything unreadable, starts a new
 * streak.
 */
async function failureStreakBefore(
  row: StoredRow | undefined,
  step: string
): Promise<Pick<TokenRequestFailure, 'kind' | 'consecutiveFailures'> | undefined> {
  if (!row || Date.now() - row.expiresAt.getTime() > TOKEN_FAILURE_STREAK_RETENTION_MS) return
  try {
    const failure = decodeFailure((await decryptSecret(row.encryptedValue)).decrypted, step)
    if (isRememberedRefusal(failure)) return
    return {
      kind: failure.throttled ? 'throttled' : 'transient',
      consecutiveFailures: failure.consecutiveFailures ?? 1,
    }
  } catch {
    return
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
 * A quick outage is retried once inside the exchange (unless `minExchangeIntervalMs` is set). An
 * exchange that still fails validation is remembered for every worker, with the policy the
 * per-instance mint cache applies (see `assessTokenRequestFailure`): a refusal of the credentials
 * for 30 seconds, a throttled answer as long as its `Retry-After` asks (at most five minutes) or
 * for a minute growing to five without one, and an outage for 5 seconds growing to 30 while it
 * continues, so a hot workflow neither hammers the token endpoint with a revoked secret nor floods
 * a struggling one. While an outage or throttling is remembered, the stored token for the same
 * secret is still served until shortly before it actually expires; a refusal is reported at once
 * and expires that secret's stored token, so no later outage serves it again.
 * A remembered failure, and that fallback, are served from committed rows without taking the
 * application lock. Tokens are encrypted at rest.
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

  const fallbackRemainingMs = Math.min(TOKEN_EXPIRY_MARGIN_MS, minRemainingMs)
  const decodedRows = new WeakMap<StoredRow, Promise<StoredApplicationToken>>()

  /**
   * The token `row` holds for this secret while more than `remainingMs` of it is left. The record
   * is decoded and its pinned state verified (throwing on a malformed record or a mismatch) once
   * per row, whenever it could be served, and for an expired record too when `verifyExpired` is
   * set and settings are pinned.
   */
  const serveStored = async (
    row: StoredRow | undefined,
    remainingMs: number,
    verifyExpired = false
  ): Promise<CoordinatedClientToken | undefined> => {
    if (!row) return undefined
    const servable = isServable(row.expiresAt, remainingMs)
    if (!servable && !(verifyExpired && pinnedState)) return undefined
    let decoded = decodedRows.get(row)
    if (!decoded) {
      decoded = decryptSecret(row.encryptedValue).then(({ decrypted }) => {
        const stored = decodeApplicationToken(decrypted, step)
        pinnedState?.verify(stored.record)
        return stored
      })
      decodedRows.set(row, decoded)
    }
    const stored = await decoded
    if (!servable || stored.secretFingerprint !== secretFingerprint) return undefined
    return { accessToken: stored.accessToken, expiresInSeconds: remainingSeconds(row.expiresAt) }
  }

  /**
   * The stored token for this secret while it has not yet run out, served while its refresh fails
   * with an outage or throttling. A record that does not decode or verify is never a fallback.
   */
  const fallbackFrom = (row: StoredRow | undefined) =>
    serveStored(row, fallbackRemainingMs).catch(() => undefined)

  /**
   * Whether `row` holds a token minted with this secret, expired or not, so a refusal of the
   * secret ends that token too and a token another secret minted stays in service.
   */
  const holdsTokenForSecret = async (row: StoredRow | undefined) =>
    (await serveStored(row, Number.NEGATIVE_INFINITY).catch(() => undefined)) !== undefined

  /**
   * Replays the application's unexpired failure memo for this secret: the still-valid token for a
   * remembered outage or throttling, the failure otherwise. `undefined` when nothing is remembered.
   * Reading committed rows needs no lock, so this also runs before the application lock is taken.
   */
  const replayRemembered = async (
    applicationRow: StoredRow | undefined,
    failureRow: StoredRow | undefined
  ): Promise<
    CoordinatedClientToken | { failure: TokenServiceAccountValidationError } | undefined
  > => {
    if (!failureRow || failureRow.expiresAt.getTime() <= Date.now()) return undefined
    const failure = decodeFailure((await decryptSecret(failureRow.encryptedValue)).decrypted, step)
    if (!isRememberedRefusal(failure)) {
      const fallback = await fallbackFrom(applicationRow)
      if (fallback) return fallback
    }
    return { failure: replayedFailure(failure, step, failureRow.expiresAt.getTime() - Date.now()) }
  }

  const settle = (
    outcome: CoordinatedClientToken | { failure: TokenServiceAccountValidationError }
  ): CoordinatedClientToken => {
    signal?.throwIfAborted()
    if ('failure' in outcome) throw outcome.failure
    return outcome
  }

  try {
    const current = await db
      .select()
      .from(clientCredentialToken)
      .where(inArray(clientCredentialToken.id, [applicationKey, failureKey]))
    const currentApplication = current.find((entry) => entry.id === applicationKey)
    const fresh = await serveStored(currentApplication, minRemainingMs, true)
    if (fresh) return fresh
    const remembered = await replayRemembered(
      currentApplication,
      current.find((entry) => entry.id === failureKey)
    )
    if (remembered) return settle(remembered)

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
      const minted = await serveStored(applicationRow, minRemainingMs, true)
      if (minted) return minted
      const failureRow = entries.find((entry) => entry.id === failureKey)
      const rememberedUnderLock = await replayRemembered(applicationRow, failureRow)
      if (rememberedUnderLock) return rememberedUnderLock
      signal?.throwIfAborted()
      try {
        const exchanged =
          input.minExchangeIntervalMs === undefined
            ? await requestTokenWithRetry(() => input.exchange(signal), signal)
            : await input.exchange(signal)
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
          await failureStreakBefore(failureRow, step)
        )
        const replayMs = Math.max(assessed.replayMs, input.minExchangeIntervalMs ?? 0)
        const code = STORED_FAILURE_CODES.has(error.code)
          ? (error.code as StoredFailure['code'])
          : 'provider_unavailable'
        const failure: StoredFailure = {
          code,
          status: error.status,
          ...(assessed.kind !== 'permanent'
            ? {
                consecutiveFailures: assessed.consecutiveFailures,
                ...(assessed.kind === 'throttled' ? { throttled: true } : {}),
              }
            : isPermanentTokenFailureCode(code)
              ? {}
              : { refusal: true }),
        }
        const { encrypted } = await encryptSecret(JSON.stringify(failure))
        const expiresAt = new Date(Date.now() + replayMs)
        await tx
          .insert(clientCredentialToken)
          .values({ id: failureKey, encryptedValue: encrypted, expiresAt })
          .onConflictDoUpdate({
            target: clientCredentialToken.id,
            set: { encryptedValue: encrypted, expiresAt, updatedAt: new Date() },
          })
        if (assessed.kind === 'permanent') {
          if (await holdsTokenForSecret(applicationRow)) {
            await tx
              .update(clientCredentialToken)
              .set({ expiresAt: new Date(0), updatedAt: new Date() })
              .where(eq(clientCredentialToken.id, applicationKey))
          }
          return { failure: replayedFailure(failure, step, replayMs) }
        }
        const fallback = await fallbackFrom(applicationRow)
        if (fallback) {
          logger.warn('Serving a still-valid client-credentials token after its refresh failed', {
            namespace,
            failure: assessed.kind,
            retryInMs: replayMs,
          })
          return fallback
        }
        return { failure: replayedFailure(failure, step, replayMs) }
      }
    })
    return settle(outcome)
  } catch (error) {
    signal?.throwIfAborted()
    if (error instanceof TokenServiceAccountValidationError) throw error
    throw unavailable(step, 'token coordination or exchange failed')
  }
}
