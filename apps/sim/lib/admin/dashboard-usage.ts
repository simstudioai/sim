import { db } from '@sim/db'
import { member, permissions, usageLog, workspace } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, countDistinct, eq, inArray, notInArray, type SQL, sql } from 'drizzle-orm'
import { unionAll } from 'drizzle-orm/pg-core'
import {
  isLedgerReadOverBudget,
  readLedgerBounded,
  WORKFLOW_RUN_COUNT_BUDGET_MS,
} from '@/lib/billing/core/ledger-read'
import type { ResolvedUsagePeriod } from '@/lib/billing/core/reporting-period'
import { buildUsageAnalyticsScope } from '@/lib/billing/core/usage-analytics'
import type { BillingEntity } from '@/lib/billing/core/usage-log'

/**
 * Ledger reads behind the admin dashboard: each billing entity's spend and workflow runs
 * over its current usage period.
 *
 * Spend is index-only, so the list pages read it for a whole page of entities: one
 * statement whose `UNION ALL` arms each cover one entity, so every arm is a scan bounded by
 * one entity's period on `usage_log_billing_entity_period_cost_idx` (stamped periods) or
 * `usage_log_billing_entity_created_at_cost_idx` (reporting periods). One `BitmapOr` over
 * all of them would fetch every matched row from the heap instead.
 *
 * Workflow runs are not. Neither entity index carries `execution_id`, so counting them
 * fetches every matched workflow row from the heap, and a large payer's period is millions
 * of rows scattered across it: a page of entities, or even one, can outlast the request.
 * Widening both entity indexes with it would grow the hot billing sums' working set to
 * speed up a staff-only page. So only one organization's detail counts runs, in a single
 * scan that yields the total and every actor's share, under
 * {@link WORKFLOW_RUN_COUNT_BUDGET_MS}; past it the count is unknown (`null`) and the page
 * still loads.
 *
 * They stay on the primary, where the hot billing sums keep those index pages cached. On
 * the replica the same scans read from disk, and a statement held past the standby's
 * replay delay is cancelled by a recovery conflict, which the largest entities' periods
 * can reach.
 *
 * A workflow run is a distinct `execution_id` among the entity's `source = 'workflow'`
 * rows in the period: an execution writes one row per charged line and boundary, so rows
 * overcount runs, and only the ledger says which entity a run was billed to.
 */

const logger = createLogger('AdminDashboardUsage')

interface DashboardLedgerWindow {
  entity: BillingEntity
  period: ResolvedUsagePeriod
}

interface DashboardWorkflowRuns {
  total: number
  /** Runs per acting user; a run with rows from two actors counts for each. */
  byUser: Map<string, number>
  /** Distinct runs across the organization's former actors together. */
  formerActors: number
}

const WORKFLOW_SOURCE = sql`${usageLog.source} = 'workflow'`

export function organizationWindow(
  organizationId: string,
  period: ResolvedUsagePeriod
): DashboardLedgerWindow {
  return { entity: { type: 'organization', id: organizationId }, period }
}

function windowScope({ entity, period }: DashboardLedgerWindow): SQL[] {
  return buildUsageAnalyticsScope(entity, { kind: 'period', period })
}

/** Distinct entities only: an arm per repeated entity would count its rows twice. */
function distinctWindows(windows: DashboardLedgerWindow[]): DashboardLedgerWindow[] {
  return [
    ...new Map(
      windows.map((window) => [`${window.entity.type}:${window.entity.id}`, window])
    ).values(),
  ]
}

/**
 * The spend rows over every scope, keyed by entity and, when `byUser`, by acting user.
 * One statement with an arm per scope.
 */
function readSpendRows(scopes: SQL[][], byUser: boolean) {
  const userId = byUser ? sql<string>`${usageLog.userId}` : sql<string>`''`
  const groupBy = byUser ? [usageLog.billingEntityId, usageLog.userId] : [usageLog.billingEntityId]
  const [first, second, ...more] = scopes.map((scope) =>
    db
      .select({
        entityId: usageLog.billingEntityId,
        userId,
        cost: sql<string>`coalesce(sum(${usageLog.cost}), 0)`,
      })
      .from(usageLog)
      .where(and(...scope))
      .groupBy(...groupBy)
  )
  return second ? unionAll(first, second, ...more) : first
}

/** Spend per entity id. An entity with no ledger rows is absent. */
export async function readDashboardLedgerSpend(
  windows: DashboardLedgerWindow[]
): Promise<Map<string, number>> {
  const result = new Map<string, number>()
  const scopes = distinctWindows(windows).map(windowScope)
  if (scopes.length === 0) return result

  for (const row of await readSpendRows(scopes, false)) {
    if (row.entityId) result.set(row.entityId, Number(row.cost))
  }
  return result
}

/** Spend per entity id, then per acting user, narrowed to `userIds` when given. */
export async function readDashboardLedgerSpendByUser(
  windows: DashboardLedgerWindow[],
  userIds?: string[]
): Promise<Map<string, Map<string, number>>> {
  const result = new Map<string, Map<string, number>>()
  const scopes = distinctWindows(windows).map((window) =>
    userIds ? [...windowScope(window), inArray(usageLog.userId, userIds)] : windowScope(window)
  )
  if (scopes.length === 0 || userIds?.length === 0) return result

  for (const row of await readSpendRows(scopes, true)) {
    if (!row.entityId) continue
    let users = result.get(row.entityId)
    if (!users) {
      users = new Map()
      result.set(row.entityId, users)
    }
    users.set(row.userId, Number(row.cost))
  }
  return result
}

/**
 * Who no longer represents an organization's usage: an actor who is neither a member nor a
 * collaborator on one of its workspaces any more. Uncorrelated, so each list is hashed once
 * rather than probed for every ledger row.
 */
function isFormerActor(organizationId: string): SQL {
  const members = db
    .select({ userId: member.userId })
    .from(member)
    .where(eq(member.organizationId, organizationId))
  const collaborators = db
    .select({ userId: permissions.userId })
    .from(permissions)
    .innerJoin(
      workspace,
      and(eq(permissions.entityType, 'workspace'), eq(permissions.entityId, workspace.id))
    )
    .where(eq(workspace.organizationId, organizationId))
  return sql`(${notInArray(usageLog.userId, members)} and ${notInArray(usageLog.userId, collaborators)})`
}

/**
 * An organization's workflow runs over its period, in total, per acting user and across its
 * former actors, from one scan. `null` when the count does not finish within
 * {@link WORKFLOW_RUN_COUNT_BUDGET_MS}.
 */
export async function readDashboardOrganizationWorkflowRuns(
  organizationId: string,
  period: ResolvedUsagePeriod
): Promise<DashboardWorkflowRuns | null> {
  let rows: { userId: string | null; formerActor: boolean | null; workflowRuns: number }[]
  try {
    rows = await readLedgerBounded(
      db,
      (tx) => {
        const workflowRows = tx
          .select({
            userId: usageLog.userId,
            executionId: usageLog.executionId,
            formerActor: sql<boolean>`${isFormerActor(organizationId)}`.as('former_actor'),
          })
          .from(usageLog)
          .where(and(...windowScope(organizationWindow(organizationId, period)), WORKFLOW_SOURCE))
          .as('workflow_rows')
        return tx
          .select({
            userId: sql<string | null>`${workflowRows.userId}`,
            formerActor: sql<boolean | null>`${workflowRows.formerActor}`,
            workflowRuns: countDistinct(workflowRows.executionId),
          })
          .from(workflowRows)
          .groupBy(sql`grouping sets ((${workflowRows.userId}), (${workflowRows.formerActor}), ())`)
      },
      WORKFLOW_RUN_COUNT_BUDGET_MS
    )
  } catch (error) {
    if (!isLedgerReadOverBudget(error)) throw error
    logger.warn('Workflow run count exceeded its budget', {
      organizationId,
      budgetMs: WORKFLOW_RUN_COUNT_BUDGET_MS,
    })
    return null
  }

  const runs: DashboardWorkflowRuns = { total: 0, byUser: new Map(), formerActors: 0 }
  for (const row of rows) {
    if (row.userId !== null) runs.byUser.set(row.userId, row.workflowRuns)
    else if (row.formerActor === null) runs.total = row.workflowRuns
    else if (row.formerActor) runs.formerActors = row.workflowRuns
  }
  return runs
}

/** An organization's period spend per former actor (see {@link isFormerActor}). */
export async function readDashboardHistoricalActorSpend(
  organizationId: string,
  period: ResolvedUsagePeriod
): Promise<Map<string, number>> {
  const rows = await db
    .select({
      userId: usageLog.userId,
      cost: sql<string>`coalesce(sum(${usageLog.cost}), 0)`,
    })
    .from(usageLog)
    .where(
      and(...windowScope(organizationWindow(organizationId, period)), isFormerActor(organizationId))
    )
    .groupBy(usageLog.userId)
  return new Map(rows.map((row) => [row.userId, Number(row.cost)]))
}
