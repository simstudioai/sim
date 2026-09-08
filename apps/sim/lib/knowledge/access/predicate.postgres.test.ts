/**
 * @vitest-environment node
 */
import { readFile } from 'node:fs/promises'
import type postgres from 'postgres'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createEnterpriseSearchMigrationFixture } from '@/lib/knowledge/__integration__/migration-fixture'

vi.unmock('drizzle-orm')
vi.unmock('@sim/db/schema')
vi.mock('@/lib/knowledge/documents/service', () => ({ hardDeleteDocuments: vi.fn() }))
vi.mock('@/lib/uploads', () => ({ StorageService: {} }))
vi.mock('@/lib/uploads/core/storage-service', () => ({ deleteFile: vi.fn() }))
vi.mock('@/lib/uploads/server/metadata', () => ({ deleteFileMetadata: vi.fn() }))
vi.mock('@/connectors/registry.server', () => ({ CONNECTOR_REGISTRY: {} }))

const { drizzle } = await import('drizzle-orm/postgres-js')
const schema = await import('@sim/db/schema')
const { persistDocumentAcls } = await import('@/lib/knowledge/connectors/sync-persistence')
const { PgDialect } = await import('drizzle-orm/pg-core')
const { knowledgeAccessCondition } = await import('@/lib/knowledge/access/predicate')
const { confluencePageAcl } = await import('@/lib/knowledge/access/confluence-permissions')

/** Explicit opt-in; every table and index belongs to an isolated disposable schema. */
const databaseUrl = process.env.KNOWLEDGE_ACL_TEST_DATABASE_URL

describe.runIf(Boolean(databaseUrl))('knowledge ACLs in PostgreSQL', () => {
  let client: ReturnType<typeof postgres>
  let connection: ReturnType<typeof postgres>
  let fixture: Awaited<ReturnType<typeof createEnterpriseSearchMigrationFixture>>
  const alice = 's:confluence:tenant:alice'
  const bob = 's:confluence:tenant:bob'

  beforeAll(async () => {
    fixture = await createEnterpriseSearchMigrationFixture(databaseUrl!)
    client = fixture.client
    connection = client
    await client`INSERT INTO document(id) VALUES ('before-migration')`
    await fixture.migrate()
    const approvalMigration = await readFile(
      new URL(
        '../../../../../packages/db/migrations/0327_organization_search_approvals.sql',
        import.meta.url
      ),
      'utf8'
    )
    const [{ current_schema: schemaName }] = await client`SELECT current_schema()`
    await client.unsafe(approvalMigration.replaceAll('"public".', `"${schemaName}".`))
    expect(await readable(['ws'], 'before-migration')).toBe(true)
    await connection.unsafe("INSERT INTO document(id) VALUES ('old-writer-after-migration')")
    expect(await readable(['ws'], 'old-writer-after-migration')).toBe(true)
  })

  afterAll(async () => {
    await fixture?.cleanup()
  })

  beforeEach(async () => {
    await connection.unsafe(
      'TRUNCATE document, knowledge_connector, knowledge_connector_member, knowledge_document_observation, embedding'
    )
    await connection.unsafe(
      "INSERT INTO knowledge_connector(id, access_mode) VALUES ('admin', 'admin'), ('members', 'members')"
    )
  })

  async function readable(tokens: string[], documentId: string, join = false): Promise<boolean> {
    const query = new PgDialect().sqlToQuery(
      knowledgeAccessCondition({ kind: 'user', userId: 'reader', tokens })
    )
    const values = query.params.map((value: unknown) => {
      if (typeof value === 'string' || typeof value === 'number') return value
      throw new Error('The access predicate must bind scalar strings and numbers')
    })
    const rows = await connection.unsafe(
      `SELECT document.id FROM document ${join ? 'JOIN embedding ON embedding.document_id = document.id' : ''}
       WHERE ${query.sql} AND document.id = $${values.length + 1}`,
      [...values, documentId]
    )
    return rows.length > 0
  }

  async function putDocument(id: string, acl: string[], requirements: string[][] = []) {
    await connection.unsafe(
      `INSERT INTO document(id, connector_id, acl, acl_requirements, acl_verified_at)
       VALUES ($1, 'admin', string_to_array($2, E'\n'), $3::text::jsonb, statement_timestamp())`,
      [id, acl.join('\n'), JSON.stringify(requirements)]
    )
  }

  it('revokes every source of one integration without changing ACLs or another organization', async () => {
    await connection.unsafe("INSERT INTO organization(id) VALUES ('approval-org'), ('other-org')")
    await connection.unsafe(
      "INSERT INTO knowledge_base(id, organization_id, name, is_search_index) VALUES ('approval-index', 'approval-org', 'Search', true), ('other-index', 'other-org', 'Search', true)"
    )
    await connection.unsafe(
      "UPDATE knowledge_connector SET knowledge_base_id = 'approval-index', connector_type = 'gmail' WHERE id = 'admin'"
    )
    await putDocument('approved-content', ['pub'])
    await connection.unsafe(
      "INSERT INTO knowledge_connector(id, knowledge_base_id, connector_type, access_mode) VALUES ('other-source', 'other-index', 'gmail', 'admin')"
    )
    await putDocument('other-content', ['pub'])
    await connection.unsafe(
      "UPDATE document SET connector_id = 'other-source' WHERE id = 'other-content'"
    )
    await connection.unsafe(
      "INSERT INTO embedding(id, document_id, content) VALUES ('approval-chunk', 'approved-content', 'synthetic approval content')"
    )
    expect(await readable(['pub'], 'approved-content')).toBe(true)
    await connection.unsafe(
      "INSERT INTO organization_search_integration(organization_id, connector_type, approved) VALUES ('approval-org', 'gmail', false)"
    )
    expect(await readable(['pub'], 'approved-content')).toBe(false)
    expect(await readable(['pub'], 'approved-content', true)).toBe(false)
    expect(await readable(['pub'], 'other-content')).toBe(true)
    await connection.unsafe(
      "UPDATE organization_search_integration SET approved = true WHERE organization_id = 'approval-org'"
    )
    expect(await readable(['pub'], 'approved-content')).toBe(true)
    expect(await readable(['pub'], 'approved-content', true)).toBe(true)
  })

  it('requires space, every ancestor, and own restrictions while allowing alternatives within each', async () => {
    const acl = confluencePageAcl({
      providerId: 'confluence',
      tenantId: 'tenant',
      spacePrincipals: [{ kind: 'group', id: 'space' }],
      restrictionChain: [
        [
          { kind: 'group', id: 'page' },
          { kind: 'user', id: 'alice', email: 'alice@corp.com' },
        ],
        null,
        [{ kind: 'group', id: 'parent' }],
        [{ kind: 'group', id: 'grandparent' }],
      ],
    })
    await putDocument('restricted', acl.acl, acl.requirements)
    const groups = ['space', 'page', 'parent', 'grandparent'].map(
      (id) => `g:confluence:tenant:${id}`
    )
    expect(await readable(groups, 'restricted')).toBe(true)
    for (let missing = 0; missing < groups.length; missing++) {
      expect(
        await readable(
          groups.filter((_, index) => index !== missing),
          'restricted'
        )
      ).toBe(false)
    }
    expect(
      await readable(
        [...groups.filter((token) => !token.endsWith(':page')), 'u:alice@corp.com'],
        'restricted'
      )
    ).toBe(false)
    expect(
      await readable(
        [...groups.filter((token) => !token.endsWith(':page')), 's:confluence:-:alice'],
        'restricted'
      )
    ).toBe(true)
    await putDocument('locked', acl.acl, [[]])
    expect(await readable(groups, 'locked')).toBe(false)
  })

  it('expires mirrored user, group and public grants, including legacy and orphaned source rows', async () => {
    for (const token of ['u:alice@corp.com', 'g:confluence:tenant:space', 'pub']) {
      await putDocument(token, [token])
      expect(await readable([token], token)).toBe(true)
      await connection.unsafe(
        "UPDATE document SET acl_verified_at = statement_timestamp() - interval '25 hours' WHERE id = $1",
        [token]
      )
      expect(await readable([token], token)).toBe(false)
      await connection.unsafe('UPDATE document SET acl_verified_at = NULL WHERE id = $1', [token])
      expect(await readable([token], token)).toBe(false)
      await connection.unsafe(
        'UPDATE document SET connector_id = NULL, acl_verified_at = statement_timestamp() WHERE id = $1',
        [token]
      )
      expect(await readable([token], token)).toBe(false)
    }
    await connection.unsafe("INSERT INTO document(id) VALUES ('upload')")
    expect(await readable(['ws'], 'upload')).toBe(true)
  })

  it('does not let one member refresh another member’s stale observation', async () => {
    await connection.unsafe(
      "INSERT INTO document(id, connector_id, acl) VALUES ('shared', 'members', string_to_array($1, ','))",
      [`${alice},${bob}`]
    )
    await connection.unsafe(
      `INSERT INTO knowledge_connector_member(id, workspace_id, connector_id, subject_token, status, member_synced_through) VALUES
      ('alice', 'workspace', 'members', $1, 'active', NULL), ('bob', 'workspace', 'members', $2, 'active', NULL)`,
      [alice, bob]
    )
    await connection.unsafe(`INSERT INTO knowledge_document_observation VALUES
      ('shared', 'alice', statement_timestamp() - interval '25 hours'),
      ('shared', 'bob', statement_timestamp())`)
    expect(await readable([alice], 'shared')).toBe(false)
    expect(await readable([bob], 'shared')).toBe(true)
    await connection.unsafe(
      "UPDATE knowledge_connector_member SET member_synced_through = statement_timestamp() WHERE id = 'alice'"
    )
    expect(await readable([alice], 'shared')).toBe(true)
    await connection.unsafe(
      "UPDATE knowledge_connector_member SET status = 'suspended' WHERE id = 'alice'"
    )
    expect(await readable([alice], 'shared')).toBe(false)
    expect(await readable(['pub', 'ws'], 'shared')).toBe(false)
  })

  it('persists current evidence and keeps every clause when a rolling-deploy writer only updates the primary ACL', async () => {
    await connection.unsafe(
      "INSERT INTO document(id, external_id, connector_id, acl) VALUES ('persisted', 'page', 'admin', '{}')"
    )
    const executor = drizzle(connection, { schema })
    const space = 'g:confluence:tenant:space'
    const page = 'g:confluence:tenant:page'
    const input = new Map([['page', { acl: [space], requirements: [[page]] }]])
    expect(await persistDocumentAcls('admin', input, executor)).toEqual({ updated: 1, rejected: 0 })
    expect(await readable([space, page], 'persisted')).toBe(true)
    expect(await readable([page], 'persisted')).toBe(false)
    await connection.unsafe("UPDATE document SET acl = string_to_array($1, E'\\n')", [page])
    expect(await readable([page], 'persisted')).toBe(false)
    expect(await readable([space, page], 'persisted')).toBe(true)
    await connection.unsafe(
      "UPDATE document SET acl_verified_at = statement_timestamp() - interval '25 hours'"
    )
    expect(await readable([space, page], 'persisted')).toBe(false)
    await persistDocumentAcls('admin', input, executor)
    expect(await readable([space, page], 'persisted')).toBe(true)
    const [stored] = await connection.unsafe(
      "SELECT jsonb_typeof(acl_requirements) AS shape, acl_requirements FROM document WHERE id = 'persisted'"
    )
    expect(stored).toEqual({ shape: 'array', acl_requirements: [[space], [page]] })
  })

  it('applies the same gate to direct document and joined chunk reads', async () => {
    await putDocument('joined', ['u:alice@corp.com'], [['g:confluence:tenant:space']])
    await connection.unsafe("INSERT INTO embedding VALUES ('chunk', 'joined', 'protected content')")
    const tokens = ['u:alice@corp.com', 'g:confluence:tenant:space']
    expect(await readable(tokens, 'joined', true)).toBe(true)
    expect(await readable(['u:alice@corp.com'], 'joined', true)).toBe(false)
    await connection.unsafe(
      "UPDATE document SET acl_verified_at = statement_timestamp() - interval '25 hours'"
    )
    expect(await readable(tokens, 'joined', true)).toBe(false)
    expect(await readable(tokens, 'joined')).toBe(false)
  })

  it('rearms automatic permission schedules in batches while preserving overdue, manual, and paused work', async () => {
    await connection.unsafe(`
      INSERT INTO knowledge_connector(id, access_mode, next_sync_at, next_member_sync_at)
      SELECT 'batch-' || n, CASE WHEN n % 2 = 0 THEN 'admin' ELSE 'members' END,
        statement_timestamp() + interval '1 day', statement_timestamp() + interval '1 day'
      FROM generate_series(1, 1001) AS n;
      INSERT INTO knowledge_connector(id, access_mode, status, sync_interval_minutes, next_sync_at)
      VALUES
        ('manual', 'admin', 'active', 0, statement_timestamp() + interval '1 day'),
        ('paused', 'admin', 'paused', 1440, statement_timestamp() + interval '1 day'),
        ('workspace', 'workspace', 'active', 1440, statement_timestamp() + interval '1 day'),
        ('overdue', 'admin', 'active', 1440, statement_timestamp() - interval '1 day');
      INSERT INTO knowledge_connector_member(id, workspace_id, connector_id, subject_token, status, next_attempt_at)
      SELECT 'member-' || n, 'workspace', 'batch-1', 'subject-' || n, 'active', statement_timestamp() + interval '1 day'
      FROM generate_series(1, 1001) AS n;
      CREATE TEMP TABLE original_schedules AS SELECT id, next_sync_at, next_member_sync_at FROM knowledge_connector;
    `)
    await fixture.migrate()
    const [actual] = await connection.unsafe(`SELECT
      (SELECT count(*)::int FROM knowledge_connector WHERE id LIKE 'batch-%'
        AND CASE WHEN access_mode = 'admin' THEN next_sync_at ELSE next_member_sync_at END
          <= statement_timestamp() + interval '1 hour') AS connector_count,
      (SELECT count(*)::int FROM knowledge_connector_member
        WHERE next_attempt_at <= statement_timestamp() + interval '1 hour') AS member_count,
      (SELECT count(*)::int FROM knowledge_connector c JOIN original_schedules o USING(id)
        WHERE c.id IN ('manual', 'paused', 'workspace', 'overdue')
          AND c.next_sync_at = o.next_sync_at) AS unchanged_count`)
    expect(actual).toEqual({ connector_count: 1001, member_count: 1001, unchanged_count: 4 })
    await connection.unsafe(
      'CREATE TEMP TABLE schedules_after_first_run AS SELECT * FROM knowledge_connector'
    )
    await fixture.migrate()
    const [replayed] =
      await connection.unsafe(`SELECT count(*)::int AS changed FROM knowledge_connector c
      JOIN schedules_after_first_run previous USING(id)
      WHERE c.next_sync_at IS DISTINCT FROM previous.next_sync_at
        OR c.next_member_sync_at IS DISTINCT FROM previous.next_member_sync_at`)
    expect(replayed.changed).toBe(0)
  })
})
