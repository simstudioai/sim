import { getPostgresErrorCode } from '@sim/utils/errors'
import { sql } from 'drizzle-orm'
import { acquireAdvisoryXactLock } from '@/lib/db/advisory-locks'
import type { DbTransaction } from '@/lib/db/types'

const MCP_SERVER_LOCK_TIMEOUT_MS = 3_000
const LOCK_NOT_AVAILABLE_SQLSTATE = '55P03'

export async function setWorkflowMcpTransactionLockTimeout(tx: DbTransaction): Promise<void> {
  await tx.execute(
    sql`select set_config('lock_timeout', ${`${MCP_SERVER_LOCK_TIMEOUT_MS}ms`}, true)`
  )
}

export async function acquireWorkflowMcpServerLock(
  tx: DbTransaction,
  serverId: string
): Promise<void> {
  await setWorkflowMcpTransactionLockTimeout(tx)
  await acquireAdvisoryXactLock(tx, 'workflow_mcp_server', serverId)
}

export function isWorkflowMcpServerLockTimeout(error: unknown): boolean {
  return getPostgresErrorCode(error) === LOCK_NOT_AVAILABLE_SQLSTATE
}
