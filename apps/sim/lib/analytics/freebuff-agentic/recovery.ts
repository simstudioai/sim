import { db } from '@sim/db'
import { workflowExecutionLogs } from '@sim/db/schema'
import { asc, eq, sql } from 'drizzle-orm'
import { enqueueFreebuffUse } from '@/lib/analytics/freebuff-agentic/service'

/** Drains the indexed failure markers without making attribution a prerequisite for completion. */
export async function recoverFreebuffAttribution(): Promise<number> {
  const deadlineAt = Date.now() + 20_000
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('statement_timeout', '3000', true)`)
    await tx.execute(sql`SELECT set_config('lock_timeout', '1000', true)`)
    const pending = await tx
      .select({
        id: workflowExecutionLogs.id,
        executionId: workflowExecutionLogs.executionId,
        endedAt: workflowExecutionLogs.endedAt,
        status: workflowExecutionLogs.status,
        deploymentVersionId: workflowExecutionLogs.deploymentVersionId,
        userId: sql<string>`${workflowExecutionLogs.executionData}->>'freebuffAttributionPending'`,
      })
      .from(workflowExecutionLogs)
      .where(sql`${workflowExecutionLogs.executionData} ? 'freebuffAttributionPending'`)
      .orderBy(asc(workflowExecutionLogs.createdAt), asc(workflowExecutionLogs.id))
      .limit(50)
      .for('update', { skipLocked: true })
    let recovered = 0
    for (const row of pending) {
      if (Date.now() >= deadlineAt) break
      if (row.status === 'completed' && row.deploymentVersionId && row.endedAt && row.userId) {
        await enqueueFreebuffUse(tx, row.userId, row.executionId, row.endedAt)
      }
      await tx
        .update(workflowExecutionLogs)
        .set({
          executionData: sql`${workflowExecutionLogs.executionData} - 'freebuffAttributionPending'`,
        })
        .where(eq(workflowExecutionLogs.id, row.id))
      recovered++
    }
    return recovered
  })
}
