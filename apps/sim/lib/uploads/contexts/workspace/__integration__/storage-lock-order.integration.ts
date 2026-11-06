/**
 * Real PostgreSQL lock ordering between new-file finalization and concurrent writers in the same
 * workspace. They reach the workspace row, the file directory lock, and the per-workspace search
 * dispatch queue row (through the `workspace_files` search-index trigger), so every writer must
 * take them in the same order.
 */
import { mkdtempSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { db, dbFor } from '@sim/db'
import {
  organization,
  user,
  workspace,
  workspaceFileSearchDispatchQueue,
  workspaceFiles,
} from '@sim/db/schema'
import { deleteWorkspaceFixture } from '@sim/db/testing/workspace-fixtures'
import { createDeferred } from '@sim/testing/helpers/deferred'
import { generateId } from '@sim/utils/id'
import { eq, inArray, sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const fixtureStorage = vi.hoisted(() => ({ root: '' }))
vi.mock('@/lib/uploads/core/setup.server', () => ({
  get UPLOAD_DIR_SERVER() {
    return fixtureStorage.root
  },
}))

import { lockWorkspaceStorageForMutationInTx } from '@/lib/billing/storage'
import {
  createKnowledgeAclFixtureIds,
  seedKnowledgeAclFixture,
} from '@/lib/knowledge/__integration__/seed-source-access-fixture'
import { bulkArchiveWorkspaceFileItems } from '@/lib/uploads/contexts/workspace/file-folder-manager'
import {
  generateWorkspaceFileKey,
  registerUploadedWorkspaceFile,
  uploadWorkspaceFile,
} from '@/lib/uploads/contexts/workspace/file-manager'
import { uploadFile } from '@/lib/uploads/core/storage-service'
import { lockFileDirectories } from '@/lib/workspace-files/locks'

type FinalizeNewFile = (workspaceId: string, userId: string) => Promise<unknown>

const finalizeByUpload: FinalizeNewFile = (workspaceId, userId) => {
  const name = `upload-${generateId()}.txt`
  return uploadWorkspaceFile(workspaceId, userId, Buffer.from(name), name, 'text/plain', {
    notifyWorkspaceChange: false,
  })
}

const finalizeByRegistration: FinalizeNewFile = async (workspaceId, userId) => {
  const name = `registered-${generateId()}.txt`
  const key = generateWorkspaceFileKey(workspaceId, name)
  await uploadFile({
    file: Buffer.from(name),
    fileName: key,
    contentType: 'text/plain',
    context: 'workspace',
    preserveKey: true,
    customKey: key,
    persistMetadata: false,
  })
  return registerUploadedWorkspaceFile({
    workspaceId,
    userId,
    key,
    originalName: name,
    contentType: 'text/plain',
  })
}

/** `db:push` never installs the migration-only search-index trigger that reaches the queue row. */
const [{ migrated }] = await db.execute<{ migrated: boolean }>(sql`SELECT EXISTS (
  SELECT 1 FROM pg_trigger
  WHERE tgrelid = 'workspace_files'::regclass AND tgname = 'workspace_files_search_index_pending'
) AS migrated`)
/** The suite's own `afterAll` never runs when it is skipped, so release the probe connection here. */
if (!migrated) await db.$client.end()

describe.skipIf(!migrated)('workspace file storage lock order in PostgreSQL', () => {
  const fixtures: ReturnType<typeof createKnowledgeAclFixtureIds>[] = []

  beforeAll(() => {
    fixtureStorage.root = mkdtempSync(path.join(tmpdir(), 'sim-file-lock-order-'))
  })

  afterAll(async () => {
    for (const ids of fixtures) {
      await deleteWorkspaceFixture(db, eq(workspace.id, ids.workspaceId))
      await db.delete(organization).where(eq(organization.id, ids.organizationId))
      await db.delete(user).where(inArray(user.id, [ids.aliceId, ids.bobId]))
    }
    await rm(fixtureStorage.root, { recursive: true, force: true })
    await Promise.all([db.$client.end(), dbFor('cleanup').$client.end()])
  })

  /** Seeds a workspace with one file, which also creates the workspace's dispatch queue row. */
  async function seedWorkspaceWithFile() {
    const ids = createKnowledgeAclFixtureIds()
    fixtures.push(ids)
    await seedKnowledgeAclFixture(ids)
    const name = `existing-${generateId()}.txt`
    const existing = await uploadWorkspaceFile(
      ids.workspaceId,
      ids.aliceId,
      Buffer.from(name),
      name,
      'text/plain',
      { notifyWorkspaceChange: false }
    )
    const queued = await db
      .select({ workspaceId: workspaceFileSearchDispatchQueue.workspaceId })
      .from(workspaceFileSearchDispatchQueue)
      .where(eq(workspaceFileSearchDispatchQueue.workspaceId, ids.workspaceId))
    expect(queued).toHaveLength(1)
    return { ...ids, existingFileId: existing.id }
  }

  it.each([
    ['uploadWorkspaceFile', finalizeByUpload],
    ['registerUploadedWorkspaceFile', finalizeByRegistration],
  ])(
    '%s commits alongside a content write that already holds the workspace row',
    async (_name, finalize) => {
      const fixture = await seedWorkspaceWithFile()
      const ready = createDeferred<number>()
      const finalizeIsWaiting = createDeferred<void>()

      // The lock sequence of `updateWorkspaceFileContent`: workspace row, then a content write.
      const contentWrite = db.transaction(async (tx) => {
        await lockWorkspaceStorageForMutationInTx(tx, fixture.workspaceId)
        const [connection] = await tx.execute<{ pid: number }>(sql`SELECT pg_backend_pid() AS pid`)
        ready.resolve(connection.pid)
        await finalizeIsWaiting.promise
        await tx
          .update(workspaceFiles)
          .set({ contentUpdatedAt: new Date(Date.now() + 1000) })
          .where(eq(workspaceFiles.id, fixture.existingFileId))
      })
      const contentWritePid = await ready.promise

      const finalized = finalize(fixture.workspaceId, fixture.aliceId)
      const settled = Promise.allSettled([contentWrite, finalized])
      try {
        await expect
          .poll(
            async () =>
              (
                await db.execute(
                  sql`SELECT pid FROM pg_stat_activity
                    WHERE ${contentWritePid} = ANY(pg_blocking_pids(pid))`
                )
              ).length,
            { timeout: 4000 }
          )
          .toBe(1)
      } finally {
        finalizeIsWaiting.resolve()
        await settled
      }

      const results = await settled
      expect(results.filter((result) => result.status === 'rejected')).toEqual([])
    }
  )

  it.each([
    ['uploadWorkspaceFile', finalizeByUpload],
    ['registerUploadedWorkspaceFile', finalizeByRegistration],
  ])(
    '%s commits alongside a bulk archive queued first on the directory lock',
    async (_name, finalize) => {
      const fixture = await seedWorkspaceWithFile()
      const ready = createDeferred<number>()
      const release = createDeferred<void>()

      const directoryHolder = db.transaction(async (tx) => {
        await lockFileDirectories(tx, [{ entityType: 'workspace', entityId: fixture.workspaceId }])
        const [connection] = await tx.execute<{ pid: number }>(sql`SELECT pg_backend_pid() AS pid`)
        ready.resolve(connection.pid)
        await release.promise
      })
      const holderPid = await ready.promise

      // Waiters blocked by the holder, or by a backend the holder blocks: only this test's queue.
      const waitingOnLocks = async () =>
        (
          await db.execute(
            sql`SELECT pid FROM pg_stat_activity
              WHERE ${holderPid} = ANY(pg_blocking_pids(pid))
                OR pg_blocking_pids(pid) && ARRAY(
                  SELECT pid FROM pg_stat_activity WHERE ${holderPid} = ANY(pg_blocking_pids(pid))
                )`
          )
        ).length
      const archived = bulkArchiveWorkspaceFileItems({
        workspaceId: fixture.workspaceId,
        fileIds: [fixture.existingFileId],
      })
      const outcomes: Promise<PromiseSettledResult<unknown>[]>[] = [
        Promise.allSettled([directoryHolder, archived]),
      ]
      try {
        await expect.poll(waitingOnLocks, { timeout: 4000 }).toBe(1)
        outcomes.push(Promise.allSettled([finalize(fixture.workspaceId, fixture.aliceId)]))
        await expect.poll(waitingOnLocks, { timeout: 4000 }).toBe(2)
      } finally {
        release.resolve()
      }

      const results = (await Promise.all(outcomes)).flat()
      expect(results.filter((result) => result.status === 'rejected')).toEqual([])
    }
  )
})
