import { deleteWorkspaceFixture, insertWorkspaceFixture } from '@sim/db/testing/workspace-fixtures'
import { createDeferred } from '@sim/testing/helpers/deferred'
import { sleep } from '@sim/utils/helpers'
import { generateId } from '@sim/utils/id'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

/** The credential page's access table proposes a whole member list, which applies all or nothing. */
describe('Replacing credential access in PostgreSQL', () => {
  const actorId = generateId()
  const readerId = generateId()
  const writerId = generateId()
  const outsiderId = generateId()
  const leaverId = generateId()
  const workspaceId = generateId()
  const credentialId = generateId()
  const principal = { kind: 'session' as const, userId: actorId, sessionId: generateId() }
  let runtime: Awaited<ReturnType<typeof loadRuntime>>

  async function loadRuntime() {
    const [{ db }, schema, { and, eq, inArray, sql }, useCases] = await Promise.all([
      import('@sim/db'),
      import('@sim/db/schema'),
      import('drizzle-orm'),
      import('@/lib/credentials/application/members'),
    ])
    return { db, schema, and, eq, inArray, sql, ...useCases }
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

  function setMembers(members: { userId: string; role: 'admin' | 'member' }[]) {
    return runtime.setCredentialMembersUseCase.execute({
      principal,
      input: { credentialId, assertedWorkspaceId: workspaceId, members },
    })
  }

  beforeAll(async () => {
    runtime = await loadRuntime()
    const { db, schema } = runtime
    await db.insert(schema.user).values(
      [actorId, readerId, writerId, outsiderId, leaverId].map((id) => ({
        id,
        name: id,
        email: `${id}@set-members.test`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      }))
    )
    await insertWorkspaceFixture(db, {
      id: workspaceId,
      name: 'Set members test',
      ownerId: actorId,
      billedAccountUserId: actorId,
    })
    await db.insert(schema.permissions).values(
      (
        [
          [actorId, 'admin'],
          [readerId, 'read'],
          [writerId, 'write'],
          [leaverId, 'write'],
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
      displayName: 'Set members test',
      providerId: 'google-service-account',
      createdBy: actorId,
    })
  }, 30_000)

  beforeEach(async () => {
    const { db, schema, eq } = runtime
    await db
      .delete(schema.credentialMember)
      .where(eq(schema.credentialMember.credentialId, credentialId))
    await db.insert(schema.credentialMember).values(
      (
        [
          [actorId, 'admin'],
          [readerId, 'member'],
        ] as const
      ).map(([userId, role]) => ({
        id: generateId(),
        credentialId,
        userId,
        role,
        status: 'active' as const,
        joinedAt: new Date(),
        invitedBy: actorId,
        createdAt: new Date(),
        updatedAt: new Date(),
      }))
    )
  })

  afterAll(async () => {
    if (!runtime) return
    const { db, schema, eq, inArray } = runtime
    await deleteWorkspaceFixture(db, eq(schema.workspace.id, workspaceId))
    await db
      .delete(schema.user)
      .where(inArray(schema.user.id, [actorId, readerId, writerId, outsiderId, leaverId]))
  })

  it('applies nothing when one proposed person is outside the workspace', async () => {
    await expect(
      setMembers([
        { userId: actorId, role: 'admin' },
        { userId: readerId, role: 'admin' },
        { userId: writerId, role: 'member' },
        { userId: outsiderId, role: 'member' },
      ])
    ).rejects.toMatchObject({ code: 'validation' })
    expect(await grants()).toEqual({ [actorId]: 'active:admin', [readerId]: 'active:member' })
  })

  it('grants, changes and revokes together in one change', async () => {
    const result = await setMembers([
      { userId: actorId, role: 'admin' },
      { userId: writerId, role: 'admin' },
    ])
    expect(result).toEqual({
      added: [{ userId: writerId, role: 'admin' }],
      roleChanged: [],
      removed: [readerId],
    })
    expect(await grants()).toEqual({
      [actorId]: 'active:admin',
      [readerId]: 'revoked:member',
      [writerId]: 'active:admin',
    })
    await setMembers([
      { userId: actorId, role: 'admin' },
      { userId: writerId, role: 'member' },
      { userId: readerId, role: 'member' },
    ])
    expect(await grants()).toEqual({
      [actorId]: 'active:admin',
      [readerId]: 'active:member',
      [writerId]: 'active:member',
    })
  })

  it('leaves a workspace admin’s unlisted grant in place', async () => {
    await setMembers([{ userId: readerId, role: 'member' }])
    expect(await grants()).toEqual({ [actorId]: 'active:admin', [readerId]: 'active:member' })
  })

  it('keeps the last explicit admin', async () => {
    const { db, schema, eq } = runtime
    await db.delete(schema.credentialMember).where(eq(schema.credentialMember.userId, actorId))
    await db
      .update(schema.credentialMember)
      .set({ role: 'admin' })
      .where(eq(schema.credentialMember.userId, readerId))
    await expect(setMembers([{ userId: writerId, role: 'member' }])).rejects.toMatchObject({
      code: 'validation',
    })
    expect(await grants()).toEqual({ [readerId]: 'active:admin' })
  })

  it('refuses a person removed from the workspace while the change waited for the credential', async () => {
    const { db, schema, and, eq, sql } = runtime
    const holding = createDeferred<number>()
    const release = createDeferred<void>()
    const remover = db.transaction(async (tx) => {
      await tx
        .select({ id: schema.credential.id })
        .from(schema.credential)
        .where(eq(schema.credential.id, credentialId))
        .for('update')
      const [{ pid }] = await tx.execute<{ pid: number }>(sql`SELECT pg_backend_pid() AS pid`)
      holding.resolve(pid)
      await release.promise
      await tx
        .delete(schema.permissions)
        .where(
          and(eq(schema.permissions.userId, leaverId), eq(schema.permissions.entityId, workspaceId))
        )
    })
    const removerPid = await holding.promise

    const change = setMembers([
      { userId: actorId, role: 'admin' },
      { userId: leaverId, role: 'member' },
    ])
    change.catch(() => {})
    let waiting = false
    const deadline = Date.now() + 5_000
    while (!waiting && Date.now() < deadline) {
      const [blocked] = await db.execute<{ waiting: boolean }>(sql`
        SELECT EXISTS (
          SELECT 1 FROM pg_stat_activity
          WHERE ${removerPid} = ANY(pg_blocking_pids(pid)) AND wait_event_type = 'Lock'
        ) AS waiting
      `)
      waiting = blocked.waiting
      if (!waiting) await sleep(5)
    }
    expect(waiting, 'The change must wait for the credential lock').toBe(true)
    release.resolve()
    await remover

    await expect(change).rejects.toMatchObject({ code: 'validation' })
    expect(await grants()).toEqual({ [actorId]: 'active:admin', [readerId]: 'active:member' })
  })
})
