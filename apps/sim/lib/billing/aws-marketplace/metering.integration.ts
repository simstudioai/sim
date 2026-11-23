import { db } from '@sim/db'
import {
  awsMarketplaceLicense,
  awsMarketplaceUsageReport,
  awsMarketplaceUsageTally,
  organization,
  usageLog,
  user,
} from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import { asc, eq, inArray } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const CONTRACT_PRODUCT = 'product-placeholder'
const USAGE_PRODUCT = 'usage-product-placeholder'
const ACCOUNT = '000000000000'
const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS

interface SentRecord {
  LicenseArn?: string
  CustomerAWSAccountId?: string
  Dimension?: string
  Quantity?: number
  Timestamp?: Date
}

const { meteringSend } = vi.hoisted(() => {
  process.env.AWS_MARKETPLACE_PRODUCTS =
    'product-placeholder=contract,usage-product-placeholder=platform-with-usage'
  return { meteringSend: vi.fn() }
})

vi.mock('@aws-sdk/client-marketplace-metering', () => ({
  MarketplaceMeteringClient: class {
    send = meteringSend
  },
  BatchMeterUsageCommand: class {
    constructor(public input: { UsageRecords: SentRecord[]; ProductCode?: string }) {}
  },
}))

import { meterAwsMarketplaceUsage } from '@/lib/billing/aws-marketplace/metering'

/** Twenty minutes into an hour. */
const NOW = Math.floor(Date.now() / HOUR_MS) * HOUR_MS + 20 * 60 * 1000
const floorHour = (time: number) => new Date(Math.floor(time / HOUR_MS) * HOUR_MS)
const HOUR = floorHour(NOW)
const NEXT_HOUR = NOW + HOUR_MS
const minutesAgo = (minutes: number) => new Date(NOW - minutes * 60_000)
/** The billing period every fixture's usage falls in, unless a test says otherwise. */
const PERIOD = { start: new Date(NOW - 10 * DAY_MS), end: new Date(NOW + 20 * DAY_MS) }

const userIds: string[] = []
const organizationIds: string[] = []
const licenseIds: string[] = []

/** Every record sent for the license, with the request's top-level product code alongside. */
function sentRecords(licenseArn: string): Array<SentRecord & { productCode?: string }> {
  return meteringSend.mock.calls.flatMap(([command]) =>
    command.input.UsageRecords.filter((record: SentRecord) => record.LicenseArn === licenseArn).map(
      (record: SentRecord) => ({ ...record, productCode: command.input.ProductCode })
    )
  )
}

/** AWS accepts every record, echoing it back with a metering record ID. */
function acceptEverything() {
  meteringSend.mockImplementation(async (command: { input: { UsageRecords: SentRecord[] } }) => ({
    Results: command.input.UsageRecords.map((record, index) => ({
      UsageRecord: record,
      MeteringRecordId: `record-${index}`,
      Status: 'Success',
    })),
    UnprocessedRecords: [],
  }))
}

async function createOrganization(): Promise<{ organizationId: string; userId: string }> {
  const userId = generateId()
  userIds.push(userId)
  await db.insert(user).values({
    id: userId,
    name: 'Metering fixture',
    email: `${userId}@example.test`,
    emailVerified: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  })
  const organizationId = generateId()
  organizationIds.push(organizationId)
  await db.insert(organization).values({
    id: organizationId,
    name: 'Metered org',
    slug: organizationId,
    createdAt: new Date(),
  })
  return { organizationId, userId }
}

async function insertLicense(
  organizationId: string,
  overrides: Partial<typeof awsMarketplaceLicense.$inferInsert> = {}
) {
  const id = generateId()
  licenseIds.push(id)
  const licenseArn = `arn:aws:license-manager::000000000000:license:l-${id}`
  await db.insert(awsMarketplaceLicense).values({
    id,
    licenseArn,
    productCode: USAGE_PRODUCT,
    customerAwsAccountId: ACCOUNT,
    status: 'active',
    dimension: 'platform',
    organizationId,
    organizationLinkedAt: new Date(NOW - 5 * HOUR_MS),
    lastVerifiedAt: new Date(),
    lastVerificationAttemptAt: new Date(),
    ...overrides,
  })
  return { id, licenseArn }
}

async function logUsage(
  owner: { organizationId: string; userId: string },
  input: {
    at: Date
    cost: number
    category?: 'model' | 'model_unbilled' | 'tool'
    period?: { start: Date; end: Date }
  }
): Promise<string> {
  const id = generateId()
  const period = input.period ?? PERIOD
  await db.insert(usageLog).values({
    id,
    userId: owner.userId,
    category: input.category ?? 'model',
    source: 'workflow',
    description: 'metering fixture',
    cost: input.cost.toString(),
    billingEntityType: 'organization',
    billingEntityId: owner.organizationId,
    billingPeriodStart: period.start,
    billingPeriodEnd: period.end,
    createdAt: input.at,
  })
  return id
}

async function reportsFor(organizationId: string) {
  return db
    .select()
    .from(awsMarketplaceUsageReport)
    .where(eq(awsMarketplaceUsageReport.organizationId, organizationId))
    .orderBy(asc(awsMarketplaceUsageReport.hourStart))
}

/** Charges the usage now, then sends it once its hour has closed. */
async function chargeAndSend() {
  await meterAwsMarketplaceUsage(NOW)
  await meterAwsMarketplaceUsage(NEXT_HOUR)
}

beforeEach(() => {
  meteringSend.mockReset()
  acceptEverything()
})

afterEach(async () => {
  if (licenseIds.length) {
    await db
      .delete(awsMarketplaceLicense)
      .where(inArray(awsMarketplaceLicense.id, licenseIds.splice(0)))
  }
  if (organizationIds.length) {
    await db.delete(organization).where(inArray(organization.id, organizationIds.splice(0)))
  }
  if (userIds.length) await db.delete(user).where(inArray(user.id, userIds.splice(0)))
})

describe('AWS Marketplace usage metering', () => {
  it('charges whole credits during the hour, carrying fractions, and sends once the hour closes', async () => {
    const owner = await createOrganization()
    const { licenseArn } = await insertLicense(owner.organizationId)
    await logUsage(owner, { at: minutesAgo(30), cost: 0.015 })
    await logUsage(owner, { at: minutesAgo(10), cost: 0.01 })

    await meterAwsMarketplaceUsage(NOW)
    await logUsage(owner, { at: minutesAgo(1), cost: 0.006 })
    await meterAwsMarketplaceUsage(NOW + 5 * 60_000)

    expect(sentRecords(licenseArn)).toEqual([])
    expect(await reportsFor(owner.organizationId)).toEqual([
      expect.objectContaining({ hourStart: HOUR, quantity: 3, status: 'pending' }),
    ])

    await meterAwsMarketplaceUsage(NEXT_HOUR)

    expect(sentRecords(licenseArn)).toEqual([
      {
        LicenseArn: licenseArn,
        CustomerAWSAccountId: ACCOUNT,
        Dimension: 'llm_credits',
        Quantity: 3,
        Timestamp: HOUR,
        productCode: undefined,
      },
    ])
    expect(await reportsFor(owner.organizationId)).toEqual([
      expect.objectContaining({ status: 'reported', meteringRecordId: 'record-0' }),
    ])
  })

  it('charges cost raised in place after it was first counted', async () => {
    const owner = await createOrganization()
    await insertLicense(owner.organizationId)
    const usageId = await logUsage(owner, { at: minutesAgo(30), cost: 0.02 })
    await chargeAndSend()

    await db.update(usageLog).set({ cost: '0.05' }).where(eq(usageLog.id, usageId))
    await meterAwsMarketplaceUsage(NEXT_HOUR + 5 * 60_000)

    expect(await reportsFor(owner.organizationId)).toEqual([
      expect.objectContaining({ hourStart: HOUR, quantity: 2, status: 'reported' }),
      expect.objectContaining({ hourStart: floorHour(NEXT_HOUR), quantity: 3, status: 'pending' }),
    ])
  })

  it('never charges bring-your-own-key or tool usage, or usage from before the link', async () => {
    const owner = await createOrganization()
    await insertLicense(owner.organizationId, { organizationLinkedAt: minutesAgo(30) })
    await logUsage(owner, { at: minutesAgo(40), cost: 5 })
    await logUsage(owner, { at: minutesAgo(20), cost: 7, category: 'model_unbilled' })
    await logUsage(owner, { at: minutesAgo(15), cost: 9, category: 'tool' })
    await logUsage(owner, { at: minutesAgo(10), cost: 0.03 })

    await meterAwsMarketplaceUsage(NOW)

    expect(await reportsFor(owner.organizationId)).toEqual([
      expect.objectContaining({ quantity: 3 }),
    ])
  })

  it('charges usage once however often it runs', async () => {
    const owner = await createOrganization()
    await insertLicense(owner.organizationId)
    await logUsage(owner, { at: minutesAgo(10), cost: 0.5 })

    await meterAwsMarketplaceUsage(NOW)
    await meterAwsMarketplaceUsage(NOW + 60_000)
    await meterAwsMarketplaceUsage(NOW + 2 * 60_000)

    expect(await reportsFor(owner.organizationId)).toEqual([
      expect.objectContaining({ quantity: 50 }),
    ])
  })

  it('charges the earliest-linked license in force, skipping one past its expiry', async () => {
    const owner = await createOrganization()
    const expired = await insertLicense(owner.organizationId, {
      organizationLinkedAt: new Date(NOW - 9 * HOUR_MS),
      expiresAt: minutesAgo(5),
    })
    const earlier = await insertLicense(owner.organizationId, {
      organizationLinkedAt: new Date(NOW - 8 * HOUR_MS),
    })
    const later = await insertLicense(owner.organizationId, {
      organizationLinkedAt: new Date(NOW - 7 * HOUR_MS),
    })
    await logUsage(owner, { at: minutesAgo(10), cost: 0.07 })

    await chargeAndSend()

    expect(sentRecords(earlier.licenseArn)).toEqual([expect.objectContaining({ Quantity: 7 })])
    expect(sentRecords(expired.licenseArn)).toEqual([])
    expect(sentRecords(later.licenseArn)).toEqual([])
  })

  it('meters nothing for a contract-only listing', async () => {
    const owner = await createOrganization()
    await insertLicense(owner.organizationId, { productCode: CONTRACT_PRODUCT })
    await logUsage(owner, { at: minutesAgo(10), cost: 4 })

    await chargeAndSend()

    expect(await reportsFor(owner.organizationId)).toEqual([])
  })

  it('flushes an ended license once, at the hour it ended, even with no expiry from AWS', async () => {
    const owner = await createOrganization()
    const endedAt = minutesAgo(10)
    const { licenseArn } = await insertLicense(owner.organizationId, {
      status: 'inactive',
      expiresAt: null,
      endedAt,
    })
    await logUsage(owner, { at: minutesAgo(15), cost: 0.02 })

    await meterAwsMarketplaceUsage(NOW)

    expect(sentRecords(licenseArn)).toEqual([
      expect.objectContaining({ Quantity: 2, Timestamp: floorHour(endedAt.getTime()) }),
    ])

    await logUsage(owner, { at: minutesAgo(1), cost: 3 })
    await meterAwsMarketplaceUsage(NOW + 5 * 60_000)

    expect(sentRecords(licenseArn)).toHaveLength(1)
    expect(await reportsFor(owner.organizationId)).toEqual([
      expect.objectContaining({ quantity: 2, status: 'reported' }),
    ])
  })

  it('starts billing a linked license with no link time from the first run that sees it', async () => {
    const owner = await createOrganization()
    const { id } = await insertLicense(owner.organizationId, { organizationLinkedAt: null })
    await logUsage(owner, { at: minutesAgo(10), cost: 5 })

    await meterAwsMarketplaceUsage(NOW)
    const [stamped] = await db
      .select({ at: awsMarketplaceLicense.organizationLinkedAt })
      .from(awsMarketplaceLicense)
      .where(eq(awsMarketplaceLicense.id, id))
    await logUsage(owner, { at: new Date(NOW + 1000), cost: 0.04 })
    await meterAwsMarketplaceUsage(NOW + 60_000)

    expect(stamped?.at).toEqual(new Date(NOW))
    expect((await reportsFor(owner.organizationId)).map((row) => row.quantity)).toEqual([4])
  })

  it('keeps counting a period while a long run can still raise its rows, and leaves a settled one alone', async () => {
    const owner = await createOrganization()
    await insertLicense(owner.organizationId, { organizationLinkedAt: new Date(NOW - 70 * DAY_MS) })
    const justEnded = { start: new Date(NOW - 31 * DAY_MS), end: new Date(NOW - 3 * DAY_MS) }
    const longEnded = { start: new Date(NOW - 62 * DAY_MS), end: new Date(NOW - 31 * DAY_MS) }
    await logUsage(owner, { at: new Date(NOW - 4 * DAY_MS), cost: 0.04, period: justEnded })
    await logUsage(owner, { at: new Date(NOW - 35 * DAY_MS), cost: 9, period: longEnded })

    await meterAwsMarketplaceUsage(NOW)

    expect((await reportsFor(owner.organizationId)).map((row) => row.quantity)).toEqual([4])
    const tallies = await db
      .select({ periodStart: awsMarketplaceUsageTally.periodStart })
      .from(awsMarketplaceUsageTally)
      .where(eq(awsMarketplaceUsageTally.organizationId, owner.organizationId))
    expect(tallies).toEqual([{ periodStart: justEnded.start }])
  })

  it('keeps unprocessed records for the next run and rejects records for an unsubscribed customer', async () => {
    const retried = await createOrganization()
    const refused = await createOrganization()
    const retriedLicense = await insertLicense(retried.organizationId)
    const refusedLicense = await insertLicense(refused.organizationId)
    await logUsage(retried, { at: minutesAgo(10), cost: 0.01 })
    await logUsage(refused, { at: minutesAgo(10), cost: 0.01 })
    await meterAwsMarketplaceUsage(NOW)
    meteringSend.mockImplementation(async (command: { input: { UsageRecords: SentRecord[] } }) => ({
      Results: command.input.UsageRecords.filter(
        (record) => record.LicenseArn === refusedLicense.licenseArn
      ).map((record) => ({ UsageRecord: record, Status: 'CustomerNotSubscribed' })),
      UnprocessedRecords: command.input.UsageRecords.filter(
        (record) => record.LicenseArn === retriedLicense.licenseArn
      ),
    }))

    await meterAwsMarketplaceUsage(NEXT_HOUR)

    expect(await reportsFor(retried.organizationId)).toEqual([
      expect.objectContaining({ status: 'pending' }),
    ])
    expect(await reportsFor(refused.organizationId)).toEqual([
      expect.objectContaining({ status: 'rejected', error: 'CustomerNotSubscribed' }),
    ])

    acceptEverything()
    await meterAwsMarketplaceUsage(NEXT_HOUR + 5 * 60_000)

    expect(await reportsFor(retried.organizationId)).toEqual([
      expect.objectContaining({ status: 'reported' }),
    ])
    expect(sentRecords(retriedLicense.licenseArn)).toHaveLength(2)
    expect(sentRecords(refusedLicense.licenseArn)).toHaveLength(1)
  })

  it('rejects a license AWS refuses outright and retries one a transient failure stopped', async () => {
    const refused = await createOrganization()
    const throttled = await createOrganization()
    const refusedLicense = await insertLicense(refused.organizationId)
    const throttledLicense = await insertLicense(throttled.organizationId)
    await logUsage(refused, { at: minutesAgo(10), cost: 0.01 })
    await logUsage(throttled, { at: minutesAgo(10), cost: 0.01 })
    await meterAwsMarketplaceUsage(NOW)
    meteringSend.mockImplementation(async (command: { input: { UsageRecords: SentRecord[] } }) => {
      const arn = command.input.UsageRecords[0]?.LicenseArn
      if (arn !== refusedLicense.licenseArn && arn !== throttledLicense.licenseArn) {
        return { Results: [], UnprocessedRecords: [] }
      }
      const error = new Error('refused')
      error.name =
        arn === refusedLicense.licenseArn ? 'InvalidLicenseException' : 'ThrottlingException'
      throw error
    })

    await meterAwsMarketplaceUsage(NEXT_HOUR)

    expect(await reportsFor(refused.organizationId)).toEqual([
      expect.objectContaining({ status: 'rejected', error: 'InvalidLicenseException' }),
    ])
    expect(await reportsFor(throttled.organizationId)).toEqual([
      expect.objectContaining({ status: 'pending' }),
    ])
  })

  it('rejects a pending record once it is older than AWS accepts', async () => {
    const owner = await createOrganization()
    const { licenseArn } = await insertLicense(owner.organizationId)
    await logUsage(owner, { at: minutesAgo(10), cost: 0.01 })
    await meterAwsMarketplaceUsage(NOW)
    meteringSend.mockResolvedValue({ Results: [], UnprocessedRecords: [] })
    await meterAwsMarketplaceUsage(NEXT_HOUR)
    meteringSend.mockClear()

    await meterAwsMarketplaceUsage(NOW + 25 * HOUR_MS)

    expect(await reportsFor(owner.organizationId)).toEqual([
      expect.objectContaining({ status: 'rejected', error: expect.stringMatching(/window/) }),
    ])
    expect(sentRecords(licenseArn)).toEqual([])
  })

  it('resends a record at the quantity first sent, keeping later usage off it', async () => {
    const owner = await createOrganization()
    const { licenseArn } = await insertLicense(owner.organizationId, {
      status: 'inactive',
      expiresAt: null,
      endedAt: minutesAgo(10),
    })
    await logUsage(owner, { at: minutesAgo(15), cost: 0.02 })
    meteringSend.mockRejectedValueOnce(
      Object.assign(new Error('timed out'), { name: 'TimeoutError' })
    )

    await meterAwsMarketplaceUsage(NOW)
    await logUsage(owner, { at: minutesAgo(1), cost: 3 })
    await meterAwsMarketplaceUsage(NOW + 5 * 60_000)

    expect(sentRecords(licenseArn).map((record) => record.Quantity)).toEqual([2, 2])
    expect(await reportsFor(owner.organizationId)).toEqual([
      expect.objectContaining({ quantity: 2, status: 'reported' }),
    ])
  })

  it('rejects only the record whose timestamp AWS finds out of range', async () => {
    const owner = await createOrganization()
    const { licenseArn } = await insertLicense(owner.organizationId)
    const earlierHour = floorHour(NOW - 2 * HOUR_MS)
    await logUsage(owner, { at: minutesAgo(130), cost: 0.01 })
    await meterAwsMarketplaceUsage(NOW - 2 * HOUR_MS)
    await logUsage(owner, { at: minutesAgo(10), cost: 0.02 })
    meteringSend.mockResolvedValue({ Results: [], UnprocessedRecords: [] })
    await meterAwsMarketplaceUsage(NOW)
    acceptEverything()
    const accept = meteringSend.getMockImplementation()
    meteringSend.mockImplementation(async (command: { input: { UsageRecords: SentRecord[] } }) => {
      if (
        command.input.UsageRecords.some(
          (record) => record.Timestamp?.getTime() === earlierHour.getTime()
        )
      ) {
        throw Object.assign(new Error('out of range'), { name: 'TimestampOutOfBoundsException' })
      }
      return accept?.(command)
    })

    await meterAwsMarketplaceUsage(NEXT_HOUR)

    expect(await reportsFor(owner.organizationId)).toEqual([
      expect.objectContaining({
        hourStart: earlierHour,
        status: 'rejected',
        error: 'TimestampOutOfBoundsException',
      }),
      expect.objectContaining({ hourStart: HOUR, quantity: 2, status: 'reported' }),
    ])
    expect(sentRecords(licenseArn).at(-1)).toEqual(expect.objectContaining({ Timestamp: HOUR }))
  })

  it("sends last month's records until the month-end grace passes, then rejects them", async () => {
    const owner = await createOrganization()
    const today = new Date(NOW)
    const monthStart = Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 1)
    const period = {
      start: new Date(monthStart - 10 * DAY_MS),
      end: new Date(monthStart + 20 * DAY_MS),
    }
    const { licenseArn } = await insertLicense(owner.organizationId, {
      organizationLinkedAt: new Date(monthStart - 5 * HOUR_MS),
    })
    const lastHourOfMonth = new Date(monthStart - HOUR_MS)
    await logUsage(owner, { at: new Date(monthStart - 50 * 60_000), cost: 0.01, period })
    await meterAwsMarketplaceUsage(monthStart - 30 * 60_000)
    meteringSend.mockResolvedValue({ Results: [], UnprocessedRecords: [] })

    await meterAwsMarketplaceUsage(monthStart + 5 * HOUR_MS)

    expect(sentRecords(licenseArn)).toEqual([
      expect.objectContaining({ Timestamp: lastHourOfMonth }),
    ])

    meteringSend.mockClear()
    await meterAwsMarketplaceUsage(monthStart + 7 * HOUR_MS)

    expect(sentRecords(licenseArn)).toEqual([])
    expect(await reportsFor(owner.organizationId)).toEqual([
      expect.objectContaining({
        hourStart: lastHourOfMonth,
        status: 'rejected',
        error: expect.stringMatching(/window/),
      }),
    ])
  })

  it('flushes a license at its expiry before any check marks it inactive', async () => {
    const owner = await createOrganization()
    const expiresAt = minutesAgo(30)
    const { licenseArn } = await insertLicense(owner.organizationId, { expiresAt })
    await logUsage(owner, { at: minutesAgo(35), cost: 0.03 })

    await meterAwsMarketplaceUsage(NOW)

    expect(sentRecords(licenseArn)).toEqual([
      expect.objectContaining({ Quantity: 3, Timestamp: floorHour(expiresAt.getTime()) }),
    ])
  })

  it('still sends usage already charged after its organization is deleted', async () => {
    const owner = await createOrganization()
    const { id, licenseArn } = await insertLicense(owner.organizationId)
    await logUsage(owner, { at: minutesAgo(10), cost: 0.02 })
    await meterAwsMarketplaceUsage(NOW)

    await db.delete(organization).where(eq(organization.id, owner.organizationId))
    await meterAwsMarketplaceUsage(NEXT_HOUR)

    expect(sentRecords(licenseArn)).toEqual([expect.objectContaining({ Quantity: 2 })])
    expect(
      await db
        .select({ status: awsMarketplaceUsageReport.status })
        .from(awsMarketplaceUsageReport)
        .where(eq(awsMarketplaceUsageReport.licenseId, id))
    ).toEqual([{ status: 'reported' }])
  })
})
