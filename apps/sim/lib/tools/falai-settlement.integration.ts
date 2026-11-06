/**
 * The fal exact-cost settlement against a real usage ledger: a shortfall is billed once however
 * often the settlement runs, and nothing is billed until fal records the charge. Only fal's
 * billing-events API is stubbed.
 */
import { db } from '@sim/db'
import { organization, usageLog, user, userStats } from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import { eq, inArray } from 'drizzle-orm'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { type FalAICostSettlementPayload, settleFalAICost } from '@/lib/tools/falai-settlement'

const HOSTED_KEY_ENV_VAR = 'FALAI_API_KEY_1'
const userIds: string[] = []
const organizationIds: string[] = []

async function createUser(): Promise<string> {
  const id = `falai-settlement-user-${generateId()}`
  const now = new Date()
  await db.insert(user).values({
    id,
    name: 'Fal Settlement Test',
    email: `${id}@falai-settlement.test`,
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(userStats).values({ id: generateId(), userId: id })
  userIds.push(id)
  return id
}

async function createOrganization(): Promise<string> {
  const id = `falai-settlement-org-${generateId()}`
  await db.insert(organization).values({ id, name: 'Fal Settlement Org', slug: id })
  organizationIds.push(id)
  return id
}

/** A settlement billed to an organization payer, the snapshot shape for a run outside a workspace. */
function payloadFor(
  userId: string,
  organizationId: string,
  billedProviderCostDollars: number,
  billingPeriod = { start: '2026-11-01T00:00:00.000Z', end: '2026-12-01T00:00:00.000Z' }
): FalAICostSettlementPayload {
  return {
    envVarName: HOSTED_KEY_ENV_VAR,
    endpointId: 'bytedance/seedance-2.5/text-to-video',
    requestId: `fal-request-${generateId()}`,
    billedProviderCostDollars,
    markupMultiplier: 1.5,
    ledger: {
      source: 'workflow',
      billingAttribution: {
        actorUserId: userId,
        workspaceId: null,
        organizationId,
        billedAccountUserId: userId,
        billingEntity: { type: 'organization', id: organizationId },
        billingPeriod,
        payerSubscription: null,
      },
    },
  }
}

/** fal's billing-events API answering with the charge for `requestId`, or with none yet. */
function stubFalBillingEvents(charge: { requestId: string; costDollars: number } | null) {
  const fetchMock = vi.fn(async () =>
    Response.json({
      billing_events: charge
        ? [
            {
              request_id: charge.requestId,
              endpoint_id: 'bytedance/seedance-2.5/text-to-video',
              output_units: 700,
              unit_price: 0.0214,
              percent_discount: null,
              cost_estimate_nano_usd: Math.round(charge.costDollars * 1_000_000_000),
            },
          ]
        : [],
    })
  )
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

async function settlementRows(userId: string) {
  return db
    .select({
      cost: usageLog.cost,
      description: usageLog.description,
      source: usageLog.source,
      billingPeriodEnd: usageLog.billingPeriodEnd,
    })
    .from(usageLog)
    .where(eq(usageLog.userId, userId))
}

beforeEach(() => {
  vi.stubEnv(HOSTED_KEY_ENV_VAR, 'hosted-fixture-key')
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

afterAll(async () => {
  if (userIds.length > 0) {
    await db.delete(usageLog).where(inArray(usageLog.userId, userIds))
    await db.delete(user).where(inArray(user.id, userIds))
  }
  if (organizationIds.length > 0) {
    await db.delete(organization).where(inArray(organization.id, organizationIds))
  }
})

describe('settleFalAICost', () => {
  it('bills the shortfall once when the exact charge exceeds the estimate, however often it runs', async () => {
    const userId = await createUser()
    const organizationId = await createOrganization()
    const payload = payloadFor(userId, organizationId, 6.49)
    stubFalBillingEvents({ requestId: payload.requestId, costDollars: 15 })

    expect(await settleFalAICost(payload)).toBe('charged')
    expect(await settleFalAICost(payload)).toBe('charged')

    const rows = await settlementRows(userId)
    expect(rows).toHaveLength(1)
    expect(Number(rows[0].cost)).toBeCloseTo((15 - 6.49) * 1.5, 6)
    expect(rows[0]).toMatchObject({
      source: 'workflow',
      description: 'fal exact cost settlement: bytedance/seedance-2.5/text-to-video',
    })
  })

  it('bills a settlement that outlives its billing period to the payer current period', async () => {
    const userId = await createUser()
    const organizationId = await createOrganization()
    const endedPeriod = { start: '2026-01-01T00:00:00.000Z', end: '2026-02-01T00:00:00.000Z' }
    const payload = payloadFor(userId, organizationId, 6.49, endedPeriod)
    stubFalBillingEvents({ requestId: payload.requestId, costDollars: 15 })

    expect(await settleFalAICost(payload)).toBe('charged')

    const rows = await settlementRows(userId)
    expect(rows).toHaveLength(1)
    expect(rows[0].billingPeriodEnd?.getTime()).toBeGreaterThan(Date.now())
  })

  it('bills nothing while fal has not recorded the charge', async () => {
    const userId = await createUser()
    const organizationId = await createOrganization()
    stubFalBillingEvents(null)

    expect(await settleFalAICost(payloadFor(userId, organizationId, 0.25))).toBe('pending')

    expect(await settlementRows(userId)).toHaveLength(0)
  })

  it('refuses to settle when the hosted key that ran the request is not configured', async () => {
    const userId = await createUser()
    const organizationId = await createOrganization()
    vi.stubEnv(HOSTED_KEY_ENV_VAR, '')
    const fetchMock = stubFalBillingEvents(null)

    await expect(settleFalAICost(payloadFor(userId, organizationId, 6.49))).rejects.toThrow(
      'Hosted fal key FALAI_API_KEY_1 is not configured'
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
