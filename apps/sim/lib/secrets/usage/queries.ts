import { db } from '@sim/db'
import { secretUsage, user, workflow } from '@sim/db/schema'
import { and, desc, eq } from 'drizzle-orm'
import type { ResolvedSecretScope } from '@/executor/utils/resolved-secret-trace-registry'

export interface SecretUsageEntry {
  id: string
  usageDate: string
  useCount: number
  firstUsedAt: Date
  lastUsedAt: Date
  source: 'workflow' | 'copilot' | 'mcp'
  workflowId: string | null
  workflowName: string | null
  actorUserId: string | null
  actorName: string | null
  actorEmail: string | null
  lastExecutionId: string | null
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
      usageDate: secretUsage.usageDate,
      useCount: secretUsage.useCount,
      firstUsedAt: secretUsage.firstUsedAt,
      lastUsedAt: secretUsage.lastUsedAt,
      source: secretUsage.source,
      workflowId: secretUsage.workflowId,
      workflowName: workflow.name,
      actorUserId: secretUsage.actorUserId,
      actorName: user.name,
      actorEmail: user.email,
      lastExecutionId: secretUsage.lastExecutionId,
      lastTrigger: secretUsage.lastTrigger,
    })
    .from(secretUsage)
    .leftJoin(workflow, eq(workflow.id, secretUsage.workflowId))
    .leftJoin(user, eq(user.id, secretUsage.actorUserId))
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
    /** The storage sentinel is an implementation detail of the unique key, not a value. */
    entries: rows.map((row) => ({
      ...row,
      workflowId: row.workflowId || null,
      actorUserId: row.actorUserId || null,
    })),
  }
}
