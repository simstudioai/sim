import { db } from '@sim/db'
import { folder, publicShare, user, workspace, workspaceFiles } from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import { eq, inArray, sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readPublicSharedFile } from '@/lib/public-shares/access'
import { readSharedFolderPage, resolveSharedFile } from '@/lib/public-shares/folder-reader'
import { resolveActiveResourceShareByToken } from '@/lib/public-shares/share-manager'

describe('public folder capabilities in PostgreSQL', () => {
  const userId = generateId()
  const workspaceId = generateId()
  const otherWorkspaceId = generateId()
  const rootId = generateId()
  const childId = generateId()
  const siblingId = generateId()
  const foreignId = generateId()
  const fileId = generateId()
  const token = generateId()
  const shareId = generateId()
  const directShareId = generateId()
  const directToken = generateId()

  beforeAll(async () => {
    await db.insert(user).values({
      id: userId,
      name: 'Folder share fixture',
      email: `${userId}@fixture.test`,
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    await db.insert(workspace).values(
      [workspaceId, otherWorkspaceId].map((id) => ({
        id,
        name: 'Folder share fixture',
        ownerId: userId,
        billedAccountUserId: userId,
      }))
    )
    await db.insert(folder).values([
      { id: rootId, name: 'Shared', resourceType: 'file', workspaceId, userId },
      { id: siblingId, name: 'Private', resourceType: 'file', workspaceId, userId },
      {
        id: foreignId,
        name: 'Foreign',
        resourceType: 'file',
        workspaceId: otherWorkspaceId,
        userId,
      },
    ])
    await db.insert(folder).values({
      id: childId,
      name: 'Nested',
      parentId: rootId,
      resourceType: 'file',
      workspaceId,
      userId,
    })
    await db.insert(workspaceFiles).values({
      id: fileId,
      key: `workspace/${workspaceId}/${fileId}`,
      workspaceId,
      userId,
      folderId: childId,
      originalName: 'nested.txt',
      contentType: 'text/plain',
      sizeBytes: 7,
      context: 'workspace',
    })
    await db.insert(publicShare).values({
      id: shareId,
      resourceType: 'folder',
      resourceId: rootId,
      workspaceId,
      createdBy: userId,
      token,
    })
    await db.insert(publicShare).values({
      id: directShareId,
      resourceType: 'file',
      resourceId: fileId,
      workspaceId,
      createdBy: userId,
      token: directToken,
    })
  })

  afterAll(async () => {
    await db.delete(workspace).where(inArray(workspace.id, [workspaceId, otherWorkspaceId]))
    await db.delete(user).where(eq(user.id, userId))
    await db.$client.end()
  })

  async function share() {
    const resolved = await resolveActiveResourceShareByToken(token)
    if (!resolved || resolved.kind !== 'folder') throw new Error('Expected active folder share')
    return resolved
  }

  it('lists only immediate children and contains breadcrumb paths within the shared root', async () => {
    const root = await readSharedFolderPage(await share(), {})
    expect(root?.entries.map((entry) => entry.id)).toEqual([childId])
    const nested = await readSharedFolderPage(await share(), { folderId: childId })
    expect(nested?.breadcrumbs.map((entry) => entry.id)).toEqual([rootId, childId])
    expect(nested?.entries.map((entry) => entry.id)).toEqual([fileId])
  })

  it('rejects sibling and foreign folder identifiers', async () => {
    const resolved = await share()
    expect(await readSharedFolderPage(resolved, { folderId: siblingId })).toBeNull()
    expect(await readSharedFolderPage(resolved, { folderId: foreignId })).toBeNull()
  })

  it('revokes a file immediately when its ancestor moves out of the shared subtree', async () => {
    const resolved = await share()
    expect((await resolveSharedFile(resolved, fileId))?.id).toBe(fileId)
    await db.update(folder).set({ parentId: siblingId }).where(eq(folder.id, childId))
    try {
      expect(await resolveSharedFile(resolved, fileId)).toBeNull()
      expect(await readSharedFolderPage(resolved, { folderId: childId })).toBeNull()
    } finally {
      await db.update(folder).set({ parentId: rootId }).where(eq(folder.id, childId))
    }
  })

  it('refuses files behind an archived ancestor even if a child record remains active', async () => {
    await db.update(folder).set({ deletedAt: new Date() }).where(eq(folder.id, childId))
    try {
      expect(await resolveSharedFile(await share(), fileId)).toBeNull()
    } finally {
      await db.update(folder).set({ deletedAt: null }).where(eq(folder.id, childId))
    }
  })

  it('paginates a folder without omissions, repetitions, or cursor reuse across folders', async () => {
    const ids = Array.from({ length: 105 }, () => generateId())
    await db.insert(workspaceFiles).values(
      ids.map((id, index) => ({
        id,
        key: `workspace/${workspaceId}/${id}`,
        workspaceId,
        userId,
        folderId: rootId,
        originalName: `file-${String(index).padStart(3, '0')}.txt`,
        contentType: 'text/plain',
        sizeBytes: 1,
        context: 'workspace',
      }))
    )
    const resolved = await share()
    const first = await readSharedFolderPage(resolved, {})
    expect(first?.entries.length).toBe(100)
    expect(first?.nextCursor).toBeTruthy()
    const second = await readSharedFolderPage(resolved, { cursor: first?.nextCursor ?? undefined })
    expect(second?.entries.length).toBe(6)
    expect(second?.nextCursor).toBeNull()
    expect(
      new Set([...(first?.entries ?? []), ...(second?.entries ?? [])].map((row) => row.id)).size
    ).toBe(106)
    await expect(
      readSharedFolderPage(resolved, { folderId: childId, cursor: first?.nextCursor ?? undefined })
    ).rejects.toMatchObject({ code: 'validation' })
  })

  it('denies stale resolved folder grants after sharing is disabled', async () => {
    const resolved = await share()
    await db.update(publicShare).set({ isActive: false }).where(eq(publicShare.id, shareId))
    try {
      expect(await resolveActiveResourceShareByToken(token)).toBeNull()
      expect(await readSharedFolderPage(resolved, {})).toBeNull()
      expect(await resolveSharedFile(resolved, fileId)).toBeNull()
    } finally {
      await db.update(publicShare).set({ isActive: true }).where(eq(publicShare.id, shareId))
    }
  })

  it.each(['SQL NULL', 'JSON null'] as const)(
    'accepts a %s allow-list as empty while still rejecting a changed policy',
    async (storage) => {
      await db
        .update(publicShare)
        .set({ allowedEmails: storage === 'SQL NULL' ? null : sql`'null'::jsonb` })
        .where(eq(publicShare.id, shareId))
      try {
        const resolved = await share()
        expect((await readSharedFolderPage(resolved, {}))?.folder.id).toBe(rootId)
        expect((await resolveSharedFile(resolved, fileId))?.id).toBe(fileId)
        await db
          .update(publicShare)
          .set({ allowedEmails: ['restricted@fixture.test'] })
          .where(eq(publicShare.id, shareId))
        expect(await readSharedFolderPage(resolved, {})).toBeNull()
        expect(await resolveSharedFile(resolved, fileId)).toBeNull()
      } finally {
        await db.update(publicShare).set({ allowedEmails: [] }).where(eq(publicShare.id, shareId))
      }
    }
  )

  it.each([
    { name: 'revocation', update: { isActive: false } },
    { name: 'password protection', update: { authType: 'password', password: 'changed-policy' } },
    { name: 'email restrictions', update: { allowedEmails: ['restricted@fixture.test'] } },
  ])('denies direct file reads when $name occurs during authorization', async ({ update }) => {
    expect(
      (
        await readPublicSharedFile({
          token: directToken,
          authorize: async () => ({ authorized: true }),
        })
      ).file.id
    ).toBe(fileId)
    try {
      await expect(
        readPublicSharedFile({
          token: directToken,
          authorize: async () => {
            await db.update(publicShare).set(update).where(eq(publicShare.id, directShareId))
            return { authorized: true }
          },
        })
      ).rejects.toMatchObject({ status: 404 })
    } finally {
      await db
        .update(publicShare)
        .set({ isActive: true, authType: 'public', password: null, allowedEmails: [] })
        .where(eq(publicShare.id, directShareId))
    }
  })
})
