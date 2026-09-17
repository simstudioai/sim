import { readFileSync } from 'node:fs'
import path from 'node:path'
import { repairWorkspaceFileContentRevisions } from '@sim/db/script-migrations/0018_repair_workspace_file_content_revision'
import { generateId } from '@sim/utils/id'
import postgres, { type Sql } from 'postgres'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

const databaseUrl = process.env.KNOWLEDGE_ACL_TEST_DATABASE_URL
const MICROSECOND_REVISION = '2026-08-01 03:30:51.566952'
const MILLISECOND_REVISION = '2026-08-01 03:30:51.566'
const MIGRATIONS = path.join(__dirname, '../migrations')

/** Applies the statements of a shipped migration that `matches` selects, against the scratch schema. */
async function applyMigration(
  sql: Sql,
  file: string,
  matches: (statement: string) => boolean
): Promise<void> {
  const statements = readFileSync(path.join(MIGRATIONS, file), 'utf8')
    .split('--> statement-breakpoint')
    .map((statement) => statement.trim())
    .filter(matches)
  if (statements.length === 0) throw new Error(`No statements matched in ${file}`)
  for (const statement of statements) await sql.unsafe(statement)
}

describe.runIf(Boolean(databaseUrl))('workspace file content revision repair in PostgreSQL', () => {
  let sql: Sql
  let admin: Sql
  const schemaName = `revision_repair_${generateId().replaceAll('-', '')}`

  beforeAll(async () => {
    const url = new URL(databaseUrl!)
    if (
      !['localhost', '127.0.0.1'].includes(url.hostname) ||
      (!url.pathname.startsWith('/sim_acl_test') && url.pathname !== '/sim_auth_scim')
    ) {
      throw new Error('Repair tests require a disposable local integration database')
    }
    admin = postgres(url.toString(), { max: 1, onnotice: () => undefined })
    await admin.unsafe(`CREATE SCHEMA "${schemaName}"`)
    sql = postgres(url.toString(), {
      max: 2,
      onnotice: () => undefined,
      connection: { search_path: schemaName, TimeZone: 'UTC' },
    })
    await sql`CREATE TABLE workspace_files (
      id text PRIMARY KEY, workspace_id text, context text NOT NULL, deleted_at timestamp,
      content_updated_at timestamp NOT NULL DEFAULT now(), secret_provenance_version integer
    )`
    await sql`CREATE TABLE workspace_file_secret_provenance (
      file_id text PRIMARY KEY REFERENCES workspace_files(id) ON DELETE CASCADE,
      content_updated_at timestamp NOT NULL, status text NOT NULL,
      entries jsonb NOT NULL DEFAULT '[]', updated_at timestamp NOT NULL DEFAULT now()
    )`
    await sql`CREATE TABLE workspace_file_search_index (
      file_id text NOT NULL, workspace_id text NOT NULL, source_content_updated_at timestamp NOT NULL,
      status text NOT NULL DEFAULT 'pending', partial boolean NOT NULL DEFAULT false,
      failure_reason text, line_count integer NOT NULL DEFAULT 0,
      indexed_bytes integer NOT NULL DEFAULT 0, dispatched_at timestamp,
      created_at timestamp NOT NULL DEFAULT now(), updated_at timestamp NOT NULL DEFAULT now(),
      PRIMARY KEY (file_id, source_content_updated_at)
    )`
    await sql`CREATE TABLE workspace_file_search_segment (
      file_id text NOT NULL, workspace_id text NOT NULL, source_content_updated_at timestamp NOT NULL,
      line_number integer NOT NULL, segment_number integer NOT NULL, content text NOT NULL,
      line_length integer NOT NULL DEFAULT 0, segment_start integer NOT NULL DEFAULT 0,
      PRIMARY KEY (file_id, source_content_updated_at, line_number, segment_number)
    )`
    await sql`CREATE TABLE workspace_file_search_dispatch_queue (
      workspace_id text PRIMARY KEY, enqueued_at timestamp NOT NULL DEFAULT now(),
      updated_at timestamp NOT NULL DEFAULT now(), last_dispatched_at timestamp
    )`
    await applyMigration(
      sql,
      '0313_puzzling_zodiak.sql',
      (statement) =>
        statement.includes('workspace_file_search_mark_pending') &&
        (statement.startsWith('CREATE OR REPLACE FUNCTION') ||
          statement.startsWith('CREATE TRIGGER'))
    )
    await applyMigration(
      sql,
      '0283_military_fabian_cortez.sql',
      (statement) =>
        statement.includes('FUNCTION "demote_secret_provenance_version"') &&
        statement.includes('CREATE OR REPLACE')
    )
    await sql`CREATE TRIGGER workspace_files_secret_provenance_demote
      BEFORE UPDATE OF content_updated_at ON workspace_files FOR EACH ROW
      WHEN (OLD.content_updated_at IS DISTINCT FROM NEW.content_updated_at)
      EXECUTE FUNCTION demote_secret_provenance_version()`
    await applyMigration(
      sql,
      '0357_workspace_file_content_version_precision.sql',
      (statement) =>
        statement.includes('content_version_millisecond') ||
        statement.includes('SET DEFAULT date_trunc')
    )
  })

  beforeEach(async () => {
    await sql`TRUNCATE workspace_files, workspace_file_secret_provenance,
      workspace_file_search_index, workspace_file_search_segment,
      workspace_file_search_dispatch_queue`
  })

  afterAll(async () => {
    try {
      await admin?.unsafe(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`)
    } finally {
      await sql?.end()
      await admin?.end()
    }
  })

  /**
   * Seeds a row that predates the 0357 trigger, which would otherwise normalize it on the way in.
   * Timestamps go in as SQL literals: the driver serializes a bound `timestamp` parameter through a
   * JavaScript `Date`, which is the very truncation under test.
   */
  async function seedLegacyFile(options: {
    id: string
    context: string
    deleted?: boolean
    provenance?: number
  }) {
    const deletedAt = options.deleted ? `TIMESTAMP '2026-09-01 00:00:00'` : 'NULL'
    const provenance = options.provenance ?? 'NULL'
    await sql`ALTER TABLE workspace_files DISABLE TRIGGER USER`
    await sql.unsafe(`INSERT INTO workspace_files
      (id, workspace_id, context, deleted_at, content_updated_at, secret_provenance_version)
      VALUES ('${options.id}', 'legacy-workspace', '${options.context}', ${deletedAt},
        TIMESTAMP '${MICROSECOND_REVISION}', ${provenance})`)
    await sql`ALTER TABLE workspace_files ENABLE TRIGGER USER`
  }

  async function seedSidecar(fileId: string, revision: string) {
    await sql.unsafe(`INSERT INTO workspace_file_secret_provenance
      (file_id, content_updated_at, status)
      VALUES ('${fileId}', TIMESTAMP '${revision}', 'exact')`)
  }

  async function seedIndexRow(fileId: string, revision: string, dispatched: boolean) {
    await sql.unsafe(`INSERT INTO workspace_file_search_index
      (file_id, workspace_id, source_content_updated_at, status, dispatched_at)
      VALUES ('${fileId}', 'legacy-workspace', TIMESTAMP '${revision}', 'pending',
        ${dispatched ? 'now()' : 'NULL'})`)
  }

  async function revisionOf(fileId: string): Promise<string> {
    const [row] = await sql<{ revision: string }[]>`SELECT content_updated_at::text AS revision
      FROM workspace_files WHERE id = ${fileId}`
    return row.revision
  }

  it('repairs live and soft-deleted workspace rows and leaves other contexts alone', async () => {
    await seedLegacyFile({ id: 'live', context: 'workspace' })
    await seedLegacyFile({ id: 'deleted', context: 'workspace', deleted: true })
    await seedLegacyFile({ id: 'knowledge', context: 'knowledge-base' })

    const repaired = await repairWorkspaceFileContentRevisions(sql, 2)

    expect(repaired).toBe(2)
    expect(await revisionOf('live')).toBe(MILLISECOND_REVISION)
    expect(await revisionOf('deleted')).toBe(MILLISECOND_REVISION)
    expect(await revisionOf('knowledge')).toBe(MICROSECOND_REVISION)
  })

  it('keeps a tracked provenance version and realigns its sidecar', async () => {
    await seedLegacyFile({ id: 'tracked', context: 'workspace', provenance: 1 })
    await seedSidecar('tracked', MILLISECOND_REVISION)

    await repairWorkspaceFileContentRevisions(sql)

    const [row] = await sql<{ version: number; sidecarMatches: boolean }[]>`
      SELECT file.secret_provenance_version AS version,
        (sidecar.content_updated_at = file.content_updated_at) AS "sidecarMatches"
      FROM workspace_files AS file
      JOIN workspace_file_secret_provenance AS sidecar ON sidecar.file_id = file.id
      WHERE file.id = 'tracked'`
    expect(row).toEqual({ version: 1, sidecarMatches: true })
  })

  it('leaves the search index holding exactly the revision the file now records', async () => {
    await seedLegacyFile({ id: 'stranded', context: 'workspace' })
    await seedIndexRow('stranded', MILLISECOND_REVISION, false)
    await seedIndexRow('stranded', MICROSECOND_REVISION, true)
    await sql.unsafe(`INSERT INTO workspace_file_search_segment
      (file_id, workspace_id, source_content_updated_at, line_number, segment_number, content)
      VALUES ('stranded', 'legacy-workspace', TIMESTAMP '${MICROSECOND_REVISION}', 1, 1, 'orphaned')`)

    await repairWorkspaceFileContentRevisions(sql)

    const rows = await sql<{ revision: string; matchesFile: boolean }[]>`
      SELECT search_index.source_content_updated_at::text AS revision,
        (search_index.source_content_updated_at = file.content_updated_at) AS "matchesFile"
      FROM workspace_file_search_index AS search_index
      JOIN workspace_files AS file ON file.id = search_index.file_id
      WHERE search_index.file_id = 'stranded'`
    expect([...rows]).toEqual([{ revision: MILLISECOND_REVISION, matchesFile: true }])
    const [segments] = await sql<{ remaining: number }[]>`SELECT count(*)::int AS remaining
      FROM workspace_file_search_segment WHERE file_id = 'stranded'`
    expect(segments.remaining).toBe(0)
  })

  it('is a no-op on replay', async () => {
    await seedLegacyFile({ id: 'replayed', context: 'workspace', provenance: 1 })
    await seedSidecar('replayed', MILLISECOND_REVISION)
    await repairWorkspaceFileContentRevisions(sql)

    const repairedAgain = await repairWorkspaceFileContentRevisions(sql)

    expect(repairedAgain).toBe(0)
    expect(await revisionOf('replayed')).toBe(MILLISECOND_REVISION)
    const [row] = await sql<{ version: number }[]>`SELECT secret_provenance_version AS version
      FROM workspace_files WHERE id = 'replayed'`
    expect(row.version).toBe(1)
  })

  it('walks past rows it cannot repair instead of rescanning them', async () => {
    for (let index = 0; index < 5; index += 1) {
      await seedLegacyFile({ id: `file-${index}`, context: 'workspace' })
    }

    const repaired = await repairWorkspaceFileContentRevisions(sql, 2)

    expect(repaired).toBe(5)
    const [row] = await sql<{ remaining: number }[]>`SELECT count(*)::int AS remaining
      FROM workspace_files
      WHERE content_updated_at <> date_trunc('milliseconds', content_updated_at)`
    expect(row.remaining).toBe(0)
  })

  describe('the 0357 invariant', () => {
    async function insertWithDatabaseDefault(id: string) {
      await sql.unsafe(`INSERT INTO workspace_files (id, workspace_id, context)
        VALUES ('${id}', 'legacy-workspace', 'workspace')`)
    }

    async function isMillisecondPrecise(fileId: string): Promise<boolean> {
      const [row] = await sql<{ precise: boolean }[]>`SELECT
        content_updated_at = date_trunc('milliseconds', content_updated_at) AS precise
        FROM workspace_files WHERE id = ${fileId}`
      return row.precise
    }

    it('declares a truncating column default', async () => {
      const [row] = await sql<{ expression: string }[]>`SELECT column_default AS expression
        FROM information_schema.columns
        WHERE table_schema = ${schemaName} AND table_name = 'workspace_files'
          AND column_name = 'content_updated_at'`

      expect(row.expression).toContain("date_trunc('milliseconds'")
    })

    it('truncates a revision written with microsecond precision', async () => {
      await sql.unsafe(`INSERT INTO workspace_files (id, workspace_id, context, content_updated_at)
        VALUES ('explicit', 'legacy-workspace', 'workspace', TIMESTAMP '${MICROSECOND_REVISION}')`)

      expect(await revisionOf('explicit')).toBe(MILLISECOND_REVISION)
    })

    it('truncates a CURRENT_TIMESTAMP restore write', async () => {
      await insertWithDatabaseDefault('restored')

      await sql`UPDATE workspace_files
        SET content_updated_at =
          GREATEST(CURRENT_TIMESTAMP, content_updated_at + INTERVAL '1 millisecond')
        WHERE id = 'restored'`

      expect(await isMillisecondPrecise('restored')).toBe(true)
    })

    it('normalizes before provenance demotion decides whether the content changed', async () => {
      await insertWithDatabaseDefault('tracked-live')
      await sql`UPDATE workspace_files SET secret_provenance_version = 1 WHERE id = 'tracked-live'`

      await sql`UPDATE workspace_files
        SET content_updated_at = content_updated_at + INTERVAL '400 microseconds'
        WHERE id = 'tracked-live'`

      const [row] = await sql<{ version: number }[]>`SELECT secret_provenance_version AS version
        FROM workspace_files WHERE id = 'tracked-live'`
      expect(row.version).toBe(1)
    })

    it('normalizes a legacy row promoted into the workspace by a metadata-only write', async () => {
      // Materializing a chat upload sets `context` alone, so the revision is never written; without
      // normalizing here the search-index trigger would key the promoted file to an unclaimable value.
      await seedLegacyFile({ id: 'promoted', context: 'mothership', provenance: 1 })

      await sql`UPDATE workspace_files SET context = 'workspace' WHERE id = 'promoted'`

      expect(await revisionOf('promoted')).toBe(MILLISECOND_REVISION)
      const [row] = await sql<{ version: number; indexed: string | null }[]>`
        SELECT file.secret_provenance_version AS version,
          (SELECT search_index.source_content_updated_at::text
           FROM workspace_file_search_index AS search_index
           WHERE search_index.file_id = file.id) AS indexed
        FROM workspace_files AS file WHERE file.id = 'promoted'`
      expect(row.indexed).toBe(MILLISECOND_REVISION)
      expect(row.version).toBe(1)
    })

    it('still demotes provenance when the millisecond revision advances', async () => {
      await insertWithDatabaseDefault('tracked-advanced')
      await sql`UPDATE workspace_files
        SET secret_provenance_version = 1 WHERE id = 'tracked-advanced'`

      await sql`UPDATE workspace_files
        SET content_updated_at = content_updated_at + INTERVAL '1 millisecond'
        WHERE id = 'tracked-advanced'`

      const [row] = await sql<{ version: number }[]>`SELECT secret_provenance_version AS version
        FROM workspace_files WHERE id = 'tracked-advanced'`
      expect(row.version).toBeNull()
    })
  })
})
