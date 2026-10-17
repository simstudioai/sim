import { db } from '@sim/db'
import { oauthAccessToken, oauthTokenFamily } from '@sim/db/schema'
import { eq } from 'drizzle-orm'
import type { DbOrTx } from '@/lib/db/types'

/**
 * Revokes every refresh family and access token a user holds. Families outlive the session that
 * minted them (`session_id` is set null on delete), so deleting sessions alone leaves them
 * rotatable. Consents are kept, so a legitimate client re-authorizes without a new consent prompt.
 */
export async function revokeUserOAuthGrants(userId: string, database: DbOrTx = db): Promise<void> {
  await database.delete(oauthTokenFamily).where(eq(oauthTokenFamily.userId, userId))
  await database.delete(oauthAccessToken).where(eq(oauthAccessToken.userId, userId))
}
