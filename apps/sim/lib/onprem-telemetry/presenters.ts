import { db } from '@sim/db'
import { onpremDeployment, onpremDeploymentRate, onpremUsageReport } from '@sim/db/schema'
import { eq, type InferSelectModel, inArray, sql } from 'drizzle-orm'
import type {
  AdminV1OnPremDeployment,
  AdminV1OnPremRate,
} from '@/lib/api/contracts/v1/admin/onprem-telemetry'
import { type EffectiveRate, resolveRateAt } from '@/lib/onprem-telemetry/rates'

export type OnPremDeploymentRow = InferSelectModel<typeof onpremDeployment>
type RateRow = InferSelectModel<typeof onpremDeploymentRate>

export function toEffectiveRate(row: RateRow): EffectiveRate {
  return {
    id: row.id,
    usdPerCredit: Number(row.usdPerCredit),
    effectiveFrom: row.effectiveFrom,
    createdAt: row.createdAt,
  }
}

export function presentRate(rate: EffectiveRate): AdminV1OnPremRate {
  return {
    id: rate.id,
    usdPerCredit: rate.usdPerCredit,
    effectiveFrom: rate.effectiveFrom.toISOString(),
    createdAt: rate.createdAt.toISOString(),
  }
}

export async function findDeployment(id: string): Promise<OnPremDeploymentRow | null> {
  const [row] = await db.select().from(onpremDeployment).where(eq(onpremDeployment.id, id)).limit(1)
  return row ?? null
}

/** Every rate for each deployment, oldest first; valuation picks from the full history. */
export async function loadRates(deploymentIds: string[]): Promise<Map<string, EffectiveRate[]>> {
  const byDeployment = new Map<string, EffectiveRate[]>()
  if (deploymentIds.length === 0) return byDeployment
  const rows = await db
    .select()
    .from(onpremDeploymentRate)
    .where(inArray(onpremDeploymentRate.deploymentId, deploymentIds))
    .orderBy(onpremDeploymentRate.effectiveFrom, onpremDeploymentRate.createdAt)
  for (const row of rows) {
    const rates = byDeployment.get(row.deploymentId) ?? []
    rates.push(toEffectiveRate(row))
    byDeployment.set(row.deploymentId, rates)
  }
  return byDeployment
}

async function loadLastReportedAt(deploymentIds: string[]): Promise<Map<string, Date>> {
  const byDeployment = new Map<string, Date>()
  if (deploymentIds.length === 0) return byDeployment
  const rows = await db
    .select({
      deploymentId: onpremUsageReport.deploymentId,
      lastReportedAt: sql<Date | string | null>`MAX(${onpremUsageReport.reportedAt})`.as(
        'last_reported_at'
      ),
    })
    .from(onpremUsageReport)
    .where(inArray(onpremUsageReport.deploymentId, deploymentIds))
    .groupBy(onpremUsageReport.deploymentId)
  for (const row of rows) {
    if (row.lastReportedAt) byDeployment.set(row.deploymentId, new Date(row.lastReportedAt))
  }
  return byDeployment
}

export async function presentDeployments(
  rows: OnPremDeploymentRow[],
  now: Date = new Date()
): Promise<AdminV1OnPremDeployment[]> {
  const ids = rows.map((row) => row.id)
  const [rates, lastReported] = await Promise.all([loadRates(ids), loadLastReportedAt(ids)])
  return rows.map((row) => {
    const current = resolveRateAt(rates.get(row.id) ?? [], now)
    return {
      id: row.id,
      name: row.name,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      currentRate: current ? presentRate(current) : null,
      lastReportedAt: lastReported.get(row.id)?.toISOString() ?? null,
    }
  })
}
