/**
 * @vitest-environment node
 */
import { envFlagsMock } from '@sim/testing/mocks/env-flags.mock'
import { generateId } from '@sim/utils/id'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.unmock('@sim/db')
vi.unmock('@sim/db/schema')
vi.unmock('drizzle-orm')
vi.mock('@/lib/core/config/env-flags', () => ({
  ...envFlagsMock,
  isHosted: true,
  isScimEnabled: true,
  isBillingEnabled: true,
}))

const databaseUrl = process.env.OAUTH_TOKEN_FAMILY_TEST_DATABASE_URL

async function loadRuntime() {
  const [{ db }, schema, { eq, inArray, sql }, { alias }, membership, entitlement] =
    await Promise.all([
      import('@sim/db'),
      import('@sim/db/schema'),
      import('drizzle-orm'),
      import('drizzle-orm/pg-core'),
      import('@/ee/scim/lib/managed-membership'),
      import('@/ee/scim/lib/entitlement'),
    ])
  return { db, schema, eq, inArray, sql, alias, ...membership, ...entitlement }
}

describe.skipIf(!databaseUrl)('SCIM managed membership in PostgreSQL', () => {
  let runtime: Awaited<ReturnType<typeof loadRuntime>>
  let orgId: string
  let otherOrgId: string
  let connectionId: string
  let managedUserId: string
  let unmanagedUserId: string
  let managedEmail: string

  beforeAll(async () => {
    process.env.DATABASE_URL = databaseUrl
    runtime = await loadRuntime()
  }, 30_000)

  beforeEach(async () => {
    vi.stubEnv('DB_TX_TRIPWIRE', 'throw')
    orgId = generateId()
    otherOrgId = generateId()
    connectionId = generateId()
    managedUserId = generateId()
    unmanagedUserId = generateId()
    managedEmail = `${managedUserId}@scim-membership.test`
    const { db, schema } = runtime
    const now = new Date()
    await db.insert(schema.organization).values(
      [orgId, otherOrgId].map((id) => ({
        id,
        name: 'SCIM predicate test',
        slug: id,
        createdAt: now,
      }))
    )
    await db.insert(schema.user).values(
      [managedUserId, unmanagedUserId].map((id) => ({
        id,
        name: 'SCIM predicate test',
        email: `${id}@scim-membership.test`,
        emailVerified: true,
        createdAt: now,
        updatedAt: now,
      }))
    )
    await db.insert(schema.subscription).values({
      id: generateId(),
      plan: 'enterprise',
      referenceId: orgId,
      status: 'active',
      seats: 50,
      metadata: { plan: 'enterprise', referenceId: orgId, seats: 50, monthlyPrice: 100 },
      periodStart: now,
      periodEnd: new Date(now.getTime() + 86_400_000),
    })
    await db.insert(schema.scimConnection).values({
      id: connectionId,
      organizationId: orgId,
      status: 'active',
      settings: { lockManualMembership: true },
    })
    await db.insert(schema.scimUser).values({
      id: generateId(),
      connectionId,
      userId: managedUserId,
      userName: managedEmail,
      orderKey: managedUserId,
      attributes: {
        userName: managedEmail,
        active: true,
        displayName: 'Managed user',
        name: { formatted: 'Managed user' },
        emails: [{ value: managedEmail, primary: true, type: 'work' }],
      },
    })
  })

  afterEach(async () => {
    const { db, schema, eq, inArray } = runtime
    await db.delete(schema.subscription).where(eq(schema.subscription.referenceId, orgId))
    await db.delete(schema.organization).where(inArray(schema.organization.id, [orgId, otherOrgId]))
    await db.delete(schema.user).where(inArray(schema.user.id, [managedUserId, unmanagedUserId]))
  })

  async function invitee(organizationId: string, email: string) {
    const { db, schema, sql, scimManagedUserPredicate } = runtime
    const [row] = await db
      .select({
        id: schema.user.id,
        managed: scimManagedUserPredicate(organizationId, schema.user.id),
      })
      .from(schema.user)
      .where(sql`lower(${schema.user.email}) = ${email}`)
    return row
  }

  it('correlates the invitation lookup to its outer user without ambiguous inner join columns', async () => {
    expect(await invitee(orgId, managedEmail)).toEqual({ id: managedUserId, managed: true })
    expect(await invitee(orgId, `${unmanagedUserId}@scim-membership.test`)).toEqual({
      id: unmanagedUserId,
      managed: false,
    })
    expect(await invitee(otherOrgId, managedEmail)).toEqual({ id: managedUserId, managed: false })
  })

  it.each(['invited_user', 'invited"user'])(
    'qualifies an aliased outer table named %s',
    async (name) => {
      const { db, schema, alias, eq, scimManagedUserPredicate } = runtime
      const invited = alias(schema.user, name)
      const rows = await db
        .select({ id: invited.id, managed: scimManagedUserPredicate(orgId, invited.id) })
        .from(invited)
        .where(eq(invited.id, managedUserId))
      expect(rows).toEqual([{ id: managedUserId, managed: true }])
    }
  )

  it.each([
    { status: 'disabled', settings: { lockManualMembership: true } },
    { status: 'active', settings: { lockManualMembership: false } },
    { status: 'active', settings: {} },
  ])('allows edits when the connection is $status with $settings', async ({ status, settings }) => {
    const { db, schema, eq, assertMembershipNotScimManaged } = runtime
    await db
      .update(schema.scimConnection)
      .set({ status, settings })
      .where(eq(schema.scimConnection.id, connectionId))
    expect(await invitee(orgId, managedEmail)).toEqual({ id: managedUserId, managed: false })
    await expect(
      db.transaction((executor) =>
        assertMembershipNotScimManaged({ organizationId: orgId, userId: managedUserId, executor })
      )
    ).resolves.toBeUndefined()
  })

  it('runs the permission guard and hosted entitlement through the same transaction', async () => {
    const { db, assertMembershipNotScimManaged } = runtime
    await expect(
      db.transaction((executor) =>
        assertMembershipNotScimManaged({ organizationId: orgId, userId: managedUserId, executor })
      )
    ).rejects.toMatchObject({ detailCode: 'SCIM_MANAGED_MEMBERSHIP' })
    for (const input of [
      { organizationId: orgId, userId: unmanagedUserId },
      { organizationId: otherOrgId, userId: managedUserId },
      { organizationId: orgId, userId: "' OR true --" },
    ]) {
      await expect(
        db.transaction((executor) => assertMembershipNotScimManaged({ ...input, executor }))
      ).resolves.toBeUndefined()
    }
  })

  it('allows a previously managed member when the real Enterprise subscription has ended', async () => {
    const { db, schema, eq, assertMembershipNotScimManaged } = runtime
    await db
      .update(schema.subscription)
      .set({ status: 'canceled' })
      .where(eq(schema.subscription.referenceId, orgId))
    await expect(
      db.transaction((executor) =>
        assertMembershipNotScimManaged({ organizationId: orgId, userId: managedUserId, executor })
      )
    ).resolves.toBeUndefined()
  })

  it('propagates a real billing query failure without relaxing directory policy', async () => {
    const { db, sql, isScimEntitledForOrganization } = runtime
    await expect(
      db.transaction(async (executor) => {
        await executor.execute(sql`set local search_path to pg_catalog`)
        await isScimEntitledForOrganization(orgId, executor)
      })
    ).rejects.toMatchObject({ cause: { code: '42P01' } })
  })
})
