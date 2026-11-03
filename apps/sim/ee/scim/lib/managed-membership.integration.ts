import { envFlagsMock } from '@sim/testing/mocks/env-flags.mock'
import { generateId } from '@sim/utils/id'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/core/config/env-flags', () => ({
  ...envFlagsMock,
  isHosted: true,
  isScimEnabled: true,
  isBillingEnabled: true,
}))

async function loadRuntime() {
  const [{ db }, schema, { and, eq, inArray, sql }, { alias }, membership, entitlement] =
    await Promise.all([
      import('@sim/db'),
      import('@sim/db/schema'),
      import('drizzle-orm'),
      import('drizzle-orm/pg-core'),
      import('@/ee/scim/lib/managed-membership'),
      import('@/ee/scim/lib/entitlement'),
    ])
  const [
    { removeOrganizationMemberRecord },
    { removeUserFromOrganization, transferOrganizationOwnership },
  ] = await Promise.all([
    import('@/lib/organizations/member-manager'),
    import('@/lib/billing/organizations/membership'),
  ])
  return {
    db,
    schema,
    and,
    eq,
    inArray,
    sql,
    alias,
    removeOrganizationMemberRecord,
    removeUserFromOrganization,
    transferOrganizationOwnership,
    ...membership,
    ...entitlement,
  }
}

describe('SCIM managed membership in PostgreSQL', () => {
  let runtime: Awaited<ReturnType<typeof loadRuntime>>
  let orgId: string
  let otherOrgId: string
  let connectionId: string
  let managedUserId: string
  let unmanagedUserId: string
  let adminUserId: string
  let managedEmail: string

  beforeAll(async () => {
    runtime = await loadRuntime()
  }, 30_000)

  beforeEach(async () => {
    vi.stubEnv('DB_TX_TRIPWIRE', 'throw')
    orgId = generateId()
    otherOrgId = generateId()
    connectionId = generateId()
    managedUserId = generateId()
    unmanagedUserId = generateId()
    adminUserId = generateId()
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
      [managedUserId, unmanagedUserId, adminUserId].map((id) => ({
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
    await db
      .delete(schema.user)
      .where(inArray(schema.user.id, [managedUserId, unmanagedUserId, adminUserId]))
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

  describe('removing a member', () => {
    beforeEach(async () => {
      const { db, schema } = runtime
      await db.insert(schema.member).values([
        { id: generateId(), organizationId: orgId, userId: adminUserId, role: 'owner' },
        { id: generateId(), organizationId: orgId, userId: managedUserId, role: 'member' },
        { id: generateId(), organizationId: orgId, userId: unmanagedUserId, role: 'member' },
      ])
    })

    async function isMember(userId: string) {
      const { db, schema, and, eq } = runtime
      const rows = await db
        .select({ id: schema.member.id })
        .from(schema.member)
        .where(and(eq(schema.member.organizationId, orgId), eq(schema.member.userId, userId)))
      return rows.length > 0
    }

    it('refuses a managed member leaving on their own and keeps the membership', async () => {
      const { removeOrganizationMemberRecord } = runtime
      await expect(
        removeOrganizationMemberRecord({
          organizationId: orgId,
          userId: managedUserId,
          actorUserId: managedUserId,
        })
      ).rejects.toMatchObject({
        detailCode: 'SCIM_MANAGED_MEMBERSHIP',
        message: expect.stringContaining('Ask your identity provider administrator'),
      })
      expect(await isMember(managedUserId)).toBe(true)
    })

    it('lets an administrator remove the same managed member', async () => {
      const { removeOrganizationMemberRecord } = runtime
      await expect(
        removeOrganizationMemberRecord({
          organizationId: orgId,
          userId: managedUserId,
          actorUserId: adminUserId,
        })
      ).resolves.toMatchObject({ membershipType: 'internal' })
      expect(await isMember(managedUserId)).toBe(false)
    })

    it('lets an unmanaged member leave on their own', async () => {
      const { removeOrganizationMemberRecord } = runtime
      await expect(
        removeOrganizationMemberRecord({
          organizationId: orgId,
          userId: unmanagedUserId,
          actorUserId: unmanagedUserId,
        })
      ).resolves.toMatchObject({ membershipType: 'internal' })
      expect(await isMember(unmanagedUserId)).toBe(false)
    })
  })

  describe('transferring ownership', () => {
    beforeEach(async () => {
      const { db, schema } = runtime
      await db.insert(schema.member).values([
        { id: generateId(), organizationId: orgId, userId: managedUserId, role: 'owner' },
        { id: generateId(), organizationId: orgId, userId: adminUserId, role: 'member' },
      ])
    })

    async function roleOf(userId: string) {
      const { db, schema, and, eq } = runtime
      const [row] = await db
        .select({ role: schema.member.role })
        .from(schema.member)
        .where(and(eq(schema.member.organizationId, orgId), eq(schema.member.userId, userId)))
      return row?.role
    }

    it('transfers a managed owner’s ownership but keeps them as admin when they try to leave', async () => {
      const { db, schema, and, eq, transferOrganizationOwnership, removeUserFromOrganization } =
        runtime
      await expect(
        transferOrganizationOwnership({
          organizationId: orgId,
          currentOwnerUserId: managedUserId,
          newOwnerUserId: adminUserId,
        })
      ).resolves.toMatchObject({ success: true })
      const [previousOwner] = await db
        .select({ id: schema.member.id })
        .from(schema.member)
        .where(
          and(eq(schema.member.organizationId, orgId), eq(schema.member.userId, managedUserId))
        )
      await expect(
        removeUserFromOrganization({
          userId: managedUserId,
          organizationId: orgId,
          memberId: previousOwner.id,
          actorUserId: managedUserId,
        })
      ).resolves.toMatchObject({
        success: false,
        refusalCode: 'SCIM_MANAGED_MEMBERSHIP',
        error: expect.stringContaining('Ask your identity provider administrator'),
      })
      expect(await roleOf(managedUserId)).toBe('admin')
      expect(await roleOf(adminUserId)).toBe('owner')
    })

    it('lets a managed owner transfer ownership and stay', async () => {
      const { transferOrganizationOwnership } = runtime
      await expect(
        transferOrganizationOwnership({
          organizationId: orgId,
          currentOwnerUserId: managedUserId,
          newOwnerUserId: adminUserId,
        })
      ).resolves.toMatchObject({ success: true })
      expect(await roleOf(managedUserId)).toBe('admin')
      expect(await roleOf(adminUserId)).toBe('owner')
    })
  })
})
