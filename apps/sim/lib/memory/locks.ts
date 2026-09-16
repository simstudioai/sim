import { sql } from 'drizzle-orm'
import type { DbTransaction } from '@/lib/db/types'

/** Serializes first writes too, before an absent conversation has a row that can be locked. */
export async function lockMemoryConversationInTx(
  tx: DbTransaction,
  workspaceId: string,
  key: string
): Promise<void> {
  const lockKey = JSON.stringify(['memory', workspaceId, key])
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`)
}
