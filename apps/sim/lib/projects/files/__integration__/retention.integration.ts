import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { db } from '@sim/db'
import {
  folder,
  member,
  organization,
  outboxEvent,
  permissions,
  subscription,
  user,
  userStats,
  workspace,
  workspaceFile,
  workspaceFiles,
  workspaceFileVersion,
} from '@sim/db/schema'
import { readTestDatabaseUrl } from '@sim/db/testing/test-infrastructure'
import { deleteWorkspaceFixture, insertWorkspaceFixture } from '@sim/db/testing/workspace-fixtures'
import { createDeferred } from '@sim/testing/helpers/deferred'
import { envFlagsMock, resetEnvFlagsMock, setEnvFlags } from '@sim/testing/mocks/env-flags.mock'
import { getErrorMessage } from '@sim/utils/errors'
import { sleep } from '@sim/utils/helpers'
import { generateId } from '@sim/utils/id'
import { and, eq, inArray, sql } from 'drizzle-orm'
import postgres from 'postgres'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/core/config/env-flags', () => envFlagsMock)

import { type CleanupJobPayload, runCleanupWithLimits } from '@/lib/billing/cleanup-dispatcher'
import { changeWorkspaceStoragePayerInTx } from '@/lib/billing/storage/payer-transfer'
import { createCleanupBudgets } from '@/lib/cleanup/limits'
import { beginFileArchiveCleanup, cleanupFileVersions } from '@/lib/file-retention'
import { loadProjectAccess } from '@/lib/projects/application/authorization'
import { processWorkspaceFileStorageCleanupsNow } from '@/lib/uploads/contexts/workspace/workspace-file-storage-cleanup-outbox'
import { deleteFile, downloadFile, uploadFile } from '@/lib/uploads/core/storage-service'
import type { FileOwner } from '@/lib/workspace-files/ownership'
import { runCleanupFileVersions } from '@/background/cleanup-file-versions'
import { runCleanupSoftDeletes } from '@/background/cleanup-soft-deletes'

const checks: { name: string; status: 'passed' | 'failed'; durationMs: number; error?: string }[] =
  []
const fixtures: {
  ownerId: string
  creatorId: string
  organizationId: string | null
  workspaceId: string
  projectId: string
}[] = []
const storedKeys: string[] = []
const HOUR = 60 * 60 * 1000
const control = postgres(readTestDatabaseUrl(), { max: 2, onnotice: () => undefined })

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
  setEnvFlags({ isBillingEnabled: true, isDataRetentionEnabled: true })
})

async function fixture(plan: 'free' | 'pro' | 'enterprise' = 'free') {
  const ownerId = generateId()
  const creatorId = generateId()
  const organizationId = plan === 'enterprise' ? generateId() : null
  const workspaceId = generateId()
  await db.insert(user).values(
    [ownerId, creatorId].map((id) => ({
      id,
      email: `${id}@retention.invalid`,
      name: 'Retention fixture',
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    }))
  )
  await db.insert(userStats).values([
    { id: generateId(), userId: ownerId, storageUsedBytes: 15 },
    { id: generateId(), userId: creatorId, storageUsedBytes: 0 },
  ])
  await db
    .insert(subscription)
    .values({ id: generateId(), referenceId: creatorId, plan: 'pro', status: 'active' })
  if (organizationId) {
    await db.insert(organization).values({
      id: organizationId,
      name: 'Retention organization',
      slug: organizationId,
      storageUsedBytes: 15,
      dataRetentionSettings: {
        fileVersionRetentionHours: 100,
        softDeleteRetentionHours: 100,
        retentionOverrides: [
          { workspaceId, fileVersionRetentionHours: 1, softDeleteRetentionHours: 1 },
        ],
      },
    })
    await db.insert(member).values({
      id: generateId(),
      userId: ownerId,
      organizationId,
      role: 'owner',
      createdAt: new Date(),
    })
  }
  if (plan !== 'free')
    await db.insert(subscription).values({
      id: generateId(),
      referenceId: organizationId ?? ownerId,
      plan,
      status: 'active',
      metadata: plan === 'enterprise' ? {} : null,
    })
  await insertWorkspaceFixture(db, {
    id: workspaceId,
    ownerId,
    billedAccountUserId: ownerId,
    name: 'Retention environment',
    organizationId,
    workspaceMode: organizationId ? 'organization' : 'personal',
  })
  const [binding] = await db
    .select({ projectId: workspace.projectId })
    .from(workspace)
    .where(eq(workspace.id, workspaceId))
  if (!binding) throw new Error('Retention fixture Project missing')
  await db.insert(permissions).values({
    id: generateId(),
    userId: ownerId,
    entityType: 'workspace',
    entityId: workspaceId,
    permissionType: 'admin',
  })
  const result = { ownerId, creatorId, organizationId, workspaceId, projectId: binding.projectId }
  fixtures.push(result)
  return result
}

async function seedFile(
  f: Awaited<ReturnType<typeof fixture>>,
  ageHours: number,
  archived = false,
  kind: 'project' | 'workspace' = 'project'
) {
  const fileId = generateId()
  const cutoff = new Date(Date.now() - ageHours * HOUR)
  const ownerId = kind === 'project' ? f.projectId : f.workspaceId
  const keys = Array.from(
    { length: 12 },
    (_, index) => `${kind}/${ownerId}/${fileId}-${index + 1}.md`
  )
  await db.insert(workspaceFiles).values({
    id: fileId,
    userId: f.creatorId,
    projectId: kind === 'project' ? f.projectId : null,
    context: kind,
    workspaceId: kind === 'workspace' ? f.workspaceId : null,
    key: keys[11],
    originalName: `${fileId}.md`,
    contentType: 'text/markdown',
    sizeBytes: 5,
    deletedAt: archived ? cutoff : null,
  })
  await db.insert(workspaceFileVersion).values(
    keys.map((key, index) => ({
      id: generateId(),
      fileId,
      workspaceId: kind === 'workspace' ? f.workspaceId : null,
      version: index + 1,
      key,
      sizeBytes: index === 11 ? 5 : 100,
      contentType: 'text/markdown',
      source: 'api' as const,
      supersededAt: index === 11 ? null : cutoff,
    }))
  )
  return { fileId, keys }
}

function payload(projectId: string) {
  return {
    workspaceIds: [],
    projectIds: [projectId],
    plan: 'free' as const,
    retentionHours: 1,
    label: `retention/${projectId}`,
  }
}

async function versions(fileId: string) {
  return db
    .select({ version: workspaceFileVersion.version })
    .from(workspaceFileVersion)
    .where(eq(workspaceFileVersion.fileId, fileId))
    .orderBy(workspaceFileVersion.version)
}

async function cleanupEvents(entityId: string, kind = 'project') {
  return db
    .select({ id: outboxEvent.id, payload: outboxEvent.payload })
    .from(outboxEvent)
    .where(
      and(
        eq(outboxEvent.eventType, 'workspace-file.storage.cleanup'),
        sql`${outboxEvent.payload}->>'key' LIKE ${`${kind}/${entityId}/%`}`
      )
    )
}

describe('Project file retention follows the current payer in PostgreSQL', () => {
  check(
    'unsupported file owners reject the whole batch before any history or archive deletion',
    async () => {
      const f = await fixture()
      const expired = await seedFile(f, 40 * 24, true)
      const owners: FileOwner[] = [
        { entityType: 'project', entityId: f.projectId },
        { entityType: 'user', entityId: f.ownerId },
      ]
      const options = { plan: 'free' as const, cutoff: new Date(), label: 'invalid-owner-batch' }
      await expect(cleanupFileVersions(owners, options, 10)).rejects.toThrow(
        'File owner is unavailable'
      )
      await expect(beginFileArchiveCleanup(owners, options)).rejects.toThrow(
        'File owner is unavailable'
      )
      expect(await versions(expired.fileId)).toHaveLength(12)
      expect(
        await db
          .select({ id: workspaceFiles.id })
          .from(workspaceFiles)
          .where(eq(workspaceFiles.id, expired.fileId))
      ).toEqual([{ id: expired.fileId }])
      expect(await cleanupEvents(f.projectId)).toEqual([])
      const [usage] = await db
        .select({ bytes: userStats.storageUsedBytes })
        .from(userStats)
        .where(eq(userStats.userId, f.ownerId))
      expect(usage.bytes).toBe(15)
    }
  )

  check(
    'a mixed queued batch retains each owner policy and leaves unselected workspace history alone',
    async () => {
      const f = await fixture('pro')
      const other = await fixture()
      const projectFile = await seedFile(f, 60 * 24)
      const workspaceFile = await seedFile(f, 60 * 24, false, 'workspace')
      const unrelated = await seedFile(other, 60 * 24, false, 'workspace')
      await runCleanupFileVersions({
        ...payload(f.projectId),
        projectIds: [f.projectId, f.projectId],
        workspaceIds: [f.workspaceId, f.workspaceId],
      })
      expect(await versions(projectFile.fileId)).toHaveLength(12)
      expect(await versions(workspaceFile.fileId)).toHaveLength(10)
      expect(await versions(unrelated.fileId)).toHaveLength(12)
      expect(await cleanupEvents(f.projectId)).toEqual([])
      const events = await db
        .select({ payload: outboxEvent.payload })
        .from(outboxEvent)
        .where(
          and(
            eq(outboxEvent.eventType, 'workspace-file.storage.cleanup'),
            sql`${outboxEvent.payload}->>'key' LIKE ${`workspace/${f.workspaceId}/%`}`
          )
        )
      expect(events.map(({ payload }) => payload)).toEqual(
        expect.arrayContaining(workspaceFile.keys.slice(0, 2).map((key) => ({ key })))
      )
      expect(events).toHaveLength(2)
    }
  )

  check(
    'one version-deletion budget bounds a mixed owner batch without changing either current head',
    async () => {
      const f = await fixture()
      const projectFile = await seedFile(f, 60 * 24)
      const workspaceFile = await seedFile(f, 60 * 24, false, 'workspace')
      const deleted = await cleanupFileVersions(
        [
          { entityType: 'project', entityId: f.projectId },
          { entityType: 'workspace', entityId: f.workspaceId },
        ],
        { plan: 'free', cutoff: new Date(), label: 'bounded-owner-batch' },
        3
      )
      expect(deleted).toBe(3)
      expect(await versions(projectFile.fileId)).toEqual(
        Array.from({ length: 10 }, (_, index) => ({ version: index + 3 }))
      )
      const remaining = await versions(workspaceFile.fileId)
      expect(remaining).toHaveLength(11)
      expect(remaining.at(-1)).toEqual({ version: 12 })
    }
  )

  check(
    'scheduled discovery includes shared Projects with their payer policy independently of environment chunks',
    async () => {
      const f = await fixture()
      const discovered: CleanupJobPayload[] = []
      await runCleanupWithLimits('cleanup-soft-deletes', { files: 1 }, async (scope) => {
        discovered.push(scope)
      })
      const scopes = discovered.filter((scope) => scope.projectIds?.includes(f.projectId))
      expect(scopes).toHaveLength(1)
      expect(scopes[0]).toMatchObject({ plan: 'free', retentionHours: 30 * 24, workspaceIds: [] })
    }
  )

  check(
    'workspace archive purge waits on Project authority and charges the payer that a preceding transfer selected',
    async () => {
      const f = await fixture()
      const expired = await seedFile(f, 40 * 24, true, 'workspace')
      await db.update(workspace).set({ storageUsedBytes: 5 }).where(eq(workspace.id, f.workspaceId))
      const acquired = createDeferred<number>()
      const release = createDeferred<void>()
      const authority = db.transaction(async (tx) => {
        await loadProjectAccess(tx, f.ownerId, { projectId: f.projectId })
        const result = await tx.execute<{ pid: number }>(sql`SELECT pg_backend_pid() AS pid`)
        acquired.resolve(result[0].pid)
        await release.promise
        await changeWorkspaceStoragePayerInTx(tx, {
          workspaceId: f.workspaceId,
          billedAccountUserId: f.creatorId,
          organizationId: null,
          expectedCurrentPayer: { billedAccountUserId: f.ownerId, organizationId: null },
        })
      })
      const authPid = await Promise.race([
        acquired.promise,
        authority.then(() => {
          throw new Error('Authority ended before publishing its lock')
        }),
      ])
      const cleanup = runCleanupSoftDeletes(
        {
          workspaceIds: [f.workspaceId],
          plan: 'free',
          retentionHours: 30 * 24,
          label: 'workspace-prelock',
        },
        createCleanupBudgets({ files: 1 })
      ).then(
        () => null,
        (error: unknown) => error
      )
      let observed: string | null = null
      try {
        for (let attempt = 0; attempt < 100; attempt += 1) {
          const [waiting] = await control<{ wait_event: string }[]>`
          SELECT wait_event FROM pg_stat_activity
          WHERE ${authPid} = ANY(pg_blocking_pids(pid)) AND wait_event_type = 'Lock'
        `
          if (waiting) {
            observed = waiting.wait_event
            break
          }
          await sleep(10)
        }
      } finally {
        release.resolve()
        await authority
        await cleanup
      }
      expect(
        observed,
        'purge must acquire the canonical Project mutex before workspace resource locks'
      ).toBe('advisory')
      expect(await cleanup).toBeNull()
      expect(await versions(expired.fileId)).toEqual([])
      const [usage] = await db
        .select({ bytes: userStats.storageUsedBytes })
        .from(userStats)
        .where(eq(userStats.userId, f.ownerId))
      expect(usage.bytes).toBe(10)
      const [destination] = await db
        .select({ bytes: userStats.storageUsedBytes })
        .from(userStats)
        .where(eq(userStats.userId, f.creatorId))
      expect(destination.bytes).toBe(0)
      const [environment] = await db
        .select({ bytes: workspace.storageUsedBytes })
        .from(workspace)
        .where(eq(workspace.id, f.workspaceId))
      expect(environment.bytes).toBe(0)
    }
  )

  check(
    'workspace archive release preserves a restored head and durably deletes only expired objects',
    async () => {
      const f = await fixture()
      const expired = await seedFile(f, 40 * 24, true, 'workspace')
      const restored = await seedFile(f, 40 * 24, true, 'workspace')
      const legacyKey = `workspace/${f.workspaceId}/${generateId()}.md`
      await db.insert(workspaceFile).values({
        id: generateId(),
        workspaceId: f.workspaceId,
        name: 'legacy.md',
        key: legacyKey,
        size: 5,
        type: 'text/markdown',
        uploadedBy: f.ownerId,
        deletedAt: new Date(Date.now() - 40 * 24 * HOUR),
      })
      await db
        .update(workspace)
        .set({ storageUsedBytes: 10 })
        .where(eq(workspace.id, f.workspaceId))
      for (const key of [expired.keys[11], restored.keys[11], legacyKey]) {
        storedKeys.push(key)
        await uploadFile({
          file: Buffer.from('draft'),
          fileName: 'note.md',
          contentType: 'text/markdown',
          customKey: key,
          preserveKey: true,
          context: 'workspace',
          persistMetadata: false,
        })
      }
      const cleanup = await beginFileArchiveCleanup(
        [{ entityType: 'workspace', entityId: f.workspaceId }],
        { plan: 'free', cutoff: new Date(), label: 'restore-selected-workspace-file' }
      )
      await db
        .update(workspaceFiles)
        .set({ deletedAt: null })
        .where(eq(workspaceFiles.id, restored.fileId))
      const deletion = await cleanup.cleanupStorage()
      expect(await deletion.deleteRows()).toBe(2)
      const events = await cleanupEvents(f.workspaceId, 'workspace')
      expect(new Set(events.map(({ payload }) => (payload as { key: string }).key))).toEqual(
        new Set([...expired.keys, legacyKey])
      )
      expect(
        events.find(({ payload }) => (payload as { key: string }).key === expired.keys[11])?.payload
      ).toEqual({ key: expired.keys[11] })
      await processWorkspaceFileStorageCleanupsNow(
        events.map(({ id }) => id),
        { label: 'retention-fixture' }
      )
      expect(await downloadFile({ key: restored.keys[11], context: 'workspace' })).toEqual(
        Buffer.from('draft')
      )
      await expect(
        downloadFile({ key: expired.keys[11], context: 'workspace' })
      ).rejects.toMatchObject({ code: 'ENOENT' })
      await expect(downloadFile({ key: legacyKey, context: 'workspace' })).rejects.toMatchObject({
        code: 'ENOENT',
      })
      expect(await versions(restored.fileId)).toHaveLength(12)
      const [usage] = await db
        .select({ bytes: userStats.storageUsedBytes })
        .from(userStats)
        .where(eq(userStats.userId, f.ownerId))
      expect(usage.bytes).toBe(10)
    }
  )

  check(
    'folder retention deduplicates more than one file batch before deleting its parent',
    async () => {
      const f = await fixture()
      const folderId = generateId()
      await db.insert(folder).values({
        id: folderId,
        projectId: f.projectId,
        userId: f.ownerId,
        resourceType: 'file',
        name: 'Expired parent',
        deletedAt: new Date(Date.now() - 40 * 24 * HOUR),
      })
      const files = Array.from({ length: 502 }, (_, index) => ({
        id: generateId(),
        projectId: f.projectId,
        userId: f.ownerId,
        context: 'project',
        key: `project/${f.projectId}/batch-${index}`,
        originalName: `batch-${index}.md`,
        contentType: 'text/markdown',
        sizeBytes: 0,
        folderId,
      }))
      await db.insert(workspaceFiles).values(files)
      await db.insert(workspaceFiles).values({
        ...files[0],
        id: generateId(),
        key: `project/${f.projectId}/root`,
        folderId: null,
      })
      await runCleanupSoftDeletes(payload(f.projectId), createCleanupBudgets({ folders: 1 }))
      expect(await db.select().from(folder).where(eq(folder.id, folderId))).toEqual([])
      const retained = await db
        .select()
        .from(workspaceFiles)
        .where(eq(workspaceFiles.projectId, f.projectId))
      expect(retained).toHaveLength(503)
      expect(retained.every((file) => file.folderId === null)).toBe(true)
      expect(new Set(retained.map((file) => file.originalName)).size).toBe(503)
      expect(retained.find((file) => file.id === files[0].id)?.originalName).not.toBe('batch-0.md')
    }
  )

  check('workspace file folder deletion failure rolls back child locations and names', async () => {
    const f = await fixture()
    const parentId = generateId()
    const childId = generateId()
    const owner = { workspaceId: f.workspaceId, userId: f.ownerId, resourceType: 'file' as const }
    await db.insert(folder).values({
      ...owner,
      id: parentId,
      name: 'Archived parent',
      deletedAt: new Date(Date.now() - 40 * 24 * HOUR),
    })
    await db.insert(folder).values({ ...owner, id: childId, name: 'Child', parentId })
    const file = await seedFile(f, 1, false, 'workspace')
    await db
      .update(workspaceFiles)
      .set({ folderId: parentId, originalName: 'Child.md' })
      .where(eq(workspaceFiles.id, file.fileId))
    const trigger = `folder_retention_failure_${generateId().replaceAll('-', '')}`
    await db.execute(
      sql.raw(`CREATE FUNCTION ${trigger}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
        IF OLD.id = '${parentId}' THEN RAISE EXCEPTION 'folder retention rollback fixture'; END IF; RETURN OLD; END $$`)
    )
    await db.execute(
      sql.raw(
        `CREATE TRIGGER ${trigger} BEFORE DELETE ON folder FOR EACH ROW EXECUTE FUNCTION ${trigger}()`
      )
    )
    try {
      await runCleanupSoftDeletes(
        {
          workspaceIds: [f.workspaceId],
          plan: 'free',
          retentionHours: 30 * 24,
          label: 'workspace-folder-rollback',
        },
        createCleanupBudgets({ folders: 1 })
      ).catch(() => undefined)
      const [child] = await db
        .select({ parentId: folder.parentId, name: folder.name })
        .from(folder)
        .where(eq(folder.id, childId))
      expect(child).toEqual({ parentId, name: 'Child' })
      const [head] = await db
        .select({ folderId: workspaceFiles.folderId, name: workspaceFiles.originalName })
        .from(workspaceFiles)
        .where(eq(workspaceFiles.id, file.fileId))
      expect(head).toEqual({ folderId: parentId, name: 'Child.md' })
    } finally {
      await db.execute(sql.raw(`DROP TRIGGER ${trigger} ON folder`))
      await db.execute(sql.raw(`DROP FUNCTION ${trigger}()`))
    }
  })

  check(
    'workspace file folder purge waits for a concurrent restore and leaves its children in place',
    async () => {
      const f = await fixture()
      const parentId = generateId()
      const childId = generateId()
      const owner = { workspaceId: f.workspaceId, userId: f.ownerId, resourceType: 'file' as const }
      await db.insert(folder).values({
        ...owner,
        id: parentId,
        name: 'Restoring parent',
        deletedAt: new Date(Date.now() - 40 * 24 * HOUR),
      })
      await db.insert(folder).values({ ...owner, id: childId, name: 'Child', parentId })
      const acquired = createDeferred<number>()
      const restore = createDeferred<void>()
      const authority = db.transaction(async (tx) => {
        await loadProjectAccess(tx, f.ownerId, { projectId: f.projectId })
        const result = await tx.execute<{ pid: number }>(sql`SELECT pg_backend_pid() AS pid`)
        acquired.resolve(result[0].pid)
        await restore.promise
        await tx.update(folder).set({ deletedAt: null }).where(eq(folder.id, parentId))
      })
      const authPid = await Promise.race([
        acquired.promise,
        authority.then(() => {
          throw new Error('Restore ended before publishing its lock')
        }),
      ])
      let settled = false
      const cleanup = runCleanupSoftDeletes(
        {
          workspaceIds: [f.workspaceId],
          plan: 'free',
          retentionHours: 30 * 24,
          label: 'workspace-folder-restore',
        },
        createCleanupBudgets({ folders: 1 })
      ).then(
        () => {
          settled = true
          return null
        },
        (error: unknown) => {
          settled = true
          return error
        }
      )
      let observed: string | null = null
      try {
        for (let attempt = 0; attempt < 100 && !settled; attempt++) {
          const [waiting] = await control<
            { wait_event: string }[]
          >`SELECT wait_event FROM pg_stat_activity WHERE ${authPid} = ANY(pg_blocking_pids(pid)) AND wait_event_type = 'Lock'`
          if (waiting) {
            observed = waiting.wait_event
            break
          }
          await sleep(10)
        }
      } finally {
        restore.resolve()
        await authority
        await cleanup
      }
      expect(observed).toBe('advisory')
      expect(await cleanup).toBeNull()
      const [parent] = await db
        .select({ deletedAt: folder.deletedAt })
        .from(folder)
        .where(eq(folder.id, parentId))
      expect(parent).toEqual({ deletedAt: null })
      const [child] = await db
        .select({ parentId: folder.parentId, name: folder.name })
        .from(folder)
        .where(eq(folder.id, childId))
      expect(child).toEqual({ parentId, name: 'Child' })
    }
  )

  check(
    'free history is pruned with its ten-version floor while a paid Project ignores a stale free queue policy and uploader plan',
    async () => {
      const free = await fixture()
      const paid = await fixture('pro')
      const freeFile = await seedFile(free, 60 * 24)
      const paidFile = await seedFile(paid, 60 * 24)
      await runCleanupFileVersions(payload(free.projectId))
      await runCleanupFileVersions(payload(paid.projectId))
      expect(await versions(freeFile.fileId)).toEqual(
        Array.from({ length: 10 }, (_, index) => ({ version: index + 3 }))
      )
      expect(await versions(paidFile.fileId)).toHaveLength(12)
      expect((await cleanupEvents(free.projectId)).map((row) => row.payload)).toEqual(
        expect.arrayContaining(
          freeFile.keys.slice(0, 2).map((key) => ({ key, context: 'project' }))
        )
      )
      expect(await cleanupEvents(paid.projectId)).toEqual([])
      const [usage] = await db
        .select({ bytes: userStats.storageUsedBytes })
        .from(userStats)
        .where(eq(userStats.userId, free.ownerId))
      expect(usage.bytes).toBe(15)
    }
  )

  check(
    'enterprise Project history uses the organization setting and never an environment override or stale queued cutoff',
    async () => {
      const f = await fixture('enterprise')
      const kept = await seedFile(f, 48)
      const expired = await seedFile(f, 200)
      await runCleanupFileVersions(payload(f.projectId))
      expect(await versions(expired.fileId)).toHaveLength(10)
      expect(await versions(kept.fileId)).toHaveLength(12)
      if (!f.organizationId) throw new Error('Expected an organization fixture')
      await db
        .update(organization)
        .set({ dataRetentionSettings: { fileVersionRetentionHours: null } })
        .where(eq(organization.id, f.organizationId))
      const indefinite = await seedFile(f, 1000)
      await runCleanupFileVersions(payload(f.projectId))
      expect(await versions(indefinite.fileId)).toHaveLength(12)
    }
  )

  check(
    'archive expiry removes exact heads and history once, debits only head bytes, and commits Project cleanup objects durably',
    async () => {
      const f = await fixture()
      const expired = await seedFile(f, 40 * 24, true)
      await runCleanupSoftDeletes(payload(f.projectId))
      await runCleanupSoftDeletes(payload(f.projectId))
      expect(
        await db
          .select({ id: workspaceFiles.id })
          .from(workspaceFiles)
          .where(eq(workspaceFiles.id, expired.fileId))
      ).toEqual([])
      expect(await versions(expired.fileId)).toEqual([])
      const [usage] = await db
        .select({ bytes: userStats.storageUsedBytes })
        .from(userStats)
        .where(eq(userStats.userId, f.ownerId))
      expect(usage.bytes).toBe(10)
      const events = await cleanupEvents(f.projectId)
      expect(new Set(events.map((row) => (row.payload as { key: string }).key))).toEqual(
        new Set(expired.keys)
      )
      expect(
        events.every((row) => (row.payload as { context: string }).context === 'project')
      ).toBe(true)
    }
  )

  check(
    'folder expiry preserves and renames surviving Project children when the root already contains their names',
    async () => {
      const f = await fixture()
      const parentId = generateId()
      const childId = generateId()
      const rootFolderId = generateId()
      const owner = {
        projectId: f.projectId,
        userId: f.creatorId,
        resourceType: 'file' as const,
      }
      await db.insert(folder).values([
        {
          ...owner,
          id: parentId,
          name: 'Archived parent',
          deletedAt: new Date(Date.now() - 40 * 24 * HOUR),
        },
        { ...owner, id: rootFolderId, name: 'Architecture' },
      ])
      await db.insert(folder).values({ ...owner, id: childId, name: 'Architecture', parentId })
      const file = await seedFile(f, 1)
      const rootFile = await seedFile(f, 1)
      await db
        .update(workspaceFiles)
        .set({ folderId: parentId, originalName: 'README.md' })
        .where(eq(workspaceFiles.id, file.fileId))
      await db
        .update(workspaceFiles)
        .set({ originalName: 'README.md' })
        .where(eq(workspaceFiles.id, rootFile.fileId))
      await runCleanupSoftDeletes(payload(f.projectId), createCleanupBudgets({ folders: 1 }))
      expect(
        await db.select({ id: folder.id }).from(folder).where(eq(folder.id, parentId))
      ).toEqual([])
      const [child] = await db
        .select({ parentId: folder.parentId, name: folder.name })
        .from(folder)
        .where(eq(folder.id, childId))
      expect(child).toEqual({ parentId: null, name: 'Architecture (1)' })
      const [survivor] = await db
        .select({ folderId: workspaceFiles.folderId, name: workspaceFiles.originalName })
        .from(workspaceFiles)
        .where(eq(workspaceFiles.id, file.fileId))
      expect(survivor.folderId).toBeNull()
      expect(survivor.name).not.toBe('README.md')
      expect(survivor.name).toMatch(/^README/)
      expect(await versions(file.fileId)).toHaveLength(12)
      expect(await cleanupEvents(f.projectId)).toEqual([])
    }
  )

  for (const kind of ['project', 'workspace'] as const)
    check(
      `a failed ${kind} archive deletion rolls back current bytes, version removal, and the cleanup outbox`,
      async () => {
        const f = await fixture()
        const expired = await seedFile(f, 40 * 24, true, kind)
        if (kind === 'workspace')
          await db
            .update(workspace)
            .set({ storageUsedBytes: 5 })
            .where(eq(workspace.id, f.workspaceId))
        const trigger = `retention_failure_${generateId().replaceAll('-', '')}`
        await db.execute(
          sql.raw(`CREATE FUNCTION ${trigger}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF OLD.id = '${expired.fileId}' THEN RAISE EXCEPTION 'retention rollback fixture'; END IF; RETURN OLD; END $$`)
        )
        await db.execute(
          sql.raw(
            `CREATE TRIGGER ${trigger} BEFORE DELETE ON workspace_files FOR EACH ROW EXECUTE FUNCTION ${trigger}()`
          )
        )
        try {
          await expect(
            runCleanupSoftDeletes(
              kind === 'project'
                ? payload(f.projectId)
                : {
                    workspaceIds: [f.workspaceId],
                    plan: 'free',
                    retentionHours: 30 * 24,
                    label: 'workspace-rollback',
                  },
              createCleanupBudgets({ files: 1 })
            )
          ).rejects.toMatchObject(
            kind === 'project'
              ? { cause: { message: 'retention rollback fixture' } }
              : { message: 'File row cleanup failed' }
          )
          expect(await versions(expired.fileId)).toHaveLength(12)
          expect(
            await cleanupEvents(kind === 'project' ? f.projectId : f.workspaceId, kind)
          ).toEqual([])
          const [usage] = await db
            .select({ bytes: userStats.storageUsedBytes })
            .from(userStats)
            .where(eq(userStats.userId, f.ownerId))
          expect(usage.bytes).toBe(15)
        } finally {
          await db.execute(sql.raw(`DROP TRIGGER ${trigger} ON workspace_files`))
          await db.execute(sql.raw(`DROP FUNCTION ${trigger}()`))
        }
      }
    )
})

afterAll(async () => {
  try {
    for (const key of storedKeys)
      await deleteFile({ key, context: 'workspace' }).catch(() => undefined)
    for (const f of fixtures) {
      await db
        .delete(outboxEvent)
        .where(
          sql`${outboxEvent.payload}->>'key' LIKE ${`project/${f.projectId}/%`} OR ${outboxEvent.payload}->>'key' LIKE ${`workspace/${f.workspaceId}/%`}`
        )
      await db.delete(workspaceFiles).where(eq(workspaceFiles.projectId, f.projectId))
      await db.delete(folder).where(eq(folder.projectId, f.projectId))
      await deleteWorkspaceFixture(db, eq(workspace.id, f.workspaceId))
      await db
        .delete(subscription)
        .where(
          inArray(subscription.referenceId, [
            f.ownerId,
            f.creatorId,
            ...(f.organizationId ? [f.organizationId] : []),
          ])
        )
      if (f.organizationId)
        await db.delete(organization).where(eq(organization.id, f.organizationId))
      await db.delete(user).where(inArray(user.id, [f.ownerId, f.creatorId]))
    }
  } finally {
    resetEnvFlagsMock()
    await control.end({ timeout: 1 })
    const path = process.env.PROJECT_FILE_RETENTION_REPORT_PATH
    if (path) {
      await mkdir(dirname(path), { recursive: true })
      await writeFile(path, JSON.stringify({ checks }, null, 2))
    }
  }
})
