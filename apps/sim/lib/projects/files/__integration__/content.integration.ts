import { mkdtempSync } from 'node:fs'
import { mkdir, readdir, readFile, rm, truncate, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
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
  project,
  projectWorkspace,
  publicShare,
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
import { emailMailerMock, emailMailerMockFns } from '@sim/testing/mocks/email-mailer.mock'
import { featureFlagsMock, featureFlagsMockFns } from '@sim/testing/mocks/feature-flags.mock'
import { setUploadDirServer, uploadsSetupMock } from '@sim/testing/mocks/uploads-setup.mock'
import { getErrorMessage, getPostgresErrorCode } from '@sim/utils/errors'
import { sleep } from '@sim/utils/helpers'
import { generateId } from '@sim/utils/id'
import { isRecordLike } from '@sim/utils/object'
import { and, eq, inArray, sql } from 'drizzle-orm'
import JSZip from 'jszip'
import { NextResponse } from 'next/server'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/uploads/core/setup.server', () => uploadsSetupMock)
vi.mock('@/lib/messaging/email/mailer', () => emailMailerMock)

import * as tracking from '@/lib/billing/storage/tracking'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { processOutboxEventById } from '@/lib/core/outbox/service'
import * as sandboxTask from '@/lib/execution/sandbox/run-task'
import { executeAgentCliRequest } from '@/lib/mothership/agent-cli'
import { readProjectFileArtifact } from '@/lib/projects/files/application/artifacts'
import {
  createProjectFile,
  readProjectFileContent,
  updateProjectFileContent,
} from '@/lib/projects/files/application/content'
import { createProjectFileFolder } from '@/lib/projects/files/application/folders'
import { revertProjectFileVersion } from '@/lib/projects/files/application/versions'
import type { WorkspaceFileSecretProvenance } from '@/lib/uploads/contexts/workspace/workspace-file-secret-provenance'
import * as storageCleanup from '@/lib/uploads/contexts/workspace/workspace-file-storage-cleanup-outbox'
import { workspaceFileStorageCleanupOutboxHandlers } from '@/lib/uploads/contexts/workspace/workspace-file-storage-cleanup-outbox'
import * as storage from '@/lib/uploads/core/storage-service'
import { storeCompiledDoc } from '@/lib/uploads/documents/compiled-store'
import * as heic from '@/lib/uploads/server/heic'
import { deleteUserAccount } from '@/lib/users/account-deletion'
import { observeWorkspaceFileDelivery } from '@/lib/workspace-files/application/file-delivery-observer'
import { verifyFileAccess } from '@/app/api/files/authorization'

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
  vi.stubEnv('PROJECT_FILES_ENABLED', 'true')
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
  const [binding] = await db
    .select()
    .from(projectWorkspace)
    .where(eq(projectWorkspace.workspaceId, workspaceId))
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
  for (const mutation of ['upload', 'update'] as const) {
    check(
      `workspace ${mutation} waits for Project authority before locking shared file resources`,
      async () => {
        const { uploadWorkspaceFile, updateWorkspaceFileContent } = await import(
          '@/lib/uploads/contexts/workspace/workspace-file-manager'
        )
        const { defineAuthorizedProjectFileUseCase } = await import(
          '@/lib/projects/files/application/authorized-use-case'
        )
        const { projectFileOperations } = await import(
          '@/lib/projects/files/application/operations'
        )
        const f = await fixture()
        const initial = await uploadWorkspaceFile(
          f.workspaceId,
          f.editorId,
          Buffer.from('old'),
          'original.txt',
          'text/plain',
          { notifyWorkspaceChange: false }
        )
        const ready = createDeferred<number>()
        const release = createDeferred<void>()
        const authority = defineAuthorizedProjectFileUseCase({
          operation: projectFileOperations.create,
          async execute({ tx }) {
            const [connection] = await tx.execute<{ pid: number }>(
              sql`SELECT pg_backend_pid() AS pid`
            )
            ready.resolve(connection.pid)
            await release.promise
          },
        }).execute({ principal: f.principal, input: { projectId: f.projectId } })
        const pid = await Promise.race([
          ready.promise,
          authority.then(() => {
            throw new Error('Authority exited early')
          }),
        ])
        const pending =
          mutation === 'upload'
            ? uploadWorkspaceFile(
                f.workspaceId,
                f.editorId,
                Buffer.from('next'),
                'new.txt',
                'text/plain',
                { notifyWorkspaceChange: false }
              )
            : updateWorkspaceFileContent(
                f.workspaceId,
                initial.id,
                f.editorId,
                Buffer.from('next'),
                'text/plain',
                {
                  version: { source: 'user', authorUserId: f.editorId },
                  syncLiveDoc: false,
                }
              )
        const observed = pending.then(
          () => null,
          (error: unknown) => error
        )
        try {
          let waiting: string | null = null
          for (let attempt = 0; attempt < 100; attempt++) {
            const [state] = await db.execute<{ wait_event: string | null }>(sql`
            SELECT wait_event FROM pg_stat_activity
            WHERE ${pid} = ANY(pg_blocking_pids(pid)) AND wait_event_type = 'Lock'
            LIMIT 1
          `)
            if (state?.wait_event) {
              waiting = state.wait_event
              break
            }
            await sleep(10)
          }
          expect(waiting).toBe('advisory')
        } finally {
          release.resolve()
          await authority
          expect(await observed).toBeNull()
        }
        expect(await ledger(f.organizationId)).toBe(mutation === 'upload' ? 7 : 4)
      }
    )
  }

  check(
    'workspace copy billing resolves the current plan within its owning transaction',
    async () => {
      const { resolveStorageBillingContext } = await import('@/lib/billing/storage/context')
      const f = await fixture()
      try {
        await db.transaction(async (tx) => {
          await tx.insert(subscription).values({
            id: generateId(),
            referenceId: f.organizationId,
            plan: 'enterprise',
            status: 'active',
            metadata: { customStorageLimitGB: 42 },
          })
          const billing = await resolveStorageBillingContext(f.workspaceId, tx)
          expect(billing).toMatchObject({
            billingEntity: { type: 'organization', id: f.organizationId },
            plan: 'enterprise',
            customStorageLimitGB: 42,
          })
        })
      } finally {
        await db.delete(subscription).where(eq(subscription.referenceId, f.organizationId))
      }
    }
  )

  check(
    'a lost staging response retains a durable cleanup record before any file is admitted',
    async () => {
      const f = await fixture()
      const upload = storage.uploadFile
      let attemptedKey = ''
      vi.spyOn(storage, 'uploadFile').mockImplementationOnce(async (options) => {
        const uploaded = await upload(options)
        attemptedKey = uploaded.key
        throw new Error('Lost provider response')
      })
      vi.spyOn(storage, 'deleteFile').mockRejectedValueOnce(new Error('Cleanup unavailable'))
      await expect(
        createProjectFile.execute({ principal: f.principal, input: createInput(f.projectId) })
      ).rejects.toThrow('Lost provider response')
      expect(await rows(f.projectId)).toEqual([])
      expect(await ledger(f.organizationId)).toBe(0)
      const [event] = await db
        .select()
        .from(outboxEvent)
        .where(sql`${outboxEvent.payload}::jsonb ->> 'key' = ${attemptedKey}`)
      expect(event?.payload).toMatchObject({ key: attemptedKey, context: 'project' })
      expect(event.status).toBe('pending')
      expect((await readFile(join(localStorageRoot, attemptedKey))).length).toBeGreaterThan(0)
      await db
        .update(outboxEvent)
        .set({ availableAt: new Date(0) })
        .where(eq(outboxEvent.id, event.id))
      await expect(
        processOutboxEventById(event.id, workspaceFileStorageCleanupOutboxHandlers)
      ).resolves.toBe('completed')
      await expect(readFile(join(localStorageRoot, attemptedKey))).rejects.toMatchObject({
        code: 'ENOENT',
      })
    }
  )

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
        '@/lib/workspace-files/application/workspace-file-folders'
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
        '@/lib/workspace-files/application/workspace-file-folders'
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
        '@/lib/workspace-files/application/workspace-file-folders'
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

  check(
    'Project history preserves source provenance and pagination through a version revert',
    async () => {
      const history = await import('@/lib/projects/files/application/versions')
      const f = await fixture()
      const secret = {
        status: 'exact' as const,
        entries: [
          {
            name: 'TOKEN',
            encryptedValue: 'encrypted-fixture',
            sourceUserId: f.editorId,
            sourceWorkspaceId: f.workspaceId,
          },
        ],
      }
      const created = await createProjectFile.execute({
        principal: f.principal,
        input: { ...createInput(f.projectId, 'classified original'), secretProvenance: secret },
      })
      const target = { projectId: f.projectId, fileId: created.file.id }
      const changed = await updateProjectFileContent.execute({
        principal: f.principal,
        input: { ...target, content: 'new', encoding: 'utf-8' },
      })
      const page = await history.listProjectFileVersions.execute({
        principal: f.principal,
        input: { ...target, sortOrder: 'desc', limit: 1 },
      })
      expect(page.versions.map((version) => version.version)).toEqual([2])
      expect(page.nextKeys).not.toBeNull()
      const older = await history.listProjectFileVersions.execute({
        principal: f.principal,
        input: { ...target, sortOrder: 'desc', limit: 1, after: page.nextKeys ?? undefined },
      })
      expect(older.versions.map((version) => version.version)).toEqual([1])
      const read = await history.readProjectFileVersionContent.execute({
        principal: f.principal,
        input: { ...target, version: 1 },
      })
      expect(read.content.toString()).toBe('classified original')
      expect(read.secretProvenance).toEqual(secret)
      const reverted = await history.revertProjectFileVersion.execute({
        principal: f.principal,
        input: { ...target, version: 1, expectedCurrentVersion: 2 },
      })
      expect(reverted).toMatchObject({
        reverted: true,
        revertedFrom: 2,
        version: {
          version: 3,
          source: 'revert',
          restoredFromVersion: 1,
          authorUserIds: [f.editorId],
        },
      })
      const current = await readProjectFileContent.execute({
        principal: f.principal,
        input: { ...target, includeSecretProvenance: true },
      })
      expect(current.secretProvenance).toEqual(secret)
      expect(current.content.toString()).toBe('classified original')
      expect(await ledger(f.organizationId)).toBe(current.content.length)
      expect(current.file.key).not.toBe(changed.file.key)
      const noOp = await history.revertProjectFileVersion.execute({
        principal: f.principal,
        input: { ...target, version: 3, expectedCurrentVersion: 3 },
      })
      expect(noOp.reverted).toBe(false)
      expect(noOp.file.key).toBe(current.file.key)
      const other = await fixture()
      await expect(
        history.listProjectFileVersions.execute({
          principal: f.principal,
          input: {
            projectId: other.projectId,
            fileId: created.file.id,
            sortOrder: 'desc',
            limit: 1,
          },
        })
      ).rejects.toMatchObject({ code: 'not_found' })
    }
  )

  check(
    'a Project revert refuses a concurrent edit after staging and releases only its orphan',
    async () => {
      const history = await import('@/lib/projects/files/application/versions')
      const f = await fixture()
      const created = await createProjectFile.execute({
        principal: f.principal,
        input: createInput(f.projectId, 'first'),
      })
      const target = { projectId: f.projectId, fileId: created.file.id }
      await updateProjectFileContent.execute({
        principal: f.principal,
        input: { ...target, content: 'second', encoding: 'utf-8' },
      })
      const upload = storage.uploadFile
      let orphanKey = ''
      vi.spyOn(storage, 'uploadFile').mockImplementationOnce(async (options) => {
        const staged = await upload(options)
        orphanKey = staged.key
        await updateProjectFileContent.execute({
          principal: f.principal,
          input: { ...target, content: 'concurrent winner', encoding: 'utf-8' },
        })
        return staged
      })
      await expect(
        history.revertProjectFileVersion.execute({
          principal: f.principal,
          input: { ...target, version: 1, expectedCurrentVersion: 2 },
        })
      ).rejects.toMatchObject({ code: 'conflict' })
      expect(orphanKey).not.toBe('')
      await expect(readFile(join(localStorageRoot, orphanKey))).rejects.toMatchObject({
        code: 'ENOENT',
      })
      const current = await readProjectFileContent.execute({
        principal: f.principal,
        input: target,
      })
      expect(current.content.toString()).toBe('concurrent winner')
      expect(await ledger(f.organizationId)).toBe(current.content.length)
      expect(
        (
          await history.listProjectFileVersions.execute({
            principal: f.principal,
            input: { ...target, limit: 10, sortOrder: 'desc' },
          })
        ).versions
      ).toHaveLength(3)
    }
  )

  check(
    'Project history deletion protects the current version and durably cleans superseded bytes',
    async () => {
      const history = await import('@/lib/projects/files/application/versions')
      const f = await fixture()
      const created = await createProjectFile.execute({
        principal: f.principal,
        input: createInput(f.projectId, 'first'),
      })
      const target = { projectId: f.projectId, fileId: created.file.id }
      await updateProjectFileContent.execute({
        principal: f.principal,
        input: { ...target, content: 'second', encoding: 'utf-8' },
      })
      await expect(
        history.deleteProjectFileVersion.execute({
          principal: f.principal,
          input: { ...target, version: 2 },
        })
      ).rejects.toMatchObject({ code: 'conflict' })
      vi.spyOn(storage, 'deleteFile').mockRejectedValueOnce(new Error('provider unavailable'))
      await history.deleteProjectFileVersion.execute({
        principal: f.principal,
        input: { ...target, version: 1 },
      })
      await expect(
        history.readProjectFileVersionContent.execute({
          principal: f.principal,
          input: { ...target, version: 1 },
        })
      ).rejects.toMatchObject({ code: 'not_found' })
      const events = await db
        .select()
        .from(outboxEvent)
        .where(sql`${outboxEvent.payload}::jsonb ->> 'key' = ${created.file.key}`)
      expect(events).toHaveLength(1)
      expect(events[0].payload).toMatchObject({ context: 'project', key: created.file.key })
      expect(await readFile(join(localStorageRoot, created.file.key), 'utf8')).toBe('first')
      await db
        .update(outboxEvent)
        .set({ availableAt: new Date(0) })
        .where(eq(outboxEvent.id, events[0].id))
      await expect(
        processOutboxEventById(events[0].id, workspaceFileStorageCleanupOutboxHandlers)
      ).resolves.toBe('completed')
      await expect(readFile(join(localStorageRoot, created.file.key))).rejects.toMatchObject({
        code: 'ENOENT',
      })
      expect(await ledger(f.organizationId)).toBe(6)
    }
  )

  check(
    'archived Project history releases bytes with canonical storage context in the purge transaction',
    async () => {
      const { releaseWorkspaceFileVersionsForPurgeInTx } = await import(
        '@/lib/uploads/contexts/workspace/workspace-file-versions'
      )
      const { archiveProjectFileItems } = await import('@/lib/projects/files/application/lifecycle')
      const f = await fixture()
      const created = await createProjectFile.execute({
        principal: f.principal,
        input: createInput(f.projectId, 'first'),
      })
      await updateProjectFileContent.execute({
        principal: f.principal,
        input: {
          projectId: f.projectId,
          fileId: created.file.id,
          content: 'second',
          encoding: 'utf-8',
        },
      })
      await archiveProjectFileItems.execute({
        principal: f.principal,
        input: { projectId: f.projectId, fileIds: [created.file.id] },
      })
      await db.transaction(async (tx) => {
        await releaseWorkspaceFileVersionsForPurgeInTx(
          tx,
          [created.file.id],
          new Date(Date.now() + 1000)
        )
        await tx.delete(workspaceFiles).where(eq(workspaceFiles.id, created.file.id))
      })
      const events = await db
        .select()
        .from(outboxEvent)
        .where(sql`${outboxEvent.payload}::jsonb ->> 'key' = ${created.file.key}`)
      expect(events).toHaveLength(1)
      expect(events[0].payload).toMatchObject({ context: 'project', key: created.file.key })
      await processOutboxEventById(events[0].id, workspaceFileStorageCleanupOutboxHandlers)
      await expect(readFile(join(localStorageRoot, created.file.key))).rejects.toMatchObject({
        code: 'ENOENT',
      })
    }
  )

  check(
    'preserves workspace bytes, current folder paths, history, and accounting through shared storage',
    async () => {
      const f = await fixture()
      const { createWorkspaceFile, createWorkspaceFileFromBuffer } = await import(
        '@/lib/workspace-files/application/create-workspace-file'
      )
      const { updateWorkspaceFileContent } = await import(
        '@/lib/workspace-files/application/update-workspace-file-content'
      )
      const { readWorkspaceFileContent } = await import(
        '@/lib/workspace-files/application/read-workspace-file-content'
      )
      const { archiveWorkspaceFileItemsOperation } = await import(
        '@/lib/workspace-files/application/archive-workspace-file-items'
      )
      const { restoreWorkspaceFileOperation } = await import(
        '@/lib/workspace-files/application/restore-workspace-file'
      )
      const { createWorkspaceFileFolderOperation, updateWorkspaceFileFolderOperation } =
        await import('@/lib/workspace-files/application/workspace-file-folders')
      const originalFolder = await createWorkspaceFileFolderOperation.execute({
        principal: f.principal,
        input: { workspaceId: f.workspaceId, name: 'Design' },
      })
      const upload = storage.uploadFile
      let replacementFolderId = ''
      vi.spyOn(storage, 'uploadFile').mockImplementationOnce(async (options) => {
        const stored = await upload(options)
        await updateWorkspaceFileFolderOperation.execute({
          principal: f.principal,
          input: { workspaceId: f.workspaceId, folderId: originalFolder.folder.id, name: 'Prior' },
        })
        const replacement = await createWorkspaceFileFolderOperation.execute({
          principal: f.principal,
          input: { workspaceId: f.workspaceId, name: 'Design' },
        })
        replacementFolderId = replacement.folder.id
        return stored
      })
      const created = await createWorkspaceFile.execute({
        principal: f.principal,
        input: {
          workspaceId: f.workspaceId,
          name: 'architecture.md',
          content: 'first',
          contentType: 'text/markdown',
          encoding: 'utf-8',
          exactName: true,
          folderPath: '/Design',
        },
      })
      expect(created.file.folderId).toBe(replacementFolderId)
      const binary = await createWorkspaceFileFromBuffer.execute({
        principal: f.principal,
        input: {
          workspaceId: f.workspaceId,
          name: 'image.bin',
          content: Buffer.from([1, 0, 255]),
          contentType: 'application/octet-stream',
          exactName: true,
        },
      })
      const updated = await updateWorkspaceFileContent.execute({
        principal: f.principal,
        input: {
          fileId: created.file.id,
          assertedWorkspaceId: f.workspaceId,
          content: 'second version',
          encoding: 'utf-8',
          syncLiveDoc: false,
        },
      })
      expect(updated.file.currentVersion).toBe(2)
      const read = await readWorkspaceFileContent.execute({
        principal: f.principal,
        input: {
          fileId: created.file.id,
          assertedWorkspaceId: f.workspaceId,
          includeSecretProvenance: true,
        },
      })
      expect(read.content.toString()).toBe('second version')
      expect(read.secretProvenance).toEqual({ status: 'exact', entries: [] })
      const binaryRead = await readWorkspaceFileContent.execute({
        principal: f.principal,
        input: { fileId: binary.file.id, assertedWorkspaceId: f.workspaceId },
      })
      expect(binaryRead.content).toEqual(Buffer.from([1, 0, 255]))
      expect(await ledger(f.organizationId)).toBe(17)
      await archiveWorkspaceFileItemsOperation.execute({
        principal: f.principal,
        input: { workspaceId: f.workspaceId, folderIds: [replacementFolderId] },
      })
      await expect(
        readWorkspaceFileContent.execute({
          principal: f.principal,
          input: { fileId: created.file.id, assertedWorkspaceId: f.workspaceId },
        })
      ).rejects.toMatchObject({ code: 'not_found' })
      const restored = await restoreWorkspaceFileOperation.execute({
        principal: f.principal,
        input: { fileId: created.file.id, assertedWorkspaceId: f.workspaceId },
      })
      expect(restored.file.folderId).toBeNull()
      expect(restored.file.key).toBe(updated.file.key)
      expect(restored.file.uploadedBy).toBe(f.editorId)
      expect(await ledger(f.organizationId)).toBe(17)
    }
  )

  check(
    'creates binary and text files in the canonical owner, attributes the actor, and bills the organization once',
    async () => {
      const f = await fixture()
      const directory = await createProjectFileFolder.execute({
        principal: f.principal,
        input: { projectId: f.projectId, name: 'Design' },
      })
      const bytes = Buffer.from([0, 255, 18, 1])
      const created = await createProjectFile.execute({
        principal: f.principal,
        input: {
          ...createInput(f.projectId),
          name: 'diagram.bin',
          contentType: 'application/octet-stream',
          content: bytes.toString('base64'),
          encoding: 'base64',
          folderId: directory.folder.id,
        },
      })
      expect(created.file).toMatchObject({
        owner: { entityType: 'project', entityId: f.projectId },
        uploadedBy: f.editorId,
        size: 4,
        folderPath: 'Design',
      })
      expect(created.file.key.startsWith(`project/${f.projectId}/`)).toBe(true)
      const read = await readProjectFileContent.execute({
        principal: f.principal,
        input: { projectId: f.projectId, fileId: created.file.id, includeSecretProvenance: true },
      })
      expect(read.content).toEqual(bytes)
      expect(read.secretProvenance).toEqual({ status: 'exact', entries: [] })
      expect(await ledger(f.organizationId)).toBe(4)
      const [stored] = await rows(f.projectId)
      expect(stored).toMatchObject({
        workspaceId: null,
        organizationId: null,
        context: 'project',
        secretProvenanceVersion: 1,
        userId: f.editorId,
      })
      await expect(
        verifyFileAccess(created.file.key, f.editorId, undefined, 'general')
      ).resolves.toBe(false)
      await expect(
        verifyFileAccess(created.file.key, f.ownerId, undefined, 'workspace')
      ).resolves.toBe(false)
    }
  )

  check(
    'revocation while a blob is staged prevents metadata admission and cleans the uncommitted object',
    async () => {
      const f = await fixture()
      const upload = storage.uploadFile
      vi.spyOn(storage, 'uploadFile').mockImplementationOnce(async (options) => {
        const result = await upload(options)
        await db
          .update(permissions)
          .set({ permissionType: 'read' })
          .where(and(eq(permissions.userId, f.editorId), eq(permissions.entityId, f.workspaceId)))
        return result
      })
      await expect(
        createProjectFile.execute({ principal: f.principal, input: createInput(f.projectId) })
      ).rejects.toMatchObject({ code: 'forbidden' })
      expect(await rows(f.projectId)).toEqual([])
      expect(await ledger(f.organizationId)).toBe(0)
      expect(await keys(f.projectId)).toEqual([])
    }
  )

  check(
    'foreign folders and duplicate names cannot commit a blob or debit either owner',
    async () => {
      const f = await fixture()
      const other = await fixture()
      const foreign = await createProjectFileFolder.execute({
        principal: other.principal,
        input: { projectId: other.projectId, name: 'Private' },
      })
      await expect(
        createProjectFile.execute({
          principal: f.principal,
          input: { ...createInput(f.projectId), folderId: foreign.folder.id },
        })
      ).rejects.toMatchObject({ code: 'not_found' })
      const created = await createProjectFile.execute({
        principal: f.principal,
        input: createInput(f.projectId),
      })
      await expect(
        createProjectFile.execute({ principal: f.principal, input: createInput(f.projectId) })
      ).rejects.toMatchObject({ code: 'conflict' })
      expect((await rows(f.projectId)).map((row) => row.id)).toEqual([created.file.id])
      expect(await ledger(f.organizationId)).toBe(created.file.size)
      expect(await ledger(other.organizationId)).toBe(0)
      expect((await keys(f.projectId)).filter((key) => !key.endsWith('.json'))).toHaveLength(1)
    }
  )

  check(
    'concurrent writes sharing one revision yield one winner and preserve provenance origins in history',
    async () => {
      const f = await fixture()
      const secret = {
        status: 'exact' as const,
        entries: [
          {
            name: 'TOKEN',
            encryptedValue: 'fixture-ciphertext',
            sourceUserId: f.editorId,
            sourceWorkspaceId: f.workspaceId,
          },
        ],
      }
      const created = await createProjectFile.execute({
        principal: f.principal,
        input: { ...createInput(f.projectId, 'sensitive architecture'), secretProvenance: secret },
      })
      const outcomes = await Promise.allSettled(
        ['replacement one', 'replacement two'].map((content) =>
          updateProjectFileContent.execute({
            principal: f.principal,
            input: {
              projectId: f.projectId,
              fileId: created.file.id,
              content,
              encoding: 'utf-8',
              expectedUpdatedAt: created.file.contentUpdatedAt,
              provenanceMode: 'preserve',
            },
          })
        )
      )
      expect(outcomes.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
      expect(outcomes.filter((result) => result.status === 'rejected')).toHaveLength(1)
      const current = await readProjectFileContent.execute({
        principal: f.principal,
        input: { projectId: f.projectId, fileId: created.file.id, includeSecretProvenance: true },
      })
      expect(current.secretProvenance).toEqual(secret)
      expect(await ledger(f.organizationId)).toBe(current.content.length)
      const history = await db
        .select()
        .from(workspaceFileVersion)
        .where(eq(workspaceFileVersion.fileId, created.file.id))
      expect(history).toHaveLength(2)
      expect(
        history.every(
          (version) => version.workspaceId === null && version.secretProvenanceStatus === 'exact'
        )
      ).toBe(true)
      expect(history.flatMap((version) => version.secretProvenanceEntries ?? [])).toContainEqual(
        expect.objectContaining({ sourceUserId: f.editorId, sourceWorkspaceId: f.workspaceId })
      )
      expect((await keys(f.projectId)).filter((key) => !key.endsWith('.json'))).toHaveLength(2)
    }
  )

  check(
    'quota failure rolls back metadata, provenance, versions and counters, retaining previous bytes',
    async () => {
      const f = await fixture()
      const created = await createProjectFile.execute({
        principal: f.principal,
        input: createInput(f.projectId, 'before'),
      })
      vi.stubEnv('FREE_STORAGE_LIMIT_GB', '1')
      await db
        .update(organization)
        .set({ storageUsedBytes: 1024 ** 3 })
        .where(eq(organization.id, f.organizationId))
      await expect(
        updateProjectFileContent.execute({
          principal: f.principal,
          input: {
            projectId: f.projectId,
            fileId: created.file.id,
            content: 'larger replacement',
            encoding: 'utf-8',
            expectedUpdatedAt: created.file.contentUpdatedAt,
          },
        })
      ).rejects.toMatchObject({ name: 'StorageLimitExceededError' })
      const [current] = await rows(f.projectId)
      expect(current.key).toBe(created.file.key)
      expect(await readFile(join(localStorageRoot, current.key), 'utf8')).toBe('before')
      expect(await ledger(f.organizationId)).toBe(1024 ** 3)
      expect(
        await db
          .select()
          .from(workspaceFileVersion)
          .where(eq(workspaceFileVersion.fileId, current.id))
      ).toEqual([])
      const [provenance] = await db
        .select()
        .from(workspaceFileSecretProvenance)
        .where(eq(workspaceFileSecretProvenance.fileId, current.id))
      expect(provenance.contentUpdatedAt.getTime()).toBe(created.file.contentUpdatedAt.getTime())
      expect((await keys(f.projectId)).filter((key) => !key.endsWith('.json'))).toHaveLength(1)
    }
  )

  check(
    'missing Project tracking cannot become exact-empty when a derived write preserves provenance',
    async () => {
      const f = await fixture()
      const created = await createProjectFile.execute({
        principal: f.principal,
        input: createInput(f.projectId),
      })
      await db
        .delete(workspaceFileSecretProvenance)
        .where(eq(workspaceFileSecretProvenance.fileId, created.file.id))
      await db
        .update(workspaceFiles)
        .set({ secretProvenanceVersion: null })
        .where(eq(workspaceFiles.id, created.file.id))
      await updateProjectFileContent.execute({
        principal: f.principal,
        input: {
          projectId: f.projectId,
          fileId: created.file.id,
          content: 'derived content',
          encoding: 'utf-8',
          expectedUpdatedAt: created.file.contentUpdatedAt,
          provenanceMode: 'preserve',
        },
      })
      const read = await readProjectFileContent.execute({
        principal: f.principal,
        input: {
          projectId: f.projectId,
          fileId: created.file.id,
          includeSecretProvenance: true,
        },
      })
      expect(read.secretProvenance).toEqual({ status: 'unknown' })
      const [current] = await rows(f.projectId)
      expect(current.secretProvenanceVersion).toBe(1)
      const history = await db
        .select()
        .from(workspaceFileVersion)
        .where(eq(workspaceFileVersion.fileId, created.file.id))
      expect(history.every((version) => version.secretProvenanceStatus === 'unknown')).toBe(true)
    }
  )

  check(
    'private delivery receives bound provenance and can refuse bytes before the caller receives them',
    async () => {
      const f = await fixture()
      const created = await createProjectFile.execute({
        principal: f.principal,
        input: {
          ...createInput(f.projectId),
          secretProvenance: { status: 'unknown' },
        },
      })
      await expect(
        observeWorkspaceFileDelivery(
          async (provenance) => {
            if (provenance?.status !== 'exact')
              throw new Error('Private delivery refuses unknown provenance')
          },
          () =>
            readProjectFileContent.execute({
              principal: f.principal,
              input: {
                projectId: f.projectId,
                fileId: created.file.id,
              },
            })
        )
      ).rejects.toThrow('Private delivery refuses unknown provenance')
    }
  )

  check(
    'shared content survives creator departure and deletion without changing stored history or its payer',
    async () => {
      const f = await fixture()
      const directory = await createProjectFileFolder.execute({
        principal: f.principal,
        input: { projectId: f.projectId, name: 'Authored' },
      })
      const created = await createProjectFile.execute({
        principal: f.principal,
        input: { ...createInput(f.projectId), folderId: directory.folder.id },
      })
      await updateProjectFileContent.execute({
        principal: f.principal,
        input: {
          projectId: f.projectId,
          fileId: created.file.id,
          content: 'Documented before departure',
          encoding: 'utf-8',
          expectedUpdatedAt: created.file.contentUpdatedAt,
        },
      })
      await db
        .delete(member)
        .where(and(eq(member.organizationId, f.organizationId), eq(member.userId, f.editorId)))
      await db
        .delete(permissions)
        .where(and(eq(permissions.entityId, f.workspaceId), eq(permissions.userId, f.editorId)))
      await expect(
        readProjectFileContent.execute({
          principal: f.principal,
          input: { projectId: f.projectId, fileId: created.file.id },
        })
      ).rejects.toMatchObject({ code: 'not_found' })
      expect((await rows(f.projectId))[0].userId).toBe(f.editorId)
      await deleteUserAccount(f.editorId)
      const principal = createSessionPrincipal({ userId: f.ownerId })
      const read = await readProjectFileContent.execute({
        principal,
        input: { projectId: f.projectId, fileId: created.file.id },
      })
      expect(read.file).toMatchObject({
        uploadedBy: f.ownerId,
        folderPath: 'Authored',
      })
      const [retainedFolder] = await db
        .select()
        .from(folder)
        .where(eq(folder.id, directory.folder.id))
      expect(retainedFolder).toMatchObject({ userId: f.ownerId, projectId: f.projectId })
      await updateProjectFileContent.execute({
        principal,
        input: {
          projectId: f.projectId,
          fileId: created.file.id,
          content: 'Maintained by another editor',
          encoding: 'utf-8',
          expectedUpdatedAt: read.file.contentUpdatedAt,
        },
      })
      const history = await db
        .select()
        .from(workspaceFileVersion)
        .where(eq(workspaceFileVersion.fileId, created.file.id))
      expect(history.find((version) => version.version === 1)?.authorUserIds).toEqual([f.editorId])
      const [maintained] = await rows(f.projectId)
      expect(maintained).toMatchObject({
        id: created.file.id,
        userId: f.ownerId,
        projectId: f.projectId,
        folderId: directory.folder.id,
      })
      expect(await readFile(join(localStorageRoot, maintained.key), 'utf8')).toBe(
        'Maintained by another editor'
      )
      expect(await ledger(f.organizationId)).toBe(maintained.sizeBytes)
    }
  )

  check(
    'a postcommit notification failure never deletes admitted bytes or their accounting',
    async () => {
      const f = await fixture()
      vi.spyOn(tracking, 'maybeNotifyStorageLimitForBillingContext').mockRejectedValueOnce(
        new Error('notification service unavailable')
      )
      await expect(
        createProjectFile.execute({ principal: f.principal, input: createInput(f.projectId) })
      ).rejects.toThrow('notification service unavailable')
      const [file] = await rows(f.projectId)
      expect(file).toBeDefined()
      expect(await readFile(join(localStorageRoot, file.key), 'utf8')).toBe('Project architecture')
      expect(await ledger(f.organizationId)).toBe(file.sizeBytes)
      const [provenance] = await db
        .select()
        .from(workspaceFileSecretProvenance)
        .where(eq(workspaceFileSecretProvenance.fileId, file.id))
      expect(provenance.status).toBe('exact')
    }
  )

  check(
    'failed staged-object deletion is durable and an outbox retry removes only uncommitted bytes',
    async () => {
      const f = await fixture()
      const upload = storage.uploadFile
      vi.spyOn(storage, 'uploadFile').mockImplementationOnce(async (options) => {
        const result = await upload(options)
        await db
          .update(permissions)
          .set({ permissionType: 'read' })
          .where(and(eq(permissions.userId, f.editorId), eq(permissions.entityId, f.workspaceId)))
        return result
      })
      vi.spyOn(storage, 'deleteFile').mockRejectedValueOnce(
        new Error('temporary object storage outage')
      )
      await expect(
        createProjectFile.execute({ principal: f.principal, input: createInput(f.projectId) })
      ).rejects.toMatchObject({ code: 'forbidden' })
      expect(await rows(f.projectId)).toEqual([])
      expect((await keys(f.projectId)).length).toBeGreaterThan(0)
      const [event] = await db
        .select()
        .from(outboxEvent)
        .where(
          sql`${outboxEvent.payload}::jsonb ->> 'key' LIKE ${`project/${f.projectId}/%`} OR ${outboxEvent.payload}::jsonb -> 'owner' ->> 'entityId' = ${f.projectId}`
        )
      expect(event.payload).toMatchObject({ context: 'project' })
      expect(event.status).toBe('pending')
      await db
        .update(outboxEvent)
        .set({ availableAt: new Date(0) })
        .where(eq(outboxEvent.id, event.id))
      await expect(
        processOutboxEventById(event.id, workspaceFileStorageCleanupOutboxHandlers)
      ).resolves.toBe('completed')
      expect(await keys(f.projectId)).toEqual([])
      expect(await ledger(f.organizationId)).toBe(0)
    }
  )

  check(
    'content changed while being downloaded cannot be returned with a newer revision or classification',
    async () => {
      const f = await fixture()
      const created = await createProjectFile.execute({
        principal: f.principal,
        input: createInput(f.projectId),
      })
      const download = storage.downloadFile
      vi.spyOn(storage, 'downloadFile').mockImplementationOnce(async (options) => {
        const content = await download(options)
        await updateProjectFileContent.execute({
          principal: f.principal,
          input: {
            projectId: f.projectId,
            fileId: created.file.id,
            content: 'updated during download',
            encoding: 'utf-8',
            expectedUpdatedAt: created.file.contentUpdatedAt,
          },
        })
        return content
      })
      await expect(
        readProjectFileContent.execute({
          principal: f.principal,
          input: { projectId: f.projectId, fileId: created.file.id, includeSecretProvenance: true },
        })
      ).rejects.toMatchObject({ code: 'conflict' })
    }
  )
})

describe('Project file lifecycle against PostgreSQL and private storage', () => {
  check(
    'recursive archive and restore preserve individually archived files, bytes, attribution, and billing',
    async () => {
      const { archiveProjectFileItems, restoreProjectFileFolder } = await import(
        '@/lib/projects/files/application/lifecycle'
      )
      const f = await fixture()
      const parent = await createProjectFileFolder.execute({
        principal: f.principal,
        input: { projectId: f.projectId, name: 'Design' },
      })
      const child = await createProjectFileFolder.execute({
        principal: f.principal,
        input: { projectId: f.projectId, name: 'Diagrams', parentId: parent.folder.id },
      })
      const current = await createProjectFile.execute({
        principal: f.principal,
        input: { ...createInput(f.projectId, 'shared content'), folderId: child.folder.id },
      })
      const prior = await createProjectFile.execute({
        principal: f.principal,
        input: {
          ...createInput(f.projectId, 'old content'),
          name: 'retired.md',
          folderId: child.folder.id,
        },
      })
      await archiveProjectFileItems.execute({
        principal: f.principal,
        input: { projectId: f.projectId, fileIds: [prior.file.id] },
      })
      await db
        .update(workspaceFiles)
        .set({ deletedAt: new Date(0) })
        .where(eq(workspaceFiles.id, prior.file.id))
      const before = await ledger(f.organizationId)
      const archived = await archiveProjectFileItems.execute({
        principal: f.principal,
        input: { projectId: f.projectId, folderIds: [parent.folder.id] },
      })
      expect(archived.deletedItems).toEqual({ files: 1, folders: 2 })
      await expect(
        readProjectFileContent.execute({
          principal: f.principal,
          input: { projectId: f.projectId, fileId: current.file.id },
        })
      ).rejects.toMatchObject({ code: 'not_found' })
      expect(await ledger(f.organizationId)).toBe(before)
      await createProjectFileFolder.execute({
        principal: f.principal,
        input: { projectId: f.projectId, name: 'Design' },
      })
      const restored = await restoreProjectFileFolder.execute({
        principal: f.principal,
        input: { projectId: f.projectId, folderId: parent.folder.id },
      })
      expect(restored.folder.name).toBe('Design (1)')
      expect(restored.restoredItems).toEqual({ files: 1, folders: 2 })
      const content = await readProjectFileContent.execute({
        principal: f.principal,
        input: { projectId: f.projectId, fileId: current.file.id, includeSecretProvenance: true },
      })
      expect(content.content.toString()).toBe('shared content')
      expect(content.file.uploadedBy).toBe(f.editorId)
      expect(content.secretProvenance).toEqual({ status: 'exact', entries: [] })
      await expect(
        readProjectFileContent.execute({
          principal: f.principal,
          input: { projectId: f.projectId, fileId: prior.file.id },
        })
      ).rejects.toMatchObject({ code: 'not_found' })
      expect(await ledger(f.organizationId)).toBe(before)
    }
  )

  check(
    'bulk moves and archives reject foreign items, conflicts, and descendant cycles atomically',
    async () => {
      const { archiveProjectFileItems, moveProjectFileItems } = await import(
        '@/lib/projects/files/application/lifecycle'
      )
      const f = await fixture()
      const other = await fixture()
      const destination = await createProjectFileFolder.execute({
        principal: f.principal,
        input: { projectId: f.projectId, name: 'Target' },
      })
      const child = await createProjectFileFolder.execute({
        principal: f.principal,
        input: { projectId: f.projectId, name: 'Child', parentId: destination.folder.id },
      })
      const a = await createProjectFile.execute({
        principal: f.principal,
        input: createInput(f.projectId),
      })
      const b = await createProjectFile.execute({
        principal: f.principal,
        input: { ...createInput(f.projectId), name: 'second.md' },
      })
      const foreign = await createProjectFile.execute({
        principal: other.principal,
        input: createInput(other.projectId),
      })
      await createProjectFile.execute({
        principal: f.principal,
        input: { ...createInput(f.projectId), name: 'second.md', folderId: destination.folder.id },
      })
      await expect(
        moveProjectFileItems.execute({
          principal: f.principal,
          input: {
            projectId: f.projectId,
            fileIds: [a.file.id, b.file.id],
            targetFolderId: destination.folder.id,
          },
        })
      ).rejects.toMatchObject({ code: 'conflict' })
      await expect(
        archiveProjectFileItems.execute({
          principal: f.principal,
          input: { projectId: f.projectId, fileIds: [a.file.id, foreign.file.id] },
        })
      ).rejects.toMatchObject({ code: 'not_found' })
      await expect(
        moveProjectFileItems.execute({
          principal: f.principal,
          input: {
            projectId: f.projectId,
            folderIds: [destination.folder.id],
            targetFolderId: child.folder.id,
          },
        })
      ).rejects.toMatchObject({ code: 'validation' })
      const [unchanged] = (await rows(f.projectId)).filter((file) => file.id === a.file.id)
      expect(unchanged).toMatchObject({ folderId: null, deletedAt: null })
      const moved = await moveProjectFileItems.execute({
        principal: f.principal,
        input: { projectId: f.projectId, fileIds: [a.file.id], targetFolderPath: '/Target/Child' },
      })
      expect(moved.movedFileIds).toEqual([a.file.id])
      const [stored] = (await rows(f.projectId)).filter((file) => file.id === a.file.id)
      expect(stored.folderId).toBe(child.folder.id)
      expect(stored.contentUpdatedAt).toEqual(a.file.contentUpdatedAt)
    }
  )

  check(
    'file restore re-roots from archived folders and deduplicates while rename preserves byte identity',
    async () => {
      const { archiveProjectFileItems, renameProjectFile, restoreProjectFile } = await import(
        '@/lib/projects/files/application/lifecycle'
      )
      const f = await fixture()
      const parent = await createProjectFileFolder.execute({
        principal: f.principal,
        input: { projectId: f.projectId, name: 'Archive' },
      })
      const file = await createProjectFile.execute({
        principal: f.principal,
        input: { ...createInput(f.projectId), folderId: parent.folder.id },
      })
      const renamed = await renameProjectFile.execute({
        principal: f.principal,
        input: { projectId: f.projectId, fileId: file.file.id, name: 'renamed.md' },
      })
      expect(renamed.file.key).toBe(file.file.key)
      expect(renamed.file.contentUpdatedAt).toEqual(file.file.contentUpdatedAt)
      await archiveProjectFileItems.execute({
        principal: f.principal,
        input: { projectId: f.projectId, folderIds: [parent.folder.id] },
      })
      await createProjectFile.execute({
        principal: f.principal,
        input: { ...createInput(f.projectId), name: 'renamed.md' },
      })
      const restored = await restoreProjectFile.execute({
        principal: f.principal,
        input: { projectId: f.projectId, fileId: file.file.id },
      })
      expect(restored.file.folderId).toBeNull()
      expect(restored.file.name).not.toBe('renamed.md')
      expect(restored.file.name.endsWith('.md')).toBe(true)
      expect(restored.file.key).toBe(file.file.key)
      expect(restored.file.contentUpdatedAt).toEqual(file.file.contentUpdatedAt)
    }
  )
})

describe('Public file shares against PostgreSQL and private storage', () => {
  check(
    'public share configuration requires Project write and the canonical organization sharing policy',
    async () => {
      const { updateProjectFileShare, getProjectFileShare } = await import(
        '@/lib/projects/files/application/shares'
      )
      const f = await fixture()
      const other = await fixture()
      const { file } = await createProjectFile.execute({
        principal: f.principal,
        input: createInput(f.projectId),
      })
      const input = { projectId: f.projectId, fileId: file.id, isActive: true }
      const created = await updateProjectFileShare.execute({ principal: f.principal, input })
      expect(created.share.isActive).toBe(true)
      const [stored] = await db
        .select()
        .from(publicShare)
        .where(eq(publicShare.id, created.share.id))
      expect(stored).toMatchObject({
        entityType: 'project',
        entityId: f.projectId,
        workspaceId: null,
        createdBy: f.editorId,
      })
      await expect(
        getProjectFileShare.execute({
          principal: other.principal,
          input: { projectId: other.projectId, fileId: file.id },
        })
      ).rejects.toMatchObject({ code: 'not_found' })
      await db
        .update(permissions)
        .set({ permissionType: 'read' })
        .where(eq(permissions.userId, f.editorId))
      await expect(
        updateProjectFileShare.execute({ principal: f.principal, input })
      ).rejects.toMatchObject({ code: 'forbidden' })
      await db
        .update(permissions)
        .set({ permissionType: 'admin' })
        .where(eq(permissions.userId, f.editorId))
      await db.insert(subscription).values({
        id: generateId(),
        plan: 'enterprise',
        referenceId: f.organizationId,
        status: 'active',
        metadata: {},
      })
      await db.insert(permissionGroup).values({
        id: generateId(),
        organizationId: f.organizationId,
        createdBy: f.ownerId,
        name: 'No public sharing',
        isDefault: true,
        membershipMode: 'inherit',
        config: { disablePublicFileSharing: true },
      })
      await expect(
        updateProjectFileShare.execute({ principal: f.principal, input })
      ).rejects.toMatchObject({ detailCode: 'PUBLIC_SHARING_NOT_ALLOWED' })
      const disabled = await updateProjectFileShare.execute({
        principal: f.principal,
        input: { ...input, isActive: false },
      })
      expect(disabled.share).toMatchObject({ isActive: false, token: created.share.token })
    }
  )

  check(
    'public share policy includes each accessible active environment without a selected-environment bypass',
    async () => {
      const { updateProjectFileShare } = await import('@/lib/projects/files/application/shares')
      const f = await fixture()
      const { file } = await createProjectFile.execute({
        principal: f.principal,
        input: createInput(f.projectId),
      })
      const secondId = generateId()
      await insertWorkspaceFixture(db, {
        id: secondId,
        ownerId: f.ownerId,
        billedAccountUserId: f.ownerId,
        organizationId: f.organizationId,
        workspaceMode: 'organization',
        name: 'Restricted environment',
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
          name: 'Restricted sharing',
          membershipMode: 'inherit',
          config: { disablePublicFileSharing: true },
        })
        await db.insert(permissionGroupWorkspace).values({
          id: generateId(),
          permissionGroupId: groupId,
          workspaceId: secondId,
          organizationId: f.organizationId,
        })
        const input = { projectId: f.projectId, fileId: file.id, isActive: true }
        await updateProjectFileShare.execute({ principal: f.principal, input })
        await db.insert(permissions).values({
          id: generateId(),
          userId: f.editorId,
          entityType: 'workspace',
          entityId: secondId,
          permissionType: 'read',
        })
        await expect(
          updateProjectFileShare.execute({ principal: f.principal, input })
        ).rejects.toMatchObject({ detailCode: 'PUBLIC_SHARING_NOT_ALLOWED' })
        await db
          .update(permissionGroup)
          .set({ config: { allowedFileShareAuthTypes: ['password'] } })
          .where(eq(permissionGroup.id, groupId))
        await expect(
          updateProjectFileShare.execute({ principal: f.principal, input })
        ).rejects.toMatchObject({ detailCode: 'PUBLIC_SHARING_NOT_ALLOWED' })
        const allowed = await updateProjectFileShare.execute({
          principal: f.principal,
          input: { ...input, authType: 'password', password: 'a-valid-share-password' },
        })
        expect(allowed.share.authType).toBe('password')
      } finally {
        await deleteWorkspaceFixture(db, eq(workspace.id, secondId))
      }
    }
  )

  check(
    'public share credentials preserve password cookies, verified email, and actual session SSO identity',
    async () => {
      const { updateProjectFileShare } = await import('@/lib/projects/files/application/shares')
      const { authorizePublicFileShare, readPublicFileShareContent } = await import(
        '@/lib/public-shares/application'
      )
      const { setDeploymentAuthCookie, deploymentAuthCookieName } = await import(
        '@/lib/core/security/deployment'
      )
      const f = await fixture()
      const { file } = await createProjectFile.execute({
        principal: f.principal,
        input: createInput(f.projectId, 'Shared architecture'),
      })
      const input = { projectId: f.projectId, fileId: file.id, isActive: true }
      const { share } = await updateProjectFileShare.execute({
        principal: f.principal,
        input: { ...input, authType: 'password', password: 'correct-password' },
      })
      const token = share.token
      expect(
        await authorizePublicFileShare({ token, credential: { method: 'GET' } })
      ).toMatchObject({ authorized: false, error: 'auth_required_password' })
      expect(
        await authorizePublicFileShare({
          token,
          credential: { method: 'POST', password: 'wrong-password' },
        })
      ).toMatchObject({ authorized: false, error: 'Invalid password' })
      const accepted = await authorizePublicFileShare({
        token,
        credential: { method: 'POST', password: 'correct-password' },
      })
      if (!accepted.authorized) throw new Error('Correct share password rejected')
      expect((await readPublicFileShareContent({ grant: accepted.grant })).buffer.toString()).toBe(
        'Shared architecture'
      )
      const [passwordShare] = await db
        .select()
        .from(publicShare)
        .where(eq(publicShare.id, share.id))
      const response = NextResponse.json({})
      await setDeploymentAuthCookie({ response, cookiePrefix: 'file', resource: passwordShare })
      const cookies = Object.fromEntries(
        response.cookies.getAll().map(({ name, value }) => [name, value])
      )
      expect(
        await authorizePublicFileShare({ token, credential: { method: 'GET', cookies } })
      ).toMatchObject({ authorized: true })
      await updateProjectFileShare.execute({
        principal: f.principal,
        input: { ...input, authType: 'email', allowedEmails: ['viewer@shared.invalid'] },
      })
      expect(
        await authorizePublicFileShare({
          token,
          credential: { method: 'POST', email: 'viewer@shared.invalid', cookies },
        })
      ).toMatchObject({ authorized: false, error: 'otp_required' })
      const [emailShare] = await db.select().from(publicShare).where(eq(publicShare.id, share.id))
      await setDeploymentAuthCookie({
        response,
        cookiePrefix: 'file',
        resource: emailShare,
        verifiedEmail: 'viewer@shared.invalid',
      })
      const emailCookie = response.cookies.get(deploymentAuthCookieName('file', share.id))
      if (!emailCookie) throw new Error('Email fixture token missing')
      expect(
        await authorizePublicFileShare({
          token,
          credential: { method: 'GET', cookies: { [emailCookie.name]: emailCookie.value } },
        })
      ).toMatchObject({ authorized: true, authenticatedEmail: 'viewer@shared.invalid' })
      await updateProjectFileShare.execute({
        principal: f.principal,
        input: { ...input, authType: 'sso', allowedEmails: [`${f.editorId}@content.invalid`] },
      })
      expect(
        await authorizePublicFileShare({
          token,
          credential: { method: 'GET', email: `${f.editorId}@content.invalid` },
        })
      ).toMatchObject({ authorized: false, error: 'auth_required_sso' })
      expect(
        await authorizePublicFileShare({
          token,
          credential: { method: 'GET', sessionPrincipal: f.principal },
        })
      ).toMatchObject({ authorized: true, authenticatedEmail: `${f.editorId}@content.invalid` })
      expect(
        await authorizePublicFileShare({
          token,
          credential: {
            method: 'GET',
            sessionPrincipal: createSessionPrincipal({ userId: f.ownerId }),
          },
        })
      ).toMatchObject({ authorized: false })
    }
  )

  check(
    'public share password exchange binds its cookie to the current password and rejects wrong modes',
    async () => {
      const { updateProjectFileShare } = await import('@/lib/projects/files/application/shares')
      const { authorizePublicFileShare, authenticatePublicFileSharePassword } = await import(
        '@/lib/public-shares/application'
      )
      const f = await fixture()
      const { file } = await createProjectFile.execute({
        principal: f.principal,
        input: createInput(f.projectId),
      })
      const input = { projectId: f.projectId, fileId: file.id, isActive: true }
      const { share } = await updateProjectFileShare.execute({ principal: f.principal, input })
      await expect(
        authenticatePublicFileSharePassword({
          token: share.token,
          password: 'a-valid-share-password',
        })
      ).rejects.toMatchObject({ code: 'validation' })
      await updateProjectFileShare.execute({
        principal: f.principal,
        input: { ...input, authType: 'password', password: 'a-valid-share-password' },
      })
      expect(
        await authenticatePublicFileSharePassword({
          token: share.token,
          password: 'wrong-password',
        })
      ).toMatchObject({ authorized: false, error: 'Invalid password' })
      const access = await authenticatePublicFileSharePassword({
        token: share.token,
        password: 'a-valid-share-password',
      })
      if (!access.authorized) throw new Error('Password exchange failed')
      const cookies = { [access.cookie.name]: access.cookie.value }
      expect(
        await authorizePublicFileShare({
          token: share.token,
          credential: { method: 'GET', cookies },
        })
      ).toMatchObject({ authorized: true, authType: 'password' })
      await updateProjectFileShare.execute({
        principal: f.principal,
        input: { ...input, password: 'replacement-share-password' },
      })
      expect(
        await authorizePublicFileShare({
          token: share.token,
          credential: { method: 'GET', cookies },
        })
      ).toMatchObject({ authorized: false, authType: 'password' })
    }
  )

  check(
    'public share OTP delivery and verification retain allowlists, code attempts, and current token policy',
    async () => {
      const { updateProjectFileShare } = await import('@/lib/projects/files/application/shares')
      const { authorizePublicFileShare, requestPublicFileShareOtp, verifyPublicFileShareOtp } =
        await import('@/lib/public-shares/application')
      const otpStore = await import('@/lib/core/security/otp')
      const f = await fixture()
      const email = `${generateId()}@shared.invalid`
      const { file } = await createProjectFile.execute({
        principal: f.principal,
        input: createInput(f.projectId),
      })
      const input = {
        projectId: f.projectId,
        fileId: file.id,
        isActive: true,
        authType: 'email' as const,
        allowedEmails: [email],
      }
      const { share } = await updateProjectFileShare.execute({ principal: f.principal, input })
      emailMailerMockFns.mockSendEmail.mockResolvedValue({
        success: true,
        message: 'Local mail boundary accepted',
      })
      await (
        await requestPublicFileShareOtp({ token: share.token, email: 'outsider@shared.invalid' })
      ).deliver()
      expect(await otpStore.getOTP('file', share.id, 'outsider@shared.invalid')).toBeNull()
      await (await requestPublicFileShareOtp({ token: share.token, email })).deliver()
      const stored = await otpStore.getOTP('file', share.id, email)
      if (!stored) throw new Error('Allowed email received no code')
      const { otp } = otpStore.decodeOTPValue(stored)
      expect(
        await verifyPublicFileShareOtp({ token: share.token, email, otp: '000000' })
      ).toMatchObject({ authorized: false, status: 400 })
      const accepted = await verifyPublicFileShareOtp({ token: share.token, email, otp })
      if (!accepted.authorized) throw new Error('Valid verification code rejected')
      expect(
        await authorizePublicFileShare({
          token: share.token,
          credential: { method: 'GET', cookies: { [accepted.cookie.name]: accepted.cookie.value } },
        })
      ).toMatchObject({ authorized: true, authenticatedEmail: email })
      expect(await verifyPublicFileShareOtp({ token: share.token, email, otp })).toMatchObject({
        authorized: false,
        status: 400,
      })
      await otpStore.storeOTP('file', share.id, email, '123456')
      const get = otpStore.getOTP
      const spy = vi.spyOn(otpStore, 'getOTP').mockImplementation(async (...args) => {
        const result = await get(...args)
        await db
          .update(publicShare)
          .set({ allowedEmails: ['replacement@shared.invalid'] })
          .where(eq(publicShare.id, share.id))
        return result
      })
      await expect(
        verifyPublicFileShareOtp({ token: share.token, email, otp: '123456' })
      ).rejects.toMatchObject({ code: 'not_found' })
      spy.mockRestore()
      await otpStore.deleteOTP('file', share.id, email)
    }
  )

  check(
    'public share SSO eligibility never grants bytes and follows current active owner policy',
    async () => {
      const { updateProjectFileShare } = await import('@/lib/projects/files/application/shares')
      const { authorizePublicFileShare, getPublicFileShareSsoEligibility } = await import(
        '@/lib/public-shares/application'
      )
      const f = await fixture()
      const email = `${f.editorId}@content.invalid`
      const { file } = await createProjectFile.execute({
        principal: f.principal,
        input: createInput(f.projectId),
      })
      const { share } = await updateProjectFileShare.execute({
        principal: f.principal,
        input: {
          projectId: f.projectId,
          fileId: file.id,
          isActive: true,
          authType: 'sso',
          allowedEmails: [email],
        },
      })
      expect(await getPublicFileShareSsoEligibility({ token: share.token, email })).toEqual({
        allowed: true,
        eligible: true,
      })
      expect(
        await getPublicFileShareSsoEligibility({
          token: share.token,
          email: 'outsider@shared.invalid',
        })
      ).toEqual({ allowed: true, eligible: false })
      expect(
        await authorizePublicFileShare({ token: share.token, credential: { method: 'GET', email } })
      ).toMatchObject({ authorized: false, authType: 'sso' })
      await db.update(publicShare).set({ isActive: false }).where(eq(publicShare.id, share.id))
      await expect(
        getPublicFileShareSsoEligibility({ token: share.token, email })
      ).rejects.toMatchObject({ code: 'not_found' })
    }
  )

  check(
    'public share Office artifacts require the current owner-qualified dependency cache without compilation',
    async () => {
      const { updateProjectFileShare } = await import('@/lib/projects/files/application/shares')
      const { readProjectFileArtifact } = await import('@/lib/projects/files/application/artifacts')
      const { authorizePublicFileShare, readPublicFileShareContent } = await import(
        '@/lib/public-shares/application'
      )
      const f = await fixture()
      const asset = await createProjectFile.execute({
        principal: f.principal,
        input: { ...createInput(f.projectId, 'first input'), name: 'input.txt' },
      })
      const source = await createProjectFile.execute({
        principal: f.principal,
        input: {
          ...createInput(f.projectId, `getFileBase64('${asset.file.id}')`),
          name: 'report.pptx',
          contentType: 'text/x-pptxgenjs',
        },
      })
      const { share } = await updateProjectFileShare.execute({
        principal: f.principal,
        input: { projectId: f.projectId, fileId: source.file.id, isActive: true },
      })
      const access = await authorizePublicFileShare({
        token: share.token,
        credential: { method: 'GET' },
      })
      if (!access.authorized) throw new Error('Public artifact fixture rejected')
      await expect(readPublicFileShareContent({ grant: access.grant })).rejects.toMatchObject({
        code: 'conflict',
      })
      vi.spyOn(sandboxTask, 'runSandboxTask').mockResolvedValue(
        Buffer.from('PK\u0003\u0004artifact')
      )
      const rendered = await readProjectFileArtifact.execute({
        principal: f.principal,
        input: { projectId: f.projectId, fileId: source.file.id, maxBytes: 1024 },
      })
      expect((await readPublicFileShareContent({ grant: access.grant })).buffer).toEqual(
        rendered.buffer
      )
      await updateProjectFileContent.execute({
        principal: f.principal,
        input: {
          projectId: f.projectId,
          fileId: asset.file.id,
          content: 'changed input',
          encoding: 'utf-8',
        },
      })
      await expect(readPublicFileShareContent({ grant: access.grant })).rejects.toMatchObject({
        code: 'conflict',
      })
    }
  )

  check(
    'public share revocation and password changes during object reads suppress downloaded bytes',
    async () => {
      const { updateProjectFileShare } = await import('@/lib/projects/files/application/shares')
      const { authorizePublicFileShare, readPublicFileShareContent } = await import(
        '@/lib/public-shares/application'
      )
      const { encryptSecret } = await import('@/lib/core/security/encryption')
      for (const change of ['disabled', 'password', 'archived'] as const) {
        const f = await fixture()
        const { file } = await createProjectFile.execute({
          principal: f.principal,
          input: createInput(f.projectId),
        })
        const { share } = await updateProjectFileShare.execute({
          principal: f.principal,
          input: {
            projectId: f.projectId,
            fileId: file.id,
            isActive: true,
            authType: 'password',
            password: 'initial-password',
          },
        })
        const access = await authorizePublicFileShare({
          token: share.token,
          credential: { method: 'POST', password: 'initial-password' },
        })
        if (!access.authorized) throw new Error('Initial credential rejected')
        const download = storage.downloadFile
        const spy = vi.spyOn(storage, 'downloadFile').mockImplementation(async (options) => {
          const result = await download(options)
          if (options.key === file.key) {
            if (change === 'disabled')
              await db
                .update(publicShare)
                .set({ isActive: false })
                .where(eq(publicShare.id, share.id))
            if (change === 'password')
              await db
                .update(publicShare)
                .set({ password: (await encryptSecret('replacement-password')).encrypted })
                .where(eq(publicShare.id, share.id))
            if (change === 'archived')
              await db
                .update(workspaceFiles)
                .set({ deletedAt: new Date() })
                .where(eq(workspaceFiles.id, file.id))
          }
          return result
        })
        await expect(readPublicFileShareContent({ grant: access.grant })).rejects.toMatchObject({
          code: 'not_found',
        })
        spy.mockRestore()
      }
    }
  )

  check(
    'public share grants cannot be cloned or reused after Project archive and preserve workspace links',
    async () => {
      const { updateProjectFileShare } = await import('@/lib/projects/files/application/shares')
      const { authorizePublicFileShare, readPublicFileShare, readPublicFileShareContent } =
        await import('@/lib/public-shares/application')
      const { uploadWorkspaceFile } = await import(
        '@/lib/uploads/contexts/workspace/workspace-file-manager'
      )
      const { upsertFileShare } = await import('@/lib/public-shares/share-manager')
      const f = await fixture()
      const { file } = await createProjectFile.execute({
        principal: f.principal,
        input: createInput(f.projectId),
      })
      const { share } = await updateProjectFileShare.execute({
        principal: f.principal,
        input: { projectId: f.projectId, fileId: file.id, isActive: true },
      })
      const access = await authorizePublicFileShare({
        token: share.token,
        credential: { method: 'GET' },
      })
      if (!access.authorized) throw new Error('Public share rejected')
      expect(await readPublicFileShare({ grant: access.grant })).toMatchObject({
        file: { id: file.id, originalName: 'architecture.md' },
      })
      await expect(
        readPublicFileShareContent({ grant: { ...access.grant } })
      ).rejects.toMatchObject({ code: 'not_found' })
      await db.transaction(async (tx) => {
        await tx
          .update(workspace)
          .set({ archivedAt: new Date() })
          .where(eq(workspace.id, f.workspaceId))
        await tx.update(project).set({ archivedAt: new Date() }).where(eq(project.id, f.projectId))
      })
      await expect(readPublicFileShare({ grant: access.grant })).rejects.toMatchObject({
        code: 'not_found',
      })
      await db.transaction(async (tx) => {
        await tx.update(project).set({ archivedAt: null }).where(eq(project.id, f.projectId))
        await tx.update(workspace).set({ archivedAt: null }).where(eq(workspace.id, f.workspaceId))
      })
      const legacy = await uploadWorkspaceFile(
        f.workspaceId,
        f.ownerId,
        Buffer.from('Workspace link'),
        'legacy.txt',
        'text/plain'
      )
      const legacyShare = await upsertFileShare({
        workspaceId: f.workspaceId,
        fileId: legacy.id,
        userId: f.ownerId,
        isActive: true,
      })
      const legacyAccess = await authorizePublicFileShare({
        token: legacyShare.token,
        credential: { method: 'GET' },
      })
      if (!legacyAccess.authorized) throw new Error('Existing workspace share rejected')
      expect(
        (await readPublicFileShareContent({ grant: legacyAccess.grant })).buffer.toString()
      ).toBe('Workspace link')
    }
  )

  check(
    'public share page assets remain confined to explicit references in the canonical owner',
    async () => {
      const { updateProjectFileShare } = await import('@/lib/projects/files/application/shares')
      const { authorizePublicFileShare, readPublicFileShareContent, readPublicFileShareInline } =
        await import('@/lib/public-shares/application')
      const f = await fixture()
      const other = await fixture()
      const image = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9uoAAAAASUVORK5CYII=',
        'base64'
      )
      const asset = await createProjectFile.execute({
        principal: f.principal,
        input: {
          ...createInput(f.projectId, image.toString('base64')),
          encoding: 'base64',
          name: 'diagram.png',
          contentType: 'image/png',
        },
      })
      const sibling = await createProjectFile.execute({
        principal: f.principal,
        input: { ...createInput(f.projectId, 'Private sibling'), name: 'private.txt' },
      })
      const foreign = await createProjectFile.execute({
        principal: other.principal,
        input: createInput(other.projectId),
      })
      const source = await createProjectFile.execute({
        principal: f.principal,
        input: {
          ...createInput(
            f.projectId,
            `---\ntitle: Architecture\n---\n\n![Diagram](sim:file/${asset.file.id})`
          ),
          name: 'Architecture',
          contentType: 'text/x-sim-page',
        },
      })
      const { share } = await updateProjectFileShare.execute({
        principal: f.principal,
        input: { projectId: f.projectId, fileId: source.file.id, isActive: true },
      })
      const access = await authorizePublicFileShare({
        token: share.token,
        credential: { method: 'GET' },
      })
      if (!access.authorized) throw new Error('Public page rejected')
      const rendered = await readPublicFileShareContent({ grant: access.grant })
      expect(rendered.contentType).toBe('text/html')
      expect(rendered.buffer.toString()).toContain(
        `data:image/png;base64,${image.toString('base64')}`
      )
      expect(
        (await readPublicFileShareInline({ grant: access.grant, fileId: asset.file.id })).buffer
      ).toEqual(image)
      for (const fileId of [sibling.file.id, foreign.file.id])
        await expect(
          readPublicFileShareInline({ grant: access.grant, fileId })
        ).rejects.toMatchObject({ code: 'not_found' })
      await updateProjectFileContent.execute({
        principal: f.principal,
        input: {
          projectId: f.projectId,
          fileId: source.file.id,
          content: `---\ntitle: Architecture\n---\n\n![Foreign](sim:file/${foreign.file.id})`,
          encoding: 'utf-8',
        },
      })
      await expect(readPublicFileShareContent({ grant: access.grant })).rejects.toMatchObject({
        code: 'not_found',
      })
    }
  )
})

describe('Project outer transaction cleanup', () => {
  for (const operation of ['create', 'update'] as const) {
    check(`cleans Project ${operation} bytes after a deferred COMMIT rejection`, async () => {
      const f = await fixture()
      const source = await createProjectFile.execute({
        principal: f.principal,
        input: createInput(f.projectId, 'original'),
      })
      const beforeUsage = await ledger(f.organizationId)
      const triggerName = sql.identifier(
        `reject_project_commit_${generateId().replaceAll('-', '')}`
      )
      await db.execute(sql`CREATE FUNCTION ${triggerName}() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          IF NEW.project_id = TG_ARGV[0] THEN
            RAISE EXCEPTION 'Deferred file constraint rejected COMMIT' USING ERRCODE = '23514';
          END IF;
          RETURN NEW;
        END;
      $$`)
      await db.execute(sql`CREATE CONSTRAINT TRIGGER ${triggerName}
        AFTER INSERT OR UPDATE ON ${workspaceFiles} DEFERRABLE INITIALLY DEFERRED
        FOR EACH ROW EXECUTE FUNCTION ${triggerName}(${sql.raw(`'${f.projectId}'`)})`)
      const transaction = db.transaction.bind(db)
      let callbackCompleted = false
      const observer = vi.spyOn(db, 'transaction').mockImplementation((callback, config) =>
        transaction(async (tx) => {
          const result = await callback(tx)
          if (isRecordLike(result) && isRecordLike(result.result) && 'file' in result.result)
            callbackCompleted = true
          return result
        }, config)
      )
      const upload = storage.uploadFile
      let stagedKey = ''
      const capture = vi.spyOn(storage, 'uploadFile').mockImplementation(async (args) => {
        const result = await upload(args)
        stagedKey = result.key
        return result
      })
      try {
        const pending =
          operation === 'create'
            ? createProjectFile.execute({
                principal: f.principal,
                input: { ...createInput(f.projectId, 'rejected'), name: 'new.md' },
              })
            : updateProjectFileContent.execute({
                principal: f.principal,
                input: {
                  projectId: f.projectId,
                  fileId: source.file.id,
                  content: 'rejected replacement',
                  encoding: 'utf-8',
                },
              })
        const rejection = await pending.catch((error: unknown) => error)
        expect(getPostgresErrorCode(rejection)).toBe('23514')
        expect(callbackCompleted).toBe(true)
      } finally {
        observer.mockRestore()
        capture.mockRestore()
        await db.execute(sql`DROP TRIGGER ${triggerName} ON ${workspaceFiles}`)
        await db.execute(sql`DROP FUNCTION ${triggerName}()`)
      }
      expect(stagedKey).not.toBe('')
      expect(await ledger(f.organizationId)).toBe(beforeUsage)
      expect(
        await db.select().from(workspaceFiles).where(eq(workspaceFiles.key, stagedKey))
      ).toEqual([])
      expect(
        await db
          .select()
          .from(workspaceFileVersion)
          .where(eq(workspaceFileVersion.fileId, source.file.id))
      ).toEqual([])
      expect(
        (
          await readProjectFileContent.execute({
            principal: f.principal,
            input: { projectId: f.projectId, fileId: source.file.id },
          })
        ).content.toString()
      ).toBe('original')
      await expect
        .soft(readFile(join(localStorageRoot, stagedKey)))
        .rejects.toMatchObject({ code: 'ENOENT' })
      expect(
        await db
          .select()
          .from(outboxEvent)
          .where(sql`${outboxEvent.payload}->>'key' = ${stagedKey}`)
      ).toHaveLength(1)
    })
  }

  for (const { operation, code } of [
    { operation: 'create', code: undefined },
    { operation: 'update', code: undefined },
    { operation: 'revert', code: undefined },
    { operation: 'preview', code: undefined },
    { operation: 'update', code: '40003' },
    { operation: 'update', code: 'CONNECTION_CLOSED' },
  ] as const) {
    check(
      `retains committed Project ${operation} bytes after acknowledgement loss (${code ?? 'uncoded'})`,
      async () => {
        const f = await fixture()
        const sourceBytes = Buffer.alloc(16)
        sourceBytes.writeUInt32BE(16, 0)
        sourceBytes.write('ftypheic', 4, 'ascii')
        const source = await createProjectFile.execute({
          principal: f.principal,
          input:
            operation === 'preview'
              ? {
                  ...createInput(f.projectId),
                  name: 'preview.heic',
                  contentType: 'image/heic',
                  content: sourceBytes.toString('base64'),
                  encoding: 'base64',
                }
              : createInput(f.projectId, 'original'),
        })
        if (operation === 'revert')
          await updateProjectFileContent.execute({
            principal: f.principal,
            input: {
              projectId: f.projectId,
              fileId: source.file.id,
              content: 'second',
              encoding: 'utf-8',
            },
          })
        vi.spyOn(heic, 'transcodeHeicToJpeg').mockResolvedValue(Buffer.alloc(128, 255))
        const upload = storage.uploadFile
        const written: string[] = []
        vi.spyOn(storage, 'uploadFile').mockImplementation(async (args) => {
          const result = await upload(args)
          written.push(result.key)
          return result
        })
        const transaction = db.transaction.bind(db)
        const primary = Object.assign(
          new Error('Commit acknowledgement lost'),
          code ? { code } : {}
        )
        let lost = false
        vi.spyOn(db, 'transaction').mockImplementation(async (callback, config) => {
          const result = await transaction(callback, config)
          if (
            !lost &&
            written.length > 0 &&
            isRecordLike(result) &&
            isRecordLike(result.result) &&
            'file' in result.result
          ) {
            lost = true
            throw primary
          }
          return result
        })
        const input = { projectId: f.projectId, fileId: source.file.id }
        const action =
          operation === 'create'
            ? createProjectFile.execute({
                principal: f.principal,
                input: { ...createInput(f.projectId, 'committed'), name: 'new.md' },
              })
            : operation === 'update'
              ? updateProjectFileContent.execute({
                  principal: f.principal,
                  input: { ...input, content: 'committed', encoding: 'utf-8' },
                })
              : operation === 'revert'
                ? revertProjectFileVersion.execute({
                    principal: f.principal,
                    input: { ...input, version: 1, expectedCurrentVersion: 2 },
                  })
                : readProjectFileArtifact.execute({
                    principal: f.principal,
                    input: { ...input, preview: true, maxBytes: 1024 },
                  })
        await expect(action).rejects.toBe(primary)
        expect(lost).toBe(true)
        expect(written).toHaveLength(1)
        for (const key of written) {
          expect((await readFile(join(localStorageRoot, key))).length).toBeGreaterThan(0)
          expect(
            await db
              .select()
              .from(outboxEvent)
              .where(sql`${outboxEvent.payload}::jsonb ->> 'key' = ${key}`)
          ).toEqual([])
        }
      }
    )
  }

  for (const deleteUnavailable of [false, true]) {
    check(
      `preserves aborted Project content error when cleanup enqueue fails (delete unavailable=${deleteUnavailable})`,
      async () => {
        const f = await fixture()
        const source = await createProjectFile.execute({
          principal: f.principal,
          input: createInput(f.projectId, 'original'),
        })
        const primary = new OrchestrationError('conflict', 'Content transaction rejected')
        vi.spyOn(tracking, 'prepareFileStorageMutationInTx').mockRejectedValueOnce(primary)
        vi.spyOn(storageCleanup, 'enqueueWorkspaceFileStorageCleanups').mockRejectedValue(
          new Error('Cleanup database unavailable')
        )
        if (deleteUnavailable)
          vi.spyOn(storage, 'deleteFile').mockRejectedValue(new Error('Storage unavailable'))
        const upload = storage.uploadFile
        let key = ''
        vi.spyOn(storage, 'uploadFile').mockImplementation(async (args) => {
          const result = await upload(args)
          key = result.key
          return result
        })
        await expect(
          updateProjectFileContent.execute({
            principal: f.principal,
            input: {
              projectId: f.projectId,
              fileId: source.file.id,
              content: 'replacement',
              encoding: 'utf-8',
            },
          })
        ).rejects.toBe(primary)
        expect(key).not.toBe('')
        if (deleteUnavailable)
          expect((await readFile(join(localStorageRoot, key))).toString()).toBe('replacement')
        else
          await expect(readFile(join(localStorageRoot, key))).rejects.toMatchObject({
            code: 'ENOENT',
          })
        expect((await readFile(join(localStorageRoot, source.file.key))).toString()).toBe(
          'original'
        )
      }
    )
  }

  check(
    'preserves preview size rejection when cleanup enqueue fails and deletes the derivative',
    async () => {
      const f = await fixture()
      const bytes = Buffer.alloc(16)
      bytes.writeUInt32BE(16, 0)
      bytes.write('ftypheic', 4, 'ascii')
      const source = await createProjectFile.execute({
        principal: f.principal,
        input: {
          ...createInput(f.projectId),
          name: 'preview.heic',
          contentType: 'image/heic',
          content: bytes.toString('base64'),
          encoding: 'base64',
        },
      })
      vi.spyOn(heic, 'transcodeHeicToJpeg').mockResolvedValue(Buffer.alloc(128, 255))
      vi.spyOn(storageCleanup, 'enqueueWorkspaceFileStorageCleanups').mockRejectedValue(
        new Error('Cleanup database unavailable')
      )
      await expect
        .soft(
          readProjectFileArtifact.execute({
            principal: f.principal,
            input: { projectId: f.projectId, fileId: source.file.id, preview: true, maxBytes: 64 },
          })
        )
        .rejects.toMatchObject({ name: 'PayloadSizeLimitError' })
      expect(
        await readdir(join(localStorageRoot, 'project', f.projectId, 'image-derivative'))
      ).toEqual([])
    }
  )
})

describe('Project rendered artifacts against PostgreSQL and private storage', () => {
  for (const failure of ['size rejection', 'revision change'] as const) {
    check(
      `a preview with ${failure} removes its derivative and preserves the original error`,
      async () => {
        const f = await fixture()
        const sourceBytes = Buffer.alloc(16)
        sourceBytes.writeUInt32BE(16, 0)
        sourceBytes.write('ftypheic', 4, 'ascii')
        const source = await createProjectFile.execute({
          principal: f.principal,
          input: {
            ...createInput(f.projectId),
            name: 'preview.heic',
            contentType: 'image/heic',
            content: sourceBytes.toString('base64'),
            encoding: 'base64',
          },
        })
        vi.spyOn(heic, 'transcodeHeicToJpeg').mockImplementation(async () => {
          if (failure === 'revision change') {
            await updateProjectFileContent.execute({
              principal: f.principal,
              input: {
                projectId: f.projectId,
                fileId: source.file.id,
                content: 'replacement source',
                encoding: 'utf-8',
              },
            })
          }
          return Buffer.alloc(128, 255)
        })
        const rendering = readProjectFileArtifact.execute({
          principal: f.principal,
          input: {
            projectId: f.projectId,
            fileId: source.file.id,
            preview: true,
            maxBytes: failure === 'size rejection' ? 64 : 1024,
          },
        })
        await expect
          .soft(rendering)
          .rejects.toMatchObject(
            failure === 'size rejection' ? { name: 'PayloadSizeLimitError' } : { code: 'conflict' }
          )
        expect
          .soft(await readdir(join(localStorageRoot, 'project', f.projectId, 'image-derivative')))
          .toEqual([])
        const current = await readProjectFileContent.execute({
          principal: f.principal,
          input: { projectId: f.projectId, fileId: source.file.id },
        })
        expect(current.content).toEqual(
          failure === 'size rejection' ? sourceBytes : Buffer.from('replacement source')
        )
      }
    )
  }

  for (const failure of ['revoked read', 'uncertain pointer upload'] as const) {
    check(`a render with ${failure} durably removes its newly published objects`, async () => {
      const { readProjectFileArtifact } = await import('@/lib/projects/files/application/artifacts')
      const f = await fixture()
      const asset = await createProjectFile.execute({
        principal: f.principal,
        input: { ...createInput(f.projectId, 'image'), name: 'logo.png', contentType: 'image/png' },
      })
      const source = await createProjectFile.execute({
        principal: f.principal,
        input: {
          ...createInput(f.projectId, `getFileBase64('${asset.file.id}')`),
          name: 'design.pptx',
          contentType: 'text/x-pptxgenjs',
        },
      })
      vi.spyOn(sandboxTask, 'runSandboxTask').mockResolvedValue(
        Buffer.from('PK\u0003\u0004document')
      )
      const upload = storage.uploadFile
      const writtenKeys: string[] = []
      vi.spyOn(storage, 'uploadFile').mockImplementation(async (options) => {
        const result = await upload(options)
        if (result.key.startsWith(`project/${f.projectId}/compiled/`)) {
          writtenKeys.push(result.key)
          if (result.key.endsWith('.published.json')) {
            if (failure === 'uncertain pointer upload') throw new Error('Lost upload response')
            await db.delete(permissions).where(eq(permissions.userId, f.editorId))
          }
        }
        return result
      })
      vi.spyOn(storage, 'deleteFile').mockRejectedValue(new Error('Cleanup unavailable'))
      const rendering = readProjectFileArtifact.execute({
        principal: f.principal,
        input: { projectId: f.projectId, fileId: source.file.id, maxBytes: 1_000_000 },
      })
      if (failure === 'revoked read') {
        await expect(rendering).rejects.toMatchObject({ code: 'not_found' })
      } else {
        await expect(rendering).rejects.toThrow('Lost upload response')
      }
      expect(writtenKeys).toHaveLength(2)
      const events = await db
        .select()
        .from(outboxEvent)
        .where(
          sql`${outboxEvent.payload}::jsonb ->> 'key' LIKE ${`project/${f.projectId}/compiled/%`}`
        )
      expect(events).toHaveLength(2)
      expect(events.map((event) => event.status)).toEqual(['pending', 'pending'])
      vi.mocked(storage.deleteFile).mockRestore()
      for (const event of events) {
        await db
          .update(outboxEvent)
          .set({ availableAt: new Date(0) })
          .where(eq(outboxEvent.id, event.id))
        await processOutboxEventById(event.id, workspaceFileStorageCleanupOutboxHandlers)
      }
      expect(await readdir(join(localStorageRoot, 'project', f.projectId, 'compiled'))).toEqual([])
      expect(await readFile(join(localStorageRoot, source.file.key))).toEqual(
        Buffer.from(`getFileBase64('${asset.file.id}')`)
      )
    })
  }

  check(
    'artifact pages bind embedded asset provenance and separately gate opaque model delivery',
    async () => {
      const { readProjectFileArtifact } = await import('@/lib/projects/files/application/artifacts')
      const f = await fixture()
      const secret = {
        status: 'exact' as const,
        entries: [
          {
            encryptedValue: 'fixture-ciphertext',
            sourceUserId: f.editorId,
            sourceWorkspaceId: f.workspaceId,
          },
        ],
      }
      const asset = await createProjectFile.execute({
        principal: f.principal,
        input: {
          ...createInput(f.projectId, 'private image bytes'),
          name: 'diagram.png',
          contentType: 'image/png',
          secretProvenance: secret,
        },
      })
      const source = `---\ntitle: Design\n---\n\n![Diagram](sim:file/${asset.file.id})`
      const page = await createProjectFile.execute({
        principal: f.principal,
        input: {
          ...createInput(f.projectId, source),
          name: 'design.html',
          contentType: 'text/x-sim-page',
        },
      })
      const input = { projectId: f.projectId, fileId: page.file.id, maxBytes: 1_000_000 }
      const rendered = await readProjectFileArtifact.execute({ principal: f.principal, input })
      expect(rendered.contentType).toBe('text/html')
      expect(rendered.buffer.toString()).toContain(
        `data:image/png;base64,${Buffer.from('private image bytes').toString('base64')}`
      )
      expect(rendered.secretProvenance).toEqual(secret)
      await expect(
        readProjectFileArtifact.execute({
          principal: f.principal,
          input: { ...input, forModel: true },
        })
      ).rejects.toMatchObject({ code: 'forbidden' })
      await updateProjectFileContent.execute({
        principal: f.principal,
        input: {
          projectId: f.projectId,
          fileId: asset.file.id,
          content: 'public image bytes',
          encoding: 'utf-8',
          expectedUpdatedAt: asset.file.contentUpdatedAt,
        },
      })
      const clean = await readProjectFileArtifact.execute({
        principal: f.principal,
        input: { ...input, forModel: true },
      })
      expect(clean.secretProvenance).toEqual({ status: 'exact', entries: [] })
      expect(clean.buffer.toString()).toContain(
        Buffer.from('public image bytes').toString('base64')
      )
    }
  )

  check(
    'artifact source cannot import a foreign Project asset through a valid source-file capability',
    async () => {
      const { readProjectFileArtifact } = await import('@/lib/projects/files/application/artifacts')
      const f = await fixture()
      const foreign = await fixture()
      const asset = await createProjectFile.execute({
        principal: foreign.principal,
        input: {
          ...createInput(foreign.projectId, 'foreign bytes'),
          name: 'private.png',
          contentType: 'image/png',
        },
      })
      const page = await createProjectFile.execute({
        principal: f.principal,
        input: {
          ...createInput(
            f.projectId,
            `---\ntitle: Design\n---\n\n![Diagram](sim:file/${asset.file.id})`
          ),
          name: 'design.html',
          contentType: 'text/x-sim-page',
        },
      })
      await expect(
        readProjectFileArtifact.execute({
          principal: f.principal,
          input: { projectId: f.projectId, fileId: page.file.id, maxBytes: 1_000_000 },
        })
      ).rejects.toMatchObject({ code: 'not_found' })
    }
  )

  check(
    'an asset changed during render cannot be delivered with stale provenance or source identity',
    async () => {
      const { readProjectFileArtifact } = await import('@/lib/projects/files/application/artifacts')
      const f = await fixture()
      const asset = await createProjectFile.execute({
        principal: f.principal,
        input: {
          ...createInput(f.projectId, 'before'),
          name: 'diagram.png',
          contentType: 'image/png',
        },
      })
      const page = await createProjectFile.execute({
        principal: f.principal,
        input: {
          ...createInput(
            f.projectId,
            `---\ntitle: Design\n---\n\n![Diagram](sim:file/${asset.file.id})`
          ),
          name: 'design.html',
          contentType: 'text/x-sim-page',
        },
      })
      const download = storage.downloadFile
      let changed = false
      vi.spyOn(storage, 'downloadFile').mockImplementation(async (options) => {
        const bytes = await download(options)
        if (!changed && options.key === asset.file.key) {
          changed = true
          await updateProjectFileContent.execute({
            principal: f.principal,
            input: {
              projectId: f.projectId,
              fileId: asset.file.id,
              content: 'after',
              encoding: 'utf-8',
              expectedUpdatedAt: asset.file.contentUpdatedAt,
              secretProvenance: { status: 'unknown' },
            },
          })
        }
        return bytes
      })
      await expect(
        readProjectFileArtifact.execute({
          principal: f.principal,
          input: { projectId: f.projectId, fileId: page.file.id, maxBytes: 1_000_000 },
        })
      ).rejects.toMatchObject({ code: 'conflict' })
    }
  )

  check(
    'generated Office artifacts use the canonical owner cache without exposing generator source',
    async () => {
      const { readProjectFileArtifact } = await import('@/lib/projects/files/application/artifacts')
      const a = await fixture()
      const b = await fixture()
      const source = 'const title = "architecture"'
      const mime = 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
      const prepared = []
      for (const [f, marker] of [
        [a, 'project A'],
        [b, 'project B'],
      ] as const) {
        const created = await createProjectFile.execute({
          principal: f.principal,
          input: {
            ...createInput(f.projectId, source),
            name: 'architecture.pptx',
            contentType: 'text/x-pptxgenjs',
          },
        })
        const artifact = Buffer.from(`PK\u0003\u0004${marker}`)
        await storeCompiledDoc(
          { entityType: 'project', entityId: f.projectId },
          source,
          'pptx',
          mime,
          artifact
        )
        prepared.push({ f, created, artifact })
      }
      for (const { f, created, artifact } of prepared) {
        const rendered = await readProjectFileArtifact.execute({
          principal: f.principal,
          input: {
            projectId: f.projectId,
            fileId: created.file.id,
            maxBytes: 1_000_000,
            forModel: true,
          },
        })
        expect(rendered.buffer).toEqual(artifact)
        expect(rendered.contentType).toBe(mime)
        expect(rendered.secretProvenance).toEqual({ status: 'exact', entries: [] })
      }
    }
  )
})

describe('private compound copy transport', () => {
  check(
    'native paired copy dispatch returns the destination resource and persists the current actor bytes',
    async () => {
      const { createCopilotResourceAdmission } = await import(
        '@/lib/mothership/auth/application-delegation'
      )
      const { uploadWorkspaceFile } = await import(
        '@/lib/uploads/contexts/workspace/workspace-file-manager'
      )
      const f = await fixture()
      const original = await uploadWorkspaceFile(
        f.workspaceId,
        f.ownerId,
        Buffer.from('native paired copy bytes'),
        'native-copy.txt',
        'text/plain'
      )
      const destinationFolder = await createProjectFileFolder.execute({
        principal: f.principal,
        input: { projectId: f.projectId, name: 'Architecture' },
      })
      const target = {
        source: {
          owner: { entityType: 'workspace' as const, entityId: f.workspaceId },
          fileIds: [original.id],
          folderIds: [],
        },
        destination: {
          owner: { entityType: 'project' as const, entityId: f.projectId },
          folderId: destinationFolder.folder.id,
        },
      }
      const result = await executeAgentCliRequest(
        {
          invocation: {
            kind: 'file-copy',
            ...target,
            argv: [
              'files',
              'copy',
              '--source',
              JSON.stringify(target.source),
              '--destination',
              JSON.stringify(target.destination),
            ],
          },
        },
        {
          userId: f.editorId,
          workspaceId: f.workspaceId,
          toolCallId: generateId(),
          copilotToolExecution: true,
          copilotResourceAdmission: createCopilotResourceAdmission({
            userId: f.editorId,
            invocation: { kind: 'workspace', workspaceId: f.workspaceId },
          }),
        }
      )
      expect(result, result.stderr).toMatchObject({ exitCode: 0 })
      const [copied] = await db
        .select()
        .from(workspaceFiles)
        .where(eq(workspaceFiles.projectId, f.projectId))
      if (!copied) throw new Error('Native paired copy created no durable Project file')
      expect(copied.id).not.toBe(original.id)
      expect(copied.userId).toBe(f.editorId)
      expect(copied.folderId).toBe(destinationFolder.folder.id)
      expect(await storage.downloadFile({ key: copied.key, context: 'project' })).toEqual(
        Buffer.from('native paired copy bytes')
      )
      expect(result.resources).toContainEqual({
        op: 'upsert',
        resource: {
          type: 'file',
          owner: target.destination.owner,
          id: copied.id,
          title: 'native-copy.txt',
          path: `projects/${f.projectId}/files/Architecture/native-copy.txt`,
        },
      })
    }
  )

  check(
    'private copy transport retains the acting user through the real v2 route and stored bytes',
    async () => {
      const { createFileCopyCliTransport } = await import(
        '@/lib/mothership/agent-cli/file-copy-transport'
      )
      const { createCopilotResourceAdmission } = await import(
        '@/lib/mothership/auth/application-delegation'
      )
      const f = await fixture()
      const original = await createProjectFile.execute({
        principal: createSessionPrincipal({ userId: f.ownerId }),
        input: createInput(f.projectId, 'private compound copy bytes'),
      })
      const input = {
        source: {
          owner: { entityType: 'project' as const, entityId: f.projectId },
          fileIds: [original.file.id],
          folderIds: [],
        },
        destination: {
          owner: { entityType: 'workspace' as const, entityId: f.workspaceId },
          folderId: null,
        },
      }
      const transport = createFileCopyCliTransport(
        'http://localhost:3000',
        {
          userId: f.editorId,
          workspaceId: f.workspaceId,
          toolCallId: generateId(),
          copilotToolExecution: true,
          copilotResourceAdmission: createCopilotResourceAdmission({
            userId: f.editorId,
            invocation: { kind: 'workspace', workspaceId: f.workspaceId },
          }),
        },
        input
      )
      const before = await ledger(f.organizationId)
      const response = await transport('http://localhost:3000/api/v2/files/copy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      })
      expect(response.status).toBe(201)
      const [copied] = await db
        .select()
        .from(workspaceFiles)
        .where(eq(workspaceFiles.workspaceId, f.workspaceId))
      if (!copied || copied.sizeBytes === null)
        throw new Error('Private copy created no sized durable file')
      expect(copied.userId).toBe(f.editorId)
      expect(copied.id).not.toBe(original.file.id)
      expect(await storage.downloadFile({ key: copied.key, context: 'workspace' })).toEqual(
        Buffer.from('private compound copy bytes')
      )
      expect(await ledger(f.organizationId)).toBe(before + copied.sizeBytes)
    }
  )

  check(
    'private copy transport binds immutable selections and refuses changed owners, routes and revoked access',
    async () => {
      const { createFileCopyCliTransport } = await import(
        '@/lib/mothership/agent-cli/file-copy-transport'
      )
      const { createCopilotResourceAdmission } = await import(
        '@/lib/mothership/auth/application-delegation'
      )
      const f = await fixture()
      const original = await createProjectFile.execute({
        principal: f.principal,
        input: createInput(f.projectId),
      })
      const input = {
        source: {
          owner: { entityType: 'project' as const, entityId: f.projectId },
          fileIds: [original.file.id],
          folderIds: [],
        },
        destination: {
          owner: { entityType: 'workspace' as const, entityId: f.workspaceId },
          folderId: null,
        },
      }
      const expected = structuredClone(input)
      const transport = createFileCopyCliTransport(
        'http://localhost:3000',
        {
          userId: f.editorId,
          workspaceId: f.workspaceId,
          toolCallId: generateId(),
          copilotToolExecution: true,
          copilotResourceAdmission: createCopilotResourceAdmission({
            userId: f.editorId,
            invocation: { kind: 'workspace', workspaceId: f.workspaceId },
          }),
        },
        input
      )
      input.source.fileIds.push(generateId())
      for (const body of [
        input,
        { ...expected, destination: { ...expected.destination, folderId: generateId() } },
        {
          ...expected,
          source: { ...expected.source, owner: { entityType: 'project', entityId: generateId() } },
        },
      ]) {
        expect(
          (
            await transport('http://localhost:3000/api/v2/files/copy', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(body),
            })
          ).status
        ).toBe(403)
      }
      expect(
        (await transport(`http://localhost:3000/api/v2/projects/${f.projectId}/files`)).status
      ).toBe(400)
      expect(
        (
          await transport('http://other.invalid/api/v2/files/copy', {
            method: 'POST',
            body: JSON.stringify(expected),
          })
        ).status
      ).toBe(400)
      await db.delete(permissions).where(eq(permissions.userId, f.editorId))
      expect(
        (
          await transport('http://localhost:3000/api/v2/files/copy', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(expected),
          })
        ).status
      ).toBe(403)
      expect(
        await db.select().from(workspaceFiles).where(eq(workspaceFiles.workspaceId, f.workspaceId))
      ).toEqual([])
    }
  )
})

describe('Project archive download and Markdown snapshot export', () => {
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
      const { executeCopilotProjectFileUseCase } = await import(
        '@/lib/mothership/application/execute-project-file-use-case'
      )
      const { createCopilotResourceAdmission } = await import(
        '@/lib/mothership/auth/application-delegation'
      )
      const delegated = await executeCopilotProjectFileUseCase(
        {
          userId: f.editorId,
          workspaceId: f.workspaceId,
          toolCallId: generateId(),
          copilotToolExecution: true,
          copilotResourceAdmission: createCopilotResourceAdmission({
            userId: f.editorId,
            invocation: { kind: 'workspace', workspaceId: f.workspaceId },
          }),
        },
        exportProjectFileSnapshot,
        { projectId: f.projectId, fileId: source.file.id, content: 'unclassified visible text' },
        { projectId: f.projectId, fileId: source.file.id }
      )
      expect(delegated.secretProvenance.status).toBe('unknown')
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
    'Project Markdown snapshot export accepts parameterized alias MIME without a Markdown extension',
    async () => {
      const { exportProjectFileSnapshot } = await import(
        '@/lib/projects/files/application/downloads'
      )
      const f = await fixture()
      const source = await createProjectFile.execute({
        principal: f.principal,
        input: {
          ...createInput(f.projectId, 'draft'),
          name: 'notes.txt',
          contentType: 'Text/X-Markdown; charset=utf-8',
        },
      })
      const exported = await exportProjectFileSnapshot.execute({
        principal: f.principal,
        input: { projectId: f.projectId, fileId: source.file.id, content: '# Selected draft' },
      })
      expect(exported.buffer.toString('utf8')).toBe('# Selected draft')
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
              encryptedValue: 'archive-fixture',
              sourceUserId: 'origin',
            },
          ],
        },
      ]
      for (const classification of classifications) {
        const f = await fixture()
        const source = await archive(f, { 'data.txt': 'extracted' }, classification)
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
        const expected =
          classification.status === 'exact'
            ? classification.entries.length
              ? 'unknown'
              : 'exact'
            : classification.status
        expect(provenance.status).toBe(expected)
        expect(provenance.entries).toEqual([])
        expect(await readFile(join(localStorageRoot, child.key), 'utf8')).toBe('extracted')
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
