import { db } from '@sim/db'
import { secretUsage, user, workflow, workflowExecutionLogs } from '@sim/db/schema'
import { and, desc, eq } from 'drizzle-orm'
import type { ResolvedSecretScope } from '@/executor/utils/resolved-secret-trace-registry'

export interface SecretUsageEntry {
  id: string
  useCount: number
  lastUsedAt: Date
  source: 'workflow' | 'copilot' | 'mcp'
  workflowName: string | null
  actorName: string | null
  lastExecutionId: string | null
  /**
   * Whether that run's log still exists. Usage outlives logs by design — the trail is not
   * bound by `logRetentionHours` — so a row routinely names a run whose log has since been
   * pruned, and the UI has to say so rather than link into an empty view.
   */
  lastExecutionAvailable: boolean
  lastTrigger: string | null
}

export interface SecretUsagePage {
  entries: SecretUsageEntry[]
}

interface SecretUsageQuery {
  workspaceId: string
  secretName: string
  secretScope: ResolvedSecretScope
  /** The owning user for a personal secret; empty for a workspace one. */
  secretOwnerUserId: string
  limit: number
}

/**
 * Reads one secret's usage trail, newest bucket first.
 *
 * The filter is the `(workspaceId, secretName, secretScope, secretOwnerUserId)` prefix that
 * the `secret_usage_secret_recent_idx` index covers, so the ordered page is an index read.
 * The owner is part of it, not an afterthought: two people can hold personal secrets under
 * one name, and without it each would read the other's runs as their own.
 */
export async function getSecretUsage(query: SecretUsageQuery): Promise<SecretUsagePage> {
  const rows = await db
    .select({
      id: secretUsage.id,
      useCount: secretUsage.useCount,
      lastUsedAt: secretUsage.lastUsedAt,
      source: secretUsage.source,
      workflowName: workflow.name,
      actorName: user.name,
      lastExecutionId: secretUsage.lastExecutionId,
      /** At most one row: `execution_id` carries a unique index, so this cannot fan out. */
      lastExecutionLogId: workflowExecutionLogs.id,
      lastTrigger: secretUsage.lastTrigger,
    })
    .from(secretUsage)
    .leftJoin(workflow, eq(workflow.id, secretUsage.workflowId))
    .leftJoin(user, eq(user.id, secretUsage.actorUserId))
    .leftJoin(
      workflowExecutionLogs,
      eq(workflowExecutionLogs.executionId, secretUsage.lastExecutionId)
    )
    .where(
      and(
        eq(secretUsage.workspaceId, query.workspaceId),
        eq(secretUsage.secretName, query.secretName),
        eq(secretUsage.secretScope, query.secretScope),
        eq(secretUsage.secretOwnerUserId, query.secretOwnerUserId)
      )
    )
    .orderBy(desc(secretUsage.lastUsedAt))
    .limit(query.limit)

  return {
    entries: rows.map(({ lastExecutionLogId, ...row }) => ({
      ...row,
      lastExecutionAvailable: lastExecutionLogId !== null,
    })),
  }
}
