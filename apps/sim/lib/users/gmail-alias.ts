import { db } from '@sim/db'
import { gmailMailbox, user, userStats } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq, gt, lt, or, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import { isBillingEnabled } from '@/lib/core/config/env-flags'
import { acquireAdvisoryXactLock } from '@/lib/db/advisory-locks'
import type { DbOrTx, DbTransaction } from '@/lib/db/types'

/**
 * One free allowance per Gmail inbox. Gmail delivers every dot and `+tag`
 * variant of an address, and its `googlemail.com` twin, to the same inbox, so
 * without this one person could register `a.b@gmail.com`, `ab+1@gmail.com`, …
 * for a fresh allowance each time. The later account is created normally but
 * without the free allowance, like a returning deleted-account identity.
 *
 * Two signups on one inbox can race: Better Auth commits each user row before
 * its signup hook runs, so a later account's check can run before the earlier
 * row is visible. Each signup therefore decides under the inbox's lock
 * ({@link acquireGmailInboxLock}) and, once the earlier account decides, it
 * withdraws the allowance from any later one that got in first
 * ({@link laterGmailAliasesWithAllowance}). The stats-row fallback, which runs
 * only when a signup's own decision failed, checks without the lock rather
 * than hold it through its caller's transaction.
 *
 * Only meaningful where billing is enabled.
 */

const logger = createLogger('GmailAlias')

const GMAIL_INBOX_LOCK_TIMEOUT_MS = 5_000

/** The account being decided; `user` in the queries below is every other account. */
const subject = alias(user, 'subject')

const onSubjectInbox = sql`${gmailMailbox(user.email)} = ${gmailMailbox(subject.email)}`

/** Orders accounts by creation time; the id breaks a creation-time tie. */
function createdRelativeToSubject(compare: typeof lt | typeof gt) {
  return or(
    compare(user.createdAt, subject.createdAt),
    and(eq(user.createdAt, subject.createdAt), compare(user.id, subject.id))
  )
}

/**
 * Serializes free-allowance decisions for the Gmail inbox this user's address
 * delivers to, until `tx` ends. Takes no lock for any other address. Bounds
 * `lock_timeout` for the rest of `tx`, so take it in a short transaction of
 * its own.
 */
export async function acquireGmailInboxLock(tx: DbTransaction, userId: string): Promise<void> {
  if (!isBillingEnabled) return
  const [row] = await tx
    .select({ mailbox: gmailMailbox(user.email) })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1)
  if (!row?.mailbox) return
  await tx.execute(
    sql`select set_config('lock_timeout', ${`${GMAIL_INBOX_LOCK_TIMEOUT_MS}ms`}, true)`
  )
  await acquireAdvisoryXactLock(tx, 'gmail_inbox', `gmail-inbox:${row.mailbox}`)
}

/**
 * Whether an earlier account, banned or not, already holds the Gmail inbox this
 * user's address delivers to. Only an account created before this one counts,
 * so the inbox's first account keeps the allowance however late its own stats
 * row is created. The earlier account counts whether or not it verified the
 * address: the allowance is granted at signup, before verification, and where
 * verification is off a password account never verifies, so a verified-only
 * rule would let every alias registered unverified keep its allowance. Pass the
 * caller's transaction as `executor` to read on it; the read then runs in a
 * savepoint, so a failed lookup never aborts that transaction. Fails open: a
 * lookup error returns `false` and is logged, because refusing a legitimate
 * person's allowance is worse than one missed match.
 */
export async function userHasGmailAliasAccount(
  userId: string,
  executor: DbOrTx = db
): Promise<boolean> {
  if (!isBillingEnabled) return false
  const read = async (reader: DbOrTx) => {
    const [earlier] = await reader
      .select({ id: user.id })
      .from(subject)
      .innerJoin(user, and(onSubjectInbox, createdRelativeToSubject(lt)))
      .where(eq(subject.id, userId))
      .limit(1)
    return Boolean(earlier)
  }
  try {
    return await (executor === db ? read(db) : executor.transaction(read))
  } catch (error) {
    logger.error('Gmail alias lookup failed; granting the free allowance', { userId, error })
    return false
  }
}

/**
 * The later accounts on this user's Gmail inbox that still hold the free
 * allowance: ones whose own check ran before this user's row was visible.
 * Called by a new user's signup under {@link acquireGmailInboxLock}.
 */
export async function laterGmailAliasesWithAllowance(
  userId: string,
  executor: DbOrTx
): Promise<string[]> {
  if (!isBillingEnabled) return []
  const later = await executor
    .select({ id: user.id })
    .from(subject)
    .innerJoin(user, and(onSubjectInbox, createdRelativeToSubject(gt)))
    .innerJoin(userStats, and(eq(userStats.userId, user.id), eq(userStats.freeTierEligible, true)))
    .where(eq(subject.id, userId))
  return later.map((row) => row.id)
}
