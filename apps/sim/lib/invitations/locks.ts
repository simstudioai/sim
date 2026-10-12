import { sql } from 'drizzle-orm'
import { acquireAdvisoryXactLock } from '@/lib/db/advisory-locks'
import type { DbTransaction } from '@/lib/db/types'

const INVITATION_MUTATION_LOCK_TIMEOUT_MS = 10_000

/**
 * Serializes invitation acceptance and workspace organization moves.
 *
 * Every caller uses the same sorted key set, which prevents lock-order
 * inversions when an invitation contains more than one workspace. The locks
 * are transaction scoped and must be held through the final invitation and
 * workspace mutations.
 */
export async function acquireInvitationMutationLocks(
  tx: DbTransaction,
  params: { invitationIds: string[]; workspaceIds: string[] }
): Promise<void> {
  await tx.execute(
    sql`select set_config('lock_timeout', ${`${INVITATION_MUTATION_LOCK_TIMEOUT_MS}ms`}, true)`
  )

  const keys = [
    ...new Set([
      ...params.invitationIds.map((id) => `invitation:${id}`),
      ...params.workspaceIds.map((id) => `workspace-invitations:${id}`),
    ]),
  ].sort()

  for (const key of keys) {
    await acquireAdvisoryXactLock(tx, 'invitation_mutation', key)
  }
}
