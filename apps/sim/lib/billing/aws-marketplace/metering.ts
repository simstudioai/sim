/**
 * Bills AWS Marketplace usage. Each run first turns an organization's closed hours of billed usage
 * into ledger rows, one per organization, dimension and hour, each billed to one license, then
 * sends the rows AWS has not yet accepted. Computing and sending are separate steps, so a failed
 * send retries the same immutable record rather than recomputing it, and the ledger's unique key
 * keeps an hour from being billed twice.
 */

import { BatchMeterUsageCommand, type UsageRecord } from '@aws-sdk/client-marketplace-metering'
import { db } from '@sim/db'
import { awsMarketplaceLicense, awsMarketplaceUsageReport, usageLog } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { getErrorMessage, toError } from '@sim/utils/errors'
import { chunkArray } from '@sim/utils/helpers'
import { generateId } from '@sim/utils/id'
import { and, asc, desc, eq, gte, inArray, isNotNull, lt, or, sql } from 'drizzle-orm'
import { getMeteringClient } from '@/lib/billing/aws-marketplace/client'
import { getAwsMarketplaceProducts } from '@/lib/billing/aws-marketplace/config'
import type {
  AwsMarketplaceProduct,
  AwsMarketplaceUsagePricing,
} from '@/lib/billing/aws-marketplace/products'
import { toDecimal, toFixedString } from '@/lib/billing/utils/decimal'
import { acquireAdvisoryXactLock } from '@/lib/db/advisory-locks'

const logger = createLogger('AwsMarketplaceMetering')

const HOUR_MS = 60 * 60 * 1000
/** Usage is logged as work finishes, so an hour is billed only once this long has passed. */
const SETTLE_MS = 15 * 60 * 1000
/** AWS accepts a record up to 24 hours after its timestamp. */
const AWS_ACCEPTS_MS = 24 * HOUR_MS
/**
 * Only hours that start within this window are computed, so every new record still has an hour
 * of AWS's window left for its first send.
 */
const COMPUTE_WINDOW_MS = AWS_ACCEPTS_MS - HOUR_MS
/** BatchMeterUsage takes at most 25 records. */
const RECORDS_PER_CALL = 25
/** Rows sent per run, oldest first; any beyond it go in the next run, 15 minutes later. */
const MAX_ROWS_PER_RUN = 500

/**
 * AWS refuses these for everything the license sends, so retrying cannot help: the records are
 * rejected and the error is logged for the team.
 */
const LICENSE_LEVEL_ERRORS = new Set([
  'InvalidLicenseException',
  'InvalidCustomerIdentifierException',
  'InvalidProductCodeException',
  'InvalidUsageDimensionException',
  'TimestampOutOfBoundsException',
])

export interface AwsMarketplaceMeteringSummary {
  /** Ledger rows written for newly closed hours. */
  recorded: number
  reported: number
  rejected: number
  /** Rows left pending for the next run: unprocessed by AWS, or a transient failure. */
  retained: number
}

/** A ledger row awaiting AWS, with the license it bills. */
interface PendingReport {
  id: string
  organizationId: string
  dimension: string
  hourStart: Date
  quantity: number
  licenseArn: string
  customerAwsAccountId: string
}

interface MeteredLicense {
  id: string
  organizationId: string
  organizationLinkedAt: Date
  status: 'pending' | 'active' | 'inactive'
  expiresAt: Date | null
  usage: AwsMarketplaceUsagePricing
}

function floorHour(time: number): number {
  return Math.floor(time / HOUR_MS) * HOUR_MS
}

/**
 * Licenses whose organization may owe usage in the compute window: linked ones on a usage plan
 * that are active, or that lapsed recently enough for their last hours to still reach AWS. The
 * earliest-linked license comes first, so where two overlap during a renewal it bills the shared
 * hours and the other picks up after it ends.
 */
async function listMeteredLicenses(
  products: ReadonlyMap<string, AwsMarketplaceProduct>,
  windowStart: Date
): Promise<MeteredLicense[]> {
  const rows = await db
    .select({
      id: awsMarketplaceLicense.id,
      productCode: awsMarketplaceLicense.productCode,
      organizationId: awsMarketplaceLicense.organizationId,
      organizationLinkedAt: awsMarketplaceLicense.organizationLinkedAt,
      status: awsMarketplaceLicense.status,
      expiresAt: awsMarketplaceLicense.expiresAt,
    })
    .from(awsMarketplaceLicense)
    .where(
      and(
        inArray(awsMarketplaceLicense.productCode, [...products.keys()]),
        isNotNull(awsMarketplaceLicense.organizationId),
        isNotNull(awsMarketplaceLicense.organizationLinkedAt),
        or(
          eq(awsMarketplaceLicense.status, 'active'),
          and(
            eq(awsMarketplaceLicense.status, 'inactive'),
            gte(awsMarketplaceLicense.expiresAt, windowStart)
          )
        )
      )
    )
    .orderBy(asc(awsMarketplaceLicense.organizationLinkedAt), asc(awsMarketplaceLicense.id))
  return rows.flatMap((row) => {
    const usage = products.get(row.productCode)?.plan.usage
    if (!usage || !row.organizationId || !row.organizationLinkedAt) return []
    return [
      {
        id: row.id,
        organizationId: row.organizationId,
        organizationLinkedAt: row.organizationLinkedAt,
        status: row.status,
        expiresAt: row.expiresAt,
        usage,
      },
    ]
  })
}

/**
 * Where a license's billable usage ends this run. An active license bills whole hours once they
 * have settled. A lapsed one bills up to its expiry as soon as that has settled, partial hour
 * included, because AWS takes a deprovisioned license's last usage for only about an hour.
 */
function billableUntil(license: MeteredLicense, now: number): number {
  const settled = now - SETTLE_MS
  const expiry = license.expiresAt?.getTime()
  if (license.status !== 'active' && expiry !== undefined && expiry <= settled) return expiry
  return floorHour(settled)
}

/**
 * Writes the ledger rows for one license's closed hours not yet billed to its organization, under
 * a lock on the organization and dimension so the running totals extend one chain. Hours with no
 * usage get no row. Usage counts from the moment the organization was linked and, for a lapsed
 * license, until its entitlement expired.
 */
async function recordLicenseHours(license: MeteredLicense, now: number): Promise<number> {
  const { usage } = license
  return db.transaction(async (tx) => {
    await acquireAdvisoryXactLock(
      tx,
      'aws_marketplace_usage',
      `aws-marketplace-usage:${license.organizationId}:${usage.dimension}`
    )
    const [last] = await tx
      .select({
        hourStart: awsMarketplaceUsageReport.hourStart,
        costThroughUsd: awsMarketplaceUsageReport.costThroughUsd,
        quantityThrough: awsMarketplaceUsageReport.quantityThrough,
      })
      .from(awsMarketplaceUsageReport)
      .where(
        and(
          eq(awsMarketplaceUsageReport.organizationId, license.organizationId),
          eq(awsMarketplaceUsageReport.dimension, usage.dimension)
        )
      )
      .orderBy(desc(awsMarketplaceUsageReport.hourStart))
      .limit(1)

    const from = Math.max(
      license.organizationLinkedAt.getTime(),
      floorHour(now - COMPUTE_WINDOW_MS) + HOUR_MS,
      last ? last.hourStart.getTime() + HOUR_MS : 0
    )
    const until = billableUntil(license, now)
    if (from >= until) return 0

    const hour = sql<Date>`date_trunc('hour', ${usageLog.createdAt})`.mapWith(usageLog.createdAt)
    const hours = await tx
      .select({ hourStart: hour, cost: sql<string>`sum(${usageLog.cost})` })
      .from(usageLog)
      .where(
        and(
          eq(usageLog.billingEntityType, 'organization'),
          eq(usageLog.billingEntityId, license.organizationId),
          inArray(usageLog.category, [...usage.categories]),
          gte(usageLog.createdAt, new Date(from)),
          lt(usageLog.createdAt, new Date(until))
        )
      )
      .groupBy(hour)
      .orderBy(hour)

    let costThrough = toDecimal(last?.costThroughUsd)
    let quantityThrough = last?.quantityThrough ?? 0
    const rows = hours.flatMap(({ hourStart, cost }) => {
      const hourCost = toDecimal(cost)
      if (hourCost.lte(0)) return []
      costThrough = costThrough.plus(hourCost)
      const unitsThrough = costThrough.dividedToIntegerBy(usage.usdPerUnit).toNumber()
      const quantity = unitsThrough - quantityThrough
      quantityThrough = unitsThrough
      return [
        {
          id: generateId(),
          organizationId: license.organizationId,
          licenseId: license.id,
          dimension: usage.dimension,
          hourStart,
          costThroughUsd: toFixedString(costThrough),
          quantity,
          quantityThrough,
        },
      ]
    })
    if (rows.length === 0) return 0
    await tx.insert(awsMarketplaceUsageReport).values(rows)
    return rows.length
  })
}

/** Rows AWS can no longer accept are rejected, so they stop being retried and the team hears. */
async function rejectExpiredReports(now: number): Promise<number> {
  const expired = await db
    .update(awsMarketplaceUsageReport)
    .set({
      status: 'rejected',
      error: 'Older than the 24 hours AWS accepts usage for',
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(awsMarketplaceUsageReport.status, 'pending'),
        lt(awsMarketplaceUsageReport.hourStart, new Date(now - AWS_ACCEPTS_MS))
      )
    )
    .returning({
      id: awsMarketplaceUsageReport.id,
      organizationId: awsMarketplaceUsageReport.organizationId,
      quantity: awsMarketplaceUsageReport.quantity,
    })
  for (const row of expired) {
    logger.error('AWS Marketplace usage aged out before AWS accepted it', { ...row })
  }
  return expired.length
}

async function settleReport(
  row: PendingReport,
  outcome:
    | { status: 'reported'; meteringRecordId: string | null }
    | { status: 'rejected'; error: string }
): Promise<void> {
  const now = new Date()
  await db
    .update(awsMarketplaceUsageReport)
    .set(
      outcome.status === 'reported'
        ? {
            status: 'reported',
            meteringRecordId: outcome.meteringRecordId,
            reportedAt: now,
            updatedAt: now,
          }
        : { status: 'rejected', error: outcome.error, updatedAt: now }
    )
    .where(eq(awsMarketplaceUsageReport.id, row.id))
}

function recordKey(dimension: string | undefined, timestamp: Date | undefined): string {
  return `${dimension}@${timestamp?.getTime()}`
}

/**
 * Sends one license's rows, at most 25 to a call. A license-level refusal rejects its rows and is
 * logged; a record AWS leaves unprocessed, or any other failure, stays pending for the next run.
 */
async function sendLicenseReports(
  rows: PendingReport[],
  summary: AwsMarketplaceMeteringSummary
): Promise<void> {
  for (const batch of chunkArray(rows, RECORDS_PER_CALL)) {
    const unsettled = new Map(batch.map((row) => [recordKey(row.dimension, row.hourStart), row]))
    try {
      const response = await getMeteringClient().send(
        new BatchMeterUsageCommand({
          UsageRecords: batch.map(
            (row): UsageRecord => ({
              LicenseArn: row.licenseArn,
              CustomerAWSAccountId: row.customerAwsAccountId,
              Dimension: row.dimension,
              Quantity: row.quantity,
              Timestamp: row.hourStart,
            })
          ),
        })
      )
      for (const result of response.Results ?? []) {
        const key = recordKey(result.UsageRecord?.Dimension, result.UsageRecord?.Timestamp)
        const row = unsettled.get(key)
        if (!row) continue
        unsettled.delete(key)
        if (result.Status === 'CustomerNotSubscribed') {
          logger.error('AWS Marketplace refused usage for a customer not subscribed', {
            reportId: row.id,
            organizationId: row.organizationId,
          })
          await settleReport(row, { status: 'rejected', error: 'CustomerNotSubscribed' })
          summary.rejected += 1
        } else {
          await settleReport(row, {
            status: 'reported',
            meteringRecordId: result.MeteringRecordId ?? null,
          })
          summary.reported += 1
        }
      }
      summary.retained += unsettled.size
    } catch (error) {
      const { name } = toError(error)
      if (LICENSE_LEVEL_ERRORS.has(name)) {
        logger.error('AWS Marketplace refused usage for a license', {
          reason: name,
          reportIds: batch.map((row) => row.id),
        })
        for (const row of batch) await settleReport(row, { status: 'rejected', error: name })
        summary.rejected += batch.length
        continue
      }
      logger.warn('AWS Marketplace usage could not be sent; retrying next run', {
        reason: name,
        error: getErrorMessage(error),
      })
      summary.retained += batch.length
    }
  }
}

/** Sends every pending row still inside AWS's window, oldest first, grouped by license. */
async function sendPendingReports(now: number, summary: AwsMarketplaceMeteringSummary) {
  summary.rejected += await rejectExpiredReports(now)
  const pending: PendingReport[] = await db
    .select({
      id: awsMarketplaceUsageReport.id,
      organizationId: awsMarketplaceUsageReport.organizationId,
      dimension: awsMarketplaceUsageReport.dimension,
      hourStart: awsMarketplaceUsageReport.hourStart,
      quantity: awsMarketplaceUsageReport.quantity,
      licenseArn: awsMarketplaceLicense.licenseArn,
      customerAwsAccountId: awsMarketplaceLicense.customerAwsAccountId,
    })
    .from(awsMarketplaceUsageReport)
    .innerJoin(
      awsMarketplaceLicense,
      eq(awsMarketplaceUsageReport.licenseId, awsMarketplaceLicense.id)
    )
    .where(eq(awsMarketplaceUsageReport.status, 'pending'))
    .orderBy(asc(awsMarketplaceUsageReport.hourStart))
    .limit(MAX_ROWS_PER_RUN)

  const byLicense = new Map<string, PendingReport[]>()
  for (const row of pending) {
    byLicense.set(row.licenseArn, [...(byLicense.get(row.licenseArn) ?? []), row])
  }
  for (const rows of byLicense.values()) {
    await sendLicenseReports(rows, summary)
  }
}

/**
 * Records every newly closed hour of usage owed through AWS Marketplace and sends what AWS has not
 * accepted yet. Null when no configured listing bills usage. Safe to replay: rows are written once
 * per organization, dimension and hour, and AWS keeps the first record it accepts for an hour.
 */
export async function meterAwsMarketplaceUsage(
  now = Date.now()
): Promise<AwsMarketplaceMeteringSummary | null> {
  const products = getAwsMarketplaceProducts()
  if (![...products.values()].some((product) => product.plan.usage)) return null
  const summary: AwsMarketplaceMeteringSummary = {
    recorded: 0,
    reported: 0,
    rejected: 0,
    retained: 0,
  }
  const licenses = await listMeteredLicenses(products, new Date(now - AWS_ACCEPTS_MS))
  for (const license of licenses) {
    summary.recorded += await recordLicenseHours(license, now)
  }
  await sendPendingReports(now, summary)
  return summary
}
