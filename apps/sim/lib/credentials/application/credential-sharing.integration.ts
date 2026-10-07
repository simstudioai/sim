import { generateId } from '@sim/utils/id'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

/** Public sharing must obey the same workspace and credential grants as the UI. */
describe('Credential sharing through user-held API credentials in PostgreSQL', () => {
  const actorId = generateId()
  const readerId = generateId()
  const outsiderId = generateId()
  const orgAdminId = generateId()
  const workspaceId = generateId()
  const organizationId = generateId()
  const credentialId = generateId()
  const principal = { kind: 'personal_api_key' as const, userId: actorId, keyId: generateId() }
  let runtime: Awaited<ReturnType<typeof loadRuntime>>

  async function loadRuntime() {
    const [{ db }, schema, { and, eq, inArray }, useCases] = await Promise.all([
      import('@sim/db'),
      import('@sim/db/schema'),
      import('drizzle-orm'),
      import('@/lib/credentials/application/credential-members'),
    ])
    return { db, schema, and, eq, inArray, ...useCases }
  }

  beforeAll(async () => {
    runtime = await loadRuntime()
    const { db, schema } = runtime
    await db.insert(schema.user).values(
      [actorId, readerId, outsiderId, orgAdminId].map((id) => ({
        id,
        name: id,
        email: `${id}@sharing.test`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      }))
    )
    await db.insert(schema.organization).values({
      id: organizationId,
      name: 'Sharing test',
      slug: organizationId,
      createdAt: new Date(),
    })
    await db.insert(schema.member).values({
      id: generateId(),
      userId: orgAdminId,
      organizationId,
      role: 'admin',
      createdAt: new Date(),
    })
    await db.insert(schema.workspace).values({
      id: workspaceId,
      name: 'Sharing test',
      ownerId: actorId,
      organizationId,
      billedAccountUserId: actorId,
    })
    await db.insert(schema.permissions).values(
      [actorId, readerId].map((userId) => ({
        id: generateId(),
        userId,
        entityType: 'workspace' as const,
        entityId: workspaceId,
        permissionType: userId === actorId ? ('admin' as const) : ('read' as const),
      }))
    )
    await db.insert(schema.credential).values({
      id: credentialId,
      workspaceId,
      type: 'service_account',
      displayName: 'Sharing test',
      providerId: 'google-service-account',
      createdBy: actorId,
    })
  }, 30_000)

  beforeEach(async () => {
    const { db, schema, eq } = runtime
    await db
      .delete(schema.credentialMember)
      .where(eq(schema.credentialMember.credentialId, credentialId))
  })

  afterAll(async () => {
    if (!runtime) return
    const { db, schema, eq, inArray } = runtime
    await db.delete(schema.workspace).where(eq(schema.workspace.id, workspaceId))
    await db.delete(schema.organization).where(eq(schema.organization.id, organizationId))
    await db
      .delete(schema.user)
      .where(inArray(schema.user.id, [actorId, readerId, outsiderId, orgAdminId]))
  })

  it('grants, changes, and revokes explicit membership with the acting API user', async () => {
    const input = { credentialId, assertedWorkspaceId: workspaceId, userId: readerId }
    await runtime.upsertCredentialMemberUseCase.execute({
      principal,
      input: { ...input, role: 'member' },
    })
    const { db, schema, and, eq } = runtime
    const [added] = await db
      .select()
      .from(schema.credentialMember)
      .where(
        and(
          eq(schema.credentialMember.credentialId, credentialId),
          eq(schema.credentialMember.userId, readerId)
        )
      )
    expect(added).toMatchObject({ status: 'active', role: 'member', invitedBy: actorId })
    const changed = await runtime.upsertCredentialMemberUseCase.execute({
      principal,
      input: { ...input, role: 'admin' },
    })
    expect(changed).toMatchObject({ created: false, previousRole: 'member' })
    await runtime.removeCredentialMemberUseCase.execute({ principal, input })
    const [removed] = await db
      .select()
      .from(schema.credentialMember)
      .where(eq(schema.credentialMember.id, added.id))
    expect(removed).toMatchObject({ status: 'revoked', role: 'admin' })
  })

  it('denies workspace keys before looking up a credential', async () => {
    await expect(
      runtime.upsertCredentialMemberUseCase.execute({
        principal: { kind: 'workspace_api_key', workspaceId, keyId: generateId() },
        input: { credentialId: generateId(), userId: readerId, role: 'admin' },
      })
    ).rejects.toMatchObject({ detailCode: 'WORKSPACE_KEY_OPERATION_NOT_PERMITTED' })
  })

  it('conceals another tenant and rejects mismatched workspace assertions', async () => {
    await expect(
      runtime.upsertCredentialMemberUseCase.execute({
        principal: { ...principal, userId: outsiderId },
        input: { credentialId, userId: readerId, role: 'admin' },
      })
    ).rejects.toMatchObject({ name: 'NoWorkspaceAccessError' })
    await expect(
      runtime.upsertCredentialMemberUseCase.execute({
        principal,
        input: { credentialId, assertedWorkspaceId: generateId(), userId: readerId, role: 'admin' },
      })
    ).rejects.toMatchObject({ code: 'not_found' })
  })

  it('rejects outsiders and protects inherited administrator grants', async () => {
    await expect(
      runtime.upsertCredentialMemberUseCase.execute({
        principal,
        input: { credentialId, userId: outsiderId, role: 'member' },
      })
    ).rejects.toMatchObject({ code: 'validation' })
    await expect(
      runtime.upsertCredentialMemberUseCase.execute({
        principal,
        input: { credentialId, userId: orgAdminId, role: 'member' },
      })
    ).rejects.toMatchObject({ code: 'validation' })
  })

  it('paginates explicit and inherited members without losing or repeating a user', async () => {
    await runtime.upsertCredentialMemberUseCase.execute({
      principal,
      input: { credentialId, assertedWorkspaceId: workspaceId, userId: readerId, role: 'member' },
    })
    const seen: string[] = []
    let cursorKeys: (string | number)[] | undefined
    for (let page = 0; page < 10; page++) {
      const result = await runtime.listCredentialMembersUseCase.execute({
        principal,
        input: {
          credentialId,
          assertedWorkspaceId: workspaceId,
          limit: 1,
          sortBy: 'email',
          sortOrder: 'asc',
          cursorKeys,
        },
      })
      expect(result.members).toHaveLength(1)
      seen.push(result.members[0].userId)
      if (!result.nextCursorKeys) break
      cursorKeys = result.nextCursorKeys
    }
    expect(seen).toHaveLength(new Set(seen).size)
    expect(new Set(seen)).toEqual(new Set([actorId, readerId, orgAdminId]))
  })

  it('concurrent first grants converge on one active member instead of a server error', async () => {
    const { db, schema, and, eq } = runtime
    await db
      .delete(schema.credentialMember)
      .where(
        and(
          eq(schema.credentialMember.credentialId, credentialId),
          eq(schema.credentialMember.userId, readerId)
        )
      )
    const input = {
      credentialId,
      assertedWorkspaceId: workspaceId,
      userId: readerId,
      role: 'member' as const,
    }
    const results = await Promise.all(
      Array.from({ length: 4 }, () =>
        runtime.upsertCredentialMemberUseCase.execute({ principal, input })
      )
    )
    expect(results.filter((result) => result.created)).toHaveLength(1)
    const rows = await db
      .select()
      .from(schema.credentialMember)
      .where(
        and(
          eq(schema.credentialMember.credentialId, credentialId),
          eq(schema.credentialMember.userId, readerId)
        )
      )
    expect(rows).toHaveLength(1)
    expect(rows[0].status).toBe('active')
  })
})
