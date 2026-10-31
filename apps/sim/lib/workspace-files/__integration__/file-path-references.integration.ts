/**
 * Real PostgreSQL behavior of single-file operations addressed by a `files/…` VFS path instead
 * of an id: the path names exactly one live file in the asserted workspace, never a same-named
 * file in another folder or workspace, a chat upload or an archived file, and authorization is
 * unchanged. A caller who cannot reach the workspace learns nothing about the paths in it.
 */
import { db } from '@sim/db'
import { permissions, user, workspace, workspaceFiles } from '@sim/db/schema'
import { assertDisposableTestDatabaseUrl } from '@sim/db/testing/test-infrastructure'
import { deleteWorkspaceFixture, insertWorkspaceFixture } from '@sim/db/testing/workspace-fixtures'
import { generateId } from '@sim/utils/id'
import { eq, inArray, sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { workspaceFileVfsPath } from '@/lib/uploads/contexts/workspace/file-manager'
import { deleteWorkspaceFileOperation } from '@/lib/workspace-files/application/delete-workspace-file'
import { readWorkspaceFileMetadataWithVersion } from '@/lib/workspace-files/application/read-workspace-file-metadata'
import { renameWorkspaceFile } from '@/lib/workspace-files/application/rename-workspace-file'

const alice = generateId()
const bob = generateId()
const carol = generateId()
const workspaceId = generateId()
const otherWorkspaceId = generateId()
const folders = { docs: generateId(), media: generateId(), foreign: generateId() }
const session = (userId: string) => ({ kind: 'session' as const, userId, sessionId: generateId() })

async function insertFile(input: {
  name: string
  folderId?: string | null
  workspaceId?: string
  context?: string
  deleted?: boolean
}): Promise<string> {
  const id = `wf_${generateId()}`
  const owner = input.workspaceId ?? workspaceId
  await db.execute(sql`
    INSERT INTO ${workspaceFiles} (id, key, user_id, workspace_id, folder_id, context, original_name,
      content_type, size_bytes, uploaded_at, updated_at, deleted_at)
    VALUES (${id}, ${`workspace/${owner}/${generateId()}-${input.name}`}, ${alice}, ${owner},
      ${input.folderId ?? null}, ${input.context ?? 'workspace'}, ${input.name}, 'text/csv', 10,
      now(), now(), ${input.deleted ? sql`now()` : sql`NULL`})`)
  return id
}

async function row(id: string) {
  const [file] = await db
    .select({ name: workspaceFiles.originalName, deletedAt: workspaceFiles.deletedAt })
    .from(workspaceFiles)
    .where(eq(workspaceFiles.id, id))
  return file
}

const describeFile = (fileId: string, userId = alice, assertedWorkspaceId = workspaceId) =>
  readWorkspaceFileMetadataWithVersion.execute({
    principal: session(userId),
    input: { fileId, assertedWorkspaceId },
  })

const deleteFile = (fileId: string, userId = alice) =>
  deleteWorkspaceFileOperation.execute({
    principal: session(userId),
    input: { fileId, assertedWorkspaceId: workspaceId },
  })

describe('single-file operations addressed by VFS path', () => {
  const ids = {
    rootReport: '',
    docsReport: '',
    mediaReport: '',
    foreignReport: '',
    chatUpload: '',
    archived: '',
    docsContent: '',
    docsOnly: '',
    spaced: '',
    alikeSpaced: '',
    alikeSingle: '',
  }

  beforeAll(async () => {
    assertDisposableTestDatabaseUrl(process.env.DATABASE_URL ?? '')
    await db.insert(user).values(
      [alice, bob, carol].map((id) => ({
        id,
        name: `Fixture ${id}`,
        email: `${id}@fixture.test`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      }))
    )
    await insertWorkspaceFixture(db, [
      { id: workspaceId, name: 'Path fixture', ownerId: alice, billedAccountUserId: alice },
      { id: otherWorkspaceId, name: 'Other fixture', ownerId: alice, billedAccountUserId: alice },
    ])
    await db.insert(permissions).values([
      {
        id: generateId(),
        userId: alice,
        entityType: 'workspace',
        entityId: workspaceId,
        permissionType: 'admin',
      },
      {
        id: generateId(),
        userId: bob,
        entityType: 'workspace',
        entityId: workspaceId,
        permissionType: 'read',
      },
      {
        id: generateId(),
        userId: alice,
        entityType: 'workspace',
        entityId: otherWorkspaceId,
        permissionType: 'admin',
      },
    ])
    await db.execute(sql`
      INSERT INTO folder (id, name, user_id, workspace_id, resource_type, parent_id) VALUES
        (${folders.docs}, 'Docs', ${alice}, ${workspaceId}, 'file', NULL),
        (${folders.media}, 'Media', ${alice}, ${workspaceId}, 'file', NULL),
        (${folders.foreign}, 'Docs', ${alice}, ${otherWorkspaceId}, 'file', NULL)`)
    ids.rootReport = await insertFile({ name: 'report.csv' })
    ids.docsReport = await insertFile({ name: 'report.csv', folderId: folders.docs })
    ids.mediaReport = await insertFile({ name: 'report.csv', folderId: folders.media })
    ids.foreignReport = await insertFile({
      name: 'report.csv',
      folderId: folders.foreign,
      workspaceId: otherWorkspaceId,
    })
    ids.chatUpload = await insertFile({ name: 'notes.txt', context: 'mothership' })
    ids.archived = await insertFile({ name: 'old.csv', deleted: true })
    ids.docsContent = await insertFile({ name: 'content', folderId: folders.docs })
    ids.docsOnly = await insertFile({ name: 'only-here.csv', folderId: folders.docs })
    ids.spaced = await insertFile({ name: 'my  notes.csv' })
    ids.alikeSpaced = await insertFile({ name: 'a  b.csv', folderId: folders.media })
    ids.alikeSingle = await insertFile({ name: 'a b.csv', folderId: folders.media })
  })

  afterAll(async () => {
    await deleteWorkspaceFixture(db, inArray(workspace.id, [workspaceId, otherWorkspaceId]))
    await db.delete(user).where(inArray(user.id, [alice, bob, carol]))
  })

  it('describes the one file at the exact path, not a same-named file elsewhere', async () => {
    expect((await describeFile('files/Docs/report.csv')).file.id).toBe(ids.docsReport)
    expect((await describeFile('files/report.csv')).file.id).toBe(ids.rootReport)
    await expect(describeFile('files/Archive/report.csv')).rejects.toMatchObject({
      code: 'not_found',
    })
    await expect(describeFile('files/Docs')).rejects.toMatchObject({ code: 'not_found' })
    await expect(describeFile('files/only-here.csv')).rejects.toMatchObject({
      code: 'not_found',
    })
  })

  it('treats a trailing `content` or `meta.json` as a name, never as the parent file', async () => {
    expect((await describeFile('files/Docs/content')).file.id).toBe(ids.docsContent)
    await expect(deleteFile('files/report.csv/content')).rejects.toMatchObject({
      code: 'not_found',
    })
    await expect(deleteFile('files/report.csv/meta.json')).rejects.toMatchObject({
      code: 'not_found',
    })
    expect((await row(ids.rootReport))?.deletedAt).toBeNull()
  })

  it('resolves the path a listing prints for a name it displays normalized', async () => {
    const listed = workspaceFileVfsPath((await describeFile(ids.spaced)).file)
    expect((await describeFile(listed)).file.id).toBe(ids.spaced)
  })

  it('refuses a path two display-alike names share instead of picking one', async () => {
    const listed = workspaceFileVfsPath((await describeFile(ids.alikeSingle)).file)
    await expect(deleteFile(listed)).rejects.toMatchObject({ code: 'validation' })
    for (const id of [ids.alikeSpaced, ids.alikeSingle]) {
      expect((await row(id))?.deletedAt).toBeNull()
    }
  })

  it('renames and deletes only the file the path names', async () => {
    const renamed = await renameWorkspaceFile.execute({
      principal: session(alice),
      input: { fileId: 'files/Docs/report.csv', assertedWorkspaceId: workspaceId, name: 'q3.csv' },
    })
    expect(renamed.file.id).toBe(ids.docsReport)
    expect((await row(ids.docsReport))?.name).toBe('q3.csv')

    expect(await deleteFile('files/Media/report.csv')).toMatchObject({
      id: ids.mediaReport,
      deleted: true,
    })
    expect((await row(ids.mediaReport))?.deletedAt).not.toBeNull()

    for (const untouched of [ids.rootReport, ids.foreignReport]) {
      expect(await row(untouched)).toMatchObject({ name: 'report.csv', deletedAt: null })
    }
  })

  it('resolves a path only inside the asserted workspace', async () => {
    await expect(
      describeFile('files/Docs/report.csv', alice, otherWorkspaceId)
    ).resolves.toMatchObject({ file: { id: ids.foreignReport } })
    await expect(
      readWorkspaceFileMetadataWithVersion.execute({
        principal: session(alice),
        input: { fileId: 'files/report.csv' },
      })
    ).rejects.toMatchObject({ code: 'not_found' })
  })

  it('never reaches a chat upload or an archived file through a path', async () => {
    await expect(deleteFile('files/notes.txt')).rejects.toMatchObject({ code: 'not_found' })
    expect((await row(ids.chatUpload))?.deletedAt).toBeNull()
    await expect(describeFile('files/old.csv')).rejects.toMatchObject({ code: 'not_found' })
  })

  it('keeps authorization: a read member cannot delete and a non-member cannot read', async () => {
    await expect(deleteFile('files/report.csv', bob)).rejects.toMatchObject({ code: 'forbidden' })
    await expect(describeFile('files/report.csv', carol)).rejects.toMatchObject({
      code: 'forbidden',
    })
    expect((await row(ids.rootReport))?.deletedAt).toBeNull()
  })

  it('answers a non-member the same for an ambiguous, a missing and an existing path', async () => {
    const ambiguous = workspaceFileVfsPath((await describeFile(ids.alikeSingle)).file)
    const outcomes = await Promise.all(
      [ambiguous, 'files/missing.csv', 'files/report.csv'].map((path) =>
        describeFile(path, carol).then(
          () => null,
          (error: { code?: string; message?: string }) => ({
            code: error.code,
            message: error.message,
          })
        )
      )
    )
    expect(outcomes[0]).toMatchObject({ code: 'forbidden' })
    expect(outcomes[1]).toEqual(outcomes[0])
    expect(outcomes[2]).toEqual(outcomes[0])
    await expect(describeFile('files/Docs/../report.csv', carol)).rejects.toMatchObject({
      code: 'validation',
    })
  })

  it('rejects a dot-segment path instead of walking out of its folder', async () => {
    await expect(deleteFile('files/Docs/../report.csv')).rejects.toMatchObject({
      code: 'validation',
    })
    expect((await row(ids.rootReport))?.deletedAt).toBeNull()
  })
})
