import { db } from '@sim/db'
import { secretUsage } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { generateShortId } from '@sim/utils/id'
import { sql } from 'drizzle-orm'
import type { ResolvedSecretScope } from '@/executor/utils/resolved-secret-trace-registry'

const logger = createLogger('SecretUsage')

/** Which surface resolved the secret. Mirrors the `secret_usage_source` enum. */
export type SecretUsageSource = 'workflow' | 'copilot' | 'mcp'

export interface SecretUsageContext {
  workspaceId: string
  source: SecretUsageSource
  /** Whose access authorized the resolution; the run's actor. */
  actorUserId: string | null
  /** Absent for a Copilot run, which has no workflow. */
  workflowId?: string | null
  executionId?: string | null
  trigger?: string | null
}

export interface ResolvedSecretUsage {
  name: string
  scope: ResolvedSecretScope
  /** The owning user of a personal secret; null for a workspace one. */
  ownerUserId: string | null
}

/**
 * The UTC day a usage row buckets into.
 *
 * Explicitly UTC rather than the server's local calendar: rows are aggregated by this value
 * and read back by workspaces in every timezone, so a server-local bucket would shift the
 * boundary with the deployment region and split one day's usage across two rows.
 */
function utcDayBucket(at: Date): string {
  return at.toISOString().slice(0, 10)
}

/**
 * Records which configured secrets a run resolved.
 *
 * Fire-and-forget and never throwing, matching `recordAudit` in `packages/audit/src/log.ts`:
 * a run must not fail because its usage trail could not be written, and this is called from
 * execution-completion paths that are already committing their result.
 *
 * One statement regardless of how many secrets a run touched. The upsert increments an
 * existing day bucket rather than inserting, which is what keeps a workflow on a one-minute
 * schedule from writing thousands of rows a day.
 */
export function recordSecretUsage(
  usage: readonly ResolvedSecretUsage[],
  context: SecretUsageContext
): void {
  if (usage.length === 0) return

  upsertSecretUsage(usage, context).catch((error) => {
    logger.error('Failed to record secret usage', {
      error,
      workspaceId: context.workspaceId,
      source: context.source,
      secretCount: usage.length,
    })
  })
}

async function upsertSecretUsage(
  usage: readonly ResolvedSecretUsage[],
  context: SecretUsageContext
): Promise<void> {
  const now = new Date()
  const usageDate = utcDayBucket(now)

  const rows = usage.map((entry) => ({
    id: generateShortId(),
    workspaceId: context.workspaceId,
    secretName: entry.name,
    secretScope: entry.scope,
    /** Empty sentinel for a workspace secret, matching the null-free bucket key. */
    secretOwnerUserId: entry.ownerUserId ?? '',
    source: context.source,
    /** Empty sentinel, never null — the unique bucket key must stay null-free. */
    workflowId: context.workflowId ?? '',
    actorUserId: context.actorUserId ?? '',
    usageDate,
    useCount: 1,
    lastUsedAt: now,
    lastExecutionId: context.executionId ?? null,
    lastTrigger: context.trigger ?? null,
  }))

  await db
    .insert(secretUsage)
    .values(rows)
    .onConflictDoUpdate({
      target: [
        secretUsage.workspaceId,
        secretUsage.secretName,
        secretUsage.secretScope,
        secretUsage.secretOwnerUserId,
        secretUsage.source,
        secretUsage.workflowId,
        secretUsage.actorUserId,
        secretUsage.usageDate,
      ],
      set: {
        useCount: sql`${secretUsage.useCount} + 1`,
        /**
         * `greatest` rather than a bare assignment: concurrent runs finishing out of order
         * must not walk the most recent timestamp backwards.
         */
        lastUsedAt: sql`greatest(${secretUsage.lastUsedAt}, excluded.last_used_at)`,
        /**
         * The run that owns `last_used_at` has to own the metadata beside it. Assigning
         * these unconditionally while the timestamp is chosen by `greatest` lets two runs
         * completing out of order split one row between them — the newer run's timestamp
         * next to the older run's execution id, so "View log" opens a run that is not the
         * one the row says it last happened at. The guard keeps both from the same run.
         *
         * Postgres evaluates every SET expression against the pre-update row, so
         * `secret_usage.last_used_at` here is the stored value, not the one being written.
         */
        lastExecutionId: sql`case when excluded.last_used_at >= ${secretUsage.lastUsedAt} then excluded.last_execution_id else ${secretUsage.lastExecutionId} end`,
        lastTrigger: sql`case when excluded.last_used_at >= ${secretUsage.lastUsedAt} then excluded.last_trigger else ${secretUsage.lastTrigger} end`,
        updatedAt: now,
      },
    })
}
