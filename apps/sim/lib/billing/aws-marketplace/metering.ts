/**
 * Bills AWS Marketplace usage. Usage cost is recorded in place and can grow after it is first
 * written, so each run charges what changed in the books rather than what an hour of rows says:
 * it re-sums every billing period of an organization's billed usage that can still change,
 * charges the whole units above what that period's tally already counted, and adds them to the
 * current hour's record for the license being billed. A record is sent once its hour closes, or at
 * once for a license that has ended, and AWS keeps the first record it accepts for a license,
 * dimension and hour, so a record's quantity is fixed once it is first sent.
 */

import { BatchMeterUsageCommand } from '@aws-sdk/client-marketplace-metering'
import { db } from '@sim/db'
import {
  awsMarketplaceLicense,
  awsMarketplaceUsageReport,
  awsMarketplaceUsageTally,
  usageLog,
} from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { getErrorMessage, toError } from '@sim/utils/errors'
import { chunkArray } from '@sim/utils/helpers'
import { generateId } from '@sim/utils/id'
import { compareStrings } from '@sim/utils/string'
import {
  and,
  asc,
  eq,
  gt,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  or,
  type SQL,
  sql,
} from 'drizzle-orm'
import { getMeteringClient } from '@/lib/billing/aws-marketplace/client'
import { getAwsMarketplaceProducts } from '@/lib/billing/aws-marketplace/config'
import type { AwsMarketplaceUsagePricing } from '@/lib/billing/aws-marketplace/products'
import { MAX_WORKFLOW_EXECUTION_TIMEOUT_SECONDS } from '@/lib/billing/execution-timeout-defaults'
import { toDecimal, toFixedString } from '@/lib/billing/utils/decimal'
import { acquireAdvisoryXactLock } from '@/lib/db/advisory-locks'
import type { DbTransaction } from '@/lib/db/types'

const logger = createLogger('AwsMarketplaceMetering')

const HOUR_MS = 60 * 60 * 1000
/** AWS refuses a record 24 hours or more after its timestamp. */
const AWS_ACCEPTS_MS = 24 * HOUR_MS
/** AWS takes the previous month's records until 06:00 UTC on the first day of the next month. */
const MONTH_GRACE_MS = 6 * HOUR_MS
/** AWS takes a license's last usage for about an hour after it ends. */
const AFTER_END_MS = HOUR_MS
/**
 * How long a usage row's cost can keep growing: a request tops up its row in place while it runs,
 * and no run outlasts the longest execution timeout. A day of margin covers late cost callbacks.
 */
const ROW_SETTLE_MS = MAX_WORKFLOW_EXECUTION_TIMEOUT_SECONDS * 1000 + 24 * HOUR_MS
/** BatchMeterUsage takes at most 25 records. */
const RECORDS_PER_CALL = 25
/** Rows sent per run, oldest first; any beyond it go in the next run. */
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
])
/** AWS refuses a whole call when any one record's timestamp is out of range. */
const TIMESTAMP_OUT_OF_BOUNDS = 'TimestampOutOfBoundsException'

export interface AwsMarketplaceMeteringSummary {
  /** Units newly charged to a license this run. */
  charged: number
  reported: number
  rejected: number
  /** Rows left pending for the next run: unprocessed by AWS, or a transient failure. */
  retained: number
}

interface MeteredLicense {
  id: string
  organizationId: string
  organizationLinkedAt: Date
  status: 'pending' | 'active' | 'inactive'
  expiresAt: Date | null
  endedAt: Date | null
  usage: AwsMarketplaceUsagePricing
}

/** A ledger row awaiting AWS, with the license it bills. */
interface PendingReport {
  id: string
  organizationId: string | null
  dimension: string
  hourStart: Date
  quantity: number
  licenseArn: string
  customerAwsAccountId: string
}

function floorHour(time: number): number {
  return Math.floor(time / HOUR_MS) * HOUR_MS
}

/** Serializes charging and sending for one organization and dimension. */
function lockUsage(tx: DbTransaction, organizationId: string, dimension: string): Promise<void> {
  return acquireAdvisoryXactLock(
    tx,
    'aws_marketplace_usage',
    `aws-marketplace-usage:${organizationId}:${dimension}`
  )
}

/**
 * Starts billing for linked licenses that have no link time, such as those linked before it was
 * recorded: their usage counts from the first run that sees them.
 */
async function stampUnmarkedLinks(productCodes: string[], now: number): Promise<void> {
  await db
    .update(awsMarketplaceLicense)
    .set({ organizationLinkedAt: new Date(now) })
    .where(
      and(
        inArray(awsMarketplaceLicense.productCode, productCodes),
        isNotNull(awsMarketplaceLicense.organizationId),
        isNull(awsMarketplaceLicense.organizationLinkedAt)
      )
    )
}

/** Linked licenses on a plan that bills usage, in force or ended recently enough to still bill. */
async function listMeteredLicenses(
  usageByProduct: ReadonlyMap<string, AwsMarketplaceUsagePricing>,
  now: number
): Promise<MeteredLicense[]> {
  const rows = await db
    .select({
      id: awsMarketplaceLicense.id,
      productCode: awsMarketplaceLicense.productCode,
      organizationId: awsMarketplaceLicense.organizationId,
      organizationLinkedAt: awsMarketplaceLicense.organizationLinkedAt,
      status: awsMarketplaceLicense.status,
      expiresAt: awsMarketplaceLicense.expiresAt,
      endedAt: awsMarketplaceLicense.endedAt,
    })
    .from(awsMarketplaceLicense)
    .where(
      and(
        inArray(awsMarketplaceLicense.productCode, [...usageByProduct.keys()]),
        isNotNull(awsMarketplaceLicense.organizationId),
        isNotNull(awsMarketplaceLicense.organizationLinkedAt),
        or(
          eq(awsMarketplaceLicense.status, 'active'),
          gte(awsMarketplaceLicense.endedAt, new Date(now - AFTER_END_MS))
        )
      )
    )
    .orderBy(asc(awsMarketplaceLicense.organizationLinkedAt), asc(awsMarketplaceLicense.id))
  return rows.flatMap(({ productCode, organizationId, organizationLinkedAt, ...row }) => {
    const usage = usageByProduct.get(productCode)
    if (!usage || !organizationId || !organizationLinkedAt) return []
    return [{ ...row, organizationId, organizationLinkedAt, usage }]
  })
}

/**
 * When a license stopped being in force, or null while it still is: the earlier of its expiry, once
 * passed, and the moment a check first found it inactive.
 */
function licenseEnd(license: MeteredLicense, now: number): number | null {
  const expiry = license.expiresAt?.getTime()
  const ends = [
    ...(expiry !== undefined && expiry <= now ? [expiry] : []),
    ...(license.status === 'active' ? [] : [license.endedAt?.getTime() ?? now]),
  ]
  return ends.length > 0 ? Math.min(...ends) : null
}

/**
 * The license an organization's newly counted usage is charged to, and the hour it is charged in.
 * A license still in force wins, the earliest-linked first, so overlapping licenses during a
 * renewal never both bill. With none in force, the license that ended most recently, within the
 * hour AWS allows, takes the usage at the hour it ended. That record is sent as soon as the end is
 * known, because AWS counts its hour from the unsubscribe itself, which a check only finds later:
 * usage that lands after the send, from work still finishing once access is gone, is not billed.
 */
function chargeTarget(
  licenses: MeteredLicense[],
  now: number
): { license: MeteredLicense; hourStart: number } | null {
  let ended: { license: MeteredLicense; end: number } | null = null
  for (const license of licenses) {
    const end = licenseEnd(license, now)
    if (end === null) return { license, hourStart: floorHour(now) }
    if (end >= now - AFTER_END_MS && (!ended || end > ended.end)) ended = { license, end }
  }
  return ended ? { license: ended.license, hourStart: floorHour(ended.end) } : null
}

/**
 * Counts the organization's usage in each billing period with a row still able to change, and
 * returns the whole units not yet charged. Each period's tally is updated to what it now covers; a period's
 * first tally fixes where its count starts.
 */
async function countNewUnits(
  tx: DbTransaction,
  organizationId: string,
  usage: AwsMarketplaceUsagePricing,
  countFrom: Date,
  now: number
): Promise<number> {
  const tallies = await tx
    .select()
    .from(awsMarketplaceUsageTally)
    .where(
      and(
        eq(awsMarketplaceUsageTally.organizationId, organizationId),
        eq(awsMarketplaceUsageTally.dimension, usage.dimension)
      )
    )
  const tallyByPeriod = new Map(tallies.map((tally) => [tally.periodStart.getTime(), tally]))

  const periods = await tx
    .selectDistinct({ periodStart: usageLog.billingPeriodStart })
    .from(usageLog)
    .where(
      and(
        eq(usageLog.billingEntityType, 'organization'),
        eq(usageLog.billingEntityId, organizationId),
        gt(usageLog.createdAt, new Date(now - ROW_SETTLE_MS))
      )
    )

  let newUnits = 0
  for (const { periodStart } of periods) {
    if (!periodStart) continue
    const tally = tallyByPeriod.get(periodStart.getTime())
    const countedFrom = tally?.countedFrom ?? countFrom
    const [{ cost }] = await tx
      .select({ cost: sql<string>`coalesce(sum(${usageLog.cost}), 0)` })
      .from(usageLog)
      .where(
        and(
          eq(usageLog.billingEntityType, 'organization'),
          eq(usageLog.billingEntityId, organizationId),
          eq(usageLog.billingPeriodStart, periodStart),
          inArray(usageLog.category, [...usage.categories]),
          gte(usageLog.createdAt, countedFrom)
        )
      )
    const periodCost = toDecimal(cost)
    const counted = tally?.units ?? 0
    const units = Math.max(counted, periodCost.dividedToIntegerBy(usage.usdPerUnit).toNumber())
    newUnits += units - counted
    await tx
      .insert(awsMarketplaceUsageTally)
      .values({
        organizationId,
        dimension: usage.dimension,
        periodStart,
        countedFrom,
        costUsd: toFixedString(periodCost),
        units,
      })
      .onConflictDoUpdate({
        target: [
          awsMarketplaceUsageTally.organizationId,
          awsMarketplaceUsageTally.dimension,
          awsMarketplaceUsageTally.periodStart,
        ],
        set: { costUsd: toFixedString(periodCost), units, updatedAt: new Date() },
      })
  }
  return newUnits
}

/**
 * Charges one organization's newly counted usage to its license, under a lock on the organization
 * and dimension so concurrent runs extend one tally. Returns the units charged. With no license
 * to charge, or only a record already sent, the usage stays uncounted for the next license that
 * can take it.
 */
async function chargeOrganization(licenses: MeteredLicense[], now: number): Promise<number> {
  const target = chargeTarget(licenses, now)
  if (!target) return 0
  const { license, hourStart } = target
  const { usage } = license
  return db.transaction(async (tx) => {
    await lockUsage(tx, license.organizationId, usage.dimension)
    const [record] = await tx
      .select({
        status: awsMarketplaceUsageReport.status,
        sentAt: awsMarketplaceUsageReport.sentAt,
      })
      .from(awsMarketplaceUsageReport)
      .where(
        and(
          eq(awsMarketplaceUsageReport.licenseId, license.id),
          eq(awsMarketplaceUsageReport.dimension, usage.dimension),
          eq(awsMarketplaceUsageReport.hourStart, new Date(hourStart))
        )
      )
    if (record && (record.status !== 'pending' || record.sentAt)) return 0

    const countFrom = licenses.reduce(
      (earliest, entry) =>
        entry.organizationLinkedAt < earliest ? entry.organizationLinkedAt : earliest,
      license.organizationLinkedAt
    )
    const units = await countNewUnits(tx, license.organizationId, usage, countFrom, now)
    if (units <= 0) return 0
    const [written] = await tx
      .insert(awsMarketplaceUsageReport)
      .values({
        id: generateId(),
        organizationId: license.organizationId,
        licenseId: license.id,
        dimension: usage.dimension,
        hourStart: new Date(hourStart),
        quantity: units,
      })
      .onConflictDoUpdate({
        target: [
          awsMarketplaceUsageReport.licenseId,
          awsMarketplaceUsageReport.dimension,
          awsMarketplaceUsageReport.hourStart,
        ],
        set: {
          quantity: sql`${awsMarketplaceUsageReport.quantity} + ${units}`,
          updatedAt: new Date(),
        },
        setWhere: isNull(awsMarketplaceUsageReport.sentAt),
      })
      .returning({ id: awsMarketplaceUsageReport.id })
    // A row frozen under another organization's lock (relinked after its organization was deleted)
    // keeps its quantity; rolling back leaves these units for the next record.
    if (!written) throw new Error('AWS Marketplace usage record was sent while it was charged')
    return units
  })
}

/**
 * Rows AWS can no longer accept are rejected, so they stop being retried and the team hears: those
 * 24 hours old, and the previous month's once its grace period has passed.
 */
async function rejectExpiredReports(now: number): Promise<number> {
  const today = new Date(now)
  const monthStart = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1)
  const tooOld: SQL[] = [lte(awsMarketplaceUsageReport.hourStart, new Date(now - AWS_ACCEPTS_MS))]
  if (now >= monthStart + MONTH_GRACE_MS) {
    tooOld.push(lt(awsMarketplaceUsageReport.hourStart, new Date(monthStart)))
  }
  const expired = await db
    .update(awsMarketplaceUsageReport)
    .set({
      status: 'rejected',
      error: 'Outside the window AWS accepts usage for',
      updatedAt: new Date(),
    })
    .where(and(eq(awsMarketplaceUsageReport.status, 'pending'), or(...tooOld)))
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
 * Fixes the quantity of rows about to go to AWS and returns them as they now stand, dropping any
 * no longer pending. The usage lock keeps a charge from joining a row between this read and the
 * send.
 */
async function freezeForSending(rows: PendingReport[]): Promise<PendingReport[]> {
  return db.transaction(async (tx) => {
    const scopes = new Map<string, { organizationId: string; dimension: string }>()
    for (const { organizationId, dimension } of rows) {
      if (organizationId)
        scopes.set(`${organizationId}:${dimension}`, { organizationId, dimension })
    }
    const ordered = [...scopes].sort(([left], [right]) => compareStrings(left, right))
    for (const [, scope] of ordered) await lockUsage(tx, scope.organizationId, scope.dimension)
    const frozen = await tx
      .update(awsMarketplaceUsageReport)
      .set({ sentAt: sql`coalesce(${awsMarketplaceUsageReport.sentAt}, now())` })
      .where(
        and(
          inArray(
            awsMarketplaceUsageReport.id,
            rows.map((row) => row.id)
          ),
          eq(awsMarketplaceUsageReport.status, 'pending')
        )
      )
      .returning({ id: awsMarketplaceUsageReport.id, quantity: awsMarketplaceUsageReport.quantity })
    const quantityById = new Map(frozen.map((row) => [row.id, row.quantity]))
    return rows.flatMap((row) => {
      const quantity = quantityById.get(row.id)
      return quantity === undefined ? [] : [{ ...row, quantity }]
    })
  })
}

/**
 * Sends one call's worth of a license's rows. A license-level refusal rejects them and is logged;
 * an out-of-range timestamp, which fails the whole call, is narrowed to its own row by sending
 * each alone; a record AWS leaves unprocessed, or any other failure, stays pending for the next
 * run.
 */
async function sendBatch(
  batch: PendingReport[],
  summary: AwsMarketplaceMeteringSummary
): Promise<void> {
  const unsettled = new Map(batch.map((row) => [recordKey(row.dimension, row.hourStart), row]))
  try {
    const response = await getMeteringClient().send(
      new BatchMeterUsageCommand({
        UsageRecords: batch.map((row) => ({
          LicenseArn: row.licenseArn,
          CustomerAWSAccountId: row.customerAwsAccountId,
          Dimension: row.dimension,
          Quantity: row.quantity,
          Timestamp: row.hourStart,
        })),
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
    if (name === TIMESTAMP_OUT_OF_BOUNDS && batch.length > 1) {
      for (const row of batch) await sendBatch([row], summary)
      return
    }
    if (name === TIMESTAMP_OUT_OF_BOUNDS || LICENSE_LEVEL_ERRORS.has(name)) {
      logger.error('AWS Marketplace refused usage', {
        reason: name,
        reportIds: batch.map((row) => row.id),
      })
      for (const row of batch) await settleReport(row, { status: 'rejected', error: name })
      summary.rejected += batch.length
      return
    }
    logger.warn('AWS Marketplace usage could not be sent; retrying next run', {
      reason: name,
      error: getErrorMessage(error),
    })
    summary.retained += batch.length
  }
}

/**
 * Sends every pending row whose hour has closed, or whose license has ended or expired so no more
 * usage can join it, oldest first and grouped by license.
 */
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
    .where(
      and(
        eq(awsMarketplaceUsageReport.status, 'pending'),
        or(
          lt(awsMarketplaceUsageReport.hourStart, new Date(floorHour(now))),
          eq(awsMarketplaceLicense.status, 'inactive'),
          lte(awsMarketplaceLicense.expiresAt, new Date(now))
        )
      )
    )
    .orderBy(asc(awsMarketplaceUsageReport.hourStart))
    .limit(MAX_ROWS_PER_RUN)

  const byLicense = new Map<string, PendingReport[]>()
  for (const row of pending) {
    const rows = byLicense.get(row.licenseArn)
    if (rows) rows.push(row)
    else byLicense.set(row.licenseArn, [row])
  }
  for (const rows of byLicense.values()) {
    for (const chunk of chunkArray(rows, RECORDS_PER_CALL)) {
      const batch = await freezeForSending(chunk)
      if (batch.length > 0) await sendBatch(batch, summary)
    }
  }
}

/**
 * Charges every organization's newly counted usage owed through AWS Marketplace and sends AWS the
 * records it can take. Null when no configured listing bills usage. Safe to replay: a period's
 * tally only moves forward, and AWS keeps the first record for a license, dimension and hour.
 */
export async function meterAwsMarketplaceUsage(
  now = Date.now()
): Promise<AwsMarketplaceMeteringSummary | null> {
  const usageByProduct = new Map<string, AwsMarketplaceUsagePricing>()
  for (const [productCode, product] of getAwsMarketplaceProducts()) {
    if (product.plan.usage) usageByProduct.set(productCode, product.plan.usage)
  }
  if (usageByProduct.size === 0) return null
  const summary: AwsMarketplaceMeteringSummary = {
    charged: 0,
    reported: 0,
    rejected: 0,
    retained: 0,
  }
  await stampUnmarkedLinks([...usageByProduct.keys()], now)
  const licensesByOrganization = new Map<string, MeteredLicense[]>()
  for (const license of await listMeteredLicenses(usageByProduct, now)) {
    const key = `${license.organizationId}:${license.usage.dimension}`
    const licenses = licensesByOrganization.get(key)
    if (licenses) licenses.push(license)
    else licensesByOrganization.set(key, [license])
  }
  for (const licenses of licensesByOrganization.values()) {
    summary.charged += await chargeOrganization(licenses, now)
  }
  await sendPendingReports(now, summary)
  return summary
}
