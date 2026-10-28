import { db } from '@sim/db'
import { gmailMailbox, user } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq, lt, or, sql } from 'drizzle-orm'
import { isBillingEnabled } from '@/lib/core/config/env-flags'
import type { DbOrTx } from '@/lib/db/types'

/**
 * One free allowance per Gmail inbox. Gmail delivers every dot and `+tag`
 * variant of an address, and its `googlemail.com` twin, to the same inbox, so
 * without this one person could register `a.b@gmail.com`, `ab+1@gmail.com`, …
 * for a fresh allowance each time. The later account is created normally but
 * without the free allowance, like a returning deleted-account identity.
 *
 * Only meaningful where billing is enabled.
 */

const logger = createLogger('GmailAlias')

/**
 * Whether an earlier account, banned or not, already holds the Gmail inbox this
 * user's address delivers to. Only an account created before this one counts
 * (the id breaks a creation-time tie), so the inbox's first account keeps the
 * allowance however late its own stats row is created. Pass the caller's
 * transaction as `executor` to read on it; the read then runs in a savepoint,
 * so a failed lookup never aborts that transaction. Fails open: a lookup error
 * returns `false` and is logged, because refusing a legitimate person's
 * allowance is worse than one missed match.
 */
export async function userHasGmailAliasAccount(
  userId: string,
  executor: DbOrTx = db
): Promise<boolean> {
  if (!isBillingEnabled) return false
  const read = async (reader: DbOrTx) => {
    const [self] = await reader
      .select({ mailbox: gmailMailbox(user.email), createdAt: user.createdAt })
      .from(user)
      .where(eq(user.id, userId))
      .limit(1)
    if (!self?.mailbox) return false
    const [other] = await reader
      .select({ id: user.id })
      .from(user)
      .where(
        and(
          sql`${gmailMailbox(user.email)} = ${self.mailbox}`,
          or(
            lt(user.createdAt, self.createdAt),
            and(eq(user.createdAt, self.createdAt), lt(user.id, userId))
          )
        )
      )
      .limit(1)
    return Boolean(other)
  }
  try {
    return await (executor === db ? read(db) : executor.transaction(read))
  } catch (error) {
    logger.error('Gmail alias lookup failed; granting the free allowance', { userId, error })
    return false
  }
}
