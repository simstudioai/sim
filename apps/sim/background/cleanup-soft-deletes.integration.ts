/**
 * Retention cleanup of deleted workflow tests against the disposable TEST_DATABASE_URL database:
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

describe('Retention cleanup of deleted workflow tests', () => {
  beforeAll(async () => {
    await control`INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at)
      VALUES (${userId}, 'Test cleanup fixture', ${`${userId}@example.test`}, true, now(), now())`
    await control`INSERT INTO user_stats (id, user_id, storage_used_bytes)
      VALUES (${generateId()}, ${userId}, 100)`
    await control`INSERT INTO workspace (id, name, owner_id, billed_account_user_id, storage_used_bytes)
      VALUES (${workspaceId}, 'Test cleanup fixtures', ${userId}, ${userId}, 100)`
  })

  afterAll(async () => {
    await control`DELETE FROM workspace WHERE id = ${workspaceId}`
    await control`DELETE FROM "user" WHERE id = ${userId}`
    await control.end()
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
})
