import { db } from '@sim/db'
import {
  account,
  apiKey,
  chat,
  copilotChats,
  document,
  environment,
  folder,
  knowledgeBase,
  member,
  organization,
  permissionGroup,
  permissions,
  projectWorkspace,
  ssoProvider,
  user,
  userTableDefinitions,
  userTableRows,
  workflow,
  workflowMcpServer,
  workspace,
  workspaceFile,
  workspaceFiles,
  workspaceFileVersion,
} from '@sim/db/schema'
import { readTestDatabaseUrl } from '@sim/db/testing/test-infrastructure'
import { deleteWorkspaceFixture, insertWorkspaceFixture } from '@sim/db/testing/workspace-fixtures'
import { createDeferred } from '@sim/testing/helpers/deferred'
import { generateId } from '@sim/utils/id'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { afterAll, describe, expect, it } from 'vitest'
import { removeUserFromOrganization } from '@/lib/billing/organizations/membership'
import { deleteUserAccount, getAccountDeletionPlan } from '@/lib/users/account-deletion'
import { revokeWorkspaceAccessTx } from '@/lib/workspaces/access/workspace-access'

readTestDatabaseUrl()

const userIds: string[] = []
const workspaceIds: string[] = []
const organizationIds: string[] = []
const projectFileIds: string[] = []

async function seedResources(archived: boolean, joined = true) {
  const ownerId = generateId()
  const departingId = generateId()
  const workspaceId = generateId()
  userIds.push(ownerId, departingId)
  workspaceIds.push(workspaceId)
  await db.insert(user).values(
    [ownerId, departingId].map((id) => ({
      id,
      name: 'Lifecycle fixture',
      email: `${id}@example.test`,
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    }))
  )
  await insertWorkspaceFixture(db, {
    id: workspaceId,
    name: 'Lifecycle fixture',
    ownerId,
    billedAccountUserId: ownerId,
    archivedAt: archived ? new Date() : null,
  })
  await db.insert(permissions).values(
    (joined ? [ownerId, departingId] : [ownerId]).map((userId) => ({
      id: generateId(),
      userId,
      entityType: 'workspace',
      entityId: workspaceId,
      permissionType: 'admin' as const,
    }))
  )
  const workflowId = generateId()
  const chatId = generateId()
  const folderId = generateId()
  const tableId = generateId()
  const rowId = generateId()
  const kbId = generateId()
  const documentId = generateId()
  const fileId = generateId()
  const legacyFileId = generateId()
  const versionId = generateId()
  const archivedAt = archived ? new Date() : null
  await db.insert(workflow).values({
    id: workflowId,
    userId: departingId,
    workspaceId,
    name: 'Retained workflow',
    lastSynced: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
    archivedAt,
  })
  await db.insert(chat).values({
    id: chatId,
    workflowId,
    userId: departingId,
    identifier: chatId,
    title: 'Retained deployment',
    archivedAt,
  })
  await db.insert(folder).values({
    id: folderId,
    resourceType: 'file',
    name: 'Retained folder',
    userId: departingId,
    workspaceId,
    deletedAt: archivedAt,
  })
  await db.insert(userTableDefinitions).values({
    id: tableId,
    workspaceId,
    name: 'Retained table',
    schema: { columns: [] },
    createdBy: departingId,
    archivedAt,
  })
  await db.insert(userTableRows).values({
    id: rowId,
    tableId,
    workspaceId,
    data: { retained: true },
    createdBy: departingId,
  })
  await db.insert(knowledgeBase).values({
    id: kbId,
    workspaceId,
    name: 'Retained knowledge',
    userId: departingId,
    deletedAt: archivedAt,
  })
  await db.insert(document).values({
    id: documentId,
    knowledgeBaseId: kbId,
    filename: 'retained.txt',
    fileUrl: 'data:text/plain,retained',
    fileSize: 8,
    mimeType: 'text/plain',
    uploadedBy: departingId,
  })
  await db.insert(workspaceFiles).values({
    id: fileId,
    key: `workspace/${workspaceId}/${fileId}.txt`,
    workspaceId,
    folderId,
    userId: departingId,
    context: 'workspace',
    originalName: 'retained.txt',
    contentType: 'text/plain',
    sizeBytes: 8,
    deletedAt: archivedAt,
  })
  await db.insert(workspaceFileVersion).values({
    id: versionId,
    fileId,
    workspaceId,
    version: 1,
    key: `workspace/${workspaceId}/${versionId}.txt`,
    sizeBytes: 8,
    contentType: 'text/plain',
    source: 'upload',
    authorUserIds: [departingId],
  })
  await db.insert(workspaceFile).values({
    id: legacyFileId,
    workspaceId,
    uploadedBy: departingId,
    name: 'legacy.txt',
    key: `workspace/${workspaceId}/${legacyFileId}.txt`,
    size: 8,
    type: 'text/plain',
    deletedAt: archivedAt,
  })
  return {
    ownerId,
    departingId,
    workspaceId,
    workflowId,
    chatId,
    folderId,
    tableId,
    rowId,
    kbId,
    documentId,
    fileId,
    legacyFileId,
    versionId,
    archivedAt,
  }
}

async function assertTransferred(fixture: Awaited<ReturnType<typeof seedResources>>) {
  const { ownerId } = fixture
  expect
    .soft(await db.select().from(workflow).where(eq(workflow.id, fixture.workflowId)))
    .toMatchObject([{ userId: ownerId, archivedAt: fixture.archivedAt }])
  expect
    .soft(await db.select().from(chat).where(eq(chat.id, fixture.chatId)))
    .toMatchObject([{ userId: ownerId, archivedAt: fixture.archivedAt }])
  expect
    .soft(await db.select().from(folder).where(eq(folder.id, fixture.folderId)))
    .toMatchObject([{ userId: ownerId, deletedAt: fixture.archivedAt }])
  expect
    .soft(
      await db
        .select()
        .from(userTableDefinitions)
        .where(eq(userTableDefinitions.id, fixture.tableId))
    )
    .toMatchObject([{ createdBy: ownerId, archivedAt: fixture.archivedAt }])
  expect
    .soft(await db.select().from(knowledgeBase).where(eq(knowledgeBase.id, fixture.kbId)))
    .toMatchObject([{ userId: ownerId, deletedAt: fixture.archivedAt }])
  expect
    .soft(await db.select().from(workspaceFiles).where(eq(workspaceFiles.id, fixture.fileId)))
    .toMatchObject([
      { userId: ownerId, folderId: fixture.folderId, sizeBytes: 8, deletedAt: fixture.archivedAt },
    ])
  expect
    .soft(await db.select().from(workspaceFile).where(eq(workspaceFile.id, fixture.legacyFileId)))
    .toMatchObject([{ uploadedBy: ownerId, deletedAt: fixture.archivedAt }])
}

async function assertRetained(fixture: Awaited<ReturnType<typeof seedResources>>) {
  const { departingId, workspaceId } = fixture
  await assertTransferred(fixture)
  expect.soft(await db.select().from(user).where(eq(user.id, departingId))).toHaveLength(0)
  expect
    .soft(await db.select().from(workspace).where(eq(workspace.id, workspaceId)))
    .toHaveLength(1)
  expect
    .soft(await db.select().from(userTableRows).where(eq(userTableRows.id, fixture.rowId)))
    .toMatchObject([{ data: { retained: true }, createdBy: null }])
  expect
    .soft(await db.select().from(document).where(eq(document.id, fixture.documentId)))
    .toMatchObject([{ uploadedBy: null, fileSize: 8 }])
  expect
    .soft(
      await db
        .select()
        .from(workspaceFileVersion)
        .where(eq(workspaceFileVersion.id, fixture.versionId))
    )
    .toMatchObject([{ authorUserIds: [departingId], version: 1 }])
  expect
    .soft(
      await db
        .select()
        .from(permissions)
        .where(and(eq(permissions.entityId, workspaceId), eq(permissions.userId, departingId)))
    )
    .toHaveLength(0)
}

afterAll(async () => {
  if (projectFileIds.length)
    await db.delete(workspaceFiles).where(inArray(workspaceFiles.id, projectFileIds))
  if (workspaceIds.length) await deleteWorkspaceFixture(db, inArray(workspace.id, workspaceIds))
  if (organizationIds.length)
    await db.delete(organization).where(inArray(organization.id, organizationIds))
  if (userIds.length) await db.delete(user).where(inArray(user.id, userIds))
})

describe('shared resource retention across workspace departure and account erasure', () => {
  it.each([false, true])(
    'retains shared roots and their children after removal (archived=%s)',
    async (archived) => {
      const fixture = await seedResources(archived)
      const result = await db.transaction((tx) =>
        revokeWorkspaceAccessTx(tx, {
          workspaceId: fixture.workspaceId,
          userId: fixture.departingId,
        })
      )
      expect(result.revoked).toBe(true)
      await assertTransferred(fixture)
      await deleteUserAccount(fixture.departingId)
      await assertRetained(fixture)
    }
  )

  it('retains workspace-logo bindings after uploader departure and deletion', async () => {
    const fixture = await seedResources(false)
    const logoId = generateId()
    await db.insert(workspaceFiles).values({
      id: logoId,
      userId: fixture.departingId,
      workspaceId: fixture.workspaceId,
      key: `workspace-logos/${fixture.workspaceId}/${logoId}.png`,
      context: 'workspace-logos',
      originalName: 'logo.png',
      contentType: 'image/png',
      sizeBytes: 8,
    })
    await db.transaction((tx) =>
      revokeWorkspaceAccessTx(tx, {
        workspaceId: fixture.workspaceId,
        userId: fixture.departingId,
      })
    )
    await deleteUserAccount(fixture.departingId)
    expect(
      await db.select().from(workspaceFiles).where(eq(workspaceFiles.id, logoId))
    ).toMatchObject([
      { userId: fixture.ownerId, workspaceId: fixture.workspaceId, context: 'workspace-logos' },
    ])
  })

  it('preserves an implicit original upload when its creator leaves', async () => {
    const fixture = await seedResources(false)
    await db.delete(workspaceFileVersion).where(eq(workspaceFileVersion.fileId, fixture.fileId))
    await db.transaction((tx) =>
      revokeWorkspaceAccessTx(tx, {
        workspaceId: fixture.workspaceId,
        userId: fixture.departingId,
      })
    )
    expect(
      await db
        .select()
        .from(workspaceFileVersion)
        .where(eq(workspaceFileVersion.fileId, fixture.fileId))
    ).toMatchObject([
      { version: 1, source: 'upload', authorUserIds: [fixture.departingId], supersededAt: null },
    ])
    await deleteUserAccount(fixture.departingId)
    expect(
      await db
        .select()
        .from(workspaceFileVersion)
        .where(eq(workspaceFileVersion.fileId, fixture.fileId))
    ).toMatchObject([{ version: 1, authorUserIds: [fixture.departingId] }])
  })

  it('repairs references left by departures before the handoff fix', async () => {
    const fixture = await seedResources(true, false)
    await deleteUserAccount(fixture.departingId)
    await assertRetained(fixture)
  })

  it('retains a shared root committed while account deletion waits for its creator', async () => {
    const fixture = await seedResources(false, false)
    const tableId = generateId()
    const ready = createDeferred<number>()
    const release = createDeferred<void>()
    const writer = db.transaction(async (tx) => {
      await tx.insert(userTableDefinitions).values({
        id: tableId,
        workspaceId: fixture.workspaceId,
        name: 'Concurrent table',
        schema: { columns: [] },
        createdBy: fixture.departingId,
      })
      const [connection] = await tx.execute<{ pid: number }>(sql`SELECT pg_backend_pid() AS pid`)
      ready.resolve(connection.pid)
      await release.promise
    })
    const writerPid = await ready.promise
    const deletion = deleteUserAccount(fixture.departingId)
    try {
      await expect
        .poll(
          async () => {
            const rows = await db.execute(
              sql`SELECT 1 FROM pg_stat_activity WHERE ${writerPid} = ANY(pg_blocking_pids(pid))`
            )
            return rows.length
          },
          { timeout: 5000 }
        )
        .toBeGreaterThan(0)
    } finally {
      release.resolve()
      await writer
      await deletion
    }
    expect(
      await db.select().from(userTableDefinitions).where(eq(userTableDefinitions.id, tableId))
    ).toMatchObject([{ createdBy: fixture.ownerId }])
    await assertRetained(fixture)
  })

  it('rejects a late ownership reference after account deletion holds the user barrier', async () => {
    const fixture = await seedResources(false, false)
    const serverId = generateId()
    await db.insert(workflowMcpServer).values({
      id: serverId,
      workspaceId: fixture.workspaceId,
      createdBy: fixture.departingId,
      name: 'Concurrent private endpoint',
      isPublic: false,
    })
    const ready = createDeferred<number>()
    const release = createDeferred<void>()
    const blocker = db.transaction(async (tx) => {
      await tx
        .select()
        .from(workflowMcpServer)
        .where(eq(workflowMcpServer.id, serverId))
        .for('update')
      const [connection] = await tx.execute<{ pid: number }>(sql`SELECT pg_backend_pid() AS pid`)
      ready.resolve(connection.pid)
      await release.promise
    })
    const blockerPid = await ready.promise
    const deletion = deleteUserAccount(fixture.departingId)
    let lateWrite: Promise<unknown> | undefined
    try {
      await expect
        .poll(
          async () => {
            const rows = await db.execute(
              sql`SELECT 1 FROM pg_stat_activity WHERE ${blockerPid} = ANY(pg_blocking_pids(pid))`
            )
            return rows.length
          },
          { timeout: 5000 }
        )
        .toBeGreaterThan(0)
      const tableId = generateId()
      lateWrite = db
        .insert(userTableDefinitions)
        .values({
          id: tableId,
          workspaceId: fixture.workspaceId,
          name: 'Too late table',
          schema: { columns: [] },
          createdBy: fixture.departingId,
        })
        .then(
          () => ({ inserted: true }),
          (error: unknown) => ({ error })
        )
      await expect
        .poll(
          async () => {
            const rows = await db.execute(sql`
          SELECT 1 FROM pg_stat_activity blocked
          WHERE EXISTS (SELECT 1 FROM pg_stat_activity deleting
            WHERE ${blockerPid} = ANY(pg_blocking_pids(deleting.pid))
            AND deleting.pid = ANY(pg_blocking_pids(blocked.pid)))
        `)
            return rows.length
          },
          { timeout: 5000 }
        )
        .toBeGreaterThan(0)
    } finally {
      release.resolve()
      await blocker
      await deletion
    }
    expect(await lateWrite).toMatchObject({
      error: expect.objectContaining({ cause: expect.objectContaining({ code: '23503' }) }),
    })
    await assertRetained(fixture)
  })

  it.each(['payer', 'grant'] as const)(
    'revalidates a concurrent successor %s change before revoking access',
    async (kind) => {
      const fixture = await seedResources(false)
      const ready = createDeferred<number>()
      const release = createDeferred<void>()
      const change = db.transaction(async (tx) => {
        if (kind === 'payer') {
          await tx
            .update(workspace)
            .set({ billedAccountUserId: fixture.departingId })
            .where(eq(workspace.id, fixture.workspaceId))
        } else {
          await tx
            .delete(permissions)
            .where(
              and(
                eq(permissions.entityId, fixture.workspaceId),
                eq(permissions.userId, fixture.ownerId)
              )
            )
        }
        const [connection] = await tx.execute<{ pid: number }>(sql`SELECT pg_backend_pid() AS pid`)
        ready.resolve(connection.pid)
        await release.promise
      })
      const changerPid = await ready.promise
      const removal = db.transaction((tx) =>
        revokeWorkspaceAccessTx(tx, {
          workspaceId: fixture.workspaceId,
          userId: fixture.departingId,
        })
      )
      try {
        await expect
          .poll(
            async () => {
              const rows = await db.execute(
                sql`SELECT 1 FROM pg_stat_activity WHERE ${changerPid} = ANY(pg_blocking_pids(pid))`
              )
              return rows.length
            },
            { timeout: 5000 }
          )
          .toBeGreaterThan(0)
      } finally {
        release.resolve()
        await change
      }
      expect((await removal).revoked).toBe(false)
      expect(
        await db
          .select()
          .from(userTableDefinitions)
          .where(eq(userTableDefinitions.id, fixture.tableId))
      ).toMatchObject([{ createdBy: fixture.departingId }])
      expect(
        await db
          .select()
          .from(permissions)
          .where(
            and(
              eq(permissions.entityId, fixture.workspaceId),
              eq(permissions.userId, fixture.departingId)
            )
          )
      ).toHaveLength(1)
    }
  )

  it('keeps private attachments and personal credentials private during departure and erases them with the user', async () => {
    const fixture = await seedResources(false)
    const privateChatId = generateId()
    const privateFileId = generateId()
    const credentialId = generateId()
    await db
      .insert(copilotChats)
      .values({ id: privateChatId, userId: fixture.departingId, workspaceId: fixture.workspaceId })
    await db.insert(workspaceFiles).values({
      id: privateFileId,
      key: `mothership/${privateFileId}`,
      userId: fixture.departingId,
      workspaceId: fixture.workspaceId,
      chatId: privateChatId,
      context: 'mothership',
      originalName: 'private.txt',
      contentType: 'text/plain',
      sizeBytes: 8,
    })
    await db.insert(account).values({
      id: credentialId,
      accountId: credentialId,
      providerId: 'fixture',
      userId: fixture.departingId,
      accessToken: 'synthetic-private-token',
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    await db.insert(environment).values({
      id: fixture.departingId,
      userId: fixture.departingId,
      variables: { PRIVATE: 'synthetic' },
    })
    await db.transaction((tx) =>
      revokeWorkspaceAccessTx(tx, { workspaceId: fixture.workspaceId, userId: fixture.departingId })
    )
    expect(
      await db.select().from(workspaceFiles).where(eq(workspaceFiles.id, privateFileId))
    ).toMatchObject([{ userId: fixture.departingId, chatId: privateChatId }])
    expect(await db.select().from(account).where(eq(account.id, credentialId))).toMatchObject([
      { userId: fixture.departingId, accessToken: 'synthetic-private-token' },
    ])
    await deleteUserAccount(fixture.departingId)
    expect(
      await db.select().from(workspaceFiles).where(eq(workspaceFiles.id, privateFileId))
    ).toHaveLength(0)
    expect(
      await db.select().from(copilotChats).where(eq(copilotChats.id, privateChatId))
    ).toHaveLength(0)
    expect(await db.select().from(account).where(eq(account.id, credentialId))).toHaveLength(0)
    expect(
      await db.select().from(environment).where(eq(environment.id, fixture.departingId))
    ).toHaveLength(0)
    await assertRetained(fixture)
  })

  it('refuses organization-only retention without an owner successor', async () => {
    const fixture = await seedResources(false, false)
    const organizationId = generateId()
    organizationIds.push(organizationId)
    await db.insert(organization).values({
      id: organizationId,
      name: 'No successor',
      slug: organizationId,
      createdAt: new Date(),
    })
    const kbId = generateId()
    await db.insert(knowledgeBase).values({
      id: kbId,
      name: 'Stranded knowledge',
      userId: fixture.departingId,
      organizationId,
      isSearchIndex: true,
    })
    await expect(deleteUserAccount(fixture.departingId)).rejects.toThrow(
      'active organization owner'
    )
    expect(await db.select().from(user).where(eq(user.id, fixture.departingId))).toHaveLength(1)
    expect(await db.select().from(knowledgeBase).where(eq(knowledgeBase.id, kbId))).toMatchObject([
      { userId: fixture.departingId },
    ])
  })

  it('refuses an inaccessible successor without changing ownership or access', async () => {
    const fixture = await seedResources(false)
    await db
      .delete(permissions)
      .where(
        and(eq(permissions.entityId, fixture.workspaceId), eq(permissions.userId, fixture.ownerId))
      )
    const result = await db.transaction((tx) =>
      revokeWorkspaceAccessTx(tx, {
        workspaceId: fixture.workspaceId,
        userId: fixture.departingId,
      })
    )
    expect(result.revoked).toBe(false)
    expect(
      await db
        .select()
        .from(userTableDefinitions)
        .where(eq(userTableDefinitions.id, fixture.tableId))
    ).toMatchObject([{ createdBy: fixture.departingId }])
    expect(
      await db
        .select()
        .from(permissions)
        .where(
          and(
            eq(permissions.entityId, fixture.workspaceId),
            eq(permissions.userId, fixture.departingId)
          )
        )
    ).toHaveLength(1)
    await db.delete(permissions).where(eq(permissions.userId, fixture.departingId))
    await expect(deleteUserAccount(fixture.departingId)).rejects.toThrow('active billing account')
    expect(await db.select().from(user).where(eq(user.id, fixture.departingId))).toHaveLength(1)
  })

  it('rolls back handoff and access revocation together when the transaction fails', async () => {
    const fixture = await seedResources(false)
    await expect(
      db.transaction(async (tx) => {
        expect(
          (
            await revokeWorkspaceAccessTx(tx, {
              workspaceId: fixture.workspaceId,
              userId: fixture.departingId,
            })
          ).revoked
        ).toBe(true)
        await tx.execute(sql`SELECT 1 / 0`)
      })
    ).rejects.toThrow()
    expect(
      await db.select().from(workspaceFiles).where(eq(workspaceFiles.id, fixture.fileId))
    ).toMatchObject([{ userId: fixture.departingId }])
    expect(
      await db
        .select()
        .from(permissions)
        .where(
          and(
            eq(permissions.entityId, fixture.workspaceId),
            eq(permissions.userId, fixture.departingId)
          )
        )
    ).toHaveLength(1)
  })

  it.each([false, true])(
    'retains public MCP execution identity and blocks erasure (deleted=%s)',
    async (deleted) => {
      const fixture = await seedResources(false)
      const serverId = generateId()
      await db.insert(workflowMcpServer).values({
        id: serverId,
        workspaceId: fixture.workspaceId,
        createdBy: fixture.departingId,
        name: 'Retained public endpoint',
        isPublic: true,
        deletedAt: deleted ? new Date() : null,
      })
      await db.transaction((tx) =>
        revokeWorkspaceAccessTx(tx, {
          workspaceId: fixture.workspaceId,
          userId: fixture.departingId,
        })
      )
      expect(
        await db.select().from(workflowMcpServer).where(eq(workflowMcpServer.id, serverId))
      ).toMatchObject([{ createdBy: fixture.departingId, isPublic: true }])
      expect((await getAccountDeletionPlan(fixture.departingId)).blockers).toMatchObject([
        { message: expect.stringContaining('Public MCP servers') },
      ])
      await expect(deleteUserAccount(fixture.departingId)).rejects.toThrow('Public MCP servers')
      expect(await db.select().from(user).where(eq(user.id, fixture.departingId))).toHaveLength(1)
      await db.delete(workflowMcpServer).where(eq(workflowMcpServer.id, serverId))
      await deleteUserAccount(fixture.departingId)
      await assertRetained(fixture)
    }
  )

  it.each(['public server', 'workspace key'] as const)(
    'rechecks a %s dependency activated after the deletion preview',
    async (kind) => {
      const fixture = await seedResources(false, false)
      const dependencyId = generateId()
      if (kind === 'public server') {
        await db.insert(workflowMcpServer).values({
          id: dependencyId,
          workspaceId: fixture.workspaceId,
          createdBy: fixture.departingId,
          name: 'Concurrent endpoint',
          isPublic: false,
        })
      } else {
        await db.insert(apiKey).values({
          id: dependencyId,
          workspaceId: fixture.workspaceId,
          userId: fixture.departingId,
          name: 'Concurrent key',
          key: generateId(),
          type: 'workspace',
          expiresAt: new Date(Date.now() - 60_000),
        })
      }
      const ready = createDeferred<number>()
      const activate = createDeferred<void>()
      const change = db.transaction(async (tx) => {
        await tx.select().from(user).where(eq(user.id, fixture.departingId)).for('update')
        const [connection] = await tx.execute<{ pid: number }>(sql`SELECT pg_backend_pid() AS pid`)
        ready.resolve(connection.pid)
        await activate.promise
        if (kind === 'public server') {
          await tx
            .update(workflowMcpServer)
            .set({ isPublic: true })
            .where(eq(workflowMcpServer.id, dependencyId))
        } else {
          await tx.update(apiKey).set({ expiresAt: null }).where(eq(apiKey.id, dependencyId))
        }
      })
      const changerPid = await ready.promise
      const deletion = deleteUserAccount(fixture.departingId).then(
        () => ({ deleted: true }),
        (error: unknown) => ({ error })
      )
      try {
        await expect
          .poll(
            async () => {
              const rows = await db.execute(
                sql`SELECT 1 FROM pg_stat_activity WHERE ${changerPid} = ANY(pg_blocking_pids(pid))`
              )
              return rows.length
            },
            { timeout: 5000 }
          )
          .toBeGreaterThan(0)
      } finally {
        activate.resolve()
        await change
      }
      expect(await deletion).toMatchObject({ error: expect.objectContaining({ code: 'conflict' }) })
      expect(await db.select().from(user).where(eq(user.id, fixture.departingId))).toHaveLength(1)
      if (kind === 'public server') {
        expect(
          await db.select().from(workflowMcpServer).where(eq(workflowMcpServer.id, dependencyId))
        ).toMatchObject([{ createdBy: fixture.departingId, isPublic: true }])
      } else {
        expect(await db.select().from(apiKey).where(eq(apiKey.id, dependencyId))).toMatchObject([
          { userId: fixture.departingId, expiresAt: null },
        ])
      }
    }
  )

  it('transfers private MCP metadata without rewriting public server actors', async () => {
    const fixture = await seedResources(false, false)
    const serverId = generateId()
    await db.insert(workflowMcpServer).values({
      id: serverId,
      workspaceId: fixture.workspaceId,
      createdBy: fixture.departingId,
      name: 'Retained authenticated endpoint',
      isPublic: false,
    })
    await deleteUserAccount(fixture.departingId)
    expect(
      await db.select().from(workflowMcpServer).where(eq(workflowMcpServer.id, serverId))
    ).toMatchObject([{ createdBy: fixture.ownerId, isPublic: false }])
    await assertRetained(fixture)
  })

  it.each(['permanent', 'future', 'expired', 'revoked'] as const)(
    'blocks only live workspace keys (%s)',
    async (state) => {
      const fixture = await seedResources(false, false)
      const keyId = generateId()
      await db.insert(apiKey).values({
        id: keyId,
        userId: fixture.departingId,
        createdBy: fixture.departingId,
        workspaceId: fixture.workspaceId,
        type: 'workspace',
        name: 'Shared key',
        key: generateId(),
        expiresAt:
          state === 'permanent'
            ? null
            : new Date(Date.now() + (state === 'expired' ? -60_000 : 60_000)),
      })
      if (state === 'revoked') await db.delete(apiKey).where(eq(apiKey.id, keyId))
      if (state === 'permanent' || state === 'future') {
        await expect(deleteUserAccount(fixture.departingId)).rejects.toThrow('Workspace API keys')
        expect(await db.select().from(apiKey).where(eq(apiKey.id, keyId))).toMatchObject([
          { userId: fixture.departingId },
        ])
        await db.delete(apiKey).where(eq(apiKey.id, keyId))
      }
      await deleteUserAccount(fixture.departingId)
      await assertRetained(fixture)
    }
  )

  it.each([true, false])(
    'retains organization-only resources with no workspace membership (currentMember=%s)',
    async (currentMember) => {
      const fixture = await seedResources(false, false)
      const organizationId = generateId()
      const memberId = generateId()
      const kbId = generateId()
      const orgFileId = generateId()
      const groupId = generateId()
      const providerId = generateId()
      organizationIds.push(organizationId)
      await db.insert(organization).values({
        id: organizationId,
        name: 'Shared organization',
        slug: organizationId,
        createdAt: new Date(),
      })
      await db.insert(member).values({
        id: generateId(),
        organizationId,
        userId: fixture.ownerId,
        role: 'owner',
        createdAt: new Date(),
      })
      if (currentMember)
        await db.insert(member).values({
          id: memberId,
          organizationId,
          userId: fixture.departingId,
          role: 'member',
          createdAt: new Date(),
        })
      await db.insert(knowledgeBase).values({
        id: kbId,
        organizationId,
        userId: fixture.departingId,
        isSearchIndex: true,
        name: 'Organization index',
        deletedAt: new Date(),
      })
      await db.insert(workspaceFiles).values({
        id: orgFileId,
        key: `knowledge-base/${organizationId}/${orgFileId}.txt`,
        organizationId,
        userId: fixture.departingId,
        context: 'knowledge-base',
        originalName: 'organization-index.txt',
        contentType: 'text/plain',
        sizeBytes: 8,
        deletedAt: new Date(),
      })

      await db.insert(permissionGroup).values({
        id: groupId,
        organizationId,
        name: 'Retained policy',
        createdBy: fixture.departingId,
        config: { tools: ['restricted'] },
      })
      await db.insert(ssoProvider).values({
        id: providerId,
        providerId,
        organizationId,
        userId: fixture.departingId,
        domain: `${providerId}.example.test`,
        issuer: `https://${providerId}.example.test`,
      })
      const environmentId = generateId()
      workspaceIds.push(environmentId)
      await insertWorkspaceFixture(db, {
        id: environmentId,
        name: 'Organization Project',
        ownerId: fixture.ownerId,
        billedAccountUserId: fixture.ownerId,
        organizationId,
        workspaceMode: 'organization',
      })
      const [binding] = await db
        .select()
        .from(projectWorkspace)
        .where(eq(projectWorkspace.workspaceId, environmentId))
      const projectFileId = generateId()
      projectFileIds.push(projectFileId)
      await db.insert(workspaceFiles).values({
        id: projectFileId,
        userId: fixture.departingId,
        projectId: binding.projectId,
        context: 'project',
        key: `project/${binding.projectId}/fixture`,
        originalName: 'fixture',
        contentType: 'text/plain',
        sizeBytes: 8,
        deletedAt: new Date(),
      })
      if (currentMember)
        expect(
          (
            await removeUserFromOrganization({
              organizationId,
              userId: fixture.departingId,
              memberId,
              skipBillingLogic: true,
              onError: 'throw',
            })
          ).success
        ).toBe(true)
      if (currentMember) {
        expect(
          await db.select().from(workspaceFiles).where(eq(workspaceFiles.id, projectFileId))
        ).toMatchObject([{ userId: fixture.ownerId }])
        expect(
          await db.select().from(workspaceFiles).where(eq(workspaceFiles.id, orgFileId))
        ).toMatchObject([
          { userId: fixture.ownerId, organizationId, workspaceId: null, sizeBytes: 8 },
        ])
        expect(
          await db.select().from(knowledgeBase).where(eq(knowledgeBase.id, kbId))
        ).toMatchObject([{ userId: fixture.ownerId }])
        expect(
          await db.select().from(permissionGroup).where(eq(permissionGroup.id, groupId))
        ).toMatchObject([{ createdBy: fixture.ownerId }])
        expect(
          await db.select().from(ssoProvider).where(eq(ssoProvider.id, providerId))
        ).toMatchObject([{ userId: fixture.ownerId }])
      }
      await deleteUserAccount(fixture.departingId)
      expect(
        await db
          .select()
          .from(workspaceFileVersion)
          .where(eq(workspaceFileVersion.fileId, projectFileId))
      ).toMatchObject([{ version: 1, source: 'upload', authorUserIds: [fixture.departingId] }])
      expect(
        await db.select().from(workspaceFiles).where(eq(workspaceFiles.id, projectFileId))
      ).toMatchObject([{ userId: fixture.ownerId }])
      expect(
        await db.select().from(workspaceFiles).where(eq(workspaceFiles.id, orgFileId))
      ).toMatchObject([
        {
          userId: fixture.ownerId,
          organizationId,
          workspaceId: null,
          sizeBytes: 8,
          deletedAt: expect.any(Date),
        },
      ])
      expect(await db.select().from(knowledgeBase).where(eq(knowledgeBase.id, kbId))).toMatchObject(
        [{ userId: fixture.ownerId }]
      )
      expect(
        await db.select().from(permissionGroup).where(eq(permissionGroup.id, groupId))
      ).toMatchObject([{ createdBy: fixture.ownerId, config: { tools: ['restricted'] } }])
      expect(
        await db.select().from(ssoProvider).where(eq(ssoProvider.id, providerId))
      ).toMatchObject([{ userId: fixture.ownerId, providerId, organizationId }])
      await assertRetained(fixture)
    }
  )
})
