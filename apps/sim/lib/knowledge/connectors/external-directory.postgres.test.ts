/** @vitest-environment node */
import type postgres from 'postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createEnterpriseSearchMigrationFixture } from '@/lib/knowledge/__integration__/migration-fixture'

const databaseUrl = process.env.KNOWLEDGE_ACL_TEST_DATABASE_URL

describe.runIf(Boolean(databaseUrl))('external directory migration in PostgreSQL', () => {
  let client: ReturnType<typeof postgres>
  let fixture: Awaited<ReturnType<typeof createEnterpriseSearchMigrationFixture>>
  beforeAll(async () => {
    fixture = await createEnterpriseSearchMigrationFixture(databaseUrl!)
    client = fixture.client
  })
  afterAll(async () => {
    await fixture?.cleanup()
  })
  it('replays without losing completion, enforces tenant uniqueness, and cascades workspace removal', async () => {
    await fixture.migrate()
    await client`INSERT INTO workspace(id) VALUES ('workspace')`
    await client`INSERT INTO knowledge_external_directory(workspace_id, provider_id, tenant_id, last_started_at, last_complete_sync_at)
      VALUES ('workspace', 'google-drive', 'corp.com', now(), now())`
    await fixture.migrate()
    expect(
      await client`SELECT last_complete_sync_at IS NOT NULL AS complete FROM knowledge_external_directory`
    ).toEqual([{ complete: true }])
    await expect(client`INSERT INTO knowledge_external_directory(workspace_id, provider_id, tenant_id)
      VALUES ('workspace', 'google-drive', 'corp.com')`).rejects.toMatchObject({ code: '23505' })
    await client`INSERT INTO knowledge_external_directory(workspace_id, provider_id, tenant_id)
      VALUES ('workspace', 'google-drive', 'other.com'), ('workspace', 'confluence', 'corp.com')`
    await client`DELETE FROM workspace WHERE id = 'workspace'`
    expect(await client`SELECT count(*)::int AS count FROM knowledge_external_directory`).toEqual([
      { count: 0 },
    ])
  })
})
