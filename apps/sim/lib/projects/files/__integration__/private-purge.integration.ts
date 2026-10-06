import { mkdtempSync } from 'node:fs'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { db } from '@sim/db'
import {
  folder,
  outboxEvent,
  permissions,
  project,
  projectWorkspace,
  publicShare,
  uploadSession,
  user,
  userStats,
  workspace,
  workspaceFileCollabState,
  workspaceFileSecretProvenance,
  workspaceFiles,
  workspaceFileVersion,
} from '@sim/db/schema'
import { deleteWorkspaceFixture, insertWorkspaceFixture } from '@sim/db/testing/workspace-fixtures'
import { createSessionPrincipal } from '@sim/testing/factories/principal.factory'
import { createDeferred } from '@sim/testing/helpers/deferred'
import { featureFlagsMock, featureFlagsMockFns } from '@sim/testing/mocks/feature-flags.mock'
import { setUploadDirServer, uploadsSetupMock } from '@sim/testing/mocks/uploads-setup.mock'
import { getErrorMessage } from '@sim/utils/errors'
import { sleep } from '@sim/utils/helpers'
import { generateId } from '@sim/utils/id'
import { and, eq, inArray, or, sql } from 'drizzle-orm'
import { NextRequest } from 'next/server'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/uploads/core/setup.server', () => uploadsSetupMock)

import { resolveProjectStorageBillingContext } from '@/lib/billing/storage/context'
import { prepareProjectStorageMutationInTx } from '@/lib/billing/storage/tracking'
import { processOutboxEventById } from '@/lib/core/outbox/service'
import { prepareProjectsForAccountDeletion } from '@/lib/projects/account-deletion'
import { createProjectFileUploadSession } from '@/lib/projects/files/application/uploads'
import { workspaceFileStorageCleanupOutboxHandlers } from '@/lib/uploads/contexts/workspace/workspace-file-storage-cleanup-outbox'
import { UPLOAD_URL_TTL_MS } from '@/lib/uploads/upload-session/provider'
import { deleteUserAccount } from '@/lib/users/account-deletion'
import { PUT as putUploadBytes } from '@/app/api/v2/uploads/[uploadId]/route'

vi.mock('@/lib/core/config/feature-flags', () => featureFlagsMock)

const storageRoot = mkdtempSync(join(tmpdir(), 'sim-project-purge-'))
setUploadDirServer(storageRoot)
const fixtures: { userId: string; projectId: string; workspaceId: string; fileIds: string[] }[] = []
const checks: { name: string; status: 'passed' | 'failed'; durationMs: number; error?: string }[] =
  []

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

beforeEach(() => {
  featureFlagsMockFns.mockIsFeatureEnabled.mockImplementation(async (flag) => flag === 'projects')
  vi.stubEnv('PROJECT_FILES_ENABLED', 'true')
})

async function fixture() {
  const userId = generateId()
  const workspaceId = generateId()
  await db.insert(user).values({
    id: userId,
    email: `${userId}@purge.invalid`,
    name: 'Purge fixture',
    emailVerified: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  })
  await db.insert(userStats).values({ id: generateId(), userId, storageUsedBytes: 18 })
  await insertWorkspaceFixture(db, {
    id: workspaceId,
    ownerId: userId,
    billedAccountUserId: userId,
    name: 'Private environment',
  })
  await db.insert(permissions).values({
    id: generateId(),
    userId,
    entityType: 'workspace',
    entityId: workspaceId,
    permissionType: 'admin',
  })
  const [binding] = await db
    .select()
    .from(projectWorkspace)
    .where(eq(projectWorkspace.workspaceId, workspaceId))
  if (!binding) throw new Error('Private Project fixture missing')
  const projectId = binding.projectId
  const folderId = generateId()
  const fileIds = [generateId(), generateId()]
  const keys = [
    `project/${projectId}/current.md`,
    `project/${projectId}/archived.md`,
    `project/${projectId}/old.md`,
  ]
  await db.insert(folder).values({
    id: folderId,
    userId,
    resourceType: 'file',
    name: 'Docs',
    projectId,
  })
  const revision = new Date()
  await db.insert(workspaceFiles).values(
    fileIds.map((id, index) => ({
      id,
      userId,
      projectId,
      context: 'project',
      key: keys[index],
      folderId,
      originalName: index ? 'archived.md' : 'current.md',
      contentType: 'text/markdown',
      sizeBytes: index ? 5 : 3,
      deletedAt: index ? new Date() : null,
      contentUpdatedAt: revision,
      secretProvenanceVersion: 1,
    }))
  )
  await db.insert(workspaceFileVersion).values([
    {
      id: generateId(),
      fileId: fileIds[0],
      version: 1,
      key: keys[2],
      sizeBytes: 100,
      contentType: 'text/markdown',
      source: 'api',
      authorUserIds: [userId],
      supersededAt: revision,
    },
    {
      id: generateId(),
      fileId: fileIds[0],
      version: 2,
      key: keys[0],
      sizeBytes: 3,
      contentType: 'text/markdown',
      source: 'api',
      authorUserIds: [userId],
    },
  ])
  await db.insert(workspaceFileSecretProvenance).values({
    fileId: fileIds[0],
    contentUpdatedAt: revision,
    status: 'exact',
    entries: [],
  })
  await db
    .insert(workspaceFileCollabState)
    .values({ fileId: fileIds[0], docState: Buffer.from([0]), sourceHash: 'fixture' })
  await db.insert(publicShare).values({
    id: generateId(),
    resourceType: 'file',
    resourceId: fileIds[0],
    entityType: 'project',
    entityId: projectId,
    createdBy: userId,
    token: generateId(),
  })
  for (const [index, key] of keys.entries()) {
    await mkdir(dirname(join(storageRoot, key)), { recursive: true })
    await writeFile(
      join(storageRoot, key),
      index === 0 ? 'new' : index === 1 ? 'older' : 'x'.repeat(100)
    )
  }
  const f = { userId, projectId, workspaceId, fileIds, folderId, keys }
  fixtures.push(f)
  return f
}

async function cleanupEvents(projectId: string) {
  return db
    .select()
    .from(outboxEvent)
    .where(
      and(
        eq(outboxEvent.eventType, 'workspace-file.storage.cleanup'),
        sql`${outboxEvent.payload}->>'key' LIKE ${`project/${projectId}/%`}`
      )
    )
}

async function payerUsage(userId: string) {
  const [row] = await db
    .select({ bytes: userStats.storageUsedBytes })
    .from(userStats)
    .where(eq(userStats.userId, userId))
  return row?.bytes
}

async function erasePrivateProject(f: Awaited<ReturnType<typeof fixture>>) {
  return db.transaction(async (tx) => {
    const result = await prepareProjectsForAccountDeletion(tx, f.userId, [f.workspaceId])
    await tx.delete(workspace).where(eq(workspace.id, f.workspaceId))
    return result
  })
}

describe('Private Project teardown and durable object cleanup', () => {
  check(
    'retires retained heads once, preserves unrelated usage, and queues current/history objects atomically',
    async () => {
      const f = await fixture()
      await expect(db.delete(project).where(eq(project.id, f.projectId))).rejects.toThrow()
      await erasePrivateProject(f)
      expect(await payerUsage(f.userId)).toBe(10)
      expect(
        await db.select().from(workspaceFiles).where(inArray(workspaceFiles.id, f.fileIds))
      ).toEqual([])
      expect(
        await db
          .select()
          .from(workspaceFileVersion)
          .where(inArray(workspaceFileVersion.fileId, f.fileIds))
      ).toEqual([])
      expect(
        await db
          .select()
          .from(workspaceFileCollabState)
          .where(inArray(workspaceFileCollabState.fileId, f.fileIds))
      ).toEqual([])
      expect(
        await db
          .select()
          .from(workspaceFileSecretProvenance)
          .where(inArray(workspaceFileSecretProvenance.fileId, f.fileIds))
      ).toEqual([])
      expect(await db.select().from(folder).where(eq(folder.id, f.folderId))).toEqual([])
      expect(
        await db.select().from(publicShare).where(inArray(publicShare.resourceId, f.fileIds))
      ).toEqual([])
      expect(await db.select().from(project).where(eq(project.id, f.projectId))).toEqual([])
      const events = await cleanupEvents(f.projectId)
      expect(events.map((event) => event.payload)).toEqual(
        expect.arrayContaining(f.keys.map((key) => ({ key, context: 'project' })))
      )
      expect(events).toHaveLength(3)
      for (const key of f.keys)
        await expect(readFile(join(storageRoot, key))).resolves.toBeInstanceOf(Buffer)
    }
  )

  check(
    'rolls back all purged metadata, accounting, and cleanup work when account teardown fails, then retries once',
    async () => {
      const f = await fixture()
      await expect(
        db.transaction(async (tx) => {
          await prepareProjectsForAccountDeletion(tx, f.userId, [f.workspaceId])
          await tx.delete(workspace).where(eq(workspace.id, f.workspaceId))
          throw new Error('Later account teardown failed')
        })
      ).rejects.toThrow('Later account teardown failed')
      expect(await payerUsage(f.userId)).toBe(18)
      expect(
        await db.select().from(workspaceFiles).where(inArray(workspaceFiles.id, f.fileIds))
      ).toHaveLength(2)
      expect(await cleanupEvents(f.projectId)).toEqual([])
      expect(
        await db
          .select()
          .from(outboxEvent)
          .where(sql`${outboxEvent.payload}->>'projectId' = ${f.projectId}`)
      ).toEqual([])
      await erasePrivateProject(f)
      await erasePrivateProject(f)
      expect(await payerUsage(f.userId)).toBe(10)
      expect(await cleanupEvents(f.projectId)).toHaveLength(3)
    }
  )

  check('queues behind a Project mutation and retires its committed size', async () => {
    const f = await fixture()
    const held = createDeferred<void>()
    const release = createDeferred<void>()
    const mutation = db.transaction(async (tx) => {
      const context = await resolveProjectStorageBillingContext(
        { projectId: f.projectId, ownerId: f.userId, organizationId: null },
        tx
      )
      const accounting = await prepareProjectStorageMutationInTx(tx, context)
      await tx
        .update(workspaceFiles)
        .set({ sizeBytes: 10 })
        .where(eq(workspaceFiles.id, f.fileIds[0]))
      await accounting.applyDelta(7)
      held.resolve()
      await release.promise
    })
    await Promise.race([mutation, held.promise])
    const pid = createDeferred<number>()
    const deletion = db.transaction(async (tx) => {
      const [connection] = await tx.execute<{ pid: number }>(sql`SELECT pg_backend_pid() AS pid`)
      pid.resolve(connection.pid)
      await prepareProjectsForAccountDeletion(tx, f.userId, [f.workspaceId])
      await tx.delete(workspace).where(eq(workspace.id, f.workspaceId))
    })
    const observedDeletion = deletion.then(
      () => null,
      (error: unknown) => error
    )
    try {
      let waiting = false
      for (let attempt = 0; attempt < 100; attempt++) {
        const [state] = await db.execute<{ waiting: boolean }>(
          sql`SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE pid = ${await pid.promise} AND wait_event_type = 'Lock') AS waiting`
        )
        if (state.waiting) {
          waiting = true
          break
        }
        await sleep(10)
      }
      expect(waiting).toBe(true)
    } finally {
      release.resolve()
    }
    await mutation
    expect(await observedDeletion).toBeNull()
    expect(await payerUsage(f.userId)).toBe(10)
    expect(await cleanupEvents(f.projectId)).toHaveLength(3)
  })

  check(
    'account deletion commits despite an object-store failure and its durable cleanup retries successfully',
    async () => {
      const f = await fixture()
      const obstructed = join(storageRoot, f.keys[0])
      await rm(obstructed)
      await mkdir(obstructed)
      await deleteUserAccount(f.userId)
      expect(await db.select().from(user).where(eq(user.id, f.userId))).toEqual([])
      expect(await db.select().from(project).where(eq(project.id, f.projectId))).toEqual([])
      const events = await cleanupEvents(f.projectId)
      const failed = events.find((event) => (event.payload as { key?: string }).key === f.keys[0])
      expect(failed).toMatchObject({ status: 'pending', attempts: 1 })
      if (!failed) throw new Error('Retryable cleanup missing')
      await rm(obstructed, { recursive: true })
      await writeFile(obstructed, 'new')
      await db
        .update(outboxEvent)
        .set({ availableAt: new Date(0) })
        .where(eq(outboxEvent.id, failed.id))
      expect(
        await processOutboxEventById(failed.id, workspaceFileStorageCleanupOutboxHandlers)
      ).toBe('completed')
      await expect(readFile(obstructed)).rejects.toMatchObject({ code: 'ENOENT' })
      expect(
        await processOutboxEventById(failed.id, workspaceFileStorageCleanupOutboxHandlers)
      ).toBe('completed')
    }
  )

  check(
    'retirement revokes byte transfers and durably sweeps derived and late objects without touching a live Project',
    async () => {
      const f = await fixture()
      const live = await fixture()
      const principal = createSessionPrincipal({ userId: f.userId, sessionId: generateId() })
      const upload = await createProjectFileUploadSession.execute({
        principal,
        input: {
          projectId: f.projectId,
          fileName: 'pending.bin',
          contentType: 'application/octet-stream',
          fileSize: 4,
          localOrigin: 'http://localhost:3000',
        },
      })
      const derived = `project/${f.projectId}/compiled/derived.pdf`
      await mkdir(dirname(join(storageRoot, derived)), { recursive: true })
      await writeFile(join(storageRoot, derived), 'derived')
      const retiredAt = Date.now()
      await erasePrivateProject(f)
      const [retiredUpload] = await db
        .select()
        .from(uploadSession)
        .where(eq(uploadSession.id, upload.id))
      expect(retiredUpload.status).toBe('aborting')
      expect(retiredUpload.expiresAt.getTime()).toBeLessThanOrEqual(Date.now())
      const events = await db
        .select()
        .from(outboxEvent)
        .where(
          and(
            eq(outboxEvent.eventType, 'project-file.storage.prefix-cleanup'),
            sql`${outboxEvent.payload}->>'projectId' = ${f.projectId}`
          )
        )
      expect(events).toHaveLength(2)
      const immediate = events.find(
        (event) => event.availableAt.getTime() < retiredAt + UPLOAD_URL_TTL_MS
      )
      const final = events.find(
        (event) => event.availableAt.getTime() >= retiredAt + UPLOAD_URL_TTL_MS
      )
      if (!immediate || !final) throw new Error('Immediate and capability-horizon sweeps required')
      const { projectFilePrefixCleanupOutboxHandlers } = await import(
        '@/lib/projects/files/prefix-cleanup'
      )
      expect(
        await processOutboxEventById(immediate.id, projectFilePrefixCleanupOutboxHandlers)
      ).toBe('completed')
      await expect(readFile(join(storageRoot, derived))).rejects.toMatchObject({ code: 'ENOENT' })
      expect(await readFile(join(storageRoot, live.keys[0]), 'utf8')).toBe('new')
      await mkdir(dirname(join(storageRoot, upload.finalKey)), { recursive: true })
      await writeFile(join(storageRoot, upload.finalKey), 'late')
      expect(await processOutboxEventById(final.id, projectFilePrefixCleanupOutboxHandlers)).toBe(
        'pending'
      )
      expect(await readFile(join(storageRoot, upload.finalKey), 'utf8')).toBe('late')
      await db
        .update(outboxEvent)
        .set({ availableAt: new Date(0) })
        .where(eq(outboxEvent.id, final.id))
      expect(await processOutboxEventById(final.id, projectFilePrefixCleanupOutboxHandlers)).toBe(
        'pending'
      )
      await expect(readFile(join(storageRoot, upload.finalKey))).rejects.toMatchObject({
        code: 'ENOENT',
      })
      await writeFile(join(storageRoot, upload.finalKey), 'finished-after-empty-sweep')
      await db
        .update(outboxEvent)
        .set({ availableAt: new Date(0), attempts: 4 })
        .where(eq(outboxEvent.id, final.id))
      expect(await processOutboxEventById(final.id, projectFilePrefixCleanupOutboxHandlers)).toBe(
        'pending'
      )
      await expect(readFile(join(storageRoot, upload.finalKey))).rejects.toMatchObject({
        code: 'ENOENT',
      })
      const [retained] = await db.select().from(outboxEvent).where(eq(outboxEvent.id, final.id))
      expect(retained.attempts).toBe(0)
      expect(retained.availableAt.getTime()).toBeGreaterThan(Date.now())
      const unsafe = generateId()
      await db.insert(outboxEvent).values({
        id: unsafe,
        eventType: immediate.eventType,
        payload: { projectId: live.projectId },
      })
      expect(await processOutboxEventById(unsafe, projectFilePrefixCleanupOutboxHandlers)).toBe(
        'pending'
      )
      expect(await readFile(join(storageRoot, live.keys[0]), 'utf8')).toBe('new')
    }
  )

  check(
    'a local stream finishing after retirement queues cleanup instead of leaving a late object',
    async () => {
      const f = await fixture()
      const created = await createProjectFileUploadSession.execute({
        principal: createSessionPrincipal({ userId: f.userId, sessionId: generateId() }),
        input: {
          projectId: f.projectId,
          fileName: 'stream.bin',
          contentType: 'application/octet-stream',
          fileSize: 4,
          localOrigin: 'http://localhost:3000',
        },
      })
      const entered = createDeferred<void>()
      const release = createDeferred<void>()
      const body = new ReadableStream<Uint8Array>(
        {
          async pull(controller) {
            entered.resolve()
            await release.promise
            controller.enqueue(Buffer.from('late'))
            controller.close()
          },
        },
        { highWaterMark: 0 }
      )
      const request = new NextRequest(`http://localhost:3000/api/v2/uploads/${created.id}`, {
        method: 'PUT',
        headers: { 'upload-token': created.uploadToken, 'content-type': created.contentType },
        body,
        duplex: 'half',
      })
      const pending = putUploadBytes(request, { params: Promise.resolve({ uploadId: created.id }) })
      await entered.promise
      try {
        await erasePrivateProject(f)
      } finally {
        release.resolve()
      }
      const response = await pending
      expect(response.status).toBe(409)
      const events = await db
        .select()
        .from(outboxEvent)
        .where(
          and(
            eq(outboxEvent.eventType, 'project-file.storage.prefix-cleanup'),
            sql`${outboxEvent.payload}->>'projectId' = ${f.projectId}`
          )
        )
      expect(events.length).toBeGreaterThanOrEqual(4)
      const { projectFilePrefixCleanupOutboxHandlers } = await import(
        '@/lib/projects/files/prefix-cleanup'
      )
      for (const event of events.filter((row) => row.availableAt.getTime() <= Date.now()))
        await processOutboxEventById(event.id, projectFilePrefixCleanupOutboxHandlers)
      await expect(readFile(join(storageRoot, created.finalKey))).rejects.toMatchObject({
        code: 'ENOENT',
      })
    }
  )

  check('prefix sweeps continue bounded batches without consuming failure retries', async () => {
    const f = await fixture()
    const prefix = join(storageRoot, `project/${f.projectId}`)
    await Promise.all(
      Array.from({ length: 510 }, async (_, index) => {
        await writeFile(join(prefix, `cache-${index}.bin`), 'x')
      })
    )
    await erasePrivateProject(f)
    const events = await db
      .select()
      .from(outboxEvent)
      .where(
        and(
          eq(outboxEvent.eventType, 'project-file.storage.prefix-cleanup'),
          sql`${outboxEvent.payload}->>'projectId' = ${f.projectId}`
        )
      )
    expect(events).toHaveLength(2)
    const event = events.find((row) => row.availableAt.getTime() <= Date.now())
    if (!event) throw new Error('Immediate sweep missing')
    const { projectFilePrefixCleanupOutboxHandlers } = await import(
      '@/lib/projects/files/prefix-cleanup'
    )
    expect(await processOutboxEventById(event.id, projectFilePrefixCleanupOutboxHandlers)).toBe(
      'pending'
    )
    const [continued] = await db.select().from(outboxEvent).where(eq(outboxEvent.id, event.id))
    expect(continued.attempts).toBe(0)
    await db
      .update(outboxEvent)
      .set({ availableAt: new Date(0) })
      .where(eq(outboxEvent.id, event.id))
    expect(await processOutboxEventById(event.id, projectFilePrefixCleanupOutboxHandlers)).toBe(
      'completed'
    )
    await expect(readFile(join(prefix, 'cache-509.bin'))).rejects.toMatchObject({ code: 'ENOENT' })
  })
})

afterAll(async () => {
  try {
    for (const f of fixtures) {
      await db.delete(workspaceFiles).where(inArray(workspaceFiles.id, f.fileIds))
      await db.delete(folder).where(eq(folder.projectId, f.projectId))
      await deleteWorkspaceFixture(db, eq(workspace.id, f.workspaceId))
      await db.delete(uploadSession).where(eq(uploadSession.userId, f.userId))
      await db.delete(user).where(eq(user.id, f.userId))
      await db
        .delete(outboxEvent)
        .where(
          or(
            sql`${outboxEvent.payload}->>'key' LIKE ${`project/${f.projectId}/%`}`,
            sql`${outboxEvent.payload}->>'projectId' = ${f.projectId}`
          )
        )
    }
    await rm(storageRoot, { recursive: true, force: true })
  } finally {
    const reportPath = process.env.PROJECT_PURGE_REPORT_PATH
    if (reportPath) {
      await mkdir(dirname(reportPath), { recursive: true })
      await writeFile(reportPath, JSON.stringify({ checks }, null, 2))
    }
  }
})
