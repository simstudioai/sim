import { db } from '@sim/db'
import { member, permissions, usageLog, workspace } from '@sim/db/schema'
import { and, countDistinct, eq, inArray, notExists, type SQL, sql } from 'drizzle-orm'
import { alias, unionAll } from 'drizzle-orm/pg-core'
import type { ResolvedUsagePeriod } from '@/lib/billing/core/reporting-period'
import { buildUsageAnalyticsScope } from '@/lib/billing/core/usage-analytics'
import type { BillingEntity } from '@/lib/billing/core/usage-log'

/**
 * Ledger reads behind the admin dashboard: each billing entity's spend and workflow runs
 * over its current usage period.
 *
 * Each read is one statement whose `UNION ALL` arms each cover one entity, so every arm
 * is a bounded index-only scan; one `BitmapOr` over all of them would fetch every matched
 * row from the heap instead:
 *
 * - spend reads `usage_log_billing_entity_period_cost_idx` (stamped periods) or
 *   `usage_log_billing_entity_created_at_cost_idx` (reporting periods);
 * - workflow runs read `usage_log_billing_entity_workflow_runs_idx`, the only index
 *   carrying `execution_id`, which is why they are a separate statement.
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

export interface DashboardLedgerWindow {
  entity: BillingEntity
  period: ResolvedUsagePeriod
}

export interface DashboardLedgerUsage {
  cost: number
  workflowRuns: number
}

const WORKFLOW_SOURCE = sql`${usageLog.source} = 'workflow'`

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
 * The spend rows and the workflow-run rows over every scope, keyed by entity and, when
 * `byUser`, by acting user. Each is one statement with an arm per scope.
 */
async function readLedgerRows(scopes: SQL[][], byUser: boolean) {
  const userId = byUser ? sql<string>`${usageLog.userId}` : sql<string>`''`
  const groupBy = byUser ? [usageLog.billingEntityId, usageLog.userId] : [usageLog.billingEntityId]
  const [cost, secondCost, ...moreCost] = scopes.map((scope) =>
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
  const [runs, secondRuns, ...moreRuns] = scopes.map((scope) =>
    db
      .select({
        entityId: usageLog.billingEntityId,
        userId,
        workflowRuns: countDistinct(usageLog.executionId),
      })
      .from(usageLog)
      .where(and(...scope, WORKFLOW_SOURCE))
      .groupBy(...groupBy)
  )
  return Promise.all([
    secondCost ? unionAll(cost, secondCost, ...moreCost) : cost,
    secondRuns ? unionAll(runs, secondRuns, ...moreRuns) : runs,
  ])
}

function usageFor<K>(map: Map<K, DashboardLedgerUsage>, key: K): DashboardLedgerUsage {
  let usage = map.get(key)
  if (!usage) {
    usage = { cost: 0, workflowRuns: 0 }
    map.set(key, usage)
  }
  return usage
}

/** Spend and workflow runs per entity id. An entity with no ledger rows is absent. */
export async function readDashboardLedgerUsage(
  windows: DashboardLedgerWindow[]
): Promise<Map<string, DashboardLedgerUsage>> {
  const result = new Map<string, DashboardLedgerUsage>()
  const scopes = distinctWindows(windows).map(windowScope)
  if (scopes.length === 0) return result

  const [costRows, runRows] = await readLedgerRows(scopes, false)
  for (const row of costRows) {
    if (row.entityId) usageFor(result, row.entityId).cost += Number(row.cost)
  }
  for (const row of runRows) {
    if (row.entityId) usageFor(result, row.entityId).workflowRuns += row.workflowRuns
  }
  return result
}

/**
 * Spend and workflow runs per entity id, then per acting user, narrowed to `userIds`
 * when given. A run is counted for each user with a row in it.
 */
export async function readDashboardLedgerUsageByUser(
  windows: DashboardLedgerWindow[],
  userIds?: string[]
): Promise<Map<string, Map<string, DashboardLedgerUsage>>> {
  const result = new Map<string, Map<string, DashboardLedgerUsage>>()
  const scopes = distinctWindows(windows).map((window) =>
    userIds ? [...windowScope(window), inArray(usageLog.userId, userIds)] : windowScope(window)
  )
  if (scopes.length === 0 || userIds?.length === 0) return result

  const usersOf = (entityId: string) => {
    let users = result.get(entityId)
    if (!users) {
      users = new Map()
      result.set(entityId, users)
    }
    return users
  }
  const [costRows, runRows] = await readLedgerRows(scopes, true)
  for (const row of costRows) {
    if (row.entityId) usageFor(usersOf(row.entityId), row.userId).cost += Number(row.cost)
  }
  for (const row of runRows) {
    if (row.entityId) {
      usageFor(usersOf(row.entityId), row.userId).workflowRuns += row.workflowRuns
    }
  }
  return result
}

const historicalUsageMember = alias(member, 'historical_usage_member')
const historicalUsagePermission = alias(permissions, 'historical_usage_permission')
const historicalUsageWorkspace = alias(workspace, 'historical_usage_workspace')

/**
 * An organization's period usage by actors who are neither members nor collaborators on
 * one of its workspaces any more: spend, workflow runs and how many such actors.
 */
export async function readDashboardHistoricalActorUsage(
  organizationId: string,
  period: ResolvedUsagePeriod
): Promise<{ usedDollars: number; workflowRuns: number; actorCount: number }> {
  const currentMember = db
    .select({ value: sql`1` })
    .from(historicalUsageMember)
    .where(
      and(
        eq(historicalUsageMember.organizationId, organizationId),
        eq(historicalUsageMember.userId, usageLog.userId)
      )
    )
  const currentCollaborator = db
    .select({ value: sql`1` })
    .from(historicalUsagePermission)
    .innerJoin(
      historicalUsageWorkspace,
      and(
        eq(historicalUsagePermission.entityType, 'workspace'),
        eq(historicalUsagePermission.entityId, historicalUsageWorkspace.id)
      )
    )
    .where(
      and(
        eq(historicalUsageWorkspace.organizationId, organizationId),
        eq(historicalUsagePermission.userId, usageLog.userId)
      )
    )
  const scope = [
    ...windowScope({ entity: { type: 'organization', id: organizationId }, period }),
    notExists(currentMember),
    notExists(currentCollaborator),
  ]

  const [[costRow], [runRow]] = await Promise.all([
    db
      .select({
        usedDollars: sql<string>`coalesce(sum(${usageLog.cost}), 0)`,
        actorCount: countDistinct(usageLog.userId),
      })
      .from(usageLog)
      .where(and(...scope)),
    db
      .select({ workflowRuns: countDistinct(usageLog.executionId) })
      .from(usageLog)
      .where(and(...scope, WORKFLOW_SOURCE)),
  ])
  return {
    usedDollars: Number(costRow?.usedDollars ?? 0),
    workflowRuns: runRow?.workflowRuns ?? 0,
    actorCount: costRow?.actorCount ?? 0,
  }
}
