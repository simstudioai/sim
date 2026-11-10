import { deleteWorkspaceFixture, insertWorkspaceFixture } from '@sim/db/testing/workspace-fixtures'
import { generateId } from '@sim/utils/id'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

/**
 * The Add people dialog grants several people one role in a single request. Failure modes: one
 * person outside the workspace blocking everyone else, a refused person granted anyway, a viewer
 * without credential admin granting access, and the outcome per person living only in the client.
 */
describe('Adding people to a credential in PostgreSQL', () => {
  const actorId = generateId()
  const readerId = generateId()
  const writerId = generateId()
  const adminId = generateId()
  const outsiderId = generateId()
  const workspaceId = generateId()
  const credentialId = generateId()
  const people = [actorId, readerId, writerId, adminId, outsiderId]
  const principalFor = (userId: string) => ({
    kind: 'session' as const,
    userId,
    sessionId: generateId(),
  })
  let runtime: Awaited<ReturnType<typeof loadRuntime>>

  async function loadRuntime() {
    const [{ db }, schema, { eq, inArray }, useCases] = await Promise.all([
      import('@sim/db'),
      import('@sim/db/schema'),
      import('drizzle-orm'),
      import('@/lib/credentials/application/members'),
    ])
    return { db, schema, eq, inArray, ...useCases }
  }

  async function grants() {
    const { db, schema, eq } = runtime
    const rows = await db
      .select({
        userId: schema.credentialMember.userId,
        role: schema.credentialMember.role,
        status: schema.credentialMember.status,
      })
      .from(schema.credentialMember)
      .where(eq(schema.credentialMember.credentialId, credentialId))
    return Object.fromEntries(rows.map((row) => [row.userId, `${row.status}:${row.role}`]))
  }

  function addMembers(userIds: string[], role: 'admin' | 'member', actor = actorId) {
    return runtime.addCredentialMembersUseCase.execute({
      principal: principalFor(actor),
      input: { credentialId, assertedWorkspaceId: workspaceId, userIds, role },
    })
  }

  beforeAll(async () => {
    runtime = await loadRuntime()
    const { db, schema } = runtime
    await db.insert(schema.user).values(
      people.map((id) => ({
        id,
        name: id,
        email: `${id}@add-members.test`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      }))
    )
    await insertWorkspaceFixture(db, {
      id: workspaceId,
      name: 'Add members test',
      ownerId: actorId,
      billedAccountUserId: actorId,
    })
    await db.insert(schema.permissions).values(
      (
        [
          [actorId, 'admin'],
          [readerId, 'read'],
          [writerId, 'write'],
          [adminId, 'admin'],
        ] as const
      ).map(([userId, permissionType]) => ({
        id: generateId(),
        userId,
        entityType: 'workspace' as const,
        entityId: workspaceId,
        permissionType,
      }))
    )
    await db.insert(schema.credential).values({
      id: credentialId,
      workspaceId,
      type: 'service_account',
      displayName: 'Add members test',
      providerId: 'google-service-account',
      createdBy: actorId,
    })
  }, 30_000)

  beforeEach(async () => {
    const { db, schema, eq } = runtime
    await db
      .delete(schema.credentialMember)
      .where(eq(schema.credentialMember.credentialId, credentialId))
    await db.insert(schema.credentialMember).values({
      id: generateId(),
      credentialId,
      userId: actorId,
      role: 'admin',
      status: 'active',
      joinedAt: new Date(),
      invitedBy: actorId,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
  })

  afterAll(async () => {
    if (!runtime) return
    const { db, schema, eq, inArray } = runtime
    await deleteWorkspaceFixture(db, eq(schema.workspace.id, workspaceId))
    await db.delete(schema.user).where(inArray(schema.user.id, people))
  })

  it('grants everyone it can and reports each refusal with its reason', async () => {
    const result = await addMembers([readerId, outsiderId, writerId, adminId, readerId], 'member')
    expect(result.added.sort()).toEqual([readerId, writerId].sort())
    expect(result.refused).toEqual([
      { userId: outsiderId, reason: 'Target user must belong to the credential workspace' },
      {
        userId: adminId,
        reason: 'Workspace admins are automatically credential admins and cannot be demoted',
      },
    ])
    expect(await grants()).toEqual({
      [actorId]: 'active:admin',
      [readerId]: 'active:member',
      [writerId]: 'active:member',
    })
  })

  it('changes an existing role and leaves a matching grant untouched', async () => {
    await addMembers([readerId], 'member')
    const result = await addMembers([readerId, writerId, actorId], 'admin')
    expect(result.roleChanged).toEqual([{ userId: readerId, fromRole: 'member', toRole: 'admin' }])
    expect(result.added).toEqual([writerId])
    expect(result.unchanged).toEqual([actorId])
    expect(await grants()).toEqual({
      [actorId]: 'active:admin',
      [readerId]: 'active:admin',
      [writerId]: 'active:admin',
    })
  })

  it('refuses a viewer who is not a credential admin and writes nothing', async () => {
    await expect(addMembers([writerId], 'member', readerId)).rejects.toBeTruthy()
    expect(await grants()).toEqual({ [actorId]: 'active:admin' })
  })
})
