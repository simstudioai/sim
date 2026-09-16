/**
 * @vitest-environment node
 */
import { auditMock } from '@sim/testing/mocks/audit.mock'
import { envFlagsMock } from '@sim/testing/mocks/env-flags.mock'
import { generateId } from '@sim/utils/id'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.unmock('@sim/db')
vi.unmock('@sim/db/schema')
vi.unmock('drizzle-orm')
vi.mock('@sim/audit', () => auditMock)
vi.mock('@/lib/core/config/env-flags', () => ({
  ...envFlagsMock,
  isHosted: true,
  isScimEnabled: true,
  isBillingEnabled: true,
}))

/** Admission and billing entitlement use PostgreSQL; post-commit integrations are outside this regression. */
vi.mock('@/lib/auth/session-policy', () => ({ applySessionPolicyToNewMember: vi.fn() }))
vi.mock('@/lib/billing/core/usage', () => ({ syncUsageLimitsFromSubscription: vi.fn() }))
vi.mock('@/lib/billing/organizations/seats', () => ({ reconcileOrganizationSeats: vi.fn() }))
vi.mock('@/lib/posthog/server', () => ({ captureServerEvent: vi.fn() }))

const databaseUrl = process.env.OAUTH_TOKEN_FAMILY_TEST_DATABASE_URL

async function loadRuntime() {
  const [{ db }, schema, { eq, inArray }, { admitSsoUser }] = await Promise.all([
    import('@sim/db'),
    import('@sim/db/schema'),
    import('drizzle-orm'),
    import('@/lib/auth/sso/application/admit-sso-user'),
  ])
  return { db, schema, eq, inArray, admitSsoUser }
}

describe.skipIf(!databaseUrl)('SSO admission with a hosted SCIM directory in PostgreSQL', () => {
  let runtime: Awaited<ReturnType<typeof loadRuntime>>
  let organizationId: string
  let ownerId: string
  let userId: string
  let providerId: string
  let connectionId: string

  beforeAll(async () => {
    process.env.DATABASE_URL = databaseUrl
    runtime = await loadRuntime()
  }, 30_000)

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.stubEnv('DB_TX_TRIPWIRE', 'throw')
    organizationId = generateId()
    ownerId = generateId()
    userId = generateId()
    providerId = generateId()
    connectionId = generateId()
    const { db, schema } = runtime
    const now = new Date()
    await db.insert(schema.organization).values({
      id: organizationId,
      name: 'SCIM SSO admission test',
      slug: organizationId,
      createdAt: now,
    })
    await db.insert(schema.user).values(
      [ownerId, userId].map((id) => ({
        id,
        name: 'SCIM SSO admission test',
        email: `${id}@scim-sso.test`,
        emailVerified: true,
        createdAt: now,
        updatedAt: now,
      }))
    )
    await db.insert(schema.member).values({
      id: generateId(),
      userId: ownerId,
      organizationId,
      role: 'owner',
    })
    await db.insert(schema.userStats).values({
      id: generateId(),
      userId: ownerId,
      billingBlocked: false,
    })
    await db.insert(schema.subscription).values({
      id: generateId(),
      plan: 'enterprise',
      referenceId: organizationId,
      status: 'active',
      seats: 50,
      metadata: { plan: 'enterprise', referenceId: organizationId, seats: 50, monthlyPrice: 100 },
      periodStart: now,
      periodEnd: new Date(now.getTime() + 86_400_000),
    })
    await db.insert(schema.ssoProvider).values({
      id: generateId(),
      providerId,
      organizationId,
      userId: ownerId,
      issuer: 'https://idp.scim-sso.test',
      domain: 'scim-sso.test',
      domainVerified: true,
      jitProvisioningEnabled: true,
    })
    await db.insert(schema.account).values({
      id: generateId(),
      accountId: userId,
      providerId,
      userId,
      createdAt: now,
      updatedAt: now,
    })
    await db.insert(schema.scimConnection).values({
      id: connectionId,
      organizationId,
      status: 'active',
      settings: { disableJit: true },
    })
  })

  afterEach(async () => {
    const { db, schema, eq, inArray } = runtime
    await db.delete(schema.subscription).where(eq(schema.subscription.referenceId, organizationId))
    await db.delete(schema.organization).where(eq(schema.organization.id, organizationId))
    await db.delete(schema.user).where(inArray(schema.user.id, [ownerId, userId]))
  })

  async function admit() {
    return runtime.admitSsoUser.execute({
      principal: { kind: 'session', userId, sessionId: generateId() },
      input: { providerId },
    })
  }

  async function membership() {
    const { db, schema, eq } = runtime
    return db
      .select({ id: schema.member.id, role: schema.member.role })
      .from(schema.member)
      .where(eq(schema.member.userId, userId))
  }

  it('honors disableJit without a global billing read creating fresh membership', async () => {
    await expect(admit()).resolves.toEqual({ kind: 'provisioning-disabled', organizationId })
    expect(await membership()).toEqual([])
  })

  it('allows an existing member without changing their role or membership', async () => {
    const { db, schema } = runtime
    const memberId = generateId()
    await db.insert(schema.member).values({ id: memberId, userId, organizationId, role: 'admin' })

    await expect(admit()).resolves.toEqual({ kind: 'already-member', organizationId, memberId })
    expect(await membership()).toEqual([{ id: memberId, role: 'admin' }])
  })

  it('resumes normal JIT admission when the directory permits automatic membership', async () => {
    const { db, schema, eq } = runtime
    await db
      .update(schema.scimConnection)
      .set({ settings: { disableJit: false } })
      .where(eq(schema.scimConnection.id, connectionId))

    const result = await admit()
    expect(result).toMatchObject({ kind: 'provisioned', organizationId })
    expect(await membership()).toEqual([{ id: expect.any(String), role: 'member' }])
  })
})
