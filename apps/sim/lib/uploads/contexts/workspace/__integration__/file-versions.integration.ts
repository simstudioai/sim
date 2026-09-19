/** Real PostgreSQL transactions and local object storage for workspace file version history. */
import { mkdtempSync } from 'node:fs'
import { access, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { db, dbFor } from '@sim/db'
import {
  organization,
  outboxEvent,
  user,
  workspace,
  workspaceFileSecretProvenance,
  workspaceFiles,
  workspaceFileVersion,
} from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import { and, asc, eq, inArray, sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const fixtureStorage = vi.hoisted(() => ({ root: '' }))
vi.mock('@/lib/uploads/core/setup.server', () => ({
  get UPLOAD_DIR_SERVER() {
    return fixtureStorage.root
  },
}))

import {
  createKnowledgeAclFixtureIds,
  seedKnowledgeAclFixture,
} from '@/lib/knowledge/__integration__/seed-source-access-fixture'
import {
  deleteWorkspaceFileVersion,
  fetchWorkspaceFileBuffer,
  getWorkspaceFile,
  getWorkspaceFileWithCurrentVersion,
  updateWorkspaceFileContent,
  uploadWorkspaceFile,
} from '@/lib/uploads/contexts/workspace/workspace-file-manager'
import { WORKSPACE_FILE_STORAGE_CLEANUP_OUTBOX_EVENT } from '@/lib/uploads/contexts/workspace/workspace-file-storage-cleanup-outbox'
import {
  getCurrentWorkspaceFileVersion,
  queryWorkspaceFileVersions,
  releaseWorkspaceFileVersionsForPurgeInTx,
} from '@/lib/uploads/contexts/workspace/workspace-file-versions'
import { revertWorkspaceFileVersion } from '@/lib/workspace-files/application/file-versions'
import { runCleanupFileVersions } from '@/background/cleanup-file-versions'

describe('workspace file version history in PostgreSQL', () => {
  const fixtures: ReturnType<typeof createKnowledgeAclFixtureIds>[] = []

  beforeAll(() => {
    fixtureStorage.root = mkdtempSync(path.join(tmpdir(), 'sim-file-versions-'))
  })

  afterAll(async () => {
    for (const ids of fixtures) {
      await db.delete(workspace).where(eq(workspace.id, ids.workspaceId))
      await db.delete(organization).where(eq(organization.id, ids.organizationId))
      await db.delete(user).where(inArray(user.id, [ids.aliceId, ids.bobId]))
    }
    await rm(fixtureStorage.root, { recursive: true, force: true })
    await Promise.all([db.$client.end(), dbFor('cleanup').$client.end()])
  })

  async function seedFile(content: string) {
    const ids = createKnowledgeAclFixtureIds()
    fixtures.push(ids)
    await seedKnowledgeAclFixture(ids)
    const uploaded = await uploadWorkspaceFile(
      ids.workspaceId,
      ids.aliceId,
      Buffer.from(content),
      `notes-${generateId()}.txt`,
      'text/plain',
      { notifyWorkspaceChange: false }
    )
    return { ...ids, fileId: uploaded.id, firstKey: uploaded.key }
  }

  function versionRows(fileId: string) {
    return db
      .select()
      .from(workspaceFileVersion)
      .where(eq(workspaceFileVersion.fileId, fileId))
      .orderBy(asc(workspaceFileVersion.version))
  }

  async function objectExists(key: string) {
    try {
      await access(path.join(fixtureStorage.root, key))
      return true
    } catch {
      return false
    }
  }

  async function readVersionBytes(workspaceId: string, fileId: string, key: string) {
    const file = await getWorkspaceFile(workspaceId, fileId)
    if (!file) throw new Error('file missing')
    return (await fetchWorkspaceFileBuffer({ ...file, key }, { maxBytes: 1024 })).toString()
  }

  it('lists a never-rewritten file as an implicit version 1 attributed to its uploader', async () => {
    const fixture = await seedFile('original')
    const file = await getWorkspaceFile(fixture.workspaceId, fixture.fileId)
    if (!file) throw new Error('file missing')

    const { versions } = await queryWorkspaceFileVersions(file, { sortOrder: 'desc', limit: 10 })

    expect(versions).toHaveLength(1)
    expect(versions[0]).toMatchObject({
      version: 1,
      isCurrent: true,
      key: fixture.firstKey,
      source: 'upload',
      authorUserIds: [fixture.aliceId],
    })
    expect(await versionRows(fixture.fileId)).toEqual([])
  })

  it('materializes version 1 on the first write and keeps the outgoing bytes readable', async () => {
    const fixture = await seedFile('original')

    const updated = await updateWorkspaceFileContent(
      fixture.workspaceId,
      fixture.fileId,
      fixture.aliceId,
      Buffer.from('second'),
      undefined,
      { version: { source: 'api', authorUserId: fixture.bobId } }
    )

    const rows = await versionRows(fixture.fileId)
    expect(rows.map((row) => [row.version, row.source, row.authorUserIds])).toEqual([
      [1, 'upload', [fixture.aliceId]],
      [2, 'api', [fixture.bobId]],
    ])
    expect(rows[0].key).toBe(fixture.firstKey)
    expect(rows[0].supersededAt).not.toBeNull()
    expect(rows[1].key).toBe(updated.key)
    expect(rows[1].supersededAt).toBeNull()
    expect(await objectExists(fixture.firstKey)).toBe(true)
    expect(await readVersionBytes(fixture.workspaceId, fixture.fileId, rows[0].key)).toBe(
      'original'
    )
  })

  it('folds consecutive collaborative writes into one version and deletes the replaced object', async () => {
    const fixture = await seedFile('original')
    const write = { source: 'collab', authorUserId: fixture.aliceId } as const

    const first = await updateWorkspaceFileContent(
      fixture.workspaceId,
      fixture.fileId,
      fixture.aliceId,
      Buffer.from('draft one'),
      undefined,
      { version: write }
    )
    const second = await updateWorkspaceFileContent(
      fixture.workspaceId,
      fixture.fileId,
      fixture.bobId,
      Buffer.from('draft two'),
      undefined,
      { version: { source: 'collab', authorUserId: fixture.bobId } }
    )

    const rows = await versionRows(fixture.fileId)
    expect(rows.map((row) => row.version)).toEqual([1, 2])
    expect(rows[1]).toMatchObject({
      key: second.key,
      source: 'collab',
      authorUserIds: [fixture.aliceId, fixture.bobId],
      supersededAt: null,
    })
    expect(await objectExists(first.key)).toBe(false)
    expect(await objectExists(fixture.firstKey)).toBe(true)
  })

  it('opens a new collaborative version once the window or the idle gap has passed', async () => {
    const fixture = await seedFile('original')
    const write = { source: 'collab', authorUserId: fixture.aliceId } as const
    const persist = (content: string) =>
      updateWorkspaceFileContent(
        fixture.workspaceId,
        fixture.fileId,
        fixture.aliceId,
        Buffer.from(content),
        undefined,
        { version: write }
      )

    await persist('session one')
    await db
      .update(workspaceFileVersion)
      .set({ createdAt: sql`now() - interval '11 minutes'` })
      .where(
        sql`${workspaceFileVersion.fileId} = ${fixture.fileId} AND ${workspaceFileVersion.version} = 2`
      )
    await persist('session one, later')
    await db
      .update(workspaceFileVersion)
      .set({ updatedAt: sql`now() - interval '6 minutes'` })
      .where(
        sql`${workspaceFileVersion.fileId} = ${fixture.fileId} AND ${workspaceFileVersion.version} = 3`
      )
    await persist('session two')

    expect((await versionRows(fixture.fileId)).map((row) => row.version)).toEqual([1, 2, 3, 4])
  })

  it('reports the current version number before and after the first write', async () => {
    const fixture = await seedFile('original')
    const before = await getWorkspaceFile(fixture.workspaceId, fixture.fileId)
    if (!before) throw new Error('file missing')
    expect((await getCurrentWorkspaceFileVersion(before)).version).toBe(1)

    await updateWorkspaceFileContent(
      fixture.workspaceId,
      fixture.fileId,
      fixture.aliceId,
      Buffer.from('second'),
      undefined,
      { version: { source: 'api', authorUserId: fixture.aliceId } }
    )

    const after = await getWorkspaceFile(fixture.workspaceId, fixture.fileId)
    if (!after) throw new Error('file missing')
    expect((await getCurrentWorkspaceFileVersion(after)).version).toBe(2)
  })

  it('reads a record with the version of the bytes it describes', async () => {
    const fixture = await seedFile('original')
    await expect(
      getWorkspaceFileWithCurrentVersion(fixture.workspaceId, fixture.fileId)
    ).resolves.toMatchObject({ key: fixture.firstKey, currentVersion: 1 })

    const write = { source: 'collab', authorUserId: fixture.aliceId } as const
    await updateWorkspaceFileContent(
      fixture.workspaceId,
      fixture.fileId,
      fixture.aliceId,
      Buffer.from('draft one'),
      undefined,
      { version: write }
    )
    const coalesced = await updateWorkspaceFileContent(
      fixture.workspaceId,
      fixture.fileId,
      fixture.aliceId,
      Buffer.from('draft two'),
      undefined,
      { version: write }
    )

    await expect(
      getWorkspaceFileWithCurrentVersion(fixture.workspaceId, fixture.fileId)
    ).resolves.toMatchObject({ key: coalesced.key, currentVersion: 2 })
  })

  it('does not keep an empty shell as a version of its own', async () => {
    const fixture = await seedFile('')

    await updateWorkspaceFileContent(
      fixture.workspaceId,
      fixture.fileId,
      fixture.aliceId,
      Buffer.from('first real content'),
      undefined,
      { version: { source: 'copilot', authorUserId: fixture.aliceId } }
    )

    const rows = await versionRows(fixture.fileId)
    expect(rows.map((row) => [row.version, row.source])).toEqual([[1, 'copilot']])
    expect(await objectExists(fixture.firstKey)).toBe(false)
  })

  it('deletes a superseded version and its object but never the current one', async () => {
    const fixture = await seedFile('original')
    await updateWorkspaceFileContent(
      fixture.workspaceId,
      fixture.fileId,
      fixture.aliceId,
      Buffer.from('second'),
      undefined,
      { version: { source: 'api', authorUserId: fixture.aliceId } }
    )

    await expect(deleteWorkspaceFileVersion(fixture.workspaceId, fixture.fileId, 2)).resolves.toBe(
      'newest'
    )
    await expect(deleteWorkspaceFileVersion(fixture.workspaceId, fixture.fileId, 1)).resolves.toBe(
      'deleted'
    )
    await expect(deleteWorkspaceFileVersion(fixture.workspaceId, fixture.fileId, 1)).resolves.toBe(
      'not_found'
    )

    expect((await versionRows(fixture.fileId)).map((row) => row.version)).toEqual([2])
    expect(await objectExists(fixture.firstKey)).toBe(false)
  })

  it('reads bytes a write left unrecorded as the version its next write records them as', async () => {
    const fixture = await seedFile('original')
    const write = { source: 'api', authorUserId: fixture.aliceId } as const
    await updateWorkspaceFileContent(
      fixture.workspaceId,
      fixture.fileId,
      fixture.aliceId,
      Buffer.from('second'),
      undefined,
      { version: write }
    )
    /** A content write that replaced the bytes without recording a version, as a build predating history would. */
    const unrecordedKey = `${fixture.firstKey}-unrecorded`
    await db
      .update(workspaceFiles)
      .set({ key: unrecordedKey, contentUpdatedAt: new Date() })
      .where(eq(workspaceFiles.id, fixture.fileId))
    const file = await getWorkspaceFile(fixture.workspaceId, fixture.fileId)
    if (!file) throw new Error('file missing')

    await expect(
      getWorkspaceFileWithCurrentVersion(fixture.workspaceId, fixture.fileId)
    ).resolves.toMatchObject({ key: unrecordedKey, currentVersion: 3 })
    expect(await getCurrentWorkspaceFileVersion(file)).toMatchObject({
      version: 3,
      key: unrecordedKey,
      isCurrent: true,
    })
    const listed = await queryWorkspaceFileVersions(file, { sortOrder: 'desc', limit: 10 })
    expect(listed.versions.map((row) => [row.version, row.isCurrent, row.source])).toEqual([
      [3, true, 'unknown'],
      [2, false, 'api'],
      [1, false, 'upload'],
    ])
    expect(listed.versions[1].supersededAt).toEqual(file.contentUpdatedAt)

    const firstPage = await queryWorkspaceFileVersions(file, { sortOrder: 'asc', limit: 2 })
    expect(firstPage.versions.map((row) => row.version)).toEqual([1, 2])
    const lastPage = await queryWorkspaceFileVersions(file, {
      sortOrder: 'asc',
      limit: 2,
      after: firstPage.nextKeys ?? undefined,
    })
    expect(lastPage.versions.map((row) => row.version)).toEqual([3])
    expect(lastPage.nextKeys).toBeNull()

    await expect(deleteWorkspaceFileVersion(fixture.workspaceId, fixture.fileId, 2)).resolves.toBe(
      'newest'
    )

    const next = await updateWorkspaceFileContent(
      fixture.workspaceId,
      fixture.fileId,
      fixture.aliceId,
      Buffer.from('fourth'),
      undefined,
      { version: write }
    )
    expect(next.currentVersion).toBe(4)
    expect((await versionRows(fixture.fileId)).map((row) => [row.version, row.source])).toEqual([
      [1, 'upload'],
      [2, 'api'],
      [3, 'unknown'],
      [4, 'api'],
    ])
    expect((await versionRows(fixture.fileId))[2].key).toBe(unrecordedKey)
  })

  it('never folds deliberate writes, and repoints the head for identical bytes', async () => {
    const fixture = await seedFile('original')
    const write = { source: 'api', authorUserId: fixture.aliceId } as const
    const first = await updateWorkspaceFileContent(
      fixture.workspaceId,
      fixture.fileId,
      fixture.aliceId,
      Buffer.from('changed'),
      undefined,
      { version: write }
    )
    const identical = await updateWorkspaceFileContent(
      fixture.workspaceId,
      fixture.fileId,
      fixture.aliceId,
      Buffer.from('changed'),
      undefined,
      { version: write }
    )
    await updateWorkspaceFileContent(
      fixture.workspaceId,
      fixture.fileId,
      fixture.aliceId,
      Buffer.from('changed again'),
      undefined,
      { version: write }
    )

    const rows = await versionRows(fixture.fileId)
    expect(rows.map((row) => row.version)).toEqual([1, 2, 3])
    expect(rows[1].key).toBe(identical.key)
    expect(await objectExists(first.key)).toBe(false)
  })

  it('numbers concurrent writes without gaps or collisions', async () => {
    const fixture = await seedFile('original')
    await Promise.all(
      ['a', 'b', 'c', 'd'].map((content) =>
        updateWorkspaceFileContent(
          fixture.workspaceId,
          fixture.fileId,
          fixture.aliceId,
          Buffer.from(content),
          undefined,
          { version: { source: 'api', authorUserId: fixture.aliceId } }
        )
      )
    )

    const rows = await versionRows(fixture.fileId)
    expect(rows.map((row) => row.version)).toEqual([1, 2, 3, 4, 5])
    expect(rows.filter((row) => row.supersededAt === null)).toHaveLength(1)
    const current = await getWorkspaceFile(fixture.workspaceId, fixture.fileId)
    expect(rows.at(-1)?.key).toBe(current?.key)
  })

  it('reverts to an earlier version as a new version carrying that version’s provenance', async () => {
    const fixture = await seedFile('original')
    await updateWorkspaceFileContent(
      fixture.workspaceId,
      fixture.fileId,
      fixture.aliceId,
      Buffer.from('tainted'),
      undefined,
      {
        version: { source: 'api', authorUserId: fixture.aliceId },
        secretProvenancePolicy: { mode: 'replace', provenance: { status: 'unknown' } },
      }
    )
    await updateWorkspaceFileContent(
      fixture.workspaceId,
      fixture.fileId,
      fixture.aliceId,
      Buffer.from('clean'),
      undefined,
      {
        version: { source: 'api', authorUserId: fixture.aliceId },
        secretProvenancePolicy: { mode: 'replace', provenance: { status: 'exact', entries: [] } },
      }
    )

    const result = await revertWorkspaceFileVersion.execute({
      principal: { kind: 'session', userId: fixture.aliceId, sessionId: generateId() },
      input: { fileId: fixture.fileId, assertedWorkspaceId: fixture.workspaceId, version: 2 },
    })

    expect(result).toMatchObject({ reverted: true, revertedFrom: 3 })
    expect(result.version).toMatchObject({
      version: 4,
      source: 'revert',
      restoredFromVersion: 2,
      authorUserIds: [fixture.aliceId],
    })
    expect(await readVersionBytes(fixture.workspaceId, fixture.fileId, result.file.key)).toBe(
      'tainted'
    )
    const [sidecar] = await db
      .select({ status: workspaceFileSecretProvenance.status })
      .from(workspaceFileSecretProvenance)
      .where(eq(workspaceFileSecretProvenance.fileId, fixture.fileId))
    expect(sidecar.status).toBe('unknown')

    const noop = await revertWorkspaceFileVersion.execute({
      principal: { kind: 'session', userId: fixture.aliceId, sessionId: generateId() },
      input: { fileId: fixture.fileId, assertedWorkspaceId: fixture.workspaceId, version: 4 },
    })
    expect(noop).toMatchObject({ reverted: false })
    expect(await versionRows(fixture.fileId)).toHaveLength(4)
  })

  it('refuses a revert whose expected current version is stale', async () => {
    const fixture = await seedFile('original')
    await updateWorkspaceFileContent(
      fixture.workspaceId,
      fixture.fileId,
      fixture.aliceId,
      Buffer.from('second'),
      undefined,
      { version: { source: 'api', authorUserId: fixture.aliceId } }
    )

    await expect(
      revertWorkspaceFileVersion.execute({
        principal: { kind: 'session', userId: fixture.aliceId, sessionId: generateId() },
        input: {
          fileId: fixture.fileId,
          assertedWorkspaceId: fixture.workspaceId,
          version: 1,
          expectedCurrentVersion: 1,
        },
      })
    ).rejects.toMatchObject({ code: 'conflict' })
  })

  it('releases history only with the purge transaction and leaves a restored file untouched', async () => {
    const expired = await seedFile('one')
    const restored = await seedFile('one')
    for (const fixture of [expired, restored]) {
      for (const content of ['two', 'three']) {
        await updateWorkspaceFileContent(
          fixture.workspaceId,
          fixture.fileId,
          fixture.aliceId,
          Buffer.from(content),
          undefined,
          { version: { source: 'api', authorUserId: fixture.aliceId } }
        )
      }
    }
    const deletedAt = sql`now() - interval '40 days'`
    await db.update(workspaceFiles).set({ deletedAt }).where(eq(workspaceFiles.id, expired.fileId))
    const releasedKeys = (await versionRows(expired.fileId))
      .filter((row) => row.supersededAt !== null)
      .map((row) => row.key)

    const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    await expect(
      db.transaction(async (tx) => {
        await releaseWorkspaceFileVersionsForPurgeInTx(tx, [expired.fileId], cutoff)
        throw new Error('purge failed')
      })
    ).rejects.toThrow('purge failed')
    expect((await versionRows(expired.fileId)).map((row) => row.version)).toEqual([1, 2, 3])

    await db.transaction((tx) =>
      releaseWorkspaceFileVersionsForPurgeInTx(tx, [expired.fileId, restored.fileId], cutoff)
    )

    expect((await versionRows(expired.fileId)).map((row) => row.version)).toEqual([3])
    expect((await versionRows(restored.fileId)).map((row) => row.version)).toEqual([1, 2, 3])
    const events = await db
      .select({ id: outboxEvent.id, payload: outboxEvent.payload })
      .from(outboxEvent)
      .where(
        and(
          eq(outboxEvent.eventType, WORKSPACE_FILE_STORAGE_CLEANUP_OUTBOX_EVENT),
          inArray(sql<string>`${outboxEvent.payload}::jsonb ->> 'key'`, releasedKeys)
        )
      )
    expect(events.map((event) => (event.payload as { key: string }).key).sort()).toEqual(
      [...releasedKeys].sort()
    )
    await db.delete(outboxEvent).where(
      inArray(
        outboxEvent.id,
        events.map((event) => event.id)
      )
    )
  })

  it('prunes superseded versions past retention but always keeps the newest ten', async () => {
    const fixture = await seedFile('v1')
    for (let index = 2; index <= 13; index++) {
      await updateWorkspaceFileContent(
        fixture.workspaceId,
        fixture.fileId,
        fixture.aliceId,
        Buffer.from(`v${index}`),
        undefined,
        { version: { source: 'api', authorUserId: fixture.aliceId } }
      )
    }
    await db
      .update(workspaceFileVersion)
      .set({ supersededAt: sql`now() - interval '400 days'` })
      .where(
        sql`${workspaceFileVersion.fileId} = ${fixture.fileId} AND ${workspaceFileVersion.supersededAt} IS NOT NULL`
      )

    const prunedKeys = (await versionRows(fixture.fileId))
      .filter((row) => row.version <= 3)
      .map((row) => row.key)

    await runCleanupFileVersions({
      plan: 'pro',
      workspaceIds: [fixture.workspaceId],
      retentionHours: 180 * 24,
      label: 'file-versions-integration',
    })

    const rows = await versionRows(fixture.fileId)
    expect(rows.map((row) => row.version)).toEqual([4, 5, 6, 7, 8, 9, 10, 11, 12, 13])
    expect(rows.at(-1)?.supersededAt).toBeNull()
    const events = await db
      .select({ id: outboxEvent.id })
      .from(outboxEvent)
      .where(
        and(
          eq(outboxEvent.eventType, WORKSPACE_FILE_STORAGE_CLEANUP_OUTBOX_EVENT),
          inArray(sql<string>`${outboxEvent.payload}::jsonb ->> 'key'`, prunedKeys)
        )
      )
    expect(events).toHaveLength(prunedKeys.length)
    await db.delete(outboxEvent).where(
      inArray(
        outboxEvent.id,
        events.map((event) => event.id)
      )
    )
  })
})
