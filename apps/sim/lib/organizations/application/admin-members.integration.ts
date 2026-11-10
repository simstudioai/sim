/**
 * The Admin API's organization-member operations against real PostgreSQL: only the deployment's
 * admin key may list or add members, so even the organization's own owner, signed in, is refused
 * before anything is read or written; the key reaches no operation that does not name it, and what
 * it does is audited as the Admin API rather than as any user.
 */
import { AuditAction } from '@sim/audit'
import type { AdminApiKeyPrincipal, SessionPrincipal } from '@sim/auth/principal'
import { db } from '@sim/db'
import { auditLog, member, organization, user } from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import { and, eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  addAdminOrganizationMember,
  listAdminOrganizationMembers,
} from '@/lib/organizations/application/admin-members'
import { updateOrganizationMember } from '@/lib/organizations/application/members'

const organizationId = generateId()
const ownerId = `admin-members-owner-${generateId()}`
const refusedTargetId = `admin-members-refused-${generateId()}`
const addedTargetId = `admin-members-added-${generateId()}`
const userIds = [ownerId, refusedTargetId, addedTargetId]

const adminPrincipal: AdminApiKeyPrincipal = { kind: 'admin_api_key' }
const ownerSession: SessionPrincipal = {
  kind: 'session',
  userId: ownerId,
  sessionId: `session-${generateId()}`,
}

async function membershipOf(userId: string) {
  return db
    .select({ id: member.id, role: member.role })
    .from(member)
    .where(and(eq(member.userId, userId), eq(member.organizationId, organizationId)))
}

beforeAll(async () => {
  const now = new Date()
  await db.insert(user).values(
    userIds.map((id) => ({
      id,
      name: id,
      email: `${id}@admin-members.test`,
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    }))
  )
  await db.insert(organization).values({
    id: organizationId,
    name: 'Admin members fixture',
    slug: organizationId,
    createdAt: now,
  })
  await db
    .insert(member)
    .values({ id: generateId(), userId: ownerId, organizationId, role: 'owner' })
})

afterAll(async () => {
  await db.delete(auditLog).where(eq(auditLog.resourceId, organizationId))
  await db.delete(organization).where(eq(organization.id, organizationId))
  await db.delete(user).where(inArray(user.id, userIds))
})

describe('Admin API organization member operations', () => {
  it("refuses the organization's own owner, holding a session, before adding anyone", async () => {
    await expect(
      addAdminOrganizationMember.execute({
        principal: ownerSession,
        input: { organizationId, userId: refusedTargetId, role: 'member' },
      })
    ).rejects.toThrow('admin.organizations.members.add reached by principal kind session')

    expect(await membershipOf(refusedTargetId)).toEqual([])
  })

  it("refuses the organization's own owner, holding a session, the member listing", async () => {
    await expect(
      listAdminOrganizationMembers.execute({
        principal: ownerSession,
        input: { organizationId, limit: 50, offset: 0 },
      })
    ).rejects.toThrow('admin.organizations.members.list reached by principal kind session')
  })

  it('adds and lists the member for the admin key', async () => {
    const added = await addAdminOrganizationMember.execute({
      principal: adminPrincipal,
      input: { organizationId, userId: addedTargetId, role: 'admin' },
    })

    expect(added).toMatchObject({ action: 'created', role: 'admin' })
    expect(await membershipOf(addedTargetId)).toEqual([{ id: added.memberId, role: 'admin' }])
    const listed = await listAdminOrganizationMembers.execute({
      principal: adminPrincipal,
      input: { organizationId, limit: 50, offset: 0 },
    })
    expect(listed.total).toBe(2)
    expect(listed.members.map((row) => row.userId).sort()).toEqual([addedTargetId, ownerId].sort())
    await vi.waitFor(
      async () => {
        const [entry] = await db
          .select({ actorId: auditLog.actorId, actorName: auditLog.actorName })
          .from(auditLog)
          .where(
            and(
              eq(auditLog.resourceId, organizationId),
              eq(auditLog.action, AuditAction.ORG_MEMBER_ADDED)
            )
          )
        expect(entry).toEqual({ actorId: null, actorName: 'Admin API' })
      },
      { timeout: 5_000 }
    )
  })

  it('refuses the admin key on a member operation that does not name it, changing nothing', async () => {
    await expect(
      updateOrganizationMember.execute({
        principal: adminPrincipal,
        input: { organizationId, userId: ownerId, role: 'member' },
      })
    ).rejects.toThrow(
      'Principal kind admin_api_key cannot perform operation organizations.members.update'
    )

    expect(await membershipOf(ownerId)).toEqual([{ id: expect.any(String), role: 'owner' }])
  })
})
