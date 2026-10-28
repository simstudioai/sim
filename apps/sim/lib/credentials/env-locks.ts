import { sql } from 'drizzle-orm'
import { acquireAdvisoryXactLock } from '@/lib/db/advisory-locks'
import type { DbTransaction } from '@/lib/db/types'

const ENV_MAP_LOCK_TIMEOUT_MS = 5_000

/**
 * Serializes every writer of one environment variables map.
 *
 * Both maps are a single jsonb column that every writer read-modify-writes, so
 * without this two concurrent writers each persist their own copy of the map
 * and the later commit silently drops the earlier one's key. The lock is
 * transaction-scoped, so it releases on commit or rollback with no unlock path
 * to miss, and it must be taken before the read that the write is derived from.
 *
 * The keys are the bare workspace or user id, matching every writer that
 * already takes this lock — a prefixed key would be a different lock and would
 * serialize against nothing.
 */
async function lockEnvMap(tx: DbTransaction, tag: string, lockKey: string): Promise<void> {
  await tx.execute(sql`SELECT set_config('lock_timeout', ${`${ENV_MAP_LOCK_TIMEOUT_MS}ms`}, true)`)
  await acquireAdvisoryXactLock(tx, tag, lockKey)
}

/** Serializes writers of one workspace's environment variables map. */
export async function lockWorkspaceEnvMap(tx: DbTransaction, workspaceId: string): Promise<void> {
  await lockEnvMap(tx, 'workspace_env_map', workspaceId)
}

/** Serializes writers of one user's personal environment variables map. */
export async function lockPersonalEnvMap(tx: DbTransaction, userId: string): Promise<void> {
  await lockEnvMap(tx, 'personal_env_map', userId)
}
