import { db } from '@sim/db'
import { account, deletedAccountIdentity, user } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { hmacSha256Hex } from '@sim/security/hmac'
import { getErrorMessage } from '@sim/utils/errors'
import { normalizeEmail } from '@sim/utils/string'
import { and, asc, eq, gt, inArray, lte, sql } from 'drizzle-orm'
import { env } from '@/lib/core/config/env'
import { isBillingEnabled } from '@/lib/core/config/env-flags'
import type { DbOrTx } from '@/lib/db/types'

/**
 * Free-tier abuse guard for self-service account deletion.
 *
 * The free allowance is a one-time grant per person, but deletion erases the
 * account row and the usage ledger with it, so without this a person could
 * delete and re-register the same email, GitHub, or Microsoft identity for a fresh
 * allowance each time. Deletion keeps only keyed one-way digests of the
 * account's sign-in identities; a new account on a matching identity is created
 * normally but without the free allowance. This is the "one free trial per
 * identity" pattern, kept to data minimisation: no user id, address, or
 * profile data survives and every row expires after
 * {@link DELETED_IDENTITY_RETENTION_MS}. The digests are pseudonymous, not
 * anonymous: Sim holds the key, so it can test whether a candidate email or
 * sign-in subject was deleted, though it cannot read one back from a row.
 *
 * The key is derived from `BETTER_AUTH_SECRET`, so rotating that secret orphans
 * every stored digest: nothing matches until new deletions are recorded, and
 * returning identities get the allowance again (fails open).
 *
 * Only meaningful where billing is enabled; self-hosted deployments keep nothing.
 */

const logger = createLogger('DeletedAccountIdentity')

/**
 * How long a deleted account's identity digests are kept, and so how long they
 * withhold the free allowance from new accounts on the same identity: 30 days,
 * inside the privacy policy's stated retention of Account Data "for 30 days
 * after a deletion request". Each recorded deletion restarts the window for
 * the identities it records.
 */
const DELETED_IDENTITY_RETENTION_MS = 30 * 24 * 60 * 60 * 1000

/** Expired rows a recorded deletion removes opportunistically on its way through. */
const EXPIRED_PURGE_BATCH = 100

/** Rows per batch of the scheduled purge, each its own short transaction. */
const SCHEDULED_PURGE_BATCH = 1_000

/** Batches one scheduled run may delete before leaving the rest to the next run. */
const SCHEDULED_PURGE_MAX_BATCHES = 50

/** Stops admitting batches well inside the cron request's 60-second timeout. */
const SCHEDULED_PURGE_BUDGET_MS = 10_000

const GMAIL_DOMAINS = new Set(['gmail.com', 'googlemail.com'])

/**
 * Providers whose documented sub-addressing delivers `name+tag@` to `name@`.
 * Plus-addressing is a provider feature, not an email standard: elsewhere the
 * two can be different mailboxes, so tags are only stripped where it holds.
 */
const PLUS_ADDRESSING_DOMAINS = new Set([
  ...GMAIL_DOMAINS,
  'outlook.com',
  'hotmail.com',
  'live.com',
  'msn.com',
  'icloud.com',
  'me.com',
  'mac.com',
  'fastmail.com',
  'proton.me',
  'protonmail.com',
  'pm.me',
])

/**
 * Sign-in providers whose subject ids are recorded and matched. Google is left
 * out: the privacy policy keeps Google API data only 7 days after deletion, and
 * a Google re-signup is still caught by its email digest. Integration
 * connections share the `account` table but carry per-connection ids, and the
 * email/password row's `accountId` is the user id itself, so neither counts.
 */
const RECORDED_SIGN_IN_PROVIDER_IDS = ['github', 'microsoft'] as const

const recordedSignInProviderIdSet: ReadonlySet<string> = new Set(RECORDED_SIGN_IN_PROVIDER_IDS)

/** One social sign-in identity: the provider and that provider's stable subject id. */
interface OAuthSubject {
  providerId: string
  accountId: string
}

interface SignInIdentity {
  email?: string | null
  oauthSubjects?: OAuthSubject[]
}

let identityKey: string | undefined

/** Purpose-bound key, so a digest here can never be replayed against any other use of the secret. */
function getIdentityKey(): string {
  identityKey ??= hmacSha256Hex('sim:deleted-account-identity:v1', env.BETTER_AUTH_SECRET)
  return identityKey
}

/**
 * Collapses the address variants that deliver to the same mailbox: case, `+tag`
 * sub-addressing at providers that support it, and Gmail's ignored dots and
 * `googlemail.com` alias.
 */
function canonicalizeEmail(email: string): string | null {
  const normalized = normalizeEmail(email)
  const at = normalized.lastIndexOf('@')
  if (at <= 0 || at === normalized.length - 1) return null
  let local = normalized.slice(0, at)
  let domain = normalized.slice(at + 1)
  const plus = local.indexOf('+')
  if (plus > 0 && PLUS_ADDRESSING_DOMAINS.has(domain)) local = local.slice(0, plus)
  if (GMAIL_DOMAINS.has(domain)) {
    local = local.replaceAll('.', '')
    domain = 'gmail.com'
  }
  return local ? `${local}@${domain}` : null
}

function identityHashes(identity: SignInIdentity): string[] {
  const preimages: string[] = []
  const email = identity.email ? canonicalizeEmail(identity.email) : null
  if (email) preimages.push(`email:${email}`)
  for (const subject of identity.oauthSubjects ?? []) {
    if (!recordedSignInProviderIdSet.has(subject.providerId) || !subject.accountId) continue
    preimages.push(`oauth:${subject.providerId}:${subject.accountId}`)
  }
  const key = getIdentityKey()
  return [...new Set(preimages)].map((preimage) => hmacSha256Hex(preimage, key))
}

/** A user's email (and whether it is verified) and the social sign-in subjects linked to it. */
async function loadSignInIdentity(
  executor: DbOrTx,
  userId: string
): Promise<SignInIdentity & { emailVerified: boolean }> {
  const [profile] = await executor
    .select({ email: user.email, emailVerified: user.emailVerified })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1)
  const oauthSubjects = await executor
    .select({ providerId: account.providerId, accountId: account.accountId })
    .from(account)
    .where(
      and(
        eq(account.userId, userId),
        inArray(account.providerId, [...RECORDED_SIGN_IN_PROVIDER_IDS])
      )
    )
  return { email: profile?.email, emailVerified: profile?.emailVerified === true, oauthSubjects }
}

/**
 * Records the sign-in identities of an account being deleted at its holder's
 * request. Runs inside the deletion transaction, before the `user` row and its
 * `account` rows cascade away, so the record and the erasure commit together.
 *
 * The email is recorded only when it was verified: an unverified address may
 * belong to someone else, who must not lose the allowance for an account they
 * never held. Its GitHub and Microsoft subjects are recorded either way. Where
 * email verification is off, password accounts are therefore recorded by
 * nothing (fails open).
 *
 * The write runs in a savepoint and never fails the deletion: an anti-abuse
 * record must not become a way to block an erasure request. On failure the
 * savepoint rolls back, nothing is recorded, and the deletion proceeds.
 */
export async function recordDeletedAccountIdentities(tx: DbOrTx, userId: string): Promise<void> {
  if (!isBillingEnabled) return

  try {
    await tx.transaction(async (savepoint) => {
      const { email, emailVerified, oauthSubjects } = await loadSignInIdentity(savepoint, userId)
      const hashes = identityHashes({ email: emailVerified ? email : null, oauthSubjects })
      if (hashes.length === 0) return

      await savepoint.delete(deletedAccountIdentity).where(
        inArray(
          deletedAccountIdentity.identityHash,
          savepoint
            .select({ identityHash: deletedAccountIdentity.identityHash })
            .from(deletedAccountIdentity)
            .where(lte(deletedAccountIdentity.expiresAt, sql`now()`))
            .limit(EXPIRED_PURGE_BATCH)
            // Concurrent deletions skip each other's purge batch instead of waiting on its commit.
            .for('update', { skipLocked: true })
        )
      )

      const expiresAt = new Date(Date.now() + DELETED_IDENTITY_RETENTION_MS)
      await savepoint
        .insert(deletedAccountIdentity)
        .values(hashes.map((identityHash) => ({ identityHash, expiresAt })))
        .onConflictDoUpdate({
          target: deletedAccountIdentity.identityHash,
          set: { deletedAt: sql`now()`, expiresAt },
        })
    })
  } catch (error) {
    logger.warn('Could not record deleted-account identities; continuing the deletion', {
      userId,
      error: getErrorMessage(error),
    })
  }
}

async function findDeletedIdentityMatch(
  executor: DbOrTx,
  identity: SignInIdentity
): Promise<boolean> {
  const hashes = identityHashes(identity)
  if (hashes.length === 0) return false
  const [match] = await executor
    .select({ identityHash: deletedAccountIdentity.identityHash })
    .from(deletedAccountIdentity)
    .where(
      and(
        inArray(deletedAccountIdentity.identityHash, hashes),
        gt(deletedAccountIdentity.expiresAt, sql`now()`)
      )
    )
    .limit(1)
  return Boolean(match)
}

/**
 * Whether any of these identities belonged to an account deleted within the
 * retention window. Fails open: a lookup error returns `false` and is logged,
 * because refusing a legitimate person's allowance is worse than one missed match.
 */
export async function isDeletedAccountIdentity(identity: SignInIdentity): Promise<boolean> {
  if (!isBillingEnabled) return false
  try {
    return await findDeletedIdentityMatch(db, identity)
  } catch (error) {
    logger.error('Deleted-identity lookup failed; granting the free allowance', { error })
    return false
  }
}

/**
 * Whether an existing user's identities belonged to an account deleted within
 * the retention window: always its email, and its linked social sign-ins only
 * when `includeSignIns` is set, which callers do only for a user created in the
 * current signup request (a sign-in linked later never withholds anything).
 * Pass the caller's transaction as `executor` to read on it; the read then runs
 * in a savepoint, so a failed lookup never aborts that transaction. Fails open
 * like {@link isDeletedAccountIdentity}.
 */
export async function userHasDeletedAccountIdentity(
  userId: string,
  { includeSignIns }: { includeSignIns: boolean },
  executor: DbOrTx = db
): Promise<boolean> {
  if (!isBillingEnabled) return false
  const read = async (reader: DbOrTx) => {
    const identity = await loadSignInIdentity(reader, userId)
    return findDeletedIdentityMatch(reader, includeSignIns ? identity : { email: identity.email })
  }
  try {
    return await (executor === db ? read(db) : executor.transaction(read))
  } catch (error) {
    logger.error('Deleted-identity lookup failed; granting the free allowance', { userId, error })
    return false
  }
}

/**
 * Deletes every expired identity digest, so none outlives its retention window
 * even when no later deletion comes along to purge it. Drains in short batches
 * in `expires_at` order, skipping rows a concurrent deletion has locked, until
 * none remain, the batch cap is hit, or the time budget runs out; whatever is
 * left goes to the next run. Runs whether or not billing is enabled, since
 * deleting expired rows is always safe.
 */
export async function purgeExpiredDeletedAccountIdentities(): Promise<{
  deleted: number
  drained: boolean
}> {
  const deadline = Date.now() + SCHEDULED_PURGE_BUDGET_MS
  let deleted = 0
  for (let batch = 0; batch < SCHEDULED_PURGE_MAX_BATCHES; batch += 1) {
    if (Date.now() >= deadline) return { deleted, drained: false }
    const removed = await db
      .delete(deletedAccountIdentity)
      .where(
        inArray(
          deletedAccountIdentity.identityHash,
          db
            .select({ identityHash: deletedAccountIdentity.identityHash })
            .from(deletedAccountIdentity)
            .where(lte(deletedAccountIdentity.expiresAt, sql`now()`))
            .orderBy(asc(deletedAccountIdentity.expiresAt))
            .limit(SCHEDULED_PURGE_BATCH)
            .for('update', { skipLocked: true })
        )
      )
      .returning({ identityHash: deletedAccountIdentity.identityHash })
    deleted += removed.length
    if (removed.length < SCHEDULED_PURGE_BATCH) return { deleted, drained: true }
  }
  return { deleted, drained: false }
}
