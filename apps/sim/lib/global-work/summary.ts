import { dbReplica } from '@sim/db'
import { copilotMessages, workflowExecutionLogs } from '@sim/db/schema'
import { sql } from 'drizzle-orm'
import { zonedWallClock, zonedWallClockToUtc } from '@/lib/core/utils/timezone'

const REPORTING_TIME_ZONE = 'America/Los_Angeles'

/**
 * Reporting-only formula. Source rows remain unweighted so changing either
 * assumption never requires a migration or a historical data rewrite.
 */
export const GLOBAL_WORK_FORMULA = Object.freeze({
  minutesPerUnit: 5,
  globalAnnualHours: 2_510_000_000_000,
})

interface AggregatedRow extends Record<string, unknown> {
  source: 'workflow' | 'mothership'
  date: string
  units: number | string
}

export interface GlobalWorkSummary {
  month: string
  label: string
  isCurrentMonth: boolean
  attribution: 'estimated'
  formula: {
    minutesPerUnit: number
    globalAnnualHours: number
  }
  units: number
  humanEquivalentHours: number
  annualizedPercentGlobalWork: number
  sources: Array<{
    source: 'workflow' | 'mothership'
    units: number
    humanEquivalentHours: number
  }>
  daily: Array<{
    date: string
    units: number
    workflow: number
    mothership: number
  }>
}

function addMonth(month: string, delta: number): string {
  const [year, monthNumber] = month.split('-').map(Number)
  const date = new Date(Date.UTC(year, monthNumber - 1 + delta, 1))
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`
}

export function getLatestCompletedGlobalWorkMonth(now: Date): string {
  return addMonth(zonedWallClock(now, REPORTING_TIME_ZONE).slice(0, 7), -1)
}

export function getGlobalWorkMonthWindow(month: string): {
  periodStart: Date
  periodEnd: Date
} {
  return {
    periodStart: zonedWallClockToUtc(`${month}-01T00:00:00`, REPORTING_TIME_ZONE),
    periodEnd: zonedWallClockToUtc(`${addMonth(month, 1)}-01T00:00:00`, REPORTING_TIME_ZONE),
  }
}

function round(value: number, places: number): number {
  return Number(value.toFixed(places))
}

function daysInMonth(month: string): number {
  const [year, monthNumber] = month.split('-').map(Number)
  return new Date(Date.UTC(year, monthNumber, 0)).getUTCDate()
}

export function buildZeroFilledGlobalWorkDailySeries(params: {
  month: string
  isCurrentMonth: boolean
  now: Date
  unitsByDate: ReadonlyMap<string, { workflow: number; mothership: number }>
}): GlobalWorkSummary['daily'] {
  const allDays = daysInMonth(params.month)
  const currentDay = Number(zonedWallClock(params.now, REPORTING_TIME_ZONE).slice(8, 10))
  const dayCount = params.isCurrentMonth ? currentDay : allDays
  return Array.from({ length: dayCount }, (_, index) => {
    const date = `${params.month}-${String(index + 1).padStart(2, '0')}`
    const counts = params.unitsByDate.get(date) ?? { workflow: 0, mothership: 0 }
    return {
      date,
      units: counts.workflow + counts.mothership,
      workflow: counts.workflow,
      mothership: counts.mothership,
    }
  })
}

/**
 * Global Work is deliberately derived from canonical product records instead
 * of duplicating every run/message into an analytics ledger.
 *
 * `usage_log` helps preserve a workflow's original billing entity through a
 * workspace move, but it is not itself a unit counter: one execution/turn can
 * have many positive-cost rows and zero-cost work has none. Workflow and
 * Mothership cardinality therefore comes from their source tables.
 *
 * Historical paid eligibility remains an estimate because subscription rows do
 * not retain a full entitlement timeline. Newer workflow rows use the immutable
 * billing snapshot already persisted for billing; older workflows and all
 * Mothership messages fall back to the current/last-known subscription state.
 */
async function queryEstimatedGlobalWorkUnits(periodStart: Date, periodEnd: Date) {
  // Raw `sql` parameters do not infer a timestamp encoder from the surrounding
  // comparison. Bind through the matching schema columns so postgres.js
  // receives UTC timestamp strings rather than JavaScript Date objects.
  const workflowPeriodStart = sql.param(periodStart, workflowExecutionLogs.endedAt)
  const workflowPeriodEnd = sql.param(periodEnd, workflowExecutionLogs.endedAt)
  const mothershipPeriodStart = sql.param(periodStart, copilotMessages.createdAt)
  const mothershipPeriodEnd = sql.param(periodEnd, copilotMessages.createdAt)

  const result = await dbReplica.execute<AggregatedRow>(sql`
    WITH workspace_billing AS (
      SELECT
        w.id AS workspace_id,
        CASE
          WHEN w.workspace_mode = 'organization' AND w.organization_id IS NOT NULL
            THEN w.organization_id
          ELSE w.billed_account_user_id
        END AS billing_entity_id,
        COALESCE(org_owner.user_id, w.billed_account_user_id) AS billing_owner_user_id
      FROM workspace w
      LEFT JOIN LATERAL (
        SELECT m.user_id
        FROM member m
        WHERE m.organization_id = w.organization_id AND m.role = 'owner'
        LIMIT 1
      ) org_owner ON w.workspace_mode = 'organization' AND w.organization_id IS NOT NULL
    ),
    workflow_units AS (
      SELECT
        'workflow'::text AS source,
        wel.execution_id AS source_event_id,
        wel.ended_at AS occurred_at,
        COALESCE(
          wel.execution_data #>> '{billingAttribution,billingEntity,id}',
          usage_scope.billing_entity_id,
          wb.billing_entity_id
        ) AS billing_entity_id,
        COALESCE(
          wel.execution_data #>> '{billingAttribution,billedAccountUserId}',
          wb.billing_owner_user_id
        ) AS billing_owner_user_id,
        COALESCE(
          wel.execution_data #>> '{billingAttribution,actorUserId}',
          wel.execution_data #>> '{environment,userId}',
          usage_scope.user_id
        ) AS actor_user_id,
        -- Presence matters independently of payerSubscription: an explicit
        -- null payer means the run was free and must never be reclassified by
        -- a later workspace upgrade.
        wel.execution_data ? 'billingAttribution' AS has_billing_snapshot,
        wel.execution_data #>> '{billingAttribution,payerSubscription,plan}' AS snapshot_plan,
        wel.execution_data #>> '{billingAttribution,payerSubscription,status}' AS snapshot_status
      FROM workflow_execution_logs wel
      JOIN workspace_billing wb ON wb.workspace_id = wel.workspace_id
      LEFT JOIN LATERAL (
        SELECT ul.billing_entity_id, ul.user_id
        FROM usage_log ul
        WHERE NOT (wel.execution_data ? 'billingAttribution')
          AND ul.execution_id = wel.execution_id
          AND ul.source = 'workflow'
          AND ul.billing_entity_id IS NOT NULL
        ORDER BY ul.created_at
        LIMIT 1
      ) usage_scope ON true
      WHERE wel.ended_at >= ${workflowPeriodStart}
        AND wel.ended_at < ${workflowPeriodEnd}
        AND wel.status = 'completed'
        AND wel.level = 'info'
    ),
    mothership_candidates AS (
      SELECT
        'mothership'::text AS source,
        cm.message_id AS source_event_id,
        cm.created_at AS occurred_at,
        wb.billing_entity_id,
        wb.billing_owner_user_id,
        cc.user_id AS actor_user_id,
        false AS has_billing_snapshot,
        NULL::text AS snapshot_plan,
        NULL::text AS snapshot_status,
        row_number() OVER (
          -- Chat forks copy prior messages with their original id/timestamp.
          -- message_id is unique only within a chat, so include the actor
          -- and timestamp to avoid collapsing an unrelated cross-chat reuse.
          PARTITION BY cc.user_id, cm.message_id, cm.created_at
          ORDER BY cm.created_at, cm.id
        ) AS logical_message_copy
      FROM copilot_messages cm
      JOIN copilot_chats cc ON cc.id = cm.chat_id
      JOIN workspace_billing wb ON wb.workspace_id = cc.workspace_id
      WHERE cc.type = 'mothership'
        AND cm.role = 'user'
        AND cm.deleted_at IS NULL
        AND cm.created_at >= ${mothershipPeriodStart}
        AND cm.created_at < ${mothershipPeriodEnd}
    ),
    source_units AS (
      SELECT * FROM workflow_units
      UNION ALL
      SELECT
        source,
        source_event_id,
        occurred_at,
        billing_entity_id,
        billing_owner_user_id,
        actor_user_id,
        has_billing_snapshot,
        snapshot_plan,
        snapshot_status
      FROM mothership_candidates
      WHERE logical_message_copy = 1
    ),
    eligible_units AS (
      SELECT su.*
      FROM source_units su
      LEFT JOIN "user" actor ON actor.id = su.actor_user_id
      LEFT JOIN "user" billing_owner ON billing_owner.id = su.billing_owner_user_id
      WHERE lower(split_part(COALESCE(actor.email, ''), '@', 2)) NOT IN ('sim.ai', 'simstudio.ai')
        AND lower(split_part(COALESCE(billing_owner.email, ''), '@', 2)) NOT IN ('sim.ai', 'simstudio.ai')
        AND (
          (
            su.has_billing_snapshot
            AND su.snapshot_plan IS NOT NULL
            AND su.snapshot_status IN ('active', 'past_due')
            AND (
              su.snapshot_plan IN ('enterprise', 'pro', 'team')
              OR left(su.snapshot_plan, 4) = 'pro_'
              OR left(su.snapshot_plan, 5) = 'team_'
            )
          )
          OR (
            NOT su.has_billing_snapshot
            AND EXISTS (
              SELECT 1
              FROM subscription s
              WHERE s.reference_id = su.billing_entity_id
                AND (
                  s.plan IN ('enterprise', 'pro', 'team')
                  OR left(s.plan, 4) = 'pro_'
                  OR left(s.plan, 5) = 'team_'
                )
                AND (s.trial_end IS NULL OR su.occurred_at >= s.trial_end)
                AND (
                  s.status IN ('active', 'past_due')
                  -- A terminal cancellation is the only historical state we
                  -- can infer safely from the surviving row. period_end
                  -- alone is not evidence of payment: Stripe also populates
                  -- it for trialing, incomplete, unpaid, and expired rows.
                  OR (
                    s.status = 'canceled'
                    AND COALESCE(s.ended_at, s.canceled_at) >= su.occurred_at
                  )
                )
            )
          )
        )
    )
    SELECT
      source,
      to_char(
        (occurred_at AT TIME ZONE 'UTC') AT TIME ZONE ${REPORTING_TIME_ZONE},
        'YYYY-MM-DD'
      ) AS date,
      count(*)::bigint AS units
    FROM eligible_units
    GROUP BY source, date
    ORDER BY date, source
  `)
  return Array.from(result)
}

export async function getGlobalWorkSummary(
  requestedMonth?: string,
  now = new Date()
): Promise<GlobalWorkSummary> {
  const month = requestedMonth ?? getLatestCompletedGlobalWorkMonth(now)
  const currentMonth = zonedWallClock(now, REPORTING_TIME_ZONE).slice(0, 7)
  const isCurrentMonth = month === currentMonth
  const { periodStart, periodEnd } = getGlobalWorkMonthWindow(month)
  const rows = await queryEstimatedGlobalWorkUnits(periodStart, periodEnd)

  const sourceUnits = { workflow: 0, mothership: 0 }
  const unitsByDate = new Map<string, { workflow: number; mothership: number }>()
  for (const row of rows) {
    const units = Number(row.units)
    sourceUnits[row.source] += units
    const daily = unitsByDate.get(row.date) ?? { workflow: 0, mothership: 0 }
    daily[row.source] += units
    unitsByDate.set(row.date, daily)
  }

  const daily = buildZeroFilledGlobalWorkDailySeries({
    month,
    isCurrentMonth,
    now,
    unitsByDate,
  })
  const units = sourceUnits.workflow + sourceUnits.mothership
  const humanEquivalentHours = units * (GLOBAL_WORK_FORMULA.minutesPerUnit / 60)
  const elapsedFraction = isCurrentMonth
    ? Math.max(
        0,
        Math.min(
          1,
          (now.getTime() - periodStart.getTime()) / (periodEnd.getTime() - periodStart.getTime())
        )
      )
    : 1
  const projectedMonthlyHours =
    isCurrentMonth && elapsedFraction > 0
      ? humanEquivalentHours / elapsedFraction
      : humanEquivalentHours
  const annualizedPercentGlobalWork =
    ((projectedMonthlyHours * 12) / GLOBAL_WORK_FORMULA.globalAnnualHours) * 100

  return {
    month,
    label: isCurrentMonth ? 'Month to date · projected annualized' : 'Completed month',
    isCurrentMonth,
    attribution: 'estimated',
    formula: GLOBAL_WORK_FORMULA,
    units,
    humanEquivalentHours: round(humanEquivalentHours, 2),
    annualizedPercentGlobalWork: round(annualizedPercentGlobalWork, 10),
    sources: (['workflow', 'mothership'] as const).map((source) => ({
      source,
      units: sourceUnits[source],
      humanEquivalentHours: round(
        sourceUnits[source] * (GLOBAL_WORK_FORMULA.minutesPerUnit / 60),
        2
      ),
    })),
    daily,
  }
}
