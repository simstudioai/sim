import { getPostgresErrorCode } from '@sim/utils/errors'
import { sql } from 'drizzle-orm'
import type { DbOrTx } from '@/lib/db/types'

const MCP_SERVER_LOCK_TIMEOUT_MS = 3_000
const LOCK_NOT_AVAILABLE_SQLSTATE = '55P03'

export async function setWorkflowMcpTransactionLockTimeout(tx: DbOrTx): Promise<void> {
  await tx.execute(
    sql`select set_config('lock_timeout', ${`${MCP_SERVER_LOCK_TIMEOUT_MS}ms`}, true)`
  )
}

export async function acquireWorkflowMcpServerLock(tx: DbOrTx, serverId: string): Promise<void> {
  await setWorkflowMcpTransactionLockTimeout(tx)
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${serverId}, 0))`)
}

export function isWorkflowMcpServerLockTimeout(error: unknown): boolean {
  return getPostgresErrorCode(error) === LOCK_NOT_AVAILABLE_SQLSTATE
}
