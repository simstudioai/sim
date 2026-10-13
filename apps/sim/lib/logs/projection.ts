import type { Principal } from '@sim/auth/principal'
import { capabilityGovernedPrincipalUserId } from '@/lib/core/application'
import { withheldExecutionData, withheldSpendData } from '@/lib/logs/fetch-log-detail'
import { refuseCapability } from '@/lib/permission-groups/capabilities'
import { capabilityDeniedBy } from '@/lib/permission-groups/capability-assertions'
import { resolvePermissionGroupConfig } from '@/lib/permission-groups/config-scope.server'

/**
 * What a viewer's permission group withholds from a log response.
 *
 * `logs.trace_spans` and `logs.cost` are PROJECTIONS rather than gates: the log
 * stays readable, some of its fields do not. That is why every logs route
 * declares `capability: 'none'` — refusing the read would withhold the status
 * and the error message too, which is not what an organization restricting
 * execution detail or spend visibility asked for.
 */
export interface LogFieldProjection {
  hideTraceSpans: boolean
  hideCostInfo: boolean
}

/** Nothing withheld — the shape a caller with no governing group gets. */
export const NO_LOG_FIELD_PROJECTION: LogFieldProjection = {
  hideTraceSpans: false,
  hideCostInfo: false,
}

/**
 * The person a log projection is decided about.
 *
 * Deliberately NOT the attribution id a use case carries alongside it. An
 * executor delegation names the run's actor for attribution and for authorizing
 * the objects the run may materialize, but it carries that person's role and
 * none of their capabilities — the exemption
 * {@link capabilityGovernedPrincipalUserId} states and
 * `authorizeWorkspaceOperation` already applied by the time a use case runs.
 * Projecting on the actor would withhold fields from a run on a group the
 * funnel declined to apply, and {@link assertLogCostQueryAllowed} would refuse
 * the read outright — a refusal, not a projection, which is the thing the
 * executor exemption exists to prevent.
 *
 * Every log surface holding a `Principal` derives its subject here, so the rule
 * is stated once rather than re-decided per projection.
 */
export function logProjectionSubjectUserId(principal: Principal): string | null {
  return capabilityGovernedPrincipalUserId(principal)
}

/**
 * The projection a viewer's permission group imposes on a workspace's logs.
 *
 * `viewerUserId` is `null` when no group governs the request — an actorless run
 * (a schedule, or a webhook with no external subject) reading its own
 * workspace's logs, a workspace API key, which authorizes as the workspace and
 * whose reported user id is only the key's creator, and an executor delegation,
 * which carries a role and no capabilities. All read whole. Callers holding a
 * `Principal` derive this through {@link logProjectionSubjectUserId} rather
 * than passing whichever user id is nearest.
 *
 * The one place the two capabilities are read, so the internal/v2 detail path
 * and the v1 public API cannot drift: two copies of a redaction rule is how one
 * of them stops redacting.
 *
 * permission-group-enforced: logs.trace_spans
 * permission-group-enforced: logs.cost
 */
export async function resolveLogFieldProjection(
  viewerUserId: string | null | undefined,
  workspaceId: string,
  organizationId?: string | null
): Promise<LogFieldProjection> {
  if (!viewerUserId) return NO_LOG_FIELD_PROJECTION

  const config = await resolvePermissionGroupConfig(viewerUserId, workspaceId, organizationId)
  return {
    hideTraceSpans: capabilityDeniedBy('logs.trace_spans', config),
    hideCostInfo: capabilityDeniedBy('logs.cost', config),
  }
}

/**
 * Applies {@link LogFieldProjection} to a materialized execution payload.
 *
 * Both halves DELETE the withheld fields rather than leaving them for response
 * validation to drop, because the log contracts are passthrough (and a span's
 * own shape is a `catchall`), so a field left in place would survive the schema.
 */
export function projectExecutionData<T extends Record<string, unknown> | null | undefined>(
  executionData: T,
  projection: LogFieldProjection
): T | Record<string, unknown> {
  if (!executionData) return executionData
  const withoutPayloads = projection.hideTraceSpans
    ? withheldExecutionData(executionData)
    : executionData
  return projection.hideCostInfo ? withheldSpendData(withoutPayloads) : withoutPayloads
}

/** The run's cost total, or `null` when the group withholds spend. */
export function projectCostTotal(
  costTotal: unknown,
  projection: LogFieldProjection
): { total: number } | null {
  if (projection.hideCostInfo || costTotal == null) return null
  return { total: Number(costTotal) }
}

/**
 * The spend-selecting halves of a log query, in the spellings the surfaces use.
 *
 * The first-party list spells its filter as an operator plus a value; the public
 * adapters spell theirs as a `minCost`/`maxCost` pair. Both are read here so the
 * rule lives once — a second copy is how one of them stops refusing.
 */
export interface LogCostQuerySurface {
  sortBy?: string | null
  costOperator?: string | null
  costValue?: number | null
  minCost?: number | null
  maxCost?: number | null
}

/** Whether the query orders or selects rows by run spend. */
export function logQuerySelectsCost(query: LogCostQuerySurface): boolean {
  if (query.sortBy === 'cost') return true
  if (query.costOperator && query.costValue != null) return true
  return query.minCost != null || query.maxCost != null
}

/**
 * Refuses a cost-ordered or cost-filtered query from a viewer whose group
 * withholds spend.
 *
 * Withholding the *field* is not enough on its own: `cost > X` answered
 * faithfully is an oracle, and a caller who can repeat it recovers every run's
 * cost by bisection — with `includeTotal` they do not even have to read the
 * rows. Ordering leaks the same thing more slowly, as a ranking.
 *
 * Refused rather than silently ignored. Dropping the clause would answer a
 * question nobody asked — a list of every run under a `cost > 5` chip, in an
 * order the caller did not request — and a wrong answer presented as the right
 * one is worse than a refusal. The refusal discloses nothing new either: the
 * workspace role check has already passed by the time this runs, so the caller
 * is a member being told about their own group, not an outsider being handed an
 * organization-configuration oracle.
 *
 * `logs.trace_spans` needs no counterpart. Nothing the trace projection
 * withholds — `traceSpans`, `blockExecutions`, `finalOutput`, `workflowInput`,
 * `blockInput` — is filterable or sortable on any log surface: `search` matches
 * the execution id alone, and every sort key is a scalar column.
 *
 * permission-group-enforced: logs.cost
 */
export function assertLogCostQueryAllowed(
  query: LogCostQuerySurface,
  projection: Pick<LogFieldProjection, 'hideCostInfo'>
): void {
  if (!projection.hideCostInfo) return
  if (!logQuerySelectsCost(query)) return
  refuseCapability('logs.cost')
}
