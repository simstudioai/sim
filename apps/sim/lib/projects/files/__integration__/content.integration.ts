import { mkdtempSync } from 'node:fs'
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
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
import { getErrorMessage, getPostgresErrorCode } from '@sim/utils/errors'
import { sleep } from '@sim/utils/helpers'
import { generateId } from '@sim/utils/id'
import { isRecordLike } from '@sim/utils/object'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/uploads/core/setup.server', () => uploadsSetupMock)
vi.mock('@/lib/messaging/email/mailer', () => emailMailerMock)

import * as tracking from '@/lib/billing/storage/tracking'
import {
  ContentDeliveryUnobservedError,
  ContentRefusedError,
  observeContentDelivery,
} from '@/lib/core/application/content-delivery'
import { PrincipalKindAuthorizationError } from '@/lib/core/application/workspace-authorization'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { processOutboxEventById } from '@/lib/core/outbox/service'
import {
  createProjectFile,
  downloadProjectFileContent,
  readProjectFileContent,
  updateProjectFileContent,
} from '@/lib/projects/files/application/content'
import { createProjectFileFolder } from '@/lib/projects/files/application/folders'
import {
  downloadProjectFileVersionContent,
  readProjectFileVersionContent,
} from '@/lib/projects/files/application/versions'
import * as storageCleanup from '@/lib/uploads/contexts/workspace/file-storage-cleanup-outbox'
import { workspaceFileStorageCleanupOutboxHandlers } from '@/lib/uploads/contexts/workspace/file-storage-cleanup-outbox'
import * as storage from '@/lib/uploads/core/storage-service'
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
  for (const mutation of ['upload', 'update'] as const) {
    check(
      `workspace ${mutation} waits for Project authority before locking shared file resources`,
      async () => {
        const { uploadWorkspaceFile, updateWorkspaceFileContent } = await import(
          '@/lib/uploads/contexts/workspace/file-manager'
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
        '@/lib/uploads/contexts/workspace/file-version-store'
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
        await import('@/lib/workspace-files/application/folders')
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
      for (const includeSecretProvenance of [false, true]) {
        const observed = vi.fn()
        const result = await observeWorkspaceFileDelivery(observed, () =>
          readProjectFileContent.execute({
            principal: f.principal,
            input: { projectId: f.projectId, fileId: created.file.id, includeSecretProvenance },
          })
        )
        expect(observed).toHaveBeenCalledWith({ status: 'unknown' }, created.file.id)
        expect('secretProvenance' in result).toBe(includeSecretProvenance)
        if (includeSecretProvenance) expect(result.secretProvenance).toEqual({ status: 'unknown' })
      }
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
      await deleteUserAccount(f.editorId, { recordIdentity: false })
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
})

afterAll(async () => {
  vi.unstubAllEnvs()
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

describe('Project streaming source delivery', () => {
  for (const historical of [false, true]) {
    for (const change of ['access', 'identity', 'cancel'] as const) {
      check(
        `${historical ? 'historical' : 'current'} download releases storage after ${change}`,
        async () => {
          const f = await fixture()
          const { file } = await createProjectFile.execute({
            principal: f.principal,
            input: createInput(f.projectId, 'x'.repeat(1024 * 1024)),
          })
          if (historical)
            await updateProjectFileContent.execute({
              principal: f.principal,
              input: {
                projectId: f.projectId,
                fileId: file.id,
                content: 'new head',
                encoding: 'utf-8',
              },
            })
          const open = storage.downloadFileStream
          let source: Awaited<ReturnType<typeof open>> | undefined
          vi.spyOn(storage, 'downloadFileStream').mockImplementationOnce(async (options) => {
            source = await open(options)
            if (change === 'access') {
              await db
                .delete(permissions)
                .where(
                  and(eq(permissions.userId, f.editorId), eq(permissions.entityId, f.workspaceId))
                )
            } else if (change === 'identity') {
              if (historical)
                await db
                  .delete(workspaceFileVersion)
                  .where(
                    and(
                      eq(workspaceFileVersion.fileId, file.id),
                      eq(workspaceFileVersion.version, 1)
                    )
                  )
              else
                await db
                  .update(workspaceFiles)
                  .set({ contentUpdatedAt: new Date(file.contentUpdatedAt.getTime() + 1000) })
                  .where(eq(workspaceFiles.id, file.id))
            }
            return source
          })
          const args = {
            principal: f.principal,
            input: { projectId: f.projectId, fileId: file.id, version: 1 },
          }
          const pending = historical
            ? downloadProjectFileVersionContent.execute(args)
            : downloadProjectFileContent.execute(args)
          if (change === 'cancel') {
            const result = await pending
            expect(result.contentLength).toBe(1024 * 1024)
            const reader = result.stream.getReader()
            const chunk = await reader.read()
            expect(chunk.done).toBe(false)
            expect(chunk.value?.length).toBeLessThan(result.contentLength)
            await reader.cancel()
          } else {
            await expect(pending).rejects.toMatchObject({
              code: change === 'identity' && !historical ? 'conflict' : 'not_found',
            })
          }
          expect(source?.destroyed).toBe(true)
        }
      )
    }
  }
})

describe('Project Copilot content admission', () => {
  for (const gate of ['missing', 'deny', 'opaque-before-read', 'opaque-before-delivery'] as const) {
    check(
      `${gate} gate blocks current reads and unsupported Copilot history reads fail authorization`,
      async () => {
        const f = await fixture()
        const { file } = await createProjectFile.execute({
          principal: f.principal,
          input: createInput(f.projectId, 'retained source'),
        })
        await updateProjectFileContent.execute({
          principal: f.principal,
          input: {
            projectId: f.projectId,
            fileId: file.id,
            content: 'current source',
            encoding: 'utf-8',
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
        const buffered = vi.spyOn(storage, 'downloadFile')
        const streamed = vi.spyOn(storage, 'downloadFileStream')
        for (const operation of [readProjectFileContent, downloadProjectFileContent]) {
          let admissions = 0
          const execute = () =>
            operation.execute({
              principal,
              input: { projectId: f.projectId, fileId: file.id },
            })
          await expect(
            gate === 'missing'
              ? execute()
              : observeContentDelivery(
                  {
                    admit: async (sources) => {
                      admissions++
                      return sources.map((source) => {
                        if (gate === 'deny') return false
                        if (gate === 'opaque-before-delivery' && admissions === 1) return true
                        return source.view !== 'opaque'
                      })
                    },
                  },
                  execute
                )
          ).rejects.toBeInstanceOf(
            gate === 'missing' ? ContentDeliveryUnobservedError : ContentRefusedError
          )
        }
        for (const operation of [
          readProjectFileVersionContent,
          downloadProjectFileVersionContent,
        ]) {
          await expect(
            operation.execute({
              principal,
              input: { projectId: f.projectId, fileId: file.id, version: 1 },
            })
          ).rejects.toBeInstanceOf(PrincipalKindAuthorizationError)
        }
        if (gate === 'opaque-before-delivery') {
          expect(buffered).toHaveBeenCalledTimes(1)
          expect(streamed).toHaveBeenCalledTimes(1)
        } else {
          expect(buffered).not.toHaveBeenCalled()
          expect(streamed).not.toHaveBeenCalled()
        }
      }
    )
  }
})
