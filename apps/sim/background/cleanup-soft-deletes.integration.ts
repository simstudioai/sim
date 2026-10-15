/**
 * Retention cleanup of deleted owned bodies (test sources, release notes) against the disposable TEST_DATABASE_URL database:
 * the foreign keys, the storage ledger, and the deletes all run for real.
 */
import { readTestDatabaseUrl } from '@sim/db/testing/test-infrastructure'
import { generateId } from '@sim/utils/id'
import postgres from 'postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { runCleanupSoftDeletes } from '@/background/cleanup-soft-deletes'

const control = postgres(readTestDatabaseUrl(), { max: 2, onnotice: () => {} })
const userId = generateId()
const workspaceId = generateId()
const expired = '2020-01-01T00:00:00Z'

async function seedTest(deletedAt: string | null, sizeBytes: number) {
  const fileId = generateId()
  const testId = generateId()
  await control`INSERT INTO workspace_files (id, key, user_id, workspace_id, context, original_name, content_type, size_bytes, deleted_at)
    VALUES (${fileId}, ${`test/${workspaceId}/${fileId}`}, ${userId}, ${workspaceId}, 'test',
      ${`${testId}.test.js`}, 'text/javascript', ${sizeBytes}, ${deletedAt})`
  await control`INSERT INTO workflow_test (id, workspace_id, name, title, body_file_id, source_hash, deleted_at)
    VALUES (${testId}, ${workspaceId}, ${testId}, 'Fixture', ${fileId}, 'hash', ${deletedAt})`
  await control`INSERT INTO workflow_test_run (id, test_id, workspace_id, version, triggered_by_actor)
    VALUES (${generateId()}, ${testId}, ${workspaceId}, 'draft', ${control.json({ type: 'user' })})`
  return { fileId, testId }
}

async function seedRelease(deletedAt: string | null, sizeBytes: number, patch: number) {
  const fileId = generateId()
  const releaseId = generateId()
  await control`INSERT INTO workspace_files (id, key, user_id, workspace_id, context, original_name, content_type, size_bytes, deleted_at)
    VALUES (${fileId}, ${`changelog/${workspaceId}/${fileId}`}, ${userId}, ${workspaceId}, 'changelog',
      ${`${releaseId}.md`}, 'text/markdown', ${sizeBytes}, ${deletedAt})`
  await control`INSERT INTO changelog_release (id, workspace_id, title, version_major, version_minor, version_patch, bump_reason, body_file_id)
    VALUES (${releaseId}, ${workspaceId}, 'Fixture', 1, 0, ${patch}, 'fixture', ${fileId})`
  await control`INSERT INTO changelog_change (id, release_id, position, text)
    VALUES (${generateId()}, ${releaseId}, 0, 'fixture change')`
  await control`UPDATE workspace SET storage_used_bytes = storage_used_bytes + ${sizeBytes} WHERE id = ${workspaceId}`
  await control`UPDATE user_stats SET storage_used_bytes = storage_used_bytes + ${sizeBytes} WHERE user_id = ${userId}`
  return { fileId, releaseId }
}

describe('Retention cleanup of deleted owned bodies', () => {
  beforeAll(async () => {
    await control.begin(async (tx) => {
      await tx`INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at)
        VALUES (${userId}, 'Test cleanup fixture', ${`${userId}@example.test`}, true, now(), now())`
      await tx`INSERT INTO user_stats (id, user_id, storage_used_bytes)
        VALUES (${generateId()}, ${userId}, 100)`
      await tx`INSERT INTO project (id, name, owner_id)
        VALUES (${workspaceId}, 'Test cleanup project', ${userId})`
      await tx`INSERT INTO workspace (id, project_id, name, owner_id, billed_account_user_id, storage_used_bytes)
        VALUES (${workspaceId}, ${workspaceId}, 'Test cleanup fixtures', ${userId}, ${userId}, 100)`
    })
  })

  afterAll(async () => {
    try {
      await control.begin(async (tx) => {
        await tx`DELETE FROM workspace WHERE id = ${workspaceId}`
        await tx`DELETE FROM project WHERE id = ${workspaceId} AND owner_id = ${userId}`
        await tx`DELETE FROM "user" WHERE id = ${userId}`
      })
    } finally {
      await control.end()
    }
  })

  it('purges an expired test with its source and releases the source bytes', async () => {
    const deleted = await seedTest(expired, 40)
    const live = await seedTest(null, 60)

    await runCleanupSoftDeletes({
      label: 'tests-integration',
      plan: 'free',
      retentionHours: 24,
      workspaceIds: [workspaceId],
    })

    const tests = await control<
      { id: string }[]
    >`SELECT id FROM workflow_test WHERE workspace_id = ${workspaceId}`
    expect(tests.map(({ id }) => id)).toEqual([live.testId])
    const files = await control<
      { id: string }[]
    >`SELECT id FROM workspace_files WHERE workspace_id = ${workspaceId}`
    expect(files.map(({ id }) => id)).toEqual([live.fileId])
    const runs = await control`SELECT 1 FROM workflow_test_run WHERE test_id = ${deleted.testId}`
    expect(runs).toHaveLength(0)
    const [ws] = await control<
      { storage_used_bytes: number }[]
    >`SELECT storage_used_bytes::int FROM workspace WHERE id = ${workspaceId}`
    expect(ws.storage_used_bytes).toBe(60)
    const [stats] = await control<
      { storage_used_bytes: number }[]
    >`SELECT storage_used_bytes::int FROM user_stats WHERE user_id = ${userId}`
    expect(stats.storage_used_bytes).toBe(60)
  })

  it('purges an expired release body with its release and releases the body bytes', async () => {
    const [before] = await control<
      { storage_used_bytes: number }[]
    >`SELECT storage_used_bytes::int FROM workspace WHERE id = ${workspaceId}`
    const deleted = await seedRelease(expired, 25, 0)
    const live = await seedRelease(null, 10, 1)

    await runCleanupSoftDeletes({
      label: 'changelog-integration',
      plan: 'free',
      retentionHours: 24,
      workspaceIds: [workspaceId],
    })

    const releases = await control<
      { id: string }[]
    >`SELECT id FROM changelog_release WHERE workspace_id = ${workspaceId}`
    expect(releases.map(({ id }) => id)).toEqual([live.releaseId])
    const changes =
      await control`SELECT 1 FROM changelog_change WHERE release_id = ${deleted.releaseId}`
    expect(changes).toHaveLength(0)
    const bodies = await control`SELECT 1 FROM workspace_files WHERE id = ${deleted.fileId}`
    expect(bodies).toHaveLength(0)
    const [ws] = await control<
      { storage_used_bytes: number }[]
    >`SELECT storage_used_bytes::int FROM workspace WHERE id = ${workspaceId}`
    expect(ws.storage_used_bytes).toBe(before.storage_used_bytes + 10)
  })
})
