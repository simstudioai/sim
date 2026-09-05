/** @vitest-environment node */
import type postgres from 'postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createEnterpriseSearchMigrationFixture } from '@/lib/knowledge/__integration__/migration-fixture'

const databaseUrl = process.env.KNOWLEDGE_ACL_TEST_DATABASE_URL

describe.runIf(Boolean(databaseUrl))('workspace search identity migration in PostgreSQL', () => {
  let client: ReturnType<typeof postgres>
  let fixture: Awaited<ReturnType<typeof createEnterpriseSearchMigrationFixture>>

  beforeAll(async () => {
    fixture = await createEnterpriseSearchMigrationFixture(databaseUrl!)
    client = fixture.client
    await client.unsafe(`
      INSERT INTO credential_group(id, workspace_id, name) VALUES ('curated', 'workspace-1', 'Workspace accounts');
      INSERT INTO knowledge_base(id, workspace_id, name)
      SELECT 'index-' || n, 'workspace-' || n, 'Sim Search' FROM generate_series(1, 1001) n;
      INSERT INTO knowledge_base(id, workspace_id, name, deleted_at) VALUES
        ('archived', 'archived-workspace', 'Sim Search', now()),
        ('ordinary', 'ordinary-workspace', 'Team docs', null),
        ('legacy-personal', null, 'Sim Search', null);
    `)
  })

  afterAll(async () => {
    await fixture?.cleanup()
  })

  it('backfills across batches, preserves renamed identity, enforces uniqueness, and replays safely', async () => {
    await fixture.migrate()
    await client`INSERT INTO knowledge_connector_member_sync_log(id, status)
      VALUES ('continued', 'partial'), ('old-worker', 'completed')`
    await expect(client`INSERT INTO knowledge_connector_member_sync_log(id, status)
      VALUES ('invalid', 'unknown')`).rejects.toMatchObject({ code: '23514' })
    expect(
      await client`SELECT count(*)::int AS count FROM knowledge_base WHERE is_search_index`
    ).toEqual([{ count: 1001 }])
    expect(
      await client`SELECT id FROM knowledge_base WHERE NOT is_search_index ORDER BY id`
    ).toEqual([{ id: 'archived' }, { id: 'legacy-personal' }, { id: 'ordinary' }])
    await client`UPDATE knowledge_base SET name = 'Company knowledge' WHERE id = 'index-1'`
    await expect(client`
      INSERT INTO knowledge_base(id, workspace_id, name, is_search_index)
      VALUES ('duplicate', 'workspace-1', 'Another index', true)
    `).rejects.toMatchObject({ code: '23505' })
    await client`INSERT INTO knowledge_base(id, workspace_id, name)
      VALUES ('old-writer', 'workspace-1', 'Sim Search')`
    await fixture.migrate()
    expect(
      await client`SELECT id, name FROM knowledge_base
      WHERE workspace_id = 'workspace-1' AND is_search_index`
    ).toEqual([{ id: 'index-1', name: 'Company knowledge' }])
    expect(
      await client`SELECT is_search_index FROM knowledge_base WHERE id = 'old-writer'`
    ).toEqual([{ is_search_index: false }])
    await client`UPDATE knowledge_base SET deleted_at = now() WHERE id = 'index-1'`
    await client`UPDATE knowledge_base SET is_search_index = true WHERE id = 'old-writer'`
    expect(
      await client`SELECT id FROM knowledge_base
      WHERE workspace_id = 'workspace-1' AND is_search_index AND deleted_at IS NULL`
    ).toEqual([{ id: 'old-writer' }])
  })

  it('enforces one container per workspace regardless of its name or status', async () => {
    await client`UPDATE credential_group SET status = 'disabled', name = 'Connected accounts' WHERE id = 'curated'`
    await expect(client`INSERT INTO credential_group(id, workspace_id, name)
      VALUES ('duplicate', 'workspace-1', 'Another container')`).rejects.toMatchObject({
      code: '23505',
    })
    await client`INSERT INTO credential_group(id, workspace_id, name)
      VALUES ('other', 'workspace-2', 'Connected accounts')`
    await fixture.migrate()
    expect(await client`SELECT id, status FROM credential_group ORDER BY id`).toEqual([
      { id: 'curated', status: 'disabled' },
      { id: 'other', status: 'active' },
    ])
  })

  it('replaces the connector index without losing historical source lookup or replay safety', async () => {
    await client`INSERT INTO document(id, connector_id, external_id) VALUES
      ('historical', 'source', 'file'), ('current', 'source', 'file')`
    await fixture.migrate()
    await fixture.migrate()
    const indexes = await client`SELECT indexname, indexdef FROM pg_indexes
      WHERE schemaname = current_schema() AND tablename = 'document'`
    expect(indexes.find((index) => index.indexname === 'doc_connector_id_idx')).toBeUndefined()
    expect(
      indexes.find((index) => index.indexname === 'doc_connector_source_lookup_idx')?.indexdef
    ).toContain('(connector_id, external_id)')
    expect(
      await client`SELECT id FROM document WHERE connector_id = 'source'
      AND external_id = 'file' ORDER BY id`
    ).toEqual([{ id: 'current' }, { id: 'historical' }])
  })

  it('replaces text-tag indexes while preserving case-insensitive filters and stored values', async () => {
    await client`INSERT INTO document(id, knowledge_base_id, tag1) VALUES
      ('mixed-case', 'tags', 'Engineering'), ('other-base', 'elsewhere', 'engineering')`
    await client`INSERT INTO embedding(id, document_id, knowledge_base_id, tag1) VALUES
      ('mixed-case-chunk', 'mixed-case', 'tags', 'Engineering')`
    await fixture.migrate()
    await fixture.migrate()
    const indexes = await client`SELECT indexname, indexdef FROM pg_indexes
      WHERE schemaname = current_schema() AND tablename IN ('document', 'embedding')`
    for (const prefix of ['doc', 'emb']) {
      for (let slot = 1; slot <= 7; slot++) {
        expect(
          indexes.find((index) => index.indexname === `${prefix}_tag${slot}_idx`)
        ).toBeUndefined()
        expect(
          indexes.find((index) => index.indexname === `${prefix}_kb_tag${slot}_lower_idx`)?.indexdef
        ).toContain(`(knowledge_base_id, lower(tag${slot}))`)
      }
    }
    expect(
      await client`SELECT id, tag1 FROM document WHERE knowledge_base_id = 'tags'
      AND lower(tag1) = lower('ENGINEERING')`
    ).toEqual([{ id: 'mixed-case', tag1: 'Engineering' }])
    expect(
      await client`SELECT id, tag1 FROM embedding WHERE knowledge_base_id = 'tags'
      AND lower(tag1) = lower('ENGINEERING')`
    ).toEqual([{ id: 'mixed-case-chunk', tag1: 'Engineering' }])
  })

  it('adds independent directory progress while preserving old writers and content checkpoints', async () => {
    await client`INSERT INTO knowledge_connector(id, listing_checkpoint)
      VALUES ('directory', '{"cursor":"content-page"}'::jsonb)`
    await fixture.migrate()
    expect(
      await client`SELECT directory_checkpoint FROM knowledge_connector WHERE id = 'directory'`
    ).toEqual([{ directory_checkpoint: null }])
    await client`UPDATE knowledge_connector SET directory_checkpoint = '{"cursor":"account-page"}'::jsonb
      WHERE id = 'directory'`
    await fixture.migrate()
    await client`INSERT INTO knowledge_connector(id) VALUES ('old-directory-writer')`
    expect(
      await client`SELECT listing_checkpoint, directory_checkpoint FROM knowledge_connector
      WHERE id = 'directory'`
    ).toEqual([
      {
        listing_checkpoint: { cursor: 'content-page' },
        directory_checkpoint: { cursor: 'account-page' },
      },
    ])
    expect(
      await client`SELECT directory_checkpoint FROM knowledge_connector WHERE id = 'old-directory-writer'`
    ).toEqual([{ directory_checkpoint: null }])
  })
})
