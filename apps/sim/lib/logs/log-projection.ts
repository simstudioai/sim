import { withheldExecutionData, withheldSpendData } from '@/lib/logs/fetch-log-detail'
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
 * The projection a viewer's permission group imposes on a workspace's logs.
 *
 * `viewerUserId` is `null` when no group governs the request — an actorless run
 * (a schedule, or a webhook with no external subject) reading its own
 * workspace's logs, and a workspace API key, which authorizes as the workspace
 * and whose reported user id is only the key's creator. Both read whole.
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
