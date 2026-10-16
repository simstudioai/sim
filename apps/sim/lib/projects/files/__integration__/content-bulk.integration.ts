import { mkdtempSync } from 'node:fs'
import { mkdir, readdir, readFile, rm, truncate, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { Principal } from '@sim/auth/principal'
import { db } from '@sim/db'
import {
  folder,
  idempotencyKey,
  member,
  organization,
  outboxEvent,
  permissionGroup,
  permissionGroupWorkspace,
  permissions,
  subscription,
  user,
  workspace,
  workspaceFileSecretProvenance,
  workspaceFiles,
  workspaceFileVersion,
} from '@sim/db/schema'
import { deleteWorkspaceFixture, insertWorkspaceFixture } from '@sim/db/testing/workspace-fixtures'
import { createSessionPrincipal } from '@sim/testing/factories/principal.factory'
import { createDeferred } from '@sim/testing/helpers/deferred'
import { emailMailerMock } from '@sim/testing/mocks/email-mailer.mock'
import { featureFlagsMock, featureFlagsMockFns } from '@sim/testing/mocks/feature-flags.mock'
import { setUploadDirServer, uploadsSetupMock } from '@sim/testing/mocks/uploads-setup.mock'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { and, eq, inArray, sql } from 'drizzle-orm'
import JSZip from 'jszip'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/uploads/core/setup.server', () => uploadsSetupMock)
vi.mock('@/lib/messaging/email/mailer', () => emailMailerMock)

import { observeContentDelivery } from '@/lib/core/application/content-delivery'
import { encryptSecret } from '@/lib/core/security/encryption'
import { createDurableSecretProvenanceRegistry } from '@/lib/execution/durable-secret-provenance'
import {
  createProjectFile,
  readProjectFileContent,
  updateProjectFileContent,
} from '@/lib/projects/files/application/content'
import { createProjectFileFolder } from '@/lib/projects/files/application/folders'
import type { WorkspaceFileSecretProvenance } from '@/lib/uploads/contexts/workspace/file-secret-provenance'
import * as storage from '@/lib/uploads/core/storage-service'
import { observeWorkspaceFileDelivery } from '@/lib/workspace-files/application/file-delivery-observer'
import { projectResolvedSecretModelContent } from '@/executor/utils/resolved-secret-content-projection'

vi.mock('@/lib/core/config/feature-flags', () => featureFlagsMock)

const localStorageRoot = mkdtempSync(join(tmpdir(), 'sim-project-content-'))
setUploadDirServer(localStorageRoot)
const fixtures: {
  ownerId: string
  editorId: string
  organizationId: string
  workspaceId: string
  projectId: string
}[] = []
const checks: { name: string; status: 'passed' | 'failed'; durationMs: number; error?: string }[] =
  []

beforeEach(() => {
  vi.restoreAllMocks()
  featureFlagsMockFns.mockIsFeatureEnabled.mockImplementation(async (flag) => flag === 'projects')
  vi.stubEnv('FREE_STORAGE_LIMIT_GB', '')
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
  const editorId = generateId()
  const organizationId = generateId()
  const workspaceId = generateId()
  await db.insert(user).values(
    [ownerId, editorId].map((id) => ({
      id,
      email: `${id}@content.invalid`,
      name: 'File content fixture',
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    }))
  )
  await db
    .insert(organization)
    .values({ id: organizationId, name: 'Content', slug: organizationId, createdAt: new Date() })
  await db.insert(member).values(
    [ownerId, editorId].map((userId) => ({
      id: generateId(),
      organizationId,
      userId,
      role: userId === ownerId ? 'owner' : 'member',
      createdAt: new Date(),
    }))
  )
  await insertWorkspaceFixture(db, {
    id: workspaceId,
    ownerId,
    billedAccountUserId: ownerId,
    organizationId,
    workspaceMode: 'organization',
    name: 'Content environment',
  })
  const [binding] = await db.select().from(workspace).where(eq(workspace.id, workspaceId))
  if (!binding) throw new Error('Project fixture missing')
  await db.insert(permissions).values({
    id: generateId(),
    userId: editorId,
    entityType: 'workspace',
    entityId: workspaceId,
    permissionType: 'admin',
  })
  const ids = { ownerId, editorId, organizationId, workspaceId, projectId: binding.projectId }
  fixtures.push(ids)
  return { ...ids, principal: createSessionPrincipal({ userId: editorId }) }
}

function createInput(projectId: string, content = 'Project architecture') {
  return {
    projectId,
    name: 'architecture.md',
    contentType: 'text/markdown',
    content,
    encoding: 'utf-8' as const,
    exactName: true,
  }
}

async function keys(projectId: string) {
  return readdir(join(localStorageRoot, 'project', projectId)).catch(() => [])
}

async function ledger(organizationId: string) {
  const [row] = await db
    .select({ bytes: organization.storageUsedBytes })
    .from(organization)
    .where(eq(organization.id, organizationId))
  return row?.bytes
}

async function rows(projectId: string) {
  return db.select().from(workspaceFiles).where(eq(workspaceFiles.projectId, projectId))
}

describe('Project file content against PostgreSQL and the local object store', () => {
  check(
    'folder tree copy hydrates destination paths once while preserving nested paths',
    async () => {
      const { copyFileItems } = await import('@/lib/workspace-files/application/copy-file-items')
      const f = await fixture()
      const root = await createProjectFileFolder.execute({
        principal: f.principal,
        input: { projectId: f.projectId, name: 'Root' },
      })
      await db.insert(folder).values(
        Array.from({ length: 20 }, (_, index) => ({
          id: generateId(),
          projectId: f.projectId,
          parentId: root.folder.id,
          resourceType: 'file' as const,
          name: `Child-${index}`,
          userId: f.ownerId,
        }))
      )
      const originalDebug = db.$client.options.debug
      const queries: string[] = []
      db.$client.options.debug = (_connection, query) => {
        queries.push(query)
      }
      try {
        const result = await copyFileItems.execute({
          principal: f.principal,
          input: {
            source: {
              owner: { entityType: 'project', entityId: f.projectId },
              fileIds: [],
              folderIds: [root.folder.id],
            },
            destination: {
              owner: { entityType: 'workspace', entityId: f.workspaceId },
              folderId: null,
            },
          },
        })
        expect(result.folders).toHaveLength(21)
        const copiedRoot = result.folders.find((item) => item.parentId === null)
        if (!copiedRoot) throw new Error('Copied root missing')
        expect(result.folders.filter((item) => item.parentId === copiedRoot.id)).toHaveLength(20)
        for (const item of result.folders.filter((item) => item.id !== copiedRoot.id))
          expect(item.path).toBe(`${copiedRoot.path}/${item.name}`)
        expect(
          queries.filter((query) =>
            query.startsWith('select "id", "name", "parent_id" from "folder"')
          )
        ).toHaveLength(0)
      } finally {
        db.$client.options.debug = originalDebug
      }
    }
  )

  check(
    'copy selection ignores unrelated folders when the owner exceeds the selection limit',
    async () => {
      const { snapshotFileCopyInTx } = await import('@/lib/workspace-files/copy')
      const f = await fixture()
      const selected = generateId()
      await db.insert(folder).values(
        Array.from({ length: 5_001 }, (_, index) => ({
          id: index === 0 ? selected : generateId(),
          projectId: f.projectId,
          resourceType: 'file' as const,
          name: `folder-${index}`,
          userId: f.ownerId,
        }))
      )
      const result = await db.transaction((tx) =>
        snapshotFileCopyInTx(tx, {
          owner: { entityType: 'project', entityId: f.projectId },
          fileIds: [],
          folderIds: [selected],
        })
      )
      expect(result.folders.map((item) => item.id)).toEqual([selected])
      expect(result.files).toHaveLength(0)
    }
  )

  check('copy retains committed bytes when COMMIT acknowledgement is lost', async () => {
    const { copyFileItems } = await import('@/lib/workspace-files/application/copy-file-items')
    const f = await fixture()
    const source = await createProjectFile.execute({
      principal: f.principal,
      input: createInput(f.projectId, 'retained after lost acknowledgement'),
    })
    const original = db.transaction.bind(db)
    vi.spyOn(db, 'transaction').mockImplementation(async (callback, config) => {
      const result = await original(callback, config)
      if (result && typeof result === 'object' && 'usage' in result && 'result' in result)
        throw new Error('Lost COMMIT acknowledgement')
      return result
    })
    await expect(
      copyFileItems.execute({
        principal: f.principal,
        input: {
          source: {
            owner: { entityType: 'project', entityId: f.projectId },
            fileIds: [source.file.id],
            folderIds: [],
          },
          destination: { owner: { entityType: 'project', entityId: f.projectId }, folderId: null },
        },
      })
    ).rejects.toThrow('Lost COMMIT acknowledgement')
    vi.restoreAllMocks()
    const copied = (await rows(f.projectId)).find((file) => file.id !== source.file.id)
    if (!copied) throw new Error('Copy did not commit')
    expect(await readFile(join(localStorageRoot, copied.key), 'utf8')).toBe(
      'retained after lost acknowledgement'
    )
    const cleanup = await db
      .select()
      .from(outboxEvent)
      .where(sql`${outboxEvent.payload}::text LIKE ${`%${copied.key}%`}`)
    expect(cleanup).toHaveLength(0)
  })

  check(
    'compound copy remaps selected page assets before staging and bills the actual rendered source bytes',
    async () => {
      const { copyFileItems } = await import('@/lib/workspace-files/application/copy-file-items')
      const { createWorkspaceFileFromBuffer } = await import(
        '@/lib/workspace-files/application/create-workspace-file'
      )
      const { readProjectFileArtifact } = await import('@/lib/projects/files/application/artifacts')
      const f = await fixture()
      const image = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9uoAAAAASUVORK5CYII=',
        'base64'
      )
      const asset = await createWorkspaceFileFromBuffer.execute({
        principal: f.principal,
        input: {
          workspaceId: f.workspaceId,
          name: 'diagram.png',
          contentType: 'image/png',
          content: image,
          exactName: true,
        },
      })
      const original = Buffer.from(
        `---\ntitle: Architecture\n---\n\n![Diagram](sim:file/${asset.file.id})\n\n![Stored](/api/files/serve/${encodeURIComponent(asset.file.key)})`
      )
      const source = await createWorkspaceFileFromBuffer.execute({
        principal: f.principal,
        input: {
          workspaceId: f.workspaceId,
          name: 'Architecture',
          contentType: 'text/x-sim-page',
          content: original,
          exactName: true,
        },
      })
      const before = await ledger(f.organizationId)
      const copied = await copyFileItems.execute({
        principal: f.principal,
        input: {
          source: {
            owner: { entityType: 'workspace', entityId: f.workspaceId },
            fileIds: [asset.file.id, source.file.id],
            folderIds: [],
          },
          destination: { owner: { entityType: 'project', entityId: f.projectId }, folderId: null },
        },
      })
      const copiedSource = copied.files.find((file) => file.name === 'Architecture')
      const copiedAsset = copied.files.find((file) => file.name === 'diagram.png')
      if (!copiedSource || !copiedAsset) throw new Error('Copy omitted selected source or asset')
      const rendered = await readProjectFileArtifact.execute({
        principal: f.principal,
        input: { projectId: f.projectId, fileId: copiedSource.id, maxBytes: 1_000_000 },
      })
      expect(rendered.buffer.toString()).toContain(
        `data:image/png;base64,${image.toString('base64')}`
      )
      const copiedBytes = await readFile(join(localStorageRoot, copiedSource.key))
      expect(copiedBytes.toString()).toContain(copiedAsset.id)
      expect(copiedBytes.toString()).not.toContain(asset.file.id)
      expect(await readFile(join(localStorageRoot, source.file.key))).toEqual(original)
      expect(await readFile(join(localStorageRoot, copiedAsset.key))).toEqual(image)
      expect(await ledger(f.organizationId)).toBe(
        (before ?? 0) + copied.files.reduce((sum, file) => sum + file.size, 0)
      )
      expect(copiedSource.size).toBe(copiedBytes.length)
    }
  )

  check(
    'compound recursive copy preserves bytes and provenance under new owner and creator attribution',
    async () => {
      const { copyFileItems } = await import('@/lib/workspace-files/application/copy-file-items')
      const { createWorkspaceFileFromBuffer } = await import(
        '@/lib/workspace-files/application/create-workspace-file'
      )
      const { createWorkspaceFileFolderOperation } = await import(
        '@/lib/workspace-files/application/folders'
      )
      const f = await fixture()
      const sourceOwner = { entityType: 'workspace' as const, entityId: f.workspaceId }
      const destinationOwner = { entityType: 'project' as const, entityId: f.projectId }
      const directory = await createWorkspaceFileFolderOperation.execute({
        principal: f.principal,
        input: { workspaceId: f.workspaceId, name: 'Source' },
      })
      const child = await createWorkspaceFileFolderOperation.execute({
        principal: f.principal,
        input: { workspaceId: f.workspaceId, name: 'Nested', parentId: directory.folder.id },
      })
      const secret = {
        status: 'exact' as const,
        entries: [
          {
            name: 'TOKEN',
            encryptedValue: 'encrypted-fixture',
            sourceUserId: f.ownerId,
            sourceWorkspaceId: f.workspaceId,
          },
        ],
      }
      const source = await createWorkspaceFileFromBuffer.execute({
        principal: createSessionPrincipal({ userId: f.ownerId }),
        input: {
          workspaceId: f.workspaceId,
          name: 'source.bin',
          contentType: 'application/octet-stream',
          content: Buffer.from([1, 255, 0]),
          folderId: child.folder.id,
          exactName: true,
          secretProvenance: secret,
        },
      })
      const copied = await copyFileItems.execute({
        principal: f.principal,
        input: {
          source: { owner: sourceOwner, fileIds: [], folderIds: [directory.folder.id] },
          destination: { owner: destinationOwner, folderId: null },
        },
      })
      expect(copied.files).toHaveLength(1)
      expect(copied.folders).toHaveLength(2)
      expect(copied.files[0]).toMatchObject({
        owner: destinationOwner,
        uploadedBy: f.editorId,
        folderPath: 'Source/Nested',
      })
      expect(copied.files[0].id).not.toBe(source.file.id)
      const read = await readProjectFileContent.execute({
        principal: f.principal,
        input: {
          projectId: f.projectId,
          fileId: copied.files[0].id,
          includeSecretProvenance: true,
        },
      })
      expect(read.content).toEqual(Buffer.from([1, 255, 0]))
      expect(read.secretProvenance).toEqual(secret)
      expect(await ledger(f.organizationId)).toBe(6)
      const sameOwner = await copyFileItems.execute({
        principal: f.principal,
        input: {
          source: { owner: destinationOwner, fileIds: [copied.files[0].id], folderIds: [] },
          destination: { owner: destinationOwner, folderId: null },
        },
      })
      expect(sameOwner.files[0].folderId).toBeNull()
      expect(sameOwner.files[0].id).not.toBe(copied.files[0].id)
      expect(await ledger(f.organizationId)).toBe(9)
    }
  )

  check(
    'compound copy rejects source changes after staging without committing folders, files, or extra billing',
    async () => {
      const { copyFileItems } = await import('@/lib/workspace-files/application/copy-file-items')
      const { createWorkspaceFile, createWorkspaceFileFromBuffer } = await import(
        '@/lib/workspace-files/application/create-workspace-file'
      )
      const { updateWorkspaceFileContent } = await import(
        '@/lib/workspace-files/application/update-workspace-file-content'
      )
      const { createWorkspaceFileFolderOperation } = await import(
        '@/lib/workspace-files/application/folders'
      )
      const f = await fixture()
      const directory = await createWorkspaceFileFolderOperation.execute({
        principal: f.principal,
        input: { workspaceId: f.workspaceId, name: 'Source' },
      })
      const source = await createWorkspaceFile.execute({
        principal: f.principal,
        input: {
          workspaceId: f.workspaceId,
          name: 'notes.txt',
          contentType: 'text/plain',
          content: 'before',
          encoding: 'utf-8',
          folderId: directory.folder.id,
          exactName: true,
        },
      })
      await createWorkspaceFileFromBuffer.execute({
        principal: f.principal,
        input: {
          workspaceId: f.workspaceId,
          name: 'more.bin',
          contentType: 'application/octet-stream',
          content: Buffer.from([1]),
          folderId: directory.folder.id,
          exactName: true,
        },
      })
      const upload = storage.uploadFile
      vi.spyOn(storage, 'uploadFile').mockImplementationOnce(async (options) => {
        const staged = await upload(options)
        await updateWorkspaceFileContent.execute({
          principal: f.principal,
          input: {
            fileId: source.file.id,
            assertedWorkspaceId: f.workspaceId,
            content: 'after source change',
            encoding: 'utf-8',
            syncLiveDoc: false,
          },
        })
        return staged
      })
      await expect(
        copyFileItems.execute({
          principal: f.principal,
          input: {
            source: {
              owner: { entityType: 'workspace', entityId: f.workspaceId },
              fileIds: [],
              folderIds: [directory.folder.id],
            },
            destination: {
              owner: { entityType: 'project', entityId: f.projectId },
              folderId: null,
            },
          },
        })
      ).rejects.toMatchObject({ code: 'conflict' })
      expect(await rows(f.projectId)).toEqual([])
      expect(await db.select().from(folder).where(eq(folder.projectId, f.projectId))).toEqual([])
      expect(await keys(f.projectId)).toEqual([])
      expect(await ledger(f.organizationId)).toBe(Buffer.byteLength('after source change') + 1)
    }
  )

  check(
    'compound copy quota failure atomically rolls back the whole destination tree and releases staged bytes',
    async () => {
      const { copyFileItems } = await import('@/lib/workspace-files/application/copy-file-items')
      const { createWorkspaceFile } = await import(
        '@/lib/workspace-files/application/create-workspace-file'
      )
      const { createWorkspaceFileFolderOperation } = await import(
        '@/lib/workspace-files/application/folders'
      )
      const f = await fixture()
      const directory = await createWorkspaceFileFolderOperation.execute({
        principal: f.principal,
        input: { workspaceId: f.workspaceId, name: 'Source' },
      })
      const source = await createWorkspaceFile.execute({
        principal: f.principal,
        input: {
          workspaceId: f.workspaceId,
          name: 'notes.txt',
          contentType: 'text/plain',
          content: 'before',
          encoding: 'utf-8',
          folderId: directory.folder.id,
          exactName: true,
        },
      })
      vi.stubEnv('FREE_STORAGE_LIMIT_GB', '1')
      await db
        .update(organization)
        .set({ storageUsedBytes: 1024 ** 3 })
        .where(eq(organization.id, f.organizationId))
      await expect(
        copyFileItems.execute({
          principal: f.principal,
          input: {
            source: {
              owner: { entityType: 'workspace', entityId: f.workspaceId },
              fileIds: [],
              folderIds: [directory.folder.id],
            },
            destination: {
              owner: { entityType: 'project', entityId: f.projectId },
              folderId: null,
            },
          },
        })
      ).rejects.toMatchObject({ name: 'StorageLimitExceededError' })
      expect(await rows(f.projectId)).toEqual([])
      expect(await db.select().from(folder).where(eq(folder.projectId, f.projectId))).toEqual([])
      expect(await keys(f.projectId)).toEqual([])
      expect(await readFile(join(localStorageRoot, source.file.key), 'utf8')).toBe('before')
      expect(await ledger(f.organizationId)).toBe(1024 ** 3)
    }
  )
})

describe('Project archive download and Markdown snapshot export', () => {
  check('snapshot export refuses an opaque embedded asset before fetching it', async () => {
    const { exportProjectFileSnapshot } = await import('@/lib/projects/files/application/downloads')
    const f = await fixture()
    const source = await createProjectFile.execute({
      principal: f.principal,
      input: createInput(f.projectId, '# source'),
    })
    const image = await createProjectFile.execute({
      principal: f.principal,
      input: {
        ...createInput(f.projectId, 'image bytes'),
        name: 'image.png',
        contentType: 'image/png',
      },
    })
    const principal: Principal = {
      kind: 'resource_delegated',
      serviceId: 'copilot',
      subjectUserId: f.editorId,
      audience: 'sim:project-files',
      delegationId: generateId(),
      issuedAt: new Date(),
      expiresAt: new Date(Date.now() + 30_000),
      scope: { kind: 'entity', entityType: 'project', entityId: f.projectId },
      invocation: { kind: 'workspace', workspaceId: f.workspaceId },
    }
    const read = vi.spyOn(storage, 'downloadFile')
    await expect(
      observeContentDelivery(
        {
          async admit(sources) {
            expect(sources.every((item) => item.view === 'opaque')).toBe(true)
            return sources.map((item) => item.id !== image.file.id)
          },
        },
        () =>
          exportProjectFileSnapshot.execute({
            principal,
            input: {
              projectId: f.projectId,
              fileId: source.file.id,
              content: `![image](sim:file/${image.file.id}?project=${f.projectId})`,
              secretProvenance: { status: 'exact', entries: [] },
            },
          })
      )
    ).rejects.toMatchObject({ code: 'forbidden' })
    expect(read).not.toHaveBeenCalled()
  })

  for (const phase of ['before-read', 'before-delivery'] as const) {
    check(`Project archive opaque admission refuses ${phase}`, async () => {
      const { downloadProjectFileItems } = await import(
        '@/lib/projects/files/application/downloads'
      )
      const f = await fixture()
      const { file } = await createProjectFile.execute({
        principal: f.principal,
        input: createInput(f.projectId, 'private bytes'),
      })
      const principal: Principal = {
        kind: 'resource_delegated',
        serviceId: 'copilot',
        subjectUserId: f.editorId,
        audience: 'sim:project-files',
        delegationId: generateId(),
        issuedAt: new Date(),
        expiresAt: new Date(Date.now() + 30_000),
        scope: { kind: 'entity', entityType: 'project', entityId: f.projectId },
        invocation: { kind: 'workspace', workspaceId: f.workspaceId },
      }
      const read = vi.spyOn(storage, 'downloadFile')
      let admissions = 0
      await expect(
        observeContentDelivery(
          {
            async admit(sources) {
              admissions++
              expect(sources.every((source) => source.view === 'opaque')).toBe(true)
              return sources.map(() => phase === 'before-delivery' && admissions === 1)
            },
          },
          () =>
            downloadProjectFileItems.execute({
              principal,
              input: { projectId: f.projectId, fileIds: [file.id], folderIds: [] },
            })
        )
      ).rejects.toMatchObject({ code: 'forbidden' })
      expect(read).toHaveBeenCalledTimes(phase === 'before-read' ? 0 : 1)
    })
  }

  check(
    'Project recursive download retains nested paths, deduplicates selections, and excludes archived or foreign items',
    async () => {
      const { downloadProjectFileItems } = await import(
        '@/lib/projects/files/application/downloads'
      )
      const { archiveProjectFileItems } = await import('@/lib/projects/files/application/lifecycle')
      const f = await fixture()
      const other = await fixture()
      const root = await createProjectFileFolder.execute({
        principal: f.principal,
        input: { projectId: f.projectId, name: 'Architecture' },
      })
      const nested = await createProjectFileFolder.execute({
        principal: f.principal,
        input: { projectId: f.projectId, parentId: root.folder.id, name: 'Diagrams' },
      })
      const source = await createProjectFile.execute({
        principal: f.principal,
        input: { ...createInput(f.projectId, 'nested bytes'), folderId: nested.folder.id },
      })
      const archived = await createProjectFile.execute({
        principal: f.principal,
        input: { ...createInput(f.projectId, 'retired bytes'), folderId: root.folder.id },
      })
      await archiveProjectFileItems.execute({
        principal: f.principal,
        input: { projectId: f.projectId, fileIds: [archived.file.id] },
      })
      const foreign = await createProjectFile.execute({
        principal: other.principal,
        input: createInput(other.projectId, 'foreign bytes'),
      })
      const foreignFolder = await createProjectFileFolder.execute({
        principal: other.principal,
        input: { projectId: other.projectId, name: 'Architecture' },
      })
      const input = {
        projectId: f.projectId,
        fileIds: [source.file.id, source.file.id],
        folderIds: [root.folder.id, nested.folder.id],
      }
      const result = await downloadProjectFileItems.execute({ principal: f.principal, input })
      const zip = await JSZip.loadAsync(result.buffer)
      const entries = Object.values(zip.files).filter((entry) => !entry.dir)
      expect(entries.map((entry) => entry.name)).toEqual(['Architecture/Diagrams/architecture.md'])
      expect(await entries[0].async('string')).toBe('nested bytes')
      expect(result.fileCount).toBe(1)
      expect(result.secretProvenance).toEqual({ status: 'exact', entries: [] })
      for (const selection of [
        { ...input, fileIds: [foreign.file.id] },
        { ...input, folderIds: [foreignFolder.folder.id] },
      ]) {
        await expect(
          downloadProjectFileItems.execute({ principal: f.principal, input: selection })
        ).rejects.toMatchObject({ code: 'not_found' })
      }
    }
  )

  check(
    'Project recursive download enforces expanded file counts and actual aggregate bytes despite understated metadata',
    async () => {
      const { downloadProjectFileItems } = await import(
        '@/lib/projects/files/application/downloads'
      )
      const f = await fixture()
      const fileIds: string[] = []
      for (let index = 0; index < 3; index++) {
        const result = await createProjectFile.execute({
          principal: f.principal,
          input: {
            ...createInput(f.projectId, 'x'),
            name: `large-${index}.bin`,
            contentType: 'application/octet-stream',
          },
        })
        await truncate(join(localStorageRoot, result.file.key), 90 * 1024 * 1024)
        fileIds.push(result.file.id)
      }
      await expect(
        downloadProjectFileItems.execute({
          principal: f.principal,
          input: { projectId: f.projectId, fileIds, folderIds: [] },
        })
      ).rejects.toMatchObject({ code: 'payload_too_large' })
      expect(await ledger(f.organizationId)).toBe(3)
      const [template] = await rows(f.projectId)
      if (!template) throw new Error('Download fixture metadata is missing')
      const selected = Array.from({ length: 101 }, (_, index) => ({
        ...template,
        id: generateId(),
        key: `project/${f.projectId}/count-${index}`,
        originalName: `count-${index}.bin`,
      }))
      await db.insert(workspaceFiles).values(selected)
      await expect(
        downloadProjectFileItems.execute({
          principal: f.principal,
          input: {
            projectId: f.projectId,
            fileIds: selected.map((file) => file.id),
            folderIds: [],
          },
        })
      ).rejects.toMatchObject({ code: 'validation' })
    }
  )

  check(
    'Project recursive download rechecks source, descendant membership, and current access after object IO',
    async () => {
      const { downloadProjectFileItems } = await import(
        '@/lib/projects/files/application/downloads'
      )
      for (const change of ['source', 'selection', 'access'] as const) {
        const f = await fixture()
        const directory = await createProjectFileFolder.execute({
          principal: f.principal,
          input: { projectId: f.projectId, name: 'Selected' },
        })
        const source = await createProjectFile.execute({
          principal: f.principal,
          input: { ...createInput(f.projectId, 'before IO'), folderId: directory.folder.id },
        })
        const download = storage.downloadFile
        let changed = false
        const interception = vi
          .spyOn(storage, 'downloadFile')
          .mockImplementation(async (options) => {
            const buffer = await download(options)
            if (options.key === source.file.key && !changed) {
              changed = true
              if (change === 'source') {
                await updateProjectFileContent.execute({
                  principal: f.principal,
                  input: {
                    projectId: f.projectId,
                    fileId: source.file.id,
                    content: 'after IO',
                    encoding: 'utf-8',
                  },
                })
              } else if (change === 'selection') {
                await createProjectFile.execute({
                  principal: f.principal,
                  input: {
                    ...createInput(f.projectId, 'new descendant'),
                    name: 'later.md',
                    folderId: directory.folder.id,
                  },
                })
              } else {
                await db.delete(permissions).where(eq(permissions.userId, f.editorId))
              }
            }
            return buffer
          })
        try {
          await expect(
            downloadProjectFileItems.execute({
              principal: f.principal,
              input: { projectId: f.projectId, fileIds: [], folderIds: [directory.folder.id] },
            })
          ).rejects.toMatchObject({ code: change === 'access' ? 'not_found' : 'conflict' })
        } finally {
          interception.mockRestore()
        }
      }
    }
  )

  check(
    'Project recursive download aggregates bulk-download policy across accessible environments while retaining single-file reads',
    async () => {
      const { downloadProjectFileItems } = await import(
        '@/lib/projects/files/application/downloads'
      )
      const f = await fixture()
      const directory = await createProjectFileFolder.execute({
        principal: f.principal,
        input: { projectId: f.projectId, name: 'Selected' },
      })
      const source = await createProjectFile.execute({
        principal: f.principal,
        input: { ...createInput(f.projectId), folderId: directory.folder.id },
      })
      const secondId = generateId()
      await insertWorkspaceFixture(db, {
        id: secondId,
        ownerId: f.ownerId,
        billedAccountUserId: f.ownerId,
        organizationId: f.organizationId,
        workspaceMode: 'organization',
        name: 'Restricted downloads',
        forkedFromWorkspaceId: f.workspaceId,
      })
      try {
        await db.insert(subscription).values({
          id: generateId(),
          plan: 'enterprise',
          referenceId: f.organizationId,
          status: 'active',
          metadata: {},
        })
        const groupId = generateId()
        await db.insert(permissionGroup).values({
          id: groupId,
          organizationId: f.organizationId,
          createdBy: f.ownerId,
          name: 'Restricted downloads',
          membershipMode: 'inherit',
          config: { disableBulkFileDownload: true },
        })
        await db.insert(permissionGroupWorkspace).values({
          id: generateId(),
          permissionGroupId: groupId,
          workspaceId: secondId,
          organizationId: f.organizationId,
        })
        const input = { projectId: f.projectId, fileIds: [], folderIds: [directory.folder.id] }
        await downloadProjectFileItems.execute({ principal: f.principal, input })
        await db.insert(permissions).values({
          id: generateId(),
          userId: f.editorId,
          entityType: 'workspace',
          entityId: secondId,
          permissionType: 'read',
        })
        await expect(
          downloadProjectFileItems.execute({ principal: f.principal, input })
        ).rejects.toMatchObject({ detailCode: 'PERMISSION_GROUP_CAPABILITY_BLOCKED' })
        const single = await downloadProjectFileItems.execute({
          principal: f.principal,
          input: { projectId: f.projectId, fileIds: [source.file.id], folderIds: [] },
        })
        expect(single.fileCount).toBe(1)
      } finally {
        await deleteWorkspaceFixture(db, eq(workspace.id, secondId))
      }
    }
  )

  check(
    'Project Markdown snapshot export packages only same-owner images, preserves source fidelity, and delivers joined provenance without persisting edits',
    async () => {
      const { exportProjectFileSnapshot } = await import(
        '@/lib/projects/files/application/downloads'
      )
      const f = await fixture()
      const other = await fixture()
      const secret = {
        status: 'exact' as const,
        entries: [
          {
            encryptedValue: 'asset-fixture',
            sourceUserId: f.ownerId,
            sourceWorkspaceId: f.workspaceId,
          },
        ],
      }
      const image = await createProjectFile.execute({
        principal: f.principal,
        input: {
          ...createInput(f.projectId, 'same-owner image bytes'),
          name: 'diagram.png',
          contentType: 'image/png',
          secretProvenance: secret,
        },
      })
      const foreign = await createProjectFile.execute({
        principal: other.principal,
        input: {
          ...createInput(other.projectId, 'foreign image bytes'),
          name: 'secret.png',
          contentType: 'image/png',
        },
      })
      const source = await createProjectFile.execute({
        principal: f.principal,
        input: createInput(f.projectId, 'durable draft'),
      })
      const headBefore = await db
        .select()
        .from(workspaceFiles)
        .where(eq(workspaceFiles.id, source.file.id))
      const historyBefore = await db
        .select()
        .from(workspaceFileVersion)
        .where(eq(workspaceFileVersion.fileId, source.file.id))
      const visible = `---\ntitle: Architecture\n---\n\n# Unsaved snapshot\n\n![diagram](sim:file/${image.file.id}?project=${f.projectId})\n\n![foreign](/api/projects/${other.projectId}/files/${foreign.file.id}/content)\n\n\`sim:file/${image.file.id}\`\n`
      let delivered: unknown
      const exported = await observeWorkspaceFileDelivery(
        async (source) => {
          delivered = source
        },
        () =>
          exportProjectFileSnapshot.execute({
            principal: f.principal,
            input: { projectId: f.projectId, fileId: source.file.id, content: visible },
          })
      )
      const zip = await JSZip.loadAsync(exported.buffer)
      expect(
        Object.values(zip.files)
          .filter((entry) => !entry.dir)
          .map((entry) => entry.name)
      ).toEqual(['architecture.md', 'assets/diagram.png'])
      expect(await zip.file('assets/diagram.png')?.async('string')).toBe('same-owner image bytes')
      expect(await zip.file('architecture.md')?.async('string')).toBe(
        visible.replace(`sim:file/${image.file.id}?project=${f.projectId}`, './assets/diagram.png')
      )
      expect(exported.secretProvenance).toEqual(secret)
      expect(delivered).toEqual(secret)
      expect(await readFile(join(localStorageRoot, source.file.key), 'utf8')).toBe('durable draft')
      const history = await db
        .select()
        .from(workspaceFileVersion)
        .where(eq(workspaceFileVersion.fileId, source.file.id))
      expect(history).toEqual(historyBefore)
      const headAfter = await db
        .select()
        .from(workspaceFiles)
        .where(eq(workspaceFiles.id, source.file.id))
      expect(headAfter).toEqual(headBefore)

      await updateProjectFileContent.execute({
        principal: f.principal,
        input: {
          projectId: f.projectId,
          fileId: source.file.id,
          content: 'unknown source',
          encoding: 'utf-8',
          secretProvenance: { status: 'unknown' },
        },
      })
      const unknown = await exportProjectFileSnapshot.execute({
        principal: f.principal,
        input: { projectId: f.projectId, fileId: source.file.id, content: visible },
      })
      expect(unknown.secretProvenance.status).toBe('unknown')
    }
  )

  check(
    'Project Markdown snapshot export never collapses admitted control-bearing names into ZIP traversal segments',
    async () => {
      const { exportProjectFileSnapshot } = await import(
        '@/lib/projects/files/application/downloads'
      )
      const f = await fixture()
      const image = await createProjectFile.execute({
        principal: f.principal,
        input: {
          ...createInput(f.projectId, 'bundled asset'),
          name: '.\r.',
          contentType: 'image/png',
        },
      })
      const source = await createProjectFile.execute({
        principal: f.principal,
        input: { ...createInput(f.projectId, 'durable draft'), name: '.\n.' },
      })
      const exported = await exportProjectFileSnapshot.execute({
        principal: f.principal,
        input: {
          projectId: f.projectId,
          fileId: source.file.id,
          content: `![asset](sim:file/${image.file.id}?project=${f.projectId})`,
        },
      })
      const zip = await JSZip.loadAsync(exported.buffer)
      const entries = Object.values(zip.files).filter((entry) => !entry.dir)
      expect(entries).toHaveLength(2)
      for (const entry of entries) {
        const rawPath = entry.unsafeOriginalName ?? entry.name
        expect(rawPath).not.toMatch(/[\x00-\x1f\x7f]/)
        expect(
          rawPath.split('/').every((segment) => segment && segment !== '.' && segment !== '..')
        ).toBe(true)
      }
      const asset = entries.find((entry) => entry.name.startsWith('assets/'))
      expect(await asset?.async('string')).toBe('bundled asset')
    }
  )

  check(
    'Project Markdown snapshot export refuses an asset revision changed after its actual bytes were read',
    async () => {
      const { exportProjectFileSnapshot } = await import(
        '@/lib/projects/files/application/downloads'
      )
      const f = await fixture()
      const image = await createProjectFile.execute({
        principal: f.principal,
        input: {
          ...createInput(f.projectId, 'image before'),
          name: 'diagram.png',
          contentType: 'image/png',
        },
      })
      const source = await createProjectFile.execute({
        principal: f.principal,
        input: createInput(f.projectId),
      })
      const download = storage.downloadFile
      let changed = false
      vi.spyOn(storage, 'downloadFile').mockImplementation(async (options) => {
        const buffer = await download(options)
        if (options.key === image.file.key && !changed) {
          changed = true
          await updateProjectFileContent.execute({
            principal: f.principal,
            input: {
              projectId: f.projectId,
              fileId: image.file.id,
              content: 'image after',
              encoding: 'utf-8',
            },
          })
        }
        return buffer
      })
      await expect(
        exportProjectFileSnapshot.execute({
          principal: f.principal,
          input: {
            projectId: f.projectId,
            fileId: source.file.id,
            content: `![diagram](sim:file/${image.file.id}?project=${f.projectId})`,
          },
        })
      ).rejects.toMatchObject({ code: 'conflict' })
    }
  )
})

describe('Project ZIP extraction against PostgreSQL and local storage', () => {
  async function archive(
    f: Awaited<ReturnType<typeof fixture>>,
    entries: Record<string, string>,
    provenance?: WorkspaceFileSecretProvenance
  ) {
    const zip = new JSZip()
    for (const [path, content] of Object.entries(entries)) zip.file(path, content)
    const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
    return createProjectFile.execute({
      principal: f.principal,
      input: {
        projectId: f.projectId,
        name: 'bundle.zip',
        contentType: 'application/zip',
        content: buffer.toString('base64'),
        encoding: 'base64',
        secretProvenance: provenance,
      },
    })
  }

  check('extraction retains committed bytes when COMMIT acknowledgement is lost', async () => {
    const { extractProjectFile } = await import('@/lib/projects/files/application/extract')
    const f = await fixture()
    const source = await archive(f, { 'retained.txt': 'retained extracted bytes' })
    const original = db.transaction.bind(db)
    vi.spyOn(db, 'transaction').mockImplementation(async (callback, config) => {
      const result = await original(callback, config)
      if (result && typeof result === 'object' && 'usage' in result && 'result' in result)
        throw new Error('Lost COMMIT acknowledgement')
      return result
    })
    await expect(
      extractProjectFile.execute({
        principal: f.principal,
        input: { projectId: f.projectId, fileId: source.file.id },
      })
    ).rejects.toThrow('Lost COMMIT acknowledgement')
    vi.restoreAllMocks()
    const child = (await rows(f.projectId)).find((file) => file.id !== source.file.id)
    if (!child) throw new Error('Extraction did not commit')
    expect(await readFile(join(localStorageRoot, child.key), 'utf8')).toBe(
      'retained extracted bytes'
    )
    const cleanup = await db
      .select()
      .from(outboxEvent)
      .where(sql`${outboxEvent.payload}::text LIKE ${`%${child.key}%`}`)
    expect(cleanup).toHaveLength(0)
  })

  check('extraction rejects an overlong directory before staging a member', async () => {
    const { extractProjectFile } = await import('@/lib/projects/files/application/extract')
    const f = await fixture()
    const source = await archive(f, { [`${'x'.repeat(256)}/entry.txt`]: 'content' })
    const upload = vi.spyOn(storage, 'uploadFile')
    await expect(
      extractProjectFile.execute({
        principal: f.principal,
        input: { projectId: f.projectId, fileId: source.file.id },
      })
    ).rejects.toMatchObject({ code: 'validation' })
    expect(upload).not.toHaveBeenCalled()
    expect(await folders(f.projectId)).toHaveLength(0)
    expect(await rows(f.projectId)).toHaveLength(1)
  })

  async function folders(projectId: string) {
    return db.select().from(folder).where(eq(folder.projectId, projectId))
  }

  check(
    'Project ZIP extraction atomically creates nested bytes beside the archive and bills the canonical payer',
    async () => {
      const { extractProjectFile } = await import('@/lib/projects/files/application/extract')
      const f = await fixture()
      const parent = await createProjectFileFolder.execute({
        principal: f.principal,
        input: { projectId: f.projectId, name: 'Resources' },
      })
      const source = await archive(f, {
        'docs/readme.txt': 'architecture',
        'images/icon.txt': 'diagram',
        '__MACOSX/._readme.txt': 'noise',
      })
      await db
        .update(workspaceFiles)
        .set({ folderId: parent.folder.id })
        .where(eq(workspaceFiles.id, source.file.id))
      await createProjectFileFolder.execute({
        principal: f.principal,
        input: { projectId: f.projectId, name: 'bundle', parentId: parent.folder.id },
      })
      const before = await ledger(f.organizationId)
      const result = await extractProjectFile.execute({
        principal: f.principal,
        input: { projectId: f.projectId, fileId: source.file.id },
      })
      expect(result).toMatchObject({ extractedCount: 2, skippedCount: 1 })
      expect(result.folderName).not.toBe('bundle')
      const tree = await folders(f.projectId)
      const root = tree.find((row) => row.id === result.folderId)
      expect(root).toMatchObject({
        parentId: parent.folder.id,
        userId: f.editorId,
        projectId: f.projectId,
        workspaceId: null,
      })
      const children = (await rows(f.projectId)).filter((row) => row.id !== source.file.id)
      expect(children).toHaveLength(2)
      for (const row of children) {
        expect(row.userId).toBe(f.editorId)
        expect(row.workspaceId).toBeNull()
        const directory = tree.find((candidate) => candidate.id === row.folderId)
        expect(directory?.parentId).toBe(result.folderId)
        expect(await readFile(join(localStorageRoot, row.key), 'utf8')).toBe(
          row.originalName === 'readme.txt' ? 'architecture' : 'diagram'
        )
      }
      expect(await ledger(f.organizationId)).toBe(
        (before ?? 0) + Buffer.byteLength('architecturediagram')
      )
      expect(await storage.downloadFile({ key: source.file.key, context: 'project' })).toHaveLength(
        source.file.size
      )
    }
  )

  check(
    'Project ZIP extraction conceals a foreign archive and refuses a read-only destination without publishing children',
    async () => {
      const { extractProjectFile } = await import('@/lib/projects/files/application/extract')
      const f = await fixture()
      const other = await fixture()
      const source = await archive(f, { 'one.txt': 'one' })
      await expect(
        extractProjectFile.execute({
          principal: f.principal,
          input: {
            projectId: f.projectId,
            fileId: (await archive(other, { 'secret.txt': 'secret' })).file.id,
          },
        })
      ).rejects.toMatchObject({ code: 'not_found' })
      await db
        .update(permissions)
        .set({ permissionType: 'read' })
        .where(and(eq(permissions.userId, f.editorId), eq(permissions.entityId, f.workspaceId)))
      await expect(
        extractProjectFile.execute({
          principal: f.principal,
          input: { projectId: f.projectId, fileId: source.file.id },
        })
      ).rejects.toMatchObject({ code: 'forbidden' })
      expect((await rows(f.projectId)).map((row) => row.id)).toEqual([source.file.id])
      expect(await folders(f.projectId)).toEqual([])
      expect(await keys(f.projectId)).toHaveLength(1)
      expect(await ledger(f.organizationId)).toBe(source.file.size)
    }
  )

  for (const change of ['permission', 'source'] as const) {
    check(
      `Project ZIP extraction rejects ${change} changes after staging and leaves no partial tree`,
      async () => {
        const { extractProjectFile } = await import('@/lib/projects/files/application/extract')
        const f = await fixture()
        const source = await archive(f, { 'first.txt': 'first', 'nested/second.txt': 'second' })
        const upload = storage.uploadFile
        let changed = false
        vi.spyOn(storage, 'uploadFile').mockImplementation(async (options) => {
          const result = await upload(options)
          if (!changed) {
            changed = true
            if (change === 'permission')
              await db
                .update(permissions)
                .set({ permissionType: 'read' })
                .where(
                  and(eq(permissions.userId, f.editorId), eq(permissions.entityId, f.workspaceId))
                )
            else
              await db
                .update(workspaceFiles)
                .set({ originalName: 'renamed.zip', updatedAt: new Date() })
                .where(eq(workspaceFiles.id, source.file.id))
          }
          return result
        })
        await expect(
          extractProjectFile.execute({
            principal: f.principal,
            input: { projectId: f.projectId, fileId: source.file.id },
          })
        ).rejects.toMatchObject({ code: change === 'permission' ? 'forbidden' : 'conflict' })
        expect((await rows(f.projectId)).map((row) => row.id)).toEqual([source.file.id])
        expect(await folders(f.projectId)).toEqual([])
        expect(await keys(f.projectId)).toHaveLength(1)
        expect(await ledger(f.organizationId)).toBe(source.file.size)
      }
    )
  }

  check(
    'Project ZIP extraction blocks concurrent work and fences a replaced lease before metadata commit',
    async () => {
      const { extractProjectFile } = await import('@/lib/projects/files/application/extract')
      const f = await fixture()
      const source = await archive(f, { 'one.txt': 'one' })
      const uploaded = createDeferred<void>()
      const resume = createDeferred<void>()
      const upload = storage.uploadFile
      vi.spyOn(storage, 'uploadFile').mockImplementationOnce(async (options) => {
        const result = await upload(options)
        uploaded.resolve()
        await resume.promise
        return result
      })
      const args = {
        principal: f.principal,
        input: { projectId: f.projectId, fileId: source.file.id },
      }
      const first = extractProjectFile.execute(args)
      const firstResult = first.catch((error: unknown) => error)
      await uploaded.promise
      try {
        await expect(extractProjectFile.execute(args)).rejects.toMatchObject({ code: 'conflict' })
        const replaced = await db
          .update(idempotencyKey)
          .set({
            result: {
              status: 'in-progress',
              claimToken: generateId(),
              inProgressExpiresAt: Date.now() + 60_000,
            },
          })
          .where(sql`${idempotencyKey.key} LIKE ${`%${f.projectId}%${source.file.id}%`}`)
          .returning({ key: idempotencyKey.key })
        expect(replaced).toHaveLength(1)
      } finally {
        resume.resolve()
      }
      expect(await firstResult).toMatchObject({ code: 'conflict' })
      expect((await rows(f.projectId)).map((row) => row.id)).toEqual([source.file.id])
      expect(await folders(f.projectId)).toEqual([])
      expect(await keys(f.projectId)).toHaveLength(1)
      expect(await ledger(f.organizationId)).toBe(source.file.size)
    }
  )

  check(
    'Project ZIP extraction quota failure rolls back every child and preserves the source archive',
    async () => {
      const { extractProjectFile } = await import('@/lib/projects/files/application/extract')
      const f = await fixture()
      const source = await archive(f, { 'first.txt': 'first', 'nested/second.txt': 'second' })
      vi.stubEnv('FREE_STORAGE_LIMIT_GB', '1')
      await db
        .update(organization)
        .set({ storageUsedBytes: 1024 ** 3 })
        .where(eq(organization.id, f.organizationId))
      await expect(
        extractProjectFile.execute({
          principal: f.principal,
          input: { projectId: f.projectId, fileId: source.file.id },
        })
      ).rejects.toMatchObject({ name: 'StorageLimitExceededError' })
      expect((await rows(f.projectId)).map((row) => row.id)).toEqual([source.file.id])
      expect(await folders(f.projectId)).toEqual([])
      expect(await keys(f.projectId)).toHaveLength(1)
      expect(await ledger(f.organizationId)).toBe(1024 ** 3)
    }
  )

  check(
    'Project ZIP extraction rejects over-deep member paths before any destination mutation',
    async () => {
      const { extractProjectFile } = await import('@/lib/projects/files/application/extract')
      const { MAX_FOLDER_PATH_SEGMENTS } = await import('@/lib/folders/paths')
      const f = await fixture()
      const source = await archive(f, {
        [`${Array.from({ length: MAX_FOLDER_PATH_SEGMENTS + 1 }, () => 'deep').join('/')}/file.txt`]:
          'too deep',
      })
      await expect(
        extractProjectFile.execute({
          principal: f.principal,
          input: { projectId: f.projectId, fileId: source.file.id },
        })
      ).rejects.toMatchObject({ reason: 'invalid' })
      expect((await rows(f.projectId)).map((row) => row.id)).toEqual([source.file.id])
      expect(await folders(f.projectId)).toEqual([])
      expect(await keys(f.projectId)).toHaveLength(1)
      expect(await ledger(f.organizationId)).toBe(source.file.size)
    }
  )

  check(
    'Project ZIP extraction preserves conservative provenance through decompression',
    async () => {
      const { extractProjectFile } = await import('@/lib/projects/files/application/extract')
      const classifications = [
        { status: 'exact' as const, entries: [] },
        { status: 'unknown' as const },
        { status: 'unrecorded' as const },
        {
          status: 'exact' as const,
          entries: [
            {
              encryptedValue: (await encryptSecret('extracted-secret-value')).encrypted,
              sourceUserId: 'origin',
            },
          ],
        },
      ]
      for (const classification of classifications) {
        const f = await fixture()
        const source = await archive(f, { 'data.txt': 'extracted-secret-value' }, classification)
        await extractProjectFile.execute({
          principal: f.principal,
          input: { projectId: f.projectId, fileId: source.file.id },
        })
        const [child] = (await rows(f.projectId)).filter((row) => row.id !== source.file.id)
        if (!child) throw new Error('Extraction did not publish a child')
        const [provenance] = await db
          .select()
          .from(workspaceFileSecretProvenance)
          .where(eq(workspaceFileSecretProvenance.fileId, child.id))
        expect(provenance.status).toBe(classification.status)
        const read = await readProjectFileContent.execute({
          principal: f.principal,
          input: { projectId: f.projectId, fileId: child.id, includeSecretProvenance: true },
        })
        expect(read.content.toString()).toBe('extracted-secret-value')
        if (classification.status === 'exact' && classification.entries.length > 0) {
          if (read.secretProvenance?.status !== 'exact')
            throw new Error('Child lost its recorded evidence')
          const registry = await createDurableSecretProvenanceRegistry(read.secretProvenance, {
            userId: f.ownerId,
            workspaceId: f.workspaceId,
          })
          expect(
            projectResolvedSecretModelContent(read.content.toString(), registry)
          ).toMatchObject({ safe: true, value: '[REDACTED_SECRET]' })
        } else expect(provenance.entries).toEqual([])
      }
    }
  )
})

afterAll(async () => {
  vi.restoreAllMocks()
  for (const f of fixtures) {
    await db.delete(idempotencyKey).where(sql`${idempotencyKey.key} LIKE ${`%${f.projectId}%`}`)
    await db
      .delete(outboxEvent)
      .where(
        sql`${outboxEvent.payload}::jsonb ->> 'key' LIKE ${`project/${f.projectId}/%`} OR ${outboxEvent.payload}::jsonb -> 'owner' ->> 'entityId' = ${f.projectId}`
      )
    await db.delete(workspaceFiles).where(eq(workspaceFiles.projectId, f.projectId))
    await db.delete(folder).where(eq(folder.projectId, f.projectId))
    await deleteWorkspaceFixture(db, eq(workspace.id, f.workspaceId))
    await db.delete(subscription).where(eq(subscription.referenceId, f.organizationId))
    await db.delete(organization).where(eq(organization.id, f.organizationId))
    await db.delete(user).where(inArray(user.id, [f.ownerId, f.editorId]))
  }
  await rm(localStorageRoot, { recursive: true, force: true })
  const report =
    process.env.PROJECT_FILE_CONTENT_REPORT_PATH ?? 'test-results/project-file-content.json'
  await mkdir(dirname(report), { recursive: true })
  await writeFile(report, JSON.stringify({ checks }, null, 2))
  await db.$client.end()
})
