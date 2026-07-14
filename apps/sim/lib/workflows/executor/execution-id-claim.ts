import { db } from '@sim/db'
import { idempotencyKey, workflowExecutionLogs } from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import { and, eq, sql } from 'drizzle-orm'
import type { DbOrTx } from '@/lib/db/types'

const EXECUTION_ID_CLAIM_PREFIX = 'workflow-execution-id'

interface ExecutionIdClaimRecord {
  status: 'claimed'
  claimToken: string
  executionId: string
}

export interface ExecutionIdClaim {
  key: string
  token: string
}

async function hasDurableExecutionOwnerWithExecutor(
  executor: DbOrTx,
  executionId: string
): Promise<boolean> {
  const existingExecution = await executor
    .select({ id: workflowExecutionLogs.id })
    .from(workflowExecutionLogs)
    .where(eq(workflowExecutionLogs.executionId, executionId))
    .limit(1)

  return existingExecution.length > 0
}

/**
 * Atomically reserves a globally unique workflow execution ID.
 *
 * The PostgreSQL primary key is the serialization point. Claims remain as
 * durable tombstones after a run starts so deleting execution logs cannot make
 * a previously consumed ID reusable.
 */
export async function claimExecutionId(executionId: string): Promise<ExecutionIdClaim | null> {
  const key = `${EXECUTION_ID_CLAIM_PREFIX}:${executionId}`
  const token = generateId()

  return db.transaction(async (tx) => {
    const inserted = await tx
      .insert(idempotencyKey)
      .values({
        key,
        result: {
          status: 'claimed',
          claimToken: token,
          executionId,
        } satisfies ExecutionIdClaimRecord,
        createdAt: new Date(),
      })
      .onConflictDoNothing()
      .returning({ key: idempotencyKey.key })

    if (inserted.length === 0) {
      return null
    }

    if (await hasDurableExecutionOwnerWithExecutor(tx, executionId)) {
      return null
    }

    return { key, token }
  })
}

/**
 * Checks whether a durable execution log has taken ownership of an ID.
 */
export async function hasDurableExecutionOwner(executionId: string): Promise<boolean> {
  return hasDurableExecutionOwnerWithExecutor(db, executionId)
}

/**
 * Releases only the transient claim owned by this request.
 *
 * Token matching prevents a stale request from deleting another owner's claim.
 */
export async function releaseExecutionIdClaim(claim: ExecutionIdClaim): Promise<void> {
  await db
    .delete(idempotencyKey)
    .where(
      and(
        eq(idempotencyKey.key, claim.key),
        sql`${idempotencyKey.result} ->> 'status' = 'claimed'`,
        sql`${idempotencyKey.result} ->> 'claimToken' = ${claim.token}`
      )
    )
}
