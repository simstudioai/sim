import { db } from '@sim/db'
import type { DbOrTx } from '@/lib/db/types'
import { userHasDeletedAccountIdentity } from '@/lib/users/deleted-identity'
import { userHasGmailAliasAccount } from '@/lib/users/gmail-alias'

/**
 * Whether a new user's identity already had the free allowance: its email or a
 * linked sign-in (with `includeSignIns`) belonged to a recently deleted account,
 * or an earlier account holds its Gmail inbox. Every path that creates a user's
 * stats row decides its allowance with this.
 */
export async function identityHadFreeAllowance(
  userId: string,
  { includeSignIns }: { includeSignIns: boolean },
  executor: DbOrTx = db
): Promise<boolean> {
  return (
    (await userHasDeletedAccountIdentity(userId, { includeSignIns }, executor)) ||
    (await userHasGmailAliasAccount(userId, executor))
  )
}
