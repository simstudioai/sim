import { readFile } from 'node:fs/promises'
import { requireKnowledgeBaseOwnerMigration } from '@sim/db/script-migrations/0014_require_knowledge_base_owner'
import { generateId } from '@sim/utils/id'
import postgres, { type Sql } from 'postgres'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

const databaseUrl = process.env.KNOWLEDGE_ACL_TEST_DATABASE_URL
const tables = [
  'knowledge_base',
  'document',
  'workspace',
  'workspace_files',
  'permissions',
  'settings',
  'workflow',
  'workflow_blocks',
  'user_stats',
  'organization',
  'member',
  'subscription',
] as const

/** Exercises the deploy order against current table definitions in an isolated local schema. */
describe.runIf(Boolean(databaseUrl))('required KB ownership migration in PostgreSQL', () => {
  let admin: Sql
  let sql: Sql
  let migrationSql: string
  const schema = `kb_owner_${generateId().replaceAll('-', '')}`

  beforeAll(async () => {
    const url = new URL(databaseUrl!)
    if (
      !['localhost', '127.0.0.1'].includes(url.hostname) ||
      !url.pathname.startsWith('/sim_acl_test')
    ) {
      throw new Error('Ownership tests require a disposable local sim_acl_test database')
    }
    admin = postgres(url.toString(), { max: 1, onnotice: () => undefined })
    await admin.unsafe(`CREATE SCHEMA "${schema}"`)
    for (const table of tables) {
      await admin.unsafe(
        `CREATE TABLE "${schema}"."${table}" (LIKE public."${table}" INCLUDING DEFAULTS INCLUDING CONSTRAINTS INCLUDING INDEXES)`
      )
    }
    sql = postgres(url.toString(), {
      max: 1,
      connection: { search_path: schema },
      onnotice: () => undefined,
    })
    migrationSql = await readFile(
      new URL('../migrations/0331_knowledge_base_required_owner.sql', import.meta.url),
      'utf8'
    )
  })

  afterAll(async () => {
    await sql?.end()
    if (admin) {
      await admin.unsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
      await admin.end()
    }
  })

  beforeEach(async () => {
    await sql.unsafe(`TRUNCATE ${tables.map((table) => `"${table}"`).join(', ')}`)
    await sql`ALTER TABLE knowledge_base DROP CONSTRAINT IF EXISTS kb_owner_check`
    await sql`ALTER TABLE knowledge_base DROP CONSTRAINT IF EXISTS kb_organization_search_index_check`
    await sql`ALTER TABLE knowledge_base ADD CONSTRAINT kb_owner_check
      CHECK (num_nonnulls(workspace_id, organization_id) <= 1)`
    await sql`INSERT INTO workspace (id, name, owner_id, billed_account_user_id)
      VALUES ('workspace', 'Workspace', 'payer', 'payer')`
    await sql`INSERT INTO permissions (id, user_id, entity_type, entity_id, permission_type)
      VALUES ('access', 'creator', 'workspace', 'workspace', 'write')`
  })

  async function applyDdl() {
    await sql.begin((tx) => tx.unsafe(migrationSql))
  }

  it('refuses missing/ambiguous owners and non-search org KBs while existing scoped writers keep working', async () => {
    await applyDdl()
    await applyDdl()
    await requireKnowledgeBaseOwnerMigration.up(sql)
    await expect(sql`INSERT INTO knowledge_base (id, user_id, name)
      VALUES ('missing', 'creator', 'Missing')`).rejects.toMatchObject({ code: '23514' })
    await expect(sql`INSERT INTO knowledge_base (id, user_id, name, workspace_id, organization_id, is_search_index)
      VALUES ('both', 'creator', 'Both', 'workspace', 'org', true)`).rejects.toMatchObject({
      code: '23514',
    })
    await expect(sql`INSERT INTO knowledge_base (id, user_id, name, organization_id)
      VALUES ('ordinary-org', 'creator', 'Ordinary', 'org')`).rejects.toMatchObject({
      code: '23514',
    })
    await sql`INSERT INTO knowledge_base (id, user_id, name, workspace_id)
      VALUES ('workspace-kb', 'creator', 'Docs', 'workspace')`
    await sql`INSERT INTO knowledge_base (id, user_id, name, organization_id, is_search_index)
      VALUES ('org-kb', 'creator', 'Search', 'org', true)`
    await expect(
      sql`UPDATE knowledge_base SET workspace_id = NULL WHERE id = 'workspace-kb'`
    ).rejects.toMatchObject({ code: '23514' })
    await expect(
      sql`UPDATE knowledge_base SET is_search_index = false WHERE id = 'org-kb'`
    ).rejects.toMatchObject({ code: '23514' })
    await requireKnowledgeBaseOwnerMigration.up(sql)
    expect(
      await sql`SELECT convalidated FROM pg_constraint
      WHERE conrelid = 'knowledge_base'::regclass
      AND conname IN ('kb_owner_check', 'kb_organization_search_index_check')`
    ).toEqual([{ convalidated: true }, { convalidated: true }])
  })

  it('repairs archived KBs without restoring/renaming them, accounts to the workspace payer, and replays', async () => {
    const archivedAt = new Date('2025-06-01T00:00:00Z')
    await sql`INSERT INTO knowledge_base (id, user_id, name, workspace_id)
      VALUES ('existing', 'creator', 'Docs', 'workspace')`
    await sql`INSERT INTO knowledge_base (id, user_id, name, deleted_at)
      VALUES ('archived', 'creator', 'Docs', ${archivedAt})`
    await sql`INSERT INTO document (id, knowledge_base_id, filename, file_url, file_size, mime_type, archived_at)
      VALUES ('retained', 'archived', 'fixture.txt', 'data:text/plain,fixture', 24, 'text/plain', ${archivedAt})`
    await sql`INSERT INTO workspace (id, name, owner_id, billed_account_user_id, archived_at)
      VALUES ('archived-workspace', 'Archived workspace', 'other', 'other', ${archivedAt})`
    await sql`INSERT INTO permissions (id, user_id, entity_type, entity_id, permission_type)
      VALUES ('archived-access', 'other', 'workspace', 'archived-workspace', 'admin')`
    await sql`INSERT INTO knowledge_base (id, user_id, name, deleted_at)
      VALUES ('archived-only-destination', 'other', 'Retained', ${archivedAt})`
    const [{ deleted_at: persistedArchivedAt }] =
      await sql`SELECT deleted_at FROM knowledge_base WHERE id = 'archived'`
    await applyDdl()
    await requireKnowledgeBaseOwnerMigration.up(sql)
    await requireKnowledgeBaseOwnerMigration.up(sql)
    expect(
      await sql`SELECT workspace_id, name, deleted_at FROM knowledge_base WHERE id = 'archived'`
    ).toEqual([{ workspace_id: 'workspace', name: 'Docs', deleted_at: persistedArchivedAt }])
    expect(await sql`SELECT archived_at FROM document WHERE id = 'retained'`).toEqual([
      { archived_at: persistedArchivedAt },
    ])
    expect(
      await sql`SELECT workspace_id, deleted_at FROM knowledge_base WHERE id = 'archived-only-destination'`
    ).toEqual([{ workspace_id: 'archived-workspace', deleted_at: persistedArchivedAt }])
    expect(
      await sql`SELECT storage_used_bytes::int AS bytes FROM workspace WHERE id = 'workspace'`
    ).toEqual([{ bytes: 24 }])
    expect(
      await sql`SELECT storage_used_bytes::int AS bytes FROM user_stats WHERE user_id = 'payer'`
    ).toEqual([{ bytes: 24 }])
    expect(
      await sql`SELECT storage_used_bytes::int AS bytes FROM user_stats WHERE user_id = 'creator'`
    ).toEqual([{ bytes: 0 }])
  })

  it('does not validate until an unresolvable active row is manually repaired', async () => {
    await sql`INSERT INTO knowledge_base (id, user_id, name) VALUES ('unresolved', 'unknown', 'Docs')`
    await applyDdl()
    await expect(requireKnowledgeBaseOwnerMigration.up(sql)).rejects.toThrow('manual repair')
    expect(
      await sql`SELECT convalidated FROM pg_constraint
      WHERE conrelid = 'knowledge_base'::regclass AND conname = 'kb_owner_check'`
    ).toEqual([{ convalidated: true }])
    await sql`UPDATE knowledge_base SET workspace_id = 'workspace' WHERE id = 'unresolved'`
    await requireKnowledgeBaseOwnerMigration.up(sql)
    expect(
      await sql`SELECT convalidated FROM pg_constraint
      WHERE conrelid = 'knowledge_base'::regclass AND conname = 'kb_owner_check'`
    ).toEqual([{ convalidated: true }])
  })
})
