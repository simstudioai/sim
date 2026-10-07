import { mkdtempSync } from 'node:fs'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { db } from '@sim/db'
import {
  folder,
  permissions,
  projectWorkspace,
  user,
  userStats,
  workspace,
  workspaceFiles,
} from '@sim/db/schema'
import { deleteWorkspaceFixture, insertWorkspaceFixture } from '@sim/db/testing/workspace-fixtures'
import { createSessionPrincipal } from '@sim/testing/factories/principal.factory'
import { setUploadDirServer, uploadsSetupMock } from '@sim/testing/mocks/uploads-setup.mock'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { eq, inArray } from 'drizzle-orm'
import { afterAll, expect, it, vi } from 'vitest'

vi.mock('@/lib/uploads/core/setup.server', () => uploadsSetupMock)

import { resolveStorageBillingContext } from '@/lib/billing/storage/context'
import {
  createWorkspaceFileFolder,
  listFileFolders,
  listWorkspaceFileFolders,
} from '@/lib/uploads/contexts/workspace/workspace-file-folder-manager'
import {
  fetchWorkspaceFileBuffer,
  getWorkspaceFile,
  updateWorkspaceFileContent,
  uploadWorkspaceFile,
} from '@/lib/uploads/contexts/workspace/workspace-file-manager'
import { queryWorkspaceFileVersions } from '@/lib/uploads/contexts/workspace/workspace-file-versions'
import { deleteUserAccount } from '@/lib/users/account-deletion'
import { readWorkspaceFileMetadata } from '@/lib/workspace-files/application/read-workspace-file-metadata'
import { revokeWorkspaceAccessTx } from '@/lib/workspaces/access/workspace-access'
import { verifyFileAccess } from '@/app/api/files/authorization'
import { toV2File } from '@/app/api/v2/files/utils'

const storageRoot = mkdtempSync(join(tmpdir(), 'sim-creator-lifetime-'))
setUploadDirServer(storageRoot)
const creatorId = generateId()
const collaboratorId = generateId()
const workspaceId = generateId()
const checks: { name: string; status: string; durationMs: number; error?: string }[] = []

afterAll(async () => {
  try {
    await db
      .delete(workspaceFiles)
      .where(inArray(workspaceFiles.userId, [creatorId, collaboratorId]))
    const [binding] = await db
      .select()
      .from(projectWorkspace)
      .where(eq(projectWorkspace.workspaceId, workspaceId))
    if (binding) {
      await db.delete(workspaceFiles).where(eq(workspaceFiles.projectId, binding.projectId))
      await db.delete(folder).where(eq(folder.projectId, binding.projectId))
    }
    await deleteWorkspaceFixture(db, eq(workspace.id, workspaceId))
    await db.delete(user).where(inArray(user.id, [creatorId, collaboratorId]))
  } finally {
    await db.$client.end()
    await rm(storageRoot, { recursive: true, force: true })
    const reportPath = process.env.FILE_CREATOR_APPLICATION_REPORT_PATH
    if (reportPath) {
      await mkdir(dirname(reportPath), { recursive: true })
      await writeFile(reportPath, JSON.stringify({ checks }, null, 2))
    }
  }
})

it('departure revokes access without erasing attribution; account deletion retains shared bytes, folders and history', async () => {
  const started = performance.now()
  const name = 'real departure, account deletion, current collaborator reads and writes'
  try {
    await db.insert(user).values(
      [creatorId, collaboratorId].map((id) => ({
        id,
        email: `${id}@creator.invalid`,
        name: 'Creator lifetime fixture',
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      }))
    )
    await db
      .insert(userStats)
      .values([creatorId, collaboratorId].map((userId) => ({ id: generateId(), userId })))
    await insertWorkspaceFixture(db, {
      id: workspaceId,
      ownerId: collaboratorId,
      billedAccountUserId: collaboratorId,
      name: 'Shared files',
    })
    await db.insert(permissions).values(
      [creatorId, collaboratorId].map((id) => ({
        id: generateId(),
        userId: id,
        entityType: 'workspace' as const,
        entityId: workspaceId,
        permissionType: 'admin' as const,
      }))
    )
    const createdFolder = await createWorkspaceFileFolder({
      workspaceId,
      userId: creatorId,
      name: 'Docs',
    })
    const uploaded = await uploadWorkspaceFile(
      workspaceId,
      creatorId,
      Buffer.from('original'),
      'notes.txt',
      'text/plain',
      { folderId: createdFolder.id, notifyWorkspaceChange: false }
    )
    await updateWorkspaceFileContent(
      workspaceId,
      uploaded.id,
      creatorId,
      Buffer.from('current'),
      undefined,
      { version: { source: 'api', authorUserId: creatorId }, syncLiveDoc: false }
    )
    const [binding] = await db
      .select()
      .from(projectWorkspace)
      .where(eq(projectWorkspace.workspaceId, workspaceId))
    const projectFolderId = generateId()
    await db.insert(folder).values({
      id: projectFolderId,
      projectId: binding.projectId,
      resourceType: 'file',
      userId: creatorId,
      name: 'Project docs',
    })
    const [before] = await db
      .select()
      .from(workspaceFiles)
      .where(eq(workspaceFiles.id, uploaded.id))
    const projectFileId = generateId()
    await db.insert(workspaceFiles).values({
      ...before,
      id: projectFileId,
      key: `project/${binding.projectId}/notes.txt`,
      workspaceId: null,
      projectId: binding.projectId,
      context: 'project',
      folderId: projectFolderId,
    })
    const billingBefore = await resolveStorageBillingContext(workspaceId)
    const creator = createSessionPrincipal({ userId: creatorId })
    const collaborator = createSessionPrincipal({ userId: collaboratorId })
    await expect(
      readWorkspaceFileMetadata.execute({
        principal: creator,
        input: { fileId: uploaded.id, assertedWorkspaceId: workspaceId },
      })
    ).resolves.toBeTruthy()
    expect(await verifyFileAccess(before.key, creatorId, undefined, 'general')).toBe(true)
    const revoked = await db.transaction((tx) =>
      revokeWorkspaceAccessTx(tx, { workspaceId, userId: creatorId })
    )
    expect(revoked.revoked).toBe(true)
    expect((await getWorkspaceFile(workspaceId, uploaded.id))?.uploadedBy).toBe(creatorId)
    await expect(
      readWorkspaceFileMetadata.execute({
        principal: creator,
        input: { fileId: uploaded.id, assertedWorkspaceId: workspaceId },
      })
    ).rejects.toThrow()
    for (const context of ['workspace', 'general', 'copilot', 'profile-pictures'] as const) {
      expect(await verifyFileAccess(before.key, creatorId, undefined, context)).toBe(false)
      expect(await verifyFileAccess(before.key, collaboratorId, undefined, context)).toBe(true)
    }
    const deletion = await deleteUserAccount(creatorId)
    expect(deletion.blockers).toEqual([])
    expect(await db.select({ id: user.id }).from(user).where(eq(user.id, creatorId))).toEqual([])
    const retained = await getWorkspaceFile(workspaceId, uploaded.id, { throwOnError: true })
    if (!retained) throw new Error('Shared file was deleted with its creator')
    expect(retained.uploadedBy).toBeNull()
    expect((await fetchWorkspaceFileBuffer(retained, { maxBytes: 1024 })).toString()).toBe(
      'current'
    )
    expect(
      (await listWorkspaceFileFolders(workspaceId)).find((folder) => folder.id === createdFolder.id)
        ?.userId
    ).toBeNull()
    expect(
      (await listFileFolders({ entityType: 'project', entityId: binding.projectId }))[0].userId
    ).toBeNull()
    expect(
      (await db.select().from(workspaceFiles).where(eq(workspaceFiles.id, projectFileId)))[0].userId
    ).toBeNull()
    expect((await toV2File(retained)).uploadedByEmail).toBeNull()
    await expect(
      readWorkspaceFileMetadata.execute({
        principal: collaborator,
        input: { fileId: uploaded.id, assertedWorkspaceId: workspaceId },
      })
    ).resolves.toBeTruthy()
    const history = await queryWorkspaceFileVersions(retained, { sortOrder: 'asc', limit: 10 })
    expect(history.versions).toHaveLength(2)
    expect(history.versions.every((version) => version.authorUserIds.includes(creatorId))).toBe(
      true
    )
    await updateWorkspaceFileContent(
      workspaceId,
      uploaded.id,
      collaboratorId,
      Buffer.from('edited after deletion'),
      undefined,
      { version: { source: 'api', authorUserId: collaboratorId }, syncLiveDoc: false }
    )
    expect((await getWorkspaceFile(workspaceId, uploaded.id))?.uploadedBy).toBeNull()
    expect(await resolveStorageBillingContext(workspaceId)).toEqual(billingBefore)
    checks.push({ name, status: 'passed', durationMs: performance.now() - started })
  } catch (error) {
    checks.push({
      name,
      status: 'failed',
      durationMs: performance.now() - started,
      error: getErrorMessage(error),
    })
    throw error
  }
})
