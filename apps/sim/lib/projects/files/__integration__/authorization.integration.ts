import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import type {
  OAuthAccessTokenPrincipal,
  ResourceDelegatedPrincipal,
  ResourceFileCopyScope,
} from '@sim/auth/principal'
import { db } from '@sim/db'
import {
  copilotChats,
  folder,
  member,
  organization,
  permissionGroup,
  permissionGroupWorkspace,
  permissions,
  project,
  projectWorkspace,
  user,
  workspace,
  workspaceFiles,
} from '@sim/db/schema'
import { deleteWorkspaceFixture, insertWorkspaceFixture } from '@sim/db/testing/workspace-fixtures'
import {
  createExecutorPrincipal,
  createPersonalApiKeyPrincipal,
  createSessionPrincipal,
  createWorkspaceApiKeyPrincipal,
} from '@sim/testing/factories/principal.factory'
import { createDeferred } from '@sim/testing/helpers/deferred'
import { getErrorMessage, getPostgresErrorCode } from '@sim/utils/errors'
import { sleep } from '@sim/utils/helpers'
import { generateId } from '@sim/utils/id'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  copilotRequestPrincipal,
  markCopilotProjectFileRequest,
} from '@/lib/api/server/routes/copilot-request'
import type { DbTransaction } from '@/lib/db/types'
import { createProjectFileCliTransport } from '@/lib/mothership/agent-cli/project-file-transport'
import {
  type CopilotExecutionContext,
  createCopilotResourceAdmission,
} from '@/lib/mothership/auth/application-delegation'
import { acquirePermissionGroupOrgLock } from '@/lib/permission-groups/locks'
import { renameProject } from '@/lib/projects/application'
import {
  createProjectFileFolder,
  getProjectFileMetadata,
  listProjectFileFolders,
  listProjectFiles,
  resolveProjectFileReference,
  updateProjectFileFolder,
} from '@/lib/projects/files/application'
import { defineAuthorizedProjectFileUseCase } from '@/lib/projects/files/application/authorized-use-case'
import { projectFileOperations } from '@/lib/projects/files/application/operations'
import { resolveFileFolderTarget } from '@/lib/uploads/contexts/workspace'
import { createFileCopyAuthorizer } from '@/lib/workspace-files/application/copy-authorization'

const readAccess = defineAuthorizedProjectFileUseCase({
  operation: projectFileOperations.list,
  async execute({ context }) {
    return { projectId: context.projectId, canWrite: context.canWrite }
  },
})
const writeAccess = defineAuthorizedProjectFileUseCase({
  operation: projectFileOperations.create,
  async execute({ context }) {
    return { projectId: context.projectId }
  },
})
const readFile = defineAuthorizedProjectFileUseCase({
  operation: projectFileOperations.readContent,
  async execute({ context }) {
    return { fileId: context.file?.id }
  },
})
const resolveFolderTarget = defineAuthorizedProjectFileUseCase<
  typeof projectFileOperations.create,
  { projectId: string; folderId?: string | null; folderPath?: string },
  Awaited<ReturnType<typeof resolveFileFolderTarget>>
>({
  operation: projectFileOperations.create,
  async execute({
    input,
    context,
    tx,
  }: {
    input: { projectId: string; folderId?: string | null; folderPath?: string }
    context: { owner: { entityType: 'project'; entityId: string } }
    tx: DbTransaction
  }) {
    return resolveFileFolderTarget(context.owner, input, tx)
  },
})

const fixtures: {
  users: string[]
  organizationId: string
  projectId: string
  workspaces: string[]
}[] = []
const checks: { name: string; status: 'passed' | 'failed'; durationMs: number; error?: string }[] =
  []

beforeEach(() => {
  vi.stubEnv('PROJECT_API_ENABLED', 'true')
  vi.stubEnv('PROJECT_FILES_ENABLED', 'true')
})

function check(name: string, run: () => Promise<void>) {
  it(name, async () => {
    const started = performance.now()
    try {
      await run()
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
}

async function fixture() {
  const ownerId = generateId()
  const readerId = generateId()
  const organizationId = generateId()
  const projectId = generateId()
  const workspaces = [generateId(), generateId()]
  fixtures.push({ users: [ownerId, readerId], organizationId, projectId, workspaces })
  await db.insert(user).values(
    [ownerId, readerId].map((id) => ({
      id,
      name: 'Project file fixture',
      email: `${id}@files.invalid`,
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    }))
  )
  await db.insert(organization).values({
    id: organizationId,
    name: 'Project files',
    slug: organizationId,
    createdAt: new Date(),
  })
  await db.insert(member).values([
    { id: generateId(), organizationId, userId: ownerId, role: 'owner', createdAt: new Date() },
    { id: generateId(), organizationId, userId: readerId, role: 'member', createdAt: new Date() },
  ])
  await db.transaction(async (tx) => {
    await tx
      .insert(project)
      .values({ id: projectId, organizationId, ownerId, name: 'Project files' })
    await tx.insert(workspace).values(
      workspaces.map((id, index) => ({
        id,
        organizationId,
        ownerId,
        billedAccountUserId: ownerId,
        workspaceMode: 'organization' as const,
        name: 'Environment',
        forkedFromWorkspaceId: index ? workspaces[0] : null,
      }))
    )
    await tx
      .insert(projectWorkspace)
      .values(workspaces.map((workspaceId) => ({ projectId, workspaceId })))
  })
  await db.insert(permissions).values({
    id: generateId(),
    entityType: 'workspace',
    entityId: workspaces[0],
    userId: readerId,
    permissionType: 'read',
  })
  return {
    ownerId,
    readerId,
    organizationId,
    projectId,
    workspaces,
    reader: createSessionPrincipal({ userId: readerId }),
  }
}

async function grant(
  userId: string,
  workspaceId: string,
  permissionType: 'read' | 'write' | 'admin'
) {
  await db
    .delete(permissions)
    .where(
      and(
        eq(permissions.userId, userId),
        eq(permissions.entityType, 'workspace'),
        eq(permissions.entityId, workspaceId)
      )
    )
  await db.insert(permissions).values({
    id: generateId(),
    userId,
    entityType: 'workspace',
    entityId: workspaceId,
    permissionType,
  })
}

function delegated(
  userId: string,
  projectId: string,
  workspaceId: string
): Extract<ResourceDelegatedPrincipal, { serviceId: 'copilot' }> {
  return {
    kind: 'resource_delegated',
    serviceId: 'copilot',
    subjectUserId: userId,
    audience: 'sim:project-files',
    delegationId: generateId(),
    issuedAt: new Date(),
    expiresAt: new Date(Date.now() + 30_000),
    scope: { kind: 'entity', entityType: 'project', entityId: projectId },
    invocation: { kind: 'workspace', workspaceId },
  }
}

afterAll(async () => {
  const reportPath =
    process.env.PROJECT_FILE_AUTHORIZATION_REPORT_PATH ??
    resolve('test-results/project-file-authorization.json')
  await mkdir(dirname(reportPath), { recursive: true })
  await writeFile(reportPath, JSON.stringify({ checks }, null, 2))
  for (const f of fixtures) {
    await db
      .delete(workspaceFiles)
      .where(
        and(eq(workspaceFiles.entityType, 'project'), eq(workspaceFiles.entityId, f.projectId))
      )
    await db
      .delete(folder)
      .where(and(eq(folder.entityType, 'project'), eq(folder.entityId, f.projectId)))
    await deleteWorkspaceFixture(db, inArray(workspace.id, f.workspaces))
    await db.delete(organization).where(eq(organization.id, f.organizationId))
    await db.delete(user).where(inArray(user.id, f.users))
  }
})

describe('Project file authority at the database boundary', () => {
  check(
    'folder writes preserve hierarchy and attribution while enforcing writer authority',
    async () => {
      const f = await fixture()
      const args = { principal: f.reader, input: { projectId: f.projectId, name: 'Docs' } }
      await expect(createProjectFileFolder.execute(args)).rejects.toMatchObject({
        code: 'forbidden',
      })
      await grant(f.readerId, f.workspaces[0], 'admin')
      const { folder: root } = await createProjectFileFolder.execute(args)
      const { folder: child } = await createProjectFileFolder.execute({
        ...args,
        input: { ...args.input, name: 'Before', parentId: root.id },
      })
      const { folder: destination } = await createProjectFileFolder.execute({
        ...args,
        input: { ...args.input, name: 'Resources' },
      })
      const result = await updateProjectFileFolder.execute({
        ...args,
        input: {
          projectId: f.projectId,
          folderId: child.id,
          name: 'Architecture',
          parentId: destination.id,
        },
      })
      expect(result.folder).toMatchObject({
        id: child.id,
        owner: { entityType: 'project', entityId: f.projectId },
        userId: f.readerId,
        parentId: destination.id,
        path: 'Resources/Architecture',
      })
      const listing = await listProjectFileFolders.execute({
        principal: f.reader,
        input: { projectId: f.projectId },
      })
      expect(listing.folders.map((folder) => folder.id).sort()).toEqual(
        [root.id, child.id, destination.id].sort()
      )
      expect(
        await resolveFolderTarget.execute({
          principal: f.reader,
          input: { projectId: f.projectId, folderPath: '/Resources/Architecture' },
        })
      ).toMatchObject({ id: child.id })
      expect(
        await resolveFolderTarget.execute({
          principal: f.reader,
          input: { projectId: f.projectId, folderId: child.id },
        })
      ).toMatchObject({ id: child.id })
      expect(
        await resolveFolderTarget.execute({
          principal: f.reader,
          input: { projectId: f.projectId, folderPath: '/' },
        })
      ).toBeNull()
    }
  )

  check(
    'folder mutations refuse foreign owners, duplicate siblings, cycles and ambiguous targets',
    async () => {
      const f = await fixture()
      const other = await fixture()
      await grant(f.readerId, f.workspaces[0], 'admin')
      const principal = f.reader
      const { folder: root } = await createProjectFileFolder.execute({
        principal,
        input: { projectId: f.projectId, name: 'Docs' },
      })
      const { folder: child } = await createProjectFileFolder.execute({
        principal,
        input: { projectId: f.projectId, name: 'Nested', parentId: root.id },
      })
      const { folder: foreign } = await createProjectFileFolder.execute({
        principal: createSessionPrincipal({ userId: other.ownerId }),
        input: { projectId: other.projectId, name: 'Docs' },
      })
      await expect(
        createProjectFileFolder.execute({
          principal,
          input: { projectId: f.projectId, name: 'Docs' },
        })
      ).rejects.toMatchObject({ code: 'conflict' })
      await expect(
        createProjectFileFolder.execute({
          principal,
          input: { projectId: f.projectId, name: 'Invalid', parentId: foreign.id },
        })
      ).rejects.toMatchObject({ code: 'not_found' })
      for (const input of [
        { projectId: f.projectId, folderId: foreign.id, name: 'Invalid' },
        { projectId: f.projectId, folderId: child.id, parentId: foreign.id },
      ])
        await expect(updateProjectFileFolder.execute({ principal, input })).rejects.toMatchObject({
          code: 'not_found',
        })
      for (const parentId of [root.id, child.id])
        await expect(
          updateProjectFileFolder.execute({
            principal,
            input: { projectId: f.projectId, folderId: root.id, parentId },
          })
        ).rejects.toMatchObject({ code: 'validation' })
      await expect(
        resolveFolderTarget.execute({
          principal,
          input: { projectId: f.projectId, folderId: root.id, folderPath: '/Docs' },
        })
      ).rejects.toMatchObject({ code: 'validation' })
      await expect(
        resolveFolderTarget.execute({
          principal,
          input: { projectId: f.projectId, folderPath: '/Missing' },
        })
      ).rejects.toMatchObject({ code: 'not_found' })
      await expect(
        resolveFolderTarget.execute({
          principal,
          input: { projectId: f.projectId, folderId: foreign.id },
        })
      ).rejects.toMatchObject({ code: 'not_found' })
      const listing = await listProjectFileFolders.execute({
        principal,
        input: { projectId: f.projectId },
      })
      expect(
        listing.folders.map((folder) => ({ id: folder.id, parentId: folder.parentId }))
      ).toEqual(
        expect.arrayContaining([
          { id: root.id, parentId: null },
          { id: child.id, parentId: root.id },
        ])
      )
    }
  )

  check(
    'file listing isolates owners and preserves pagination and nested folder attribution',
    async () => {
      const f = await fixture()
      const other = await fixture()
      const rootFileId = generateId()
      const nestedFileId = generateId()
      const folderId = generateId()
      await db.insert(folder).values({
        id: folderId,
        entityType: 'project',
        entityId: f.projectId,
        resourceType: 'file',
        name: 'Docs',
        userId: f.ownerId,
      })
      await db.insert(workspaceFiles).values([
        {
          id: rootFileId,
          userId: f.ownerId,
          entityType: 'project',
          entityId: f.projectId,
          context: 'project',
          key: `project/${f.projectId}/${rootFileId}`,
          originalName: 'a.md',
          contentType: 'text/markdown',
          sizeBytes: 0,
        },
        {
          id: nestedFileId,
          userId: f.ownerId,
          entityType: 'project',
          entityId: f.projectId,
          context: 'project',
          folderId,
          key: `project/${f.projectId}/${nestedFileId}`,
          originalName: 'b.md',
          contentType: 'text/markdown',
          sizeBytes: 0,
        },
        {
          id: generateId(),
          userId: f.ownerId,
          workspaceId: f.workspaces[0],
          context: 'workspace',
          key: `workspace/${f.workspaces[0]}/a.md`,
          originalName: 'a.md',
          contentType: 'text/markdown',
          sizeBytes: 0,
        },
        {
          id: generateId(),
          userId: other.ownerId,
          entityType: 'project',
          entityId: other.projectId,
          context: 'project',
          key: `project/${other.projectId}/a.md`,
          originalName: 'a.md',
          contentType: 'text/markdown',
          sizeBytes: 0,
        },
      ])
      const input = { projectId: f.projectId, limit: 1, sortBy: 'name', sortOrder: 'asc' } as const
      const first = await listProjectFiles.execute({ principal: f.reader, input })
      expect(first.capabilities).toEqual({ canRead: true, canWrite: false })
      expect(first.files.map((file) => file.id)).toEqual([rootFileId])
      expect(first.files[0]).toMatchObject({
        owner: { entityType: 'project', entityId: f.projectId },
        uploadedBy: f.ownerId,
        folderId: null,
        folderPath: null,
      })
      if (!first.nextKeys) throw new Error('The next Project file page must be available')
      const second = await listProjectFiles.execute({
        principal: f.reader,
        input: { ...input, after: first.nextKeys },
      })
      expect(second.files.map((file) => file.id)).toEqual([nestedFileId])
      expect(second.files[0]).toMatchObject({ folderId, folderPath: 'Docs' })
      expect(second.nextKeys).toBeNull()
    }
  )

  check('folder path pages preserve shallow, recursive, root, and missing-path scope', async () => {
    const f = await fixture()
    const docsId = generateId()
    const nestedId = generateId()
    const siblingId = generateId()
    await db.insert(folder).values([
      {
        id: docsId,
        entityType: 'project',
        entityId: f.projectId,
        resourceType: 'file',
        name: 'Docs',
        userId: f.ownerId,
      },
      {
        id: nestedId,
        entityType: 'project',
        entityId: f.projectId,
        resourceType: 'file',
        name: 'Q3/Q4',
        parentId: docsId,
        userId: f.ownerId,
      },
      {
        id: siblingId,
        entityType: 'project',
        entityId: f.projectId,
        resourceType: 'file',
        name: 'Elsewhere',
        userId: f.ownerId,
      },
    ])
    const fileIds = [generateId(), generateId(), generateId(), generateId()]
    await db.insert(workspaceFiles).values(
      fileIds.map((id, index) => ({
        id,
        userId: f.ownerId,
        entityType: 'project' as const,
        entityId: f.projectId,
        context: 'project',
        folderId: [null, docsId, nestedId, siblingId][index],
        key: `project/${f.projectId}/${id}`,
        originalName: `${index}.md`,
        contentType: 'text/markdown',
        sizeBytes: 0,
      }))
    )
    const base = { projectId: f.projectId, limit: 100, sortBy: 'name', sortOrder: 'asc' } as const
    const page = (filter: { folderPath?: string; recursive?: boolean; folderId?: string | null }) =>
      listProjectFiles.execute({ principal: f.reader, input: { ...base, ...filter } })
    expect((await page({ folderPath: '/Docs' })).files.map((file) => file.id)).toEqual([fileIds[1]])
    expect(
      (await page({ folderPath: '/Docs', recursive: true })).files.map((file) => file.id)
    ).toEqual([fileIds[1], fileIds[2]])
    expect((await page({ folderPath: '/Docs/Q3%2FQ4' })).files.map((file) => file.id)).toEqual([
      fileIds[2],
    ])
    expect((await page({ folderPath: '/' })).files.map((file) => file.id)).toEqual([fileIds[0]])
    expect((await page({ folderPath: '/', recursive: true })).files.map((file) => file.id)).toEqual(
      fileIds
    )
    expect((await page({ recursive: false })).files.map((file) => file.id)).toEqual(fileIds)
    expect(await page({ folderPath: '/Missing' })).toMatchObject({ files: [], nextKeys: null })
    await expect(page({ folderPath: '/Docs', folderId: siblingId })).rejects.toMatchObject({
      code: 'validation',
    })
    const first = await listProjectFiles.execute({
      principal: f.reader,
      input: { ...base, folderPath: '/Docs', recursive: true, limit: 1 },
    })
    if (!first.nextKeys) throw new Error('The nested folder page must have a cursor')
    const next = await listProjectFiles.execute({
      principal: f.reader,
      input: { ...base, folderPath: '/Docs', recursive: true, limit: 1, after: first.nextKeys },
    })
    expect(next.files.map((file) => file.id)).toEqual([fileIds[2]])
    expect(next.nextKeys).toBeNull()
    expect(
      (await listProjectFiles.execute({ principal: f.reader, input: { ...base, limit: 1000 } }))
        .files
    ).toHaveLength(4)
  })

  check(
    'file references resolve exact owner paths and conceal foreign or archived identities',
    async () => {
      const f = await fixture()
      const other = await fixture()
      const folderId = generateId()
      await db.insert(folder).values({
        id: folderId,
        entityType: 'project',
        entityId: f.projectId,
        resourceType: 'file',
        name: 'Q3/Q4',
        userId: f.ownerId,
      })
      const fileId = generateId()
      const foreignId = generateId()
      const archivedId = generateId()
      await db.insert(workspaceFiles).values([
        {
          id: fileId,
          userId: f.ownerId,
          entityType: 'project',
          entityId: f.projectId,
          context: 'project',
          folderId,
          key: `project/${f.projectId}/${fileId}`,
          originalName: 'Architecture overview.md',
          contentType: 'text/markdown',
          sizeBytes: 0,
        },
        {
          id: foreignId,
          userId: other.ownerId,
          entityType: 'project',
          entityId: other.projectId,
          context: 'project',
          key: `project/${other.projectId}/${foreignId}`,
          originalName: 'Architecture overview.md',
          contentType: 'text/markdown',
          sizeBytes: 0,
        },
        {
          id: archivedId,
          userId: f.ownerId,
          entityType: 'project',
          entityId: f.projectId,
          context: 'project',
          key: `project/${f.projectId}/${archivedId}`,
          originalName: 'old.md',
          contentType: 'text/markdown',
          sizeBytes: 0,
          deletedAt: new Date(),
        },
      ])
      const resolve = (fileReference: string) =>
        resolveProjectFileReference.execute({
          principal: f.reader,
          input: { projectId: f.projectId, fileReference },
        })
      const vfsPath = `projects/${f.projectId}/files/Q3%2FQ4/Architecture%20overview.md`
      for (const reference of [fileId, 'files/Q3%2FQ4/Architecture%20overview.md', vfsPath]) {
        const result = await resolve(reference)
        expect(result.file.id).toBe(fileId)
        expect(result.file.path).toBe(`/api/projects/${f.projectId}/files/${fileId}/content`)
        expect(result.vfsPath).toBe(vfsPath)
      }
      for (const reference of [
        foreignId,
        archivedId,
        'files/Q3%2FQ4/architecture%20overview.md',
        'files/Architecture%20overview.md',
      ]) {
        await expect(resolve(reference)).rejects.toMatchObject({ code: 'not_found' })
      }
      for (const reference of [
        `projects/${other.projectId}/files/Architecture%20overview.md`,
        `workspaces/${f.workspaces[0]}/files/example.md`,
        'files/../old.md',
        'files/Q3%2FQ4/%broken',
      ]) {
        await expect(resolve(reference)).rejects.toMatchObject({ code: 'validation' })
      }
    }
  )

  check(
    'file metadata returns creator attribution and conceals a foreign Project file ID',
    async () => {
      const f = await fixture()
      const other = await fixture()
      const fileId = generateId()
      const foreignFileId = generateId()
      await db.insert(workspaceFiles).values([
        {
          id: fileId,
          userId: f.ownerId,
          entityType: 'project',
          entityId: f.projectId,
          context: 'project',
          key: `project/${f.projectId}/${fileId}`,
          originalName: 'architecture.md',
          contentType: 'text/markdown',
          sizeBytes: 0,
        },
        {
          id: foreignFileId,
          userId: other.ownerId,
          entityType: 'project',
          entityId: other.projectId,
          context: 'project',
          key: `project/${other.projectId}/${foreignFileId}`,
          originalName: 'architecture.md',
          contentType: 'text/markdown',
          sizeBytes: 0,
        },
      ])
      const result = await getProjectFileMetadata.execute({
        principal: f.reader,
        input: { projectId: f.projectId, fileId },
      })
      expect(result.capabilities).toEqual({ canRead: true, canWrite: false })
      expect(result.file).toMatchObject({
        id: fileId,
        owner: { entityType: 'project', entityId: f.projectId },
        name: 'architecture.md',
        uploadedBy: f.ownerId,
      })
      await expect(
        getProjectFileMetadata.execute({
          principal: f.reader,
          input: { projectId: f.projectId, fileId: foreignFileId },
        })
      ).rejects.toMatchObject({ code: 'not_found' })
    }
  )

  check('partial readers can read but cannot write or administer the Project', async () => {
    const f = await fixture()
    const args = { principal: f.reader, input: { projectId: f.projectId } }
    expect(await readAccess.execute(args)).toEqual({ projectId: f.projectId, canWrite: false })
    await expect(writeAccess.execute(args)).rejects.toMatchObject({ code: 'forbidden' })
    await grant(f.readerId, f.workspaces[0], 'admin')
    expect(await writeAccess.execute(args)).toEqual({ projectId: f.projectId })
    await expect(
      renameProject.execute({
        ...args,
        input: { projectId: f.projectId, name: 'Forbidden rename' },
      })
    ).rejects.toMatchObject({ code: 'forbidden' })
  })

  check(
    'write requires every active environment unless an environment admin or org admin',
    async () => {
      const f = await fixture()
      const args = { principal: f.reader, input: { projectId: f.projectId } }
      await grant(f.readerId, f.workspaces[0], 'write')
      await expect(writeAccess.execute(args)).rejects.toMatchObject({ code: 'forbidden' })
      await grant(f.readerId, f.workspaces[1], 'write')
      expect(await writeAccess.execute(args)).toEqual({ projectId: f.projectId })
      await grant(f.readerId, f.workspaces[1], 'read')
      await expect(writeAccess.execute(args)).rejects.toMatchObject({ code: 'forbidden' })
      expect(
        await writeAccess.execute({
          ...args,
          principal: createSessionPrincipal({ userId: f.ownerId }),
        })
      ).toEqual({ projectId: f.projectId })
      await grant(f.readerId, f.workspaces[1], 'admin')
      await db
        .update(workspace)
        .set({ archivedAt: new Date() })
        .where(eq(workspace.id, f.workspaces[1]))
      expect(await writeAccess.execute(args)).toEqual({ projectId: f.projectId })
      await db.transaction(async (tx) => {
        await tx
          .update(workspace)
          .set({ archivedAt: new Date() })
          .where(inArray(workspace.id, f.workspaces))
        await tx.update(project).set({ archivedAt: new Date() }).where(eq(project.id, f.projectId))
      })
      await expect(
        writeAccess.execute({ ...args, principal: createSessionPrincipal({ userId: f.ownerId }) })
      ).rejects.toMatchObject({ code: 'conflict' })
    }
  )

  check(
    'credential policy aggregates accessible environments and rechecks OAuth scope',
    async () => {
      const f = await fixture()
      await grant(f.readerId, f.workspaces[0], 'admin')
      const principal = createPersonalApiKeyPrincipal({ userId: f.readerId })
      const input = { projectId: f.projectId }
      await db
        .update(workspace)
        .set({ allowPersonalApiKeys: false })
        .where(eq(workspace.id, f.workspaces[1]))
      expect(await writeAccess.execute({ principal, input })).toEqual({ projectId: f.projectId })
      await grant(f.readerId, f.workspaces[1], 'read')
      await expect(writeAccess.execute({ principal, input })).rejects.toMatchObject({
        detailCode: 'PERSONAL_API_KEYS_DISABLED',
      })
      const oauth: OAuthAccessTokenPrincipal = {
        kind: 'oauth_access_token',
        userId: f.readerId,
        clientId: 'fixture-client',
        tokenId: generateId(),
        scopes: ['api:read'],
        expiresAt: new Date(Date.now() + 60_000),
      }
      await expect(writeAccess.execute({ principal: oauth, input })).rejects.toMatchObject({
        detailCode: 'INSUFFICIENT_SCOPE',
      })
    }
  )

  check(
    'Files permission policy aggregates visible environments without importing the Issues gate',
    async () => {
      const f = await fixture()
      const groupId = generateId()
      await db.insert(permissionGroup).values({
        id: groupId,
        organizationId: f.organizationId,
        createdBy: f.ownerId,
        name: 'Files disabled',
        config: { hideFilesTab: true },
        membershipMode: 'inherit',
      })
      await db.insert(permissionGroupWorkspace).values({
        id: generateId(),
        permissionGroupId: groupId,
        workspaceId: f.workspaces[1],
        organizationId: f.organizationId,
      })
      const args = { principal: f.reader, input: { projectId: f.projectId } }
      expect(await readAccess.execute(args)).toEqual({ projectId: f.projectId, canWrite: false })
      await grant(f.readerId, f.workspaces[1], 'read')
      await expect(readAccess.execute(args)).rejects.toMatchObject({
        detailCode: 'PERMISSION_GROUP_CAPABILITY_BLOCKED',
      })
      await db
        .update(permissionGroup)
        .set({ config: { deniedPartialAccessProjectIssues: [f.projectId] } })
        .where(eq(permissionGroup.id, groupId))
      expect(await readAccess.execute(args)).toEqual({ projectId: f.projectId, canWrite: false })
    }
  )

  check(
    'workspace keys and executor authority cannot be upgraded into Project access',
    async () => {
      const f = await fixture()
      const input = { projectId: f.projectId }
      for (const principal of [
        createWorkspaceApiKeyPrincipal({ workspaceId: f.workspaces[0] }),
        createExecutorPrincipal({ subjectUserId: f.ownerId, workspaceId: f.workspaces[0] }),
      ]) {
        await expect(readAccess.execute({ principal, input })).rejects.toMatchObject({
          detailCode: 'PRINCIPAL_KIND_NOT_PERMITTED',
        })
      }
    }
  )

  check(
    'Copilot delegation binds its current environment and rejects revoked access or forged scope',
    async () => {
      const f = await fixture()
      const principal = delegated(f.readerId, f.projectId, f.workspaces[0])
      const input = { projectId: f.projectId }
      expect(await readAccess.execute({ principal, input })).toEqual({
        projectId: f.projectId,
        canWrite: false,
      })
      await expect(
        readAccess.execute({ principal: { ...principal, expiresAt: new Date(0) }, input })
      ).rejects.toMatchObject({ code: 'forbidden' })
      const fileId = generateId()
      await expect(
        readAccess.execute({
          principal: {
            ...principal,
            scope: { kind: 'entity', entityType: 'project', entityId: f.projectId, fileId },
          },
          input: { ...input, fileId },
        })
      ).rejects.toMatchObject({ code: 'validation' })
      await expect(
        readAccess.execute({
          principal: {
            ...principal,
            scope: { kind: 'entity', entityType: 'project', entityId: generateId() },
          },
          input,
        })
      ).rejects.toMatchObject({ code: 'forbidden' })
      await db.delete(permissions).where(eq(permissions.userId, f.readerId))
      await expect(readAccess.execute({ principal, input })).rejects.toMatchObject({
        code: 'forbidden',
      })
    }
  )

  check(
    'organization conversations can reach authorized Projects without selecting an environment',
    async () => {
      const f = await fixture()
      const chatId = generateId()
      await db.insert(copilotChats).values({
        id: chatId,
        userId: f.readerId,
        organizationId: f.organizationId,
        workspaceId: null,
        type: 'mothership',
        config: { conversationMode: 'agent' },
        title: 'Project context',
      })
      const principal: ResourceDelegatedPrincipal = {
        ...delegated(f.readerId, f.projectId, f.workspaces[0]),
        serviceId: 'copilot',
        invocation: { kind: 'chat', chatId },
      }
      expect(await readAccess.execute({ principal, input: { projectId: f.projectId } })).toEqual({
        projectId: f.projectId,
        canWrite: false,
      })
      await db
        .delete(member)
        .where(and(eq(member.userId, f.readerId), eq(member.organizationId, f.organizationId)))
      await expect(
        readAccess.execute({ principal, input: { projectId: f.projectId } })
      ).rejects.toMatchObject({ code: 'not_found' })
    }
  )

  check('checked environment key policy cannot change before a file mutation commits', async () => {
    const f = await fixture()
    await grant(f.readerId, f.workspaces[0], 'admin')
    const entered = createDeferred<void>()
    const release = createDeferred<void>()
    const mutation = defineAuthorizedProjectFileUseCase({
      operation: projectFileOperations.create,
      async execute() {
        entered.resolve()
        await release.promise
      },
    }).execute({
      principal: createPersonalApiKeyPrincipal({ userId: f.readerId }),
      input: { projectId: f.projectId },
    })
    await entered.promise
    try {
      const policyUpdate = db.transaction(async (tx) => {
        await tx.execute(sql`SET LOCAL lock_timeout = '100ms'`)
        await tx
          .update(workspace)
          .set({ allowPersonalApiKeys: false })
          .where(eq(workspace.id, f.workspaces[0]))
      })
      expect(await policyUpdate.then(() => null, getPostgresErrorCode)).toBe('55P03')
    } finally {
      release.resolve()
      await mutation
    }
  })

  check(
    'file-bound realtime grants cannot become listing authority or cross-file reads',
    async () => {
      const f = await fixture()
      const fileId = generateId()
      const folderId = generateId()
      await db.insert(folder).values({
        id: folderId,
        userId: f.ownerId,
        entityType: 'project',
        entityId: f.projectId,
        resourceType: 'file',
        name: 'Architecture',
      })
      await db.insert(workspaceFiles).values({
        id: fileId,
        entityType: 'project',
        entityId: f.projectId,
        userId: f.ownerId,
        context: 'project',
        folderId,
        key: `project/${f.projectId}/${fileId}`,
        originalName: 'architecture.md',
        contentType: 'text/markdown',
        sizeBytes: 0,
      })
      const principal: ResourceDelegatedPrincipal = {
        kind: 'resource_delegated',
        serviceId: 'realtime',
        subjectUserId: f.readerId,
        delegationId: generateId(),
        audience: 'sim:project-files',
        issuedAt: new Date(),
        expiresAt: new Date(Date.now() + 30_000),
        scope: { kind: 'entity', entityType: 'project', entityId: f.projectId, fileId },
        invocation: { kind: 'realtime', connectionId: 'fixture-connection' },
      }
      expect(
        await readFile.execute({ principal, input: { projectId: f.projectId, fileId } })
      ).toEqual({ fileId })
      await expect(
        readAccess.execute({ principal, input: { projectId: f.projectId } })
      ).rejects.toMatchObject({ code: 'forbidden' })
      await expect(
        readFile.execute({ principal, input: { projectId: f.projectId, fileId: generateId() } })
      ).rejects.toMatchObject({ code: 'forbidden' })
    }
  )
  check(
    'private v2 admission preserves the actor and rechecks live Project membership',
    async () => {
      const f = await fixture()
      const chatId = generateId()
      const fileId = generateId()
      await db.insert(copilotChats).values({
        id: chatId,
        userId: f.readerId,
        organizationId: f.organizationId,
        workspaceId: null,
        type: 'mothership',
        config: { conversationMode: 'agent' },
        title: 'Private Project files',
      })
      await db.insert(workspaceFiles).values({
        id: fileId,
        userId: f.ownerId,
        entityType: 'project',
        entityId: f.projectId,
        context: 'project',
        key: `project/${f.projectId}/${fileId}`,
        originalName: 'architecture.md',
        contentType: 'text/markdown',
        sizeBytes: 0,
      })
      const request = new Request(
        `http://localhost/api/v2/projects/${f.projectId}/files/${fileId}/metadata`
      )
      markCopilotProjectFileRequest(
        request,
        {
          userId: f.readerId,
          organizationId: f.organizationId,
          chatId,
          toolCallId: generateId(),
          copilotToolExecution: true,
          copilotResourceAdmission: createCopilotResourceAdmission({
            userId: f.readerId,
            invocation: { kind: 'chat', chatId },
          }),
        },
        { projectId: f.projectId, fileId }
      )
      const principal = copilotRequestPrincipal(
        request,
        projectFileOperations.readMetadata,
        getProjectFileMetadata
      )
      if (!principal) throw new Error('Private Project admission did not produce a principal')
      const input = { projectId: f.projectId, fileId }
      expect(await getProjectFileMetadata.execute({ principal, input })).toMatchObject({
        file: { id: fileId, owner: { entityType: 'project', entityId: f.projectId } },
        capabilities: { canRead: true, canWrite: false },
      })
      await expect(
        getProjectFileMetadata.execute({ principal, input: { ...input, fileId: generateId() } })
      ).rejects.toMatchObject({ code: 'forbidden' })
      await db.delete(permissions).where(eq(permissions.userId, f.readerId))
      await expect(getProjectFileMetadata.execute({ principal, input })).rejects.toMatchObject({
        code: 'not_found',
      })
    }
  )

  check(
    'Project-only v2 transport reaches the canonical route and cannot change owners',
    async () => {
      const f = await fixture()
      const fileId = generateId()
      await db.insert(workspaceFiles).values({
        id: fileId,
        userId: f.ownerId,
        entityType: 'project',
        entityId: f.projectId,
        context: 'project',
        key: `project/${f.projectId}/${fileId}`,
        originalName: 'transport.md',
        contentType: 'text/markdown',
        sizeBytes: 0,
      })
      const context: CopilotExecutionContext = {
        userId: f.readerId,
        workspaceId: f.workspaces[0],
        toolCallId: generateId(),
        copilotToolExecution: true,
        copilotResourceAdmission: createCopilotResourceAdmission({
          userId: f.readerId,
          invocation: { kind: 'workspace', workspaceId: f.workspaces[0] },
        }),
      }
      const endpoint = 'http://localhost:3000'
      const filePath = `/api/v2/projects/${f.projectId}/files/${fileId}/metadata`
      const transport = createProjectFileCliTransport(endpoint, context, {
        projectId: f.projectId,
        fileId,
      })
      const response = await transport(`${endpoint}${filePath}`)
      expect(response.status).toBe(200)
      expect(await response.json()).toMatchObject({
        data: { id: fileId, owner: { entityType: 'project', entityId: f.projectId } },
      })
      for (const url of [
        `http://other.invalid${filePath}`,
        `${endpoint}/api/v2/projects/${generateId()}/files/${fileId}/metadata`,
        `${endpoint}/api/v2/projects/${f.projectId}/files/${generateId()}/metadata`,
        `${endpoint}/api/v2/projects/${f.projectId}/files/folders`,
        `${endpoint}/api/v2/files/${fileId}/metadata?workspaceId=${f.workspaces[0]}`,
      ]) {
        expect((await transport(url)).status).toBe(400)
      }
      const projectTransport = createProjectFileCliTransport(endpoint, context, {
        projectId: f.projectId,
      })
      expect(
        (await projectTransport(`${endpoint}/api/v2/projects/${f.projectId}/files`)).status
      ).toBe(200)
      expect((await projectTransport(`${endpoint}${filePath}`)).status).toBe(200)
      context.boundWorkflowExecutionId = 'workflow-run'
      expect((await transport(`${endpoint}${filePath}`)).status).toBe(403)
    }
  )
})

describe('compound copy owner authority', () => {
  function selection(f: Awaited<ReturnType<typeof fixture>>): Omit<ResourceFileCopyScope, 'kind'> {
    return {
      source: {
        owner: { entityType: 'project', entityId: f.projectId },
        fileIds: [generateId()],
        folderIds: [],
      },
      destination: {
        owner: { entityType: 'workspace', entityId: f.workspaces[1] },
        folderId: null,
      },
    }
  }

  function copyPrincipal(
    f: Awaited<ReturnType<typeof fixture>>,
    input: Omit<ResourceFileCopyScope, 'kind'>
  ) {
    return {
      ...delegated(f.readerId, f.projectId, f.workspaces[0]),
      audience: 'sim:files:copy',
      scope: { kind: 'file_copy' as const, ...input },
    }
  }

  check(
    'copy checks source read and destination write independently and rechecks after preparation',
    async () => {
      const f = await fixture()
      await grant(f.readerId, f.workspaces[1], 'write')
      const input = selection(f)
      const authorize = await createFileCopyAuthorizer(f.reader, input)
      expect(await db.transaction(authorize)).toMatchObject({
        source: { owner: input.source.owner, canWrite: false, ownerUserId: f.ownerId },
        destination: { owner: input.destination.owner, billedAccountUserId: f.ownerId },
      })
      const reverse = {
        source: { ...input.source, owner: input.destination.owner },
        destination: { ...input.destination, owner: input.source.owner },
      }
      const reverseAuthorize = await createFileCopyAuthorizer(f.reader, reverse)
      await expect(db.transaction(reverseAuthorize)).rejects.toMatchObject({ code: 'forbidden' })
      await grant(f.readerId, f.workspaces[1], 'read')
      await expect(db.transaction(authorize)).rejects.toMatchObject({ code: 'forbidden' })
    }
  )

  check(
    'copy refuses widened paired grants, entity grants, workspace keys and executors',
    async () => {
      const f = await fixture()
      await grant(f.readerId, f.workspaces[1], 'write')
      const input = selection(f)
      const principal = copyPrincipal(f, input)
      expect(await db.transaction(await createFileCopyAuthorizer(principal, input))).toMatchObject({
        source: { owner: input.source.owner },
        destination: { owner: input.destination.owner },
      })
      for (const changed of [
        { ...input, source: { ...input.source, fileIds: [generateId()] } },
        { ...input, destination: { ...input.destination, folderId: generateId() } },
        { ...input, source: { ...input.source, owner: input.destination.owner } },
      ]) {
        await expect(createFileCopyAuthorizer(principal, changed)).rejects.toMatchObject({
          code: 'forbidden',
        })
      }
      const realtime: ResourceDelegatedPrincipal = {
        kind: 'resource_delegated',
        serviceId: 'realtime',
        subjectUserId: f.readerId,
        audience: 'sim:files:copy',
        delegationId: generateId(),
        issuedAt: new Date(),
        expiresAt: new Date(Date.now() + 30_000),
        scope: {
          kind: 'entity',
          entityType: 'project',
          entityId: f.projectId,
          fileId: input.source.fileIds[0],
        },
        invocation: { kind: 'realtime', connectionId: 'copy-fixture' },
      }
      for (const rejected of [
        realtime,
        delegated(f.readerId, f.projectId, f.workspaces[0]),
        createWorkspaceApiKeyPrincipal({ workspaceId: f.workspaces[1] }),
        createExecutorPrincipal({ subjectUserId: f.readerId, workspaceId: f.workspaces[1] }),
      ]) {
        await expect(createFileCopyAuthorizer(rejected, input)).rejects.toMatchObject({
          code: 'forbidden',
        })
      }
    }
  )

  check(
    'copy cannot escape the current workspace Project despite access to both owners',
    async () => {
      const f = await fixture()
      const other = await fixture()
      for (const workspaceId of other.workspaces) await grant(f.ownerId, workspaceId, 'admin')
      const input = {
        ...selection(f),
        destination: {
          owner: { entityType: 'project' as const, entityId: other.projectId },
          folderId: null,
        },
      }
      const principal = { ...copyPrincipal(f, input), subjectUserId: f.ownerId }
      const authorize = await createFileCopyAuthorizer(principal, input)
      await expect(db.transaction(authorize)).rejects.toMatchObject({ code: 'not_found' })
      expect(
        await db.transaction(
          await createFileCopyAuthorizer(createSessionPrincipal({ userId: f.ownerId }), input)
        )
      ).toMatchObject({ destination: { owner: input.destination.owner } })
    }
  )

  check('copy rechecks organization chat actor and mode at commit', async () => {
    const f = await fixture()
    await grant(f.readerId, f.workspaces[1], 'write')
    const input = selection(f)
    const chatId = generateId()
    await db.insert(copilotChats).values({
      id: chatId,
      userId: f.readerId,
      organizationId: f.organizationId,
      workspaceId: null,
      type: 'mothership',
      config: { conversationMode: 'agent' },
      title: 'Copy files',
    })
    const principal = { ...copyPrincipal(f, input), invocation: { kind: 'chat' as const, chatId } }
    const authorize = await createFileCopyAuthorizer(principal, input)
    expect(await db.transaction(authorize)).toMatchObject({ source: { owner: input.source.owner } })
    await db
      .update(copilotChats)
      .set({ config: { conversationMode: 'ask' } })
      .where(eq(copilotChats.id, chatId))
    await expect(db.transaction(authorize)).rejects.toMatchObject({ code: 'not_found' })
    await db
      .update(copilotChats)
      .set({ config: { conversationMode: 'agent' }, userId: f.ownerId })
      .where(eq(copilotChats.id, chatId))
    await expect(db.transaction(authorize)).rejects.toMatchObject({ code: 'not_found' })
  })

  check('copy applies personal-key availability and OAuth write scope to both owners', async () => {
    const f = await fixture()
    await grant(f.readerId, f.workspaces[1], 'write')
    await db
      .update(workspace)
      .set({ allowPersonalApiKeys: true })
      .where(inArray(workspace.id, f.workspaces))
    const input = selection(f)
    const key = createPersonalApiKeyPrincipal({ userId: f.readerId })
    expect(await db.transaction(await createFileCopyAuthorizer(key, input))).toMatchObject({
      destination: { owner: input.destination.owner },
    })
    await db
      .update(workspace)
      .set({ allowPersonalApiKeys: false })
      .where(eq(workspace.id, f.workspaces[0]))
    await expect(db.transaction(await createFileCopyAuthorizer(key, input))).rejects.toMatchObject({
      code: 'forbidden',
    })
    const oauth: OAuthAccessTokenPrincipal = {
      kind: 'oauth_access_token',
      userId: f.readerId,
      tokenId: generateId(),
      clientId: 'test-client',
      scopes: ['api:read'],
      expiresAt: new Date(Date.now() + 60_000),
    }
    await expect(createFileCopyAuthorizer(oauth, input)).rejects.toMatchObject({
      code: 'forbidden',
    })
  })

  check('copy blocks a suspended actor after preparation for workspace-only owners', async () => {
    const f = await fixture()
    await grant(f.readerId, f.workspaces[1], 'write')
    const original = selection(f)
    const input = {
      ...original,
      source: {
        ...original.source,
        owner: { entityType: 'workspace' as const, entityId: f.workspaces[0] },
      },
    }
    const authorize = await createFileCopyAuthorizer(f.reader, input)
    expect(await db.transaction(authorize)).toMatchObject({ source: { owner: input.source.owner } })
    await db.update(user).set({ banned: true }).where(eq(user.id, f.readerId))
    await expect(db.transaction(authorize)).rejects.toMatchObject({ code: 'forbidden' })
  })

  check(
    'copy locks opposite Project directions consistently in overlapping transactions',
    async () => {
      const f = await fixture()
      const other = await fixture()
      for (const workspaceId of other.workspaces) await grant(f.ownerId, workspaceId, 'admin')
      const principal = createSessionPrincipal({ userId: f.ownerId })
      const input = {
        ...selection(f),
        destination: {
          owner: { entityType: 'project' as const, entityId: other.projectId },
          folderId: null,
        },
      }
      const reverse = {
        source: { ...input.source, owner: input.destination.owner },
        destination: { ...input.destination, owner: input.source.owner },
      }
      const forward = await createFileCopyAuthorizer(principal, input)
      const backward = await createFileCopyAuthorizer(principal, reverse)
      const results = await Promise.all([db.transaction(forward), db.transaction(backward)])
      expect(results.map((result) => result.destination.owner.entityId)).toEqual([
        other.projectId,
        f.projectId,
      ])
    }
  )

  check(
    'copy does not upgrade shared membership locks across two Projects in one organization',
    async () => {
      const f = await fixture()
      const extraWorkspaceId = generateId()
      f.workspaces.push(extraWorkspaceId)
      await insertWorkspaceFixture(db, {
        id: extraWorkspaceId,
        name: 'Separate Project',
        organizationId: f.organizationId,
        ownerId: f.ownerId,
        billedAccountUserId: f.ownerId,
        workspaceMode: 'organization',
      })
      const [extra] = await db
        .select()
        .from(projectWorkspace)
        .where(eq(projectWorkspace.workspaceId, extraWorkspaceId))
      const first = selection(f)
      const second = {
        source: {
          ...first.source,
          owner: { entityType: 'project' as const, entityId: extra.projectId },
        },
        destination: {
          owner: { entityType: 'workspace' as const, entityId: extraWorkspaceId },
          folderId: null,
        },
      }
      const principal = createSessionPrincipal({ userId: f.ownerId })
      const authorizeFirst = await createFileCopyAuthorizer(principal, first)
      const authorizeSecond = await createFileCopyAuthorizer(principal, second)
      const ready = createDeferred<number>()
      const release = createDeferred<void>()
      const organizationEdit = db.transaction(async (tx) => {
        await acquirePermissionGroupOrgLock(tx, f.organizationId)
        const [connection] = await tx.execute<{ pid: number }>(sql`SELECT pg_backend_pid() AS pid`)
        ready.resolve(connection.pid)
        await release.promise
      })
      const pid = await Promise.race([
        ready.promise,
        organizationEdit.then(() => {
          throw new Error('Organization edit exited early')
        }),
      ])
      const outcomes = Promise.allSettled([
        db.transaction(authorizeFirst),
        db.transaction(authorizeSecond),
      ])
      try {
        let blocked = 0
        for (let attempt = 0; attempt < 100; attempt++) {
          const [state] = await db.execute<{ count: number }>(sql`
          SELECT count(*)::int AS count FROM pg_stat_activity
          WHERE ${pid} = ANY(pg_blocking_pids(pid)) AND wait_event = 'advisory'
        `)
          blocked = state.count
          if (blocked === 2) break
          await sleep(10)
        }
        expect(blocked).toBe(2)
      } finally {
        release.resolve()
        await organizationEdit
        await outcomes
      }
      const results = await outcomes
      expect(results.map((result) => result.status)).toEqual(['fulfilled', 'fulfilled'])
    }
  )
})
