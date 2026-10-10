import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { db } from '@sim/db'
import { folder, permissions, project, user, workspace, workspaceFiles } from '@sim/db/schema'
import { deleteWorkspaceFixture, insertWorkspaceFixture } from '@sim/db/testing/workspace-fixtures'
import { createSessionPrincipal } from '@sim/testing/factories/principal.factory'
import { featureFlagsMock, featureFlagsMockFns } from '@sim/testing/mocks/feature-flags.mock'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { and, eq, inArray } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { listProjectFileItems } from '@/lib/projects/files/application'
import { deleteUserAccount } from '@/lib/users/account-deletion'
import type { FileBrowserQuery } from '@/lib/workspace-files/browser-query'

interface BrowserFixture {
  workspaceId: string
  projectId?: string
  users: string[]
  fileIds: string[]
  folderIds: string[]
}
vi.mock('@/lib/core/config/feature-flags', () => featureFlagsMock)

const fixtures: BrowserFixture[] = []
const checks: { name: string; status: 'passed' | 'failed'; durationMs: number; error?: string }[] =
  []
beforeEach(() => {
  featureFlagsMockFns.mockIsFeatureEnabled.mockImplementation(async (flag) => flag === 'projects')
  vi.stubEnv('PROJECT_FILES_ENABLED', 'true')
})
function check(name: string, run: () => Promise<void>) {
  it(name, async () => {
    const start = performance.now()
    try {
      await run()
      checks.push({ name, status: 'passed', durationMs: performance.now() - start })
    } catch (error) {
      checks.push({
        name,
        status: 'failed',
        durationMs: performance.now() - start,
        error: getErrorMessage(error),
      })
      throw error
    }
  })
}
async function fixture() {
  const ownerId = generateId()
  const readerId = generateId()
  const creatorId = generateId()
  const workspaceId = generateId()
  const owned: BrowserFixture = {
    workspaceId,
    users: [ownerId, readerId, creatorId],
    fileIds: [],
    folderIds: [],
  }
  fixtures.push(owned)
  await db.insert(user).values(
    [ownerId, readerId, creatorId].map((id, index) => ({
      id,
      name: ['Owner', 'Reader', 'Other creator'][index],
      email: `${id}@browser.invalid`,
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    }))
  )
  await insertWorkspaceFixture(db, {
    id: workspaceId,
    name: 'File browser fixture',
    ownerId,
    billedAccountUserId: ownerId,
    workspaceMode: 'personal',
  })
  const [membership] = await db
    .select({ projectId: workspace.projectId })
    .from(workspace)
    .where(eq(workspace.id, workspaceId))
  if (!membership) throw new Error('Fixture Project missing')
  const projectId = membership.projectId
  owned.projectId = projectId
  await db.insert(permissions).values([
    {
      id: generateId(),
      userId: ownerId,
      entityType: 'workspace',
      entityId: workspaceId,
      permissionType: 'admin',
    },
    {
      id: generateId(),
      userId: readerId,
      entityType: 'workspace',
      entityId: workspaceId,
      permissionType: 'read',
    },
  ])
  const reader = createSessionPrincipal({ userId: readerId })
  const list = (input: Partial<FileBrowserQuery> = {}) =>
    listProjectFileItems.execute({
      principal: reader,
      input: { projectId, scope: 'active', sortBy: 'name', sortOrder: 'asc', limit: 100, ...input },
    })
  const addFile = async (
    name: string,
    size: number,
    options: { folderId?: string; userId?: string; type?: string; archived?: boolean } = {}
  ) => {
    const id = generateId()
    owned.fileIds.push(id)
    await db.insert(workspaceFiles).values({
      id,
      projectId: projectId,
      context: 'project',
      workspaceId: null,
      userId: options.userId ?? ownerId,
      folderId: options.folderId,
      key: `project/${projectId}/${id}`,
      originalName: name,
      contentType: options.type ?? 'application/octet-stream',
      sizeBytes: size,
      deletedAt: options.archived ? new Date() : null,
    })
    return id
  }
  const addFolder = async (name: string, parentId?: string, userId = ownerId) => {
    const id = generateId()
    owned.folderIds.push(id)
    await db.insert(folder).values({
      id,
      projectId: projectId,
      workspaceId: null,
      resourceType: 'file',
      name,
      userId,
      parentId,
    })
    return id
  }
  return { ownerId, readerId, creatorId, workspaceId, projectId, reader, list, addFile, addFolder }
}
afterAll(async () => {
  const cleanup: { workspaceId: string; status: 'passed' | 'failed'; error?: string }[] = []
  try {
    for (const fixture of fixtures) {
      try {
        await db.transaction(async (tx) => {
          if (fixture.projectId) {
            if (fixture.fileIds.length)
              await tx
                .delete(workspaceFiles)
                .where(
                  and(
                    eq(workspaceFiles.projectId, fixture.projectId),
                    inArray(workspaceFiles.id, fixture.fileIds)
                  )
                )
            if (fixture.folderIds.length)
              await tx
                .delete(folder)
                .where(
                  and(
                    eq(folder.projectId, fixture.projectId),
                    inArray(folder.id, fixture.folderIds)
                  )
                )
          }
          await deleteWorkspaceFixture(tx, eq(workspace.id, fixture.workspaceId))
          if (fixture.projectId) {
            await tx.delete(project).where(eq(project.id, fixture.projectId))
          }
          await tx.delete(user).where(inArray(user.id, fixture.users))
        })
        cleanup.push({ workspaceId: fixture.workspaceId, status: 'passed' })
      } catch (error) {
        cleanup.push({
          workspaceId: fixture.workspaceId,
          status: 'failed',
          error: getErrorMessage(error),
        })
      }
    }
  } finally {
    const report = process.env.PROJECT_FILE_BROWSER_REPORT_PATH
    if (report) {
      await mkdir(dirname(report), { recursive: true })
      await writeFile(report, JSON.stringify({ checks, cleanup }, null, 2))
    }
  }
  const failures = cleanup.filter((result) => result.status === 'failed')
  if (failures.length)
    throw new Error(`Browser fixture cleanup failed: ${JSON.stringify(failures)}`)
})

describe('Project browser real mixed collection', () => {
  check(
    'type, size and creator predicates select the complete collection before pagination',
    async () => {
      const f = await fixture()
      for (let index = 0; index < 5; index++) await f.addFile(`a${index}.txt`, 1)
      const expected = await f.addFile('z-image.png', 1_048_576, { userId: f.creatorId })
      const page = await f.list({
        types: ['image'],
        sizes: ['medium'],
        creatorIds: [f.creatorId],
        limit: 1,
      })
      expect(page.items.map((item) => item.id)).toEqual([expected])
      expect(page.files.map((file) => file.id)).toEqual([expected])
      expect(page.nextKeys).toBeNull()
      expect(page.capabilities.canWrite).toBe(false)
    }
  )
  check('effective MIME and exact size boundaries retain workspace product semantics', async () => {
    const f = await fixture()
    const small = await f.addFile('small.webm', 1_048_575)
    const minimum = await f.addFile('minimum.webm', 1_048_576)
    const maximum = await f.addFile('maximum.webm', 10_485_760)
    const large = await f.addFile('large.webm', 10_485_761)
    expect(
      (await f.list({ types: ['video'], sizes: ['small'] })).items.map((item) => item.id)
    ).toEqual([small])
    expect(
      (await f.list({ types: ['video'], sizes: ['medium'] })).items.map((item) => item.id).sort()
    ).toEqual([minimum, maximum].sort())
    expect(
      (await f.list({ types: ['video'], sizes: ['large'] })).items.map((item) => item.id)
    ).toEqual([large])
    expect((await f.list({ types: ['audio'] })).items).toEqual([])
  })
  check(
    'mixed size pages keep ascending name ties in both directions and include descendant rollup',
    async () => {
      const f = await fixture()
      const a = await f.addFolder('a-folder')
      const child = await f.addFolder('child', a)
      await f.addFile('nested.txt', 10, { folderId: child })
      await f.addFile('ignored.txt', 1000, { folderId: child, archived: true })
      const b = await f.addFile('b-file.txt', 10)
      const c = await f.addFile('c-file.txt', 20)
      for (const sortOrder of ['asc', 'desc'] as const) {
        const ids: string[] = []
        let after: FileBrowserQuery['after']
        for (let index = 0; index < 4; index++) {
          const page = await f.list({ folderId: null, sortBy: 'size', sortOrder, limit: 1, after })
          ids.push(...page.items.map((item) => item.id))
          if (!page.nextKeys) break
          after = page.nextKeys
        }
        expect(ids).toEqual(sortOrder === 'asc' ? [a, b, c] : [c, a, b])
      }
    }
  )
  check(
    'creator handoff updates filter choices and preserves file and folder pagination',
    async () => {
      const f = await fixture()
      const other = await fixture()
      await other.addFile('unrelated.png', 1, { userId: other.creatorId })
      const deleted = await f.addFile('deleted.txt', 1, { userId: f.creatorId })
      const deletedFolder = await f.addFolder('deleted-folder', undefined, f.creatorId)
      const live = await f.addFile('live.txt', 1)
      await deleteUserAccount(f.creatorId)
      const page = await f.list()
      expect(page.items.find((item) => item.id === deleted)?.creator).toMatchObject({
        id: f.ownerId,
      })
      expect(page.items.find((item) => item.id === deletedFolder)?.creator).toMatchObject({
        id: f.ownerId,
      })
      expect(page.files.find((file) => file.id === deleted)?.uploadedBy).toBe(f.ownerId)
      expect(page.creators.map((creator) => creator.id)).toEqual([f.ownerId])
      expect(page.creators.some((creator) => creator.id === other.creatorId)).toBe(false)
      expect((await f.list({ creatorIds: [f.creatorId] })).files).toEqual([])
      for (const sortOrder of ['asc', 'desc'] as const) {
        const ids: string[] = []
        let after: FileBrowserQuery['after']
        for (let index = 0; index < 4; index++) {
          const page = await f.list({ sortBy: 'owner', sortOrder, limit: 1, after })
          ids.push(...page.items.map((item) => item.id))
          if (!page.nextKeys) break
          after = page.nextKeys
        }
        expect(ids).toEqual([deletedFolder, deleted, live])
      }
    }
  )
  check('live read revocation denies both item rows and creator metadata', async () => {
    const f = await fixture()
    await f.addFile('readable.txt', 1)
    expect((await f.list()).items).toHaveLength(1)
    await db
      .delete(permissions)
      .where(and(eq(permissions.userId, f.readerId), eq(permissions.entityId, f.workspaceId)))
    await expect(f.list()).rejects.toMatchObject({ code: 'not_found' })
  })
})
