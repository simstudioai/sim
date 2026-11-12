import { db } from '@sim/db'
import {
  awsMarketplaceLicense,
  awsMarketplaceUsageReport,
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

/** Twenty minutes into an hour, so the previous hour has settled and this one has not. */
const NOW = Math.floor(Date.now() / HOUR_MS) * HOUR_MS + 20 * 60 * 1000
const CURRENT_HOUR = Math.floor(NOW / HOUR_MS) * HOUR_MS
const hoursAgo = (hours: number) => new Date(CURRENT_HOUR - hours * HOUR_MS)
const minutesInto = (hour: Date, minutes: number) => new Date(hour.getTime() + minutes * 60_000)

const userIds: string[] = []
const organizationIds: string[] = []

/** Every record sent so far, with the request's top-level product code alongside. */
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
  const licenseArn = `arn:aws:license-manager::000000000000:license:l-${id}`
  await db.insert(awsMarketplaceLicense).values({
    id,
    licenseArn,
    productCode: USAGE_PRODUCT,
    customerAwsAccountId: ACCOUNT,
    status: 'active',
    dimension: 'platform',
    organizationId,
    organizationLinkedAt: hoursAgo(10),
    lastVerifiedAt: new Date(),
    lastVerificationAttemptAt: new Date(),
    ...overrides,
  })
  return { id, licenseArn }
}

async function logUsage(
  owner: { organizationId: string; userId: string },
  at: Date,
  cost: number,
  category: 'model' | 'model_unbilled' | 'tool' = 'model'
) {
  await db.insert(usageLog).values({
    id: generateId(),
    userId: owner.userId,
    category,
    source: 'workflow',
    description: 'metering fixture',
    cost: cost.toString(),
    billingEntityType: 'organization',
    billingEntityId: owner.organizationId,
    billingPeriodStart: new Date(at.getTime() - 30 * 24 * HOUR_MS),
    billingPeriodEnd: new Date(at.getTime() + 30 * 24 * HOUR_MS),
    createdAt: at,
  })
}

async function reportsFor(organizationId: string) {
  return db
    .select()
    .from(awsMarketplaceUsageReport)
    .where(eq(awsMarketplaceUsageReport.organizationId, organizationId))
    .orderBy(asc(awsMarketplaceUsageReport.hourStart))
}

beforeEach(() => {
  meteringSend.mockReset()
  acceptEverything()
})

afterEach(async () => {
  if (organizationIds.length) {
    await db.delete(organization).where(inArray(organization.id, organizationIds.splice(0)))
  }
  if (userIds.length) await db.delete(user).where(inArray(user.id, userIds.splice(0)))
})

describe('AWS Marketplace usage metering', () => {
  it('bills each settled hour of billed model usage in whole credits, carrying fractions forward', async () => {
    const owner = await createOrganization()
    const { licenseArn } = await insertLicense(owner.organizationId)
    await logUsage(owner, minutesInto(hoursAgo(3), 5), 0.01)
    await logUsage(owner, minutesInto(hoursAgo(3), 40), 0.005)
    await logUsage(owner, minutesInto(hoursAgo(2), 10), 0.015)
    await logUsage(owner, minutesInto(hoursAgo(1), 59), 1.2345)

    await meterAwsMarketplaceUsage(NOW)

    expect(sentRecords(licenseArn)).toEqual([
      {
        LicenseArn: licenseArn,
        CustomerAWSAccountId: ACCOUNT,
        Dimension: 'llm_credits',
        Quantity: 1,
        Timestamp: hoursAgo(3),
        productCode: undefined,
      },
      expect.objectContaining({ Quantity: 2, Timestamp: hoursAgo(2) }),
      expect.objectContaining({ Quantity: 123, Timestamp: hoursAgo(1) }),
    ])
    expect(await reportsFor(owner.organizationId)).toEqual([
      expect.objectContaining({
        status: 'reported',
        quantityThrough: 1,
        costThroughUsd: '0.015000',
      }),
      expect.objectContaining({
        status: 'reported',
        quantityThrough: 3,
        costThroughUsd: '0.030000',
      }),
      expect.objectContaining({
        status: 'reported',
        quantityThrough: 126,
        costThroughUsd: '1.264500',
      }),
    ])
  })

  it('never bills bring-your-own-key or tool usage, usage before the link, or an unsettled hour', async () => {
    const owner = await createOrganization()
    const { licenseArn } = await insertLicense(owner.organizationId, {
      organizationLinkedAt: minutesInto(hoursAgo(2), 30),
    })
    await logUsage(owner, minutesInto(hoursAgo(2), 10), 5)
    await logUsage(owner, minutesInto(hoursAgo(2), 45), 0.03)
    await logUsage(owner, minutesInto(hoursAgo(1), 5), 7, 'model_unbilled')
    await logUsage(owner, minutesInto(hoursAgo(1), 6), 9, 'tool')
    await logUsage(owner, minutesInto(hoursAgo(0), 1), 11)

    await meterAwsMarketplaceUsage(NOW)

    expect(sentRecords(licenseArn)).toEqual([
      expect.objectContaining({ Quantity: 3, Timestamp: hoursAgo(2) }),
    ])
  })

  it('bills an hour once, however often it runs', async () => {
    const owner = await createOrganization()
    const { licenseArn } = await insertLicense(owner.organizationId)
    await logUsage(owner, minutesInto(hoursAgo(1), 5), 0.5)

    await meterAwsMarketplaceUsage(NOW)
    await meterAwsMarketplaceUsage(NOW + 5 * 60_000)

    expect(sentRecords(licenseArn)).toHaveLength(1)
    expect(await reportsFor(owner.organizationId)).toHaveLength(1)
  })

  it('bills an hour shared by two licenses of one organization to the earlier-linked one only', async () => {
    const owner = await createOrganization()
    const earlier = await insertLicense(owner.organizationId, { organizationLinkedAt: hoursAgo(9) })
    const later = await insertLicense(owner.organizationId, { organizationLinkedAt: hoursAgo(8) })
    await logUsage(owner, minutesInto(hoursAgo(1), 5), 0.07)

    await meterAwsMarketplaceUsage(NOW)

    expect(sentRecords(earlier.licenseArn)).toEqual([expect.objectContaining({ Quantity: 7 })])
    expect(sentRecords(later.licenseArn)).toEqual([])
  })

  it('meters nothing for a contract-only listing', async () => {
    const owner = await createOrganization()
    const { licenseArn } = await insertLicense(owner.organizationId, {
      productCode: CONTRACT_PRODUCT,
    })
    await logUsage(owner, minutesInto(hoursAgo(1), 5), 4)

    await meterAwsMarketplaceUsage(NOW)

    expect(sentRecords(licenseArn)).toEqual([])
    expect(await reportsFor(owner.organizationId)).toEqual([])
  })

  it('bills a lapsed license up to its expiry, partial hour included, and nothing after', async () => {
    const owner = await createOrganization()
    const expiresAt = minutesInto(hoursAgo(1), 20)
    const { licenseArn } = await insertLicense(owner.organizationId, {
      status: 'inactive',
      expiresAt,
    })
    await logUsage(owner, minutesInto(hoursAgo(1), 10), 0.02)
    await logUsage(owner, minutesInto(hoursAgo(1), 30), 3)

    await meterAwsMarketplaceUsage(NOW)

    expect(sentRecords(licenseArn)).toEqual([
      expect.objectContaining({ Quantity: 2, Timestamp: hoursAgo(1) }),
    ])
  })

  it('keeps unprocessed records for the next run and rejects records for an unsubscribed customer', async () => {
    const retried = await createOrganization()
    const refused = await createOrganization()
    const retriedLicense = await insertLicense(retried.organizationId)
    const refusedLicense = await insertLicense(refused.organizationId)
    await logUsage(retried, minutesInto(hoursAgo(1), 5), 0.01)
    await logUsage(refused, minutesInto(hoursAgo(1), 5), 0.01)
    meteringSend.mockImplementation(async (command: { input: { UsageRecords: SentRecord[] } }) => ({
      Results: command.input.UsageRecords.filter(
        (record) => record.LicenseArn === refusedLicense.licenseArn
      ).map((record) => ({ UsageRecord: record, Status: 'CustomerNotSubscribed' })),
      UnprocessedRecords: command.input.UsageRecords.filter(
        (record) => record.LicenseArn === retriedLicense.licenseArn
      ),
    }))

    await meterAwsMarketplaceUsage(NOW)

    expect(await reportsFor(retried.organizationId)).toEqual([
      expect.objectContaining({ status: 'pending' }),
    ])
    expect(await reportsFor(refused.organizationId)).toEqual([
      expect.objectContaining({ status: 'rejected', error: 'CustomerNotSubscribed' }),
    ])

    acceptEverything()
    await meterAwsMarketplaceUsage(NOW + 5 * 60_000)

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
    await logUsage(refused, minutesInto(hoursAgo(1), 5), 0.01)
    await logUsage(throttled, minutesInto(hoursAgo(1), 5), 0.01)
    meteringSend.mockImplementation(async (command: { input: { UsageRecords: SentRecord[] } }) => {
      const arn = command.input.UsageRecords[0]?.LicenseArn
      const error = new Error('refused')
      error.name =
        arn === refusedLicense.licenseArn ? 'InvalidLicenseException' : 'ThrottlingException'
      if (arn === refusedLicense.licenseArn || arn === throttledLicense.licenseArn) throw error
      return { Results: [], UnprocessedRecords: [] }
    })

    await meterAwsMarketplaceUsage(NOW)

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
    await logUsage(owner, minutesInto(hoursAgo(1), 5), 0.01)
    meteringSend.mockResolvedValue({ Results: [], UnprocessedRecords: [] })
    await meterAwsMarketplaceUsage(NOW)
    meteringSend.mockClear()

    await meterAwsMarketplaceUsage(NOW + 25 * HOUR_MS)

    expect(await reportsFor(owner.organizationId)).toEqual([
      expect.objectContaining({ status: 'rejected', error: expect.stringMatching(/24 hours/) }),
    ])
    expect(sentRecords(licenseArn)).toEqual([])
  })
})
