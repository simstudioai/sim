import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import type { OAuthAccessTokenPrincipal, ResourceDelegatedPrincipal } from '@sim/auth/principal'
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
  user,
  workspace,
  workspaceFiles,
} from '@sim/db/schema'
import { deleteWorkspaceFixture } from '@sim/db/testing/workspace-fixtures'
import {
  createExecutorPrincipal,
  createPersonalApiKeyPrincipal,
  createSessionPrincipal,
  createWorkspaceApiKeyPrincipal,
} from '@sim/testing/factories/principal.factory'
import { createDeferred } from '@sim/testing/helpers/deferred'
import { featureFlagsMock, featureFlagsMockFns } from '@sim/testing/mocks/feature-flags.mock'
import { getErrorMessage, getPostgresErrorCode } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DbTransaction } from '@/lib/db/types'
import { acquirePermissionGroupOrgLock } from '@/lib/permission-groups/locks'
import { renameProject } from '@/lib/projects/application'
import { ProjectConflictError } from '@/lib/projects/errors'
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
import { tryLockProjects } from '@/lib/projects/membership'
import { resolveFileFolderTarget } from '@/lib/uploads/contexts/workspace'
import { resolveArchivedFileFolderScope } from '@/lib/uploads/contexts/workspace/file-folder-manager'
import { readWorkspaceFileMetadata } from '@/lib/workspace-files/application/read-workspace-file-metadata'

vi.mock('@/lib/core/config/feature-flags', () => featureFlagsMock)

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
  featureFlagsMockFns.mockIsFeatureEnabled.mockImplementation(async (flag) => flag === 'projects')
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
        projectId,
        forkedFromWorkspaceId: index ? workspaces[0] : null,
      }))
    )
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
    const memberships = await db
      .select({ projectId: workspace.projectId })
      .from(workspace)
      .where(inArray(workspace.id, f.workspaces))
    const projectIds = [f.projectId, ...memberships.map((row) => row.projectId)]
    await db.delete(workspaceFiles).where(inArray(workspaceFiles.projectId, projectIds))
    await db.delete(folder).where(inArray(folder.projectId, projectIds))
    await deleteWorkspaceFixture(db, inArray(workspace.id, f.workspaces))
    await db.delete(project).where(inArray(project.id, projectIds))
    await db.delete(organization).where(eq(organization.id, f.organizationId))
    await db.delete(user).where(inArray(user.id, f.users))
  }
})

describe('Project file authority at the database boundary', () => {
  check('Project files follow the projects flag without a separate readiness switch', async () => {
    const f = await fixture()
    const request = { principal: f.reader, input: { projectId: f.projectId } }
    featureFlagsMockFns.mockIsFeatureEnabled.mockResolvedValue(false)
    await expect(readAccess.execute(request)).rejects.toMatchObject({ statusCode: 503 })
    featureFlagsMockFns.mockIsFeatureEnabled.mockImplementation(async (flag) => flag === 'projects')
    await expect(readAccess.execute(request)).resolves.toMatchObject({ projectId: f.projectId })
  })

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
        projectId: f.projectId,
        resourceType: 'file',
        name: 'Docs',
        userId: f.ownerId,
      })
      await db.insert(workspaceFiles).values([
        {
          id: rootFileId,
          userId: f.ownerId,
          projectId: f.projectId,
          context: 'project',
          key: `project/${f.projectId}/${rootFileId}`,
          originalName: 'a.md',
          contentType: 'text/markdown',
          sizeBytes: 0,
        },
        {
          id: nestedFileId,
          userId: f.ownerId,
          projectId: f.projectId,
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
          projectId: other.projectId,
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
        projectId: f.projectId,
        resourceType: 'file',
        name: 'Docs',
        userId: f.ownerId,
      },
      {
        id: nestedId,
        projectId: f.projectId,
        resourceType: 'file',
        name: 'Q3/Q4',
        parentId: docsId,
        userId: f.ownerId,
      },
      {
        id: siblingId,
        projectId: f.projectId,
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
        projectId: f.projectId,
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

    const archivedAt = new Date()
    await db.update(folder).set({ deletedAt: archivedAt }).where(eq(folder.id, nestedId))
    await db
      .update(workspaceFiles)
      .set({ deletedAt: archivedAt })
      .where(inArray(workspaceFiles.id, [fileIds[1], fileIds[2]]))
    const archivedDocsId = generateId()
    const replacementNestedId = generateId()
    await db.insert(folder).values([
      {
        id: archivedDocsId,
        projectId: f.projectId,
        resourceType: 'file',
        name: 'Docs',
        userId: f.ownerId,
        deletedAt: archivedAt,
      },
      {
        id: replacementNestedId,
        projectId: f.projectId,
        resourceType: 'file',
        name: 'Q3/Q4',
        parentId: docsId,
        userId: f.ownerId,
      },
    ])
    const archivedIds = [generateId(), generateId()]
    await db.insert(workspaceFiles).values(
      archivedIds.map((id, index) => ({
        id,
        userId: f.ownerId,
        projectId: f.projectId,
        context: 'project',
        folderId: [archivedDocsId, replacementNestedId][index],
        key: `project/${f.projectId}/${id}`,
        originalName: `${index + 4}.md`,
        contentType: 'text/markdown',
        sizeBytes: 0,
        deletedAt: archivedAt,
      }))
    )
    const archivedPage = (folderPath: string, recursive = false) =>
      listProjectFiles.execute({
        principal: f.reader,
        input: { ...base, scope: 'archived', folderPath, recursive },
      })
    expect(
      await resolveArchivedFileFolderScope(
        { entityType: 'project', entityId: f.projectId },
        '/Docs',
        false,
        2,
        db
      )
    ).toEqual(expect.arrayContaining([docsId, archivedDocsId]))
    expect((await archivedPage('/Docs')).files.map((file) => file.id)).toEqual([
      fileIds[1],
      archivedIds[0],
    ])
    expect((await archivedPage('/Docs/Q3%2FQ4')).files.map((file) => file.id)).toEqual([
      fileIds[2],
      archivedIds[1],
    ])
    expect((await archivedPage('/Docs', true)).files.map((file) => file.id)).toEqual([
      fileIds[1],
      fileIds[2],
      ...archivedIds,
    ])
    expect((await archivedPage('/Missing', true)).files).toEqual([])
    expect((await archivedPage('/')).files).toEqual([])
    expect((await archivedPage('/', true)).files.map((file) => file.id)).toEqual([
      fileIds[1],
      fileIds[2],
      ...archivedIds,
    ])
  })

  check(
    'file references resolve exact owner paths and conceal foreign or archived identities',
    async () => {
      const f = await fixture()
      const other = await fixture()
      const folderId = generateId()
      await db.insert(folder).values({
        id: folderId,
        projectId: f.projectId,
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
          projectId: f.projectId,
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
          projectId: other.projectId,
          context: 'project',
          key: `project/${other.projectId}/${foreignId}`,
          originalName: 'Architecture overview.md',
          contentType: 'text/markdown',
          sizeBytes: 0,
        },
        {
          id: archivedId,
          userId: f.ownerId,
          projectId: f.projectId,
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
      for (const name of ['content', 'meta.json']) {
        await db
          .update(workspaceFiles)
          .set({ originalName: name })
          .where(eq(workspaceFiles.id, fileId))
        expect((await resolve(`files/Q3%2FQ4/${name}`)).file.id).toBe(fileId)
      }
      await db
        .update(workspaceFiles)
        .set({ originalName: 'Architecture overview.md' })
        .where(eq(workspaceFiles.id, fileId))
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
          projectId: f.projectId,
          context: 'project',
          key: `project/${f.projectId}/${fileId}`,
          originalName: 'architecture.md',
          contentType: 'text/markdown',
          sizeBytes: 0,
        },
        {
          id: foreignFileId,
          userId: other.ownerId,
          projectId: other.projectId,
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
      await grant(f.readerId, f.workspaces[0], 'read')
      expect(await readAccess.execute(args)).toEqual({ projectId: f.projectId, canWrite: false })
      await expect(writeAccess.execute(args)).rejects.toMatchObject({ code: 'forbidden' })
      await grant(f.readerId, f.workspaces[0], 'admin')
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
    'reads and non-charging writes share the Project while exclusive holders still wait',
    async () => {
      const f = await fixture()
      await grant(f.readerId, f.workspaces[0], 'admin')
      const [baseline] = await db.execute<{ value: string }>(
        sql`SELECT current_setting('lock_timeout') AS value`
      )
      const entered = createDeferred<string | undefined>()
      const release = createDeferred<void>()
      const read = defineAuthorizedProjectFileUseCase({
        operation: projectFileOperations.list,
        async execute({ tx }) {
          const [setting] = await tx.execute<{ value: string }>(
            sql`SELECT current_setting('lock_timeout') AS value`
          )
          entered.resolve(setting?.value)
          await release.promise
        },
      }).execute({ principal: f.reader, input: { projectId: f.projectId } })
      try {
        expect(await entered.promise).toBe(baseline?.value)
        expect(
          await readAccess.execute({ principal: f.reader, input: { projectId: f.projectId } })
        ).toEqual({ projectId: f.projectId, canWrite: true })
        const { folder: created } = await createProjectFileFolder.execute({
          principal: f.reader,
          input: { projectId: f.projectId, name: 'Concurrent' },
        })
        expect(created.name).toBe('Concurrent')
        await expect(
          db.transaction((tx) => tryLockProjects(tx, [f.projectId]))
        ).rejects.toBeInstanceOf(ProjectConflictError)
        const groupWrite = db.transaction(async (tx) => {
          await tx.execute(sql`SET LOCAL lock_timeout = '100ms'`)
          await acquirePermissionGroupOrgLock(tx, f.organizationId, {
            lockTimeoutAlreadyBounded: true,
          })
        })
        expect(await groupWrite.then(() => null, getPostgresErrorCode)).toBe('55P03')
      } finally {
        release.resolve()
        await read
      }
    }
  )

  check('storage-charging writes hold the Project exclusively from authorization', async () => {
    const f = await fixture()
    await grant(f.readerId, f.workspaces[0], 'admin')
    const entered = createDeferred<void>()
    const release = createDeferred<void>()
    const write = defineAuthorizedProjectFileUseCase({
      operation: projectFileOperations.create,
      async execute() {
        entered.resolve()
        await release.promise
      },
    }).execute({ principal: f.reader, input: { projectId: f.projectId } })
    try {
      await entered.promise
      const read = db.transaction(async (tx) => {
        await tx.execute(sql`SET LOCAL lock_timeout = '100ms'`)
        await tx.execute(
          sql`SELECT pg_advisory_xact_lock_shared(hashtextextended(${`project:${f.projectId}`}, 0))`
        )
      })
      expect(await read.then(() => null, getPostgresErrorCode)).toBe('55P03')
    } finally {
      release.resolve()
      await write
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
        projectId: f.projectId,
        resourceType: 'file',
        name: 'Architecture',
      })
      await db.insert(workspaceFiles).values({
        id: fileId,
        projectId: f.projectId,
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
})

describe('shared file identity and current actor authority', () => {
  check('creator attribution grants neither scope access nor access after departure', async () => {
    const f = await fixture()
    const workspaceFileId = generateId()
    const projectFileId = generateId()
    await db.insert(workspaceFiles).values([
      {
        id: workspaceFileId,
        userId: f.readerId,
        workspaceId: f.workspaces[0],
        context: 'workspace',
        key: `workspace/${f.workspaces[0]}/${workspaceFileId}`,
        originalName: 'workspace.md',
        contentType: 'text/markdown',
        sizeBytes: 0,
      },
      {
        id: projectFileId,
        userId: f.readerId,
        projectId: f.projectId,
        context: 'project',
        key: `project/${f.projectId}/${projectFileId}`,
        originalName: 'project.md',
        contentType: 'text/markdown',
        sizeBytes: 0,
      },
    ])
    const workspaceArgs = { principal: f.reader, input: { fileId: workspaceFileId } }
    const projectArgs = {
      principal: f.reader,
      input: { projectId: f.projectId, fileId: projectFileId },
    }
    await readWorkspaceFileMetadata.authorize(workspaceArgs)
    await getProjectFileMetadata.authorize(projectArgs)
    await expect(
      readWorkspaceFileMetadata.authorize({
        ...workspaceArgs,
        input: { fileId: workspaceFileId, assertedWorkspaceId: f.workspaces[1] },
      })
    ).rejects.toMatchObject({ code: 'not_found' })
    await expect(
      readWorkspaceFileMetadata.authorize({ ...workspaceArgs, input: { fileId: projectFileId } })
    ).rejects.toMatchObject({ code: 'not_found' })
    await expect(
      getProjectFileMetadata.authorize({
        ...projectArgs,
        input: { projectId: f.projectId, fileId: workspaceFileId },
      })
    ).rejects.toMatchObject({ code: 'not_found' })
    await db.delete(permissions).where(eq(permissions.userId, f.readerId))
    await expect(readWorkspaceFileMetadata.authorize(workspaceArgs)).rejects.toMatchObject({
      code: 'forbidden',
    })
    await expect(getProjectFileMetadata.authorize(projectArgs)).rejects.toMatchObject({
      code: 'not_found',
    })
    const collaborator = createSessionPrincipal({ userId: f.ownerId })
    await readWorkspaceFileMetadata.authorize({ ...workspaceArgs, principal: collaborator })
    await getProjectFileMetadata.authorize({ ...projectArgs, principal: collaborator })
    const rows = await db
      .select({ userId: workspaceFiles.userId })
      .from(workspaceFiles)
      .where(inArray(workspaceFiles.id, [workspaceFileId, projectFileId]))
    expect(rows.map((row) => row.userId)).toEqual([f.readerId, f.readerId])
  })

  check(
    'workspace metadata keeps deleted-file opt-in separate from workspace archival',
    async () => {
      const f = await fixture()
      const fileId = generateId()
      await db.insert(workspaceFiles).values({
        id: fileId,
        userId: f.ownerId,
        workspaceId: f.workspaces[0],
        context: 'workspace',
        key: `workspace/${f.workspaces[0]}/${fileId}`,
        originalName: 'archived.md',
        contentType: 'text/markdown',
        sizeBytes: 0,
        deletedAt: new Date(),
      })
      const args = { principal: f.reader, input: { fileId } }
      await expect(readWorkspaceFileMetadata.authorize(args)).rejects.toMatchObject({
        code: 'not_found',
      })
      await readWorkspaceFileMetadata.authorize({
        ...args,
        input: { fileId, includeDeleted: true },
      })
      await db
        .update(workspace)
        .set({ archivedAt: new Date() })
        .where(eq(workspace.id, f.workspaces[0]))
      await expect(
        readWorkspaceFileMetadata.authorize({ ...args, input: { fileId, includeDeleted: true } })
      ).rejects.toMatchObject({ code: 'not_found' })
    }
  )

  check(
    'a ban or permission revocation during preparation prevents a committed write',
    async () => {
      for (const revoke of ['permission', 'ban'] as const) {
        const f = await fixture()
        await grant(f.readerId, f.workspaces[0], 'admin')
        const folderId = generateId()
        const mutation = defineAuthorizedProjectFileUseCase({
          operation: projectFileOperations.createFolder,
          async prepare() {
            if (revoke === 'ban')
              await db.update(user).set({ banned: true }).where(eq(user.id, f.readerId))
            else await grant(f.readerId, f.workspaces[0], 'read')
            return folderId
          },
          async execute({ tx, prepared }) {
            if (!prepared) throw new Error('Prepared folder ID missing')
            await tx.insert(folder).values({
              id: prepared,
              projectId: f.projectId,
              userId: f.readerId,
              resourceType: 'file',
              name: 'Must not commit',
            })
          },
        })
        await expect(
          mutation.execute({ principal: f.reader, input: { projectId: f.projectId } })
        ).rejects.toMatchObject({ code: 'forbidden' })
        expect(
          await db.select({ id: folder.id }).from(folder).where(eq(folder.id, folderId))
        ).toEqual([])
      }
    }
  )
})
