import {
  backfillLegacyKnowledgeBaseWorkspaces,
  createPostgresLegacyKnowledgeBaseWorkspaceStore,
  type LegacyKnowledgeBaseMoveOutcome,
  selectLegacyKnowledgeBaseWorkspace,
} from '@sim/db/script-migrations/0013_backfill_legacy_knowledge_base_workspaces'
import { sleep } from '@sim/utils/helpers'
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

/** Copies current table definitions into an isolated disposable schema; no public rows are touched. */
describe.runIf(Boolean(databaseUrl))('legacy KB workspace backfill in PostgreSQL', () => {
  let sql: Sql
  let admin: Sql
  const schemaName = `kb_backfill_${generateId().replaceAll('-', '')}`
  let subject: ReturnType<typeof createPostgresLegacyKnowledgeBaseWorkspaceStore>

  beforeAll(async () => {
    const url = new URL(databaseUrl!)
    if (
      !['localhost', '127.0.0.1'].includes(url.hostname) ||
      !url.pathname.startsWith('/sim_acl_test')
    ) {
      throw new Error('Backfill tests require a disposable local sim_acl_test database')
    }
    admin = postgres(url.toString(), { max: 1, onnotice: () => undefined })
    await admin.unsafe(`CREATE SCHEMA "${schemaName}"`)
    for (const table of tables) {
      await admin.unsafe(
        `CREATE TABLE "${schemaName}"."${table}" (LIKE public."${table}" INCLUDING DEFAULTS INCLUDING CONSTRAINTS INCLUDING INDEXES)`
      )
    }
    sql = postgres(url.toString(), {
      max: 2,
      connection: { search_path: schemaName },
      onnotice: () => undefined,
    })
    /** Reproduce the pre-0014 schema so this historical backfill can seed unscoped rows. */
    await sql`ALTER TABLE knowledge_base DROP CONSTRAINT kb_owner_check`
    await sql`ALTER TABLE knowledge_base ADD CONSTRAINT kb_owner_check
      CHECK (num_nonnulls(workspace_id, organization_id) <= 1)`
    subject = createPostgresLegacyKnowledgeBaseWorkspaceStore(sql)
  })

  afterAll(async () => {
    await sql?.end()
    if (admin) {
      await admin.unsafe(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`)
      await admin.end()
    }
  })

  beforeEach(async () => {
    await sql.unsafe(`TRUNCATE ${tables.map((table) => `"${table}"`).join(', ')}`)
  })

  async function workspace(
    id: string,
    payer = 'owner',
    role: 'write' | 'admin' | 'read' = 'admin'
  ) {
    await sql`INSERT INTO workspace (id, name, owner_id, billed_account_user_id) VALUES (${id}, ${id}, ${payer}, ${payer})`
    await sql`INSERT INTO permissions (id, user_id, entity_type, entity_id, permission_type)
      VALUES (${generateId()}, 'owner', 'workspace', ${id}, ${role})`
  }

  async function kb(id = 'kb', name = 'Docs', workspaceId: string | null = null) {
    await sql`INSERT INTO knowledge_base (id, user_id, name, workspace_id) VALUES (${id}, 'owner', ${name}, ${workspaceId})`
  }

  async function document(
    kbId: string,
    size: number,
    options: { archived?: boolean; deleted?: boolean; connector?: boolean; key?: string } = {}
  ) {
    await sql`INSERT INTO document (id, knowledge_base_id, filename, file_url, file_size, mime_type, archived_at, deleted_at, connector_id, storage_key)
      VALUES (${generateId()}, ${kbId}, 'fixture.txt', 'data:text/plain,fixture', ${size}, 'text/plain',
        ${options.archived ? new Date() : null}, ${options.deleted ? new Date() : null},
        ${options.connector ? 'fixture-connector' : null}, ${options.key ?? null})`
  }

  async function workflow(workspaceId: string, runs: number, kbId?: string, enabled = true) {
    const id = generateId()
    await sql`INSERT INTO workflow (id, user_id, workspace_id, name, last_synced, created_at, updated_at, run_count, last_run_at)
      VALUES (${id}, 'collaborator', ${workspaceId}, ${id}, now(), now(), now(), ${runs}, now())`
    if (kbId) {
      await sql`INSERT INTO workflow_blocks (id, workflow_id, type, name, position_x, position_y, enabled, sub_blocks)
        VALUES (${generateId()}, ${id}, 'knowledge', 'Knowledge', 0, 0, ${enabled},
          ${sql.json({ knowledgeBaseSelector: { value: kbId } })})`
    }
    return id
  }

  async function scopedKb(id = 'kb') {
    const [row] = await sql`SELECT workspace_id, name FROM knowledge_base WHERE id = ${id}`
    return row
  }

  async function userBytes(id: string) {
    const [row] = await sql`SELECT storage_used_bytes FROM user_stats WHERE user_id = ${id}`
    return Number(row?.storage_used_bytes ?? 0)
  }

  it('prefers a KB reference over unrelated runs and falls back to all authors’ workflow runs', async () => {
    await workspace('referenced')
    await workspace('busy')
    await kb()
    await kb('unreferenced', 'Unreferenced')
    await workflow('referenced', 2, 'kb')
    await workflow('busy', 1000)
    expect(await selectLegacyKnowledgeBaseWorkspace(sql, 'kb')).toEqual({
      workspace_id: 'referenced',
      has_reference: true,
    })
    expect(await subject.moveCandidate('kb')).toBe('moved')
    expect(await subject.moveCandidate('unreferenced')).toBe('moved')
    expect((await scopedKb()).workspace_id).toBe('referenced')
    expect((await scopedKb('unreferenced')).workspace_id).toBe('busy')
  })

  it('ignores disabled blocks, archived workflows, archived workspaces, and read-only memberships', async () => {
    await workspace('valid')
    await workspace('archived')
    await workspace('read-only', 'owner', 'read')
    await sql`UPDATE workspace SET archived_at = now() WHERE id = 'archived'`
    await kb()
    await workflow('read-only', 1000, 'kb')
    await workflow('archived', 1000, 'kb')
    const oldWorkflow = await workflow('valid', 1000, 'kb')
    await sql`UPDATE workflow SET archived_at = now() WHERE id = ${oldWorkflow}`
    await workflow('valid', 1, 'kb', false)
    expect(await selectLegacyKnowledgeBaseWorkspace(sql, 'kb')).toEqual({
      workspace_id: 'valid',
      has_reference: false,
    })
  })

  it('uses only the active selector and recognizes legacy array selections', async () => {
    await workspace('target')
    await kb()
    const workflowId = await workflow('target', 1, 'kb')
    await sql`UPDATE workflow_blocks SET sub_blocks = ${sql.json({
      knowledgeBaseSelector: { value: 'other-kb' },
      manualKnowledgeBaseId: { value: 'kb' },
    })} WHERE workflow_id = ${workflowId}`
    expect((await selectLegacyKnowledgeBaseWorkspace(sql, 'kb'))?.has_reference).toBe(false)
    await sql`UPDATE workflow_blocks SET advanced_mode = true WHERE workflow_id = ${workflowId}`
    expect((await selectLegacyKnowledgeBaseWorkspace(sql, 'kb'))?.has_reference).toBe(true)
    await sql`UPDATE workflow_blocks SET advanced_mode = false,
      sub_blocks = ${sql.json({ knowledgeBaseSelector: { value: ['kb', 'other-kb'] } })}
      WHERE workflow_id = ${workflowId}`
    expect((await selectLegacyKnowledgeBaseWorkspace(sql, 'kb'))?.has_reference).toBe(true)
  })

  it('uses recency before last selection when successful run counts tie', async () => {
    await workspace('older')
    await workspace('recent')
    await kb()
    const olderId = await workflow('older', 5)
    await workflow('recent', 5)
    await sql`UPDATE workflow SET last_run_at = '2025-01-01' WHERE id = ${olderId}`
    expect((await selectLegacyKnowledgeBaseWorkspace(sql, 'kb'))?.workspace_id).toBe('recent')
  })

  it('skips owners without a writable workspace and never treats ownership as permission', async () => {
    await workspace('owned')
    await sql`DELETE FROM permissions`
    await kb()
    expect(await subject.moveCandidate('kb')).toBe('no_workspace')
    expect((await scopedKb()).workspace_id).toBeNull()
  })

  it('allocates unique suffixes for existing names and multiple incoming names, including a taken suffix', async () => {
    await workspace('target')
    await kb('existing', 'Docs', 'target')
    await kb('suffix', 'Docs (recovered kb)', 'target')
    await kb()
    await kb('kb2')
    expect(await subject.moveCandidate('kb')).toBe('renamed')
    expect(await subject.moveCandidate('kb2')).toBe('renamed')
    expect((await scopedKb()).name).toBe('Docs (recovered kb-2)')
    expect((await scopedKb('kb2')).name).toBe('Docs (recovered kb2)')
    expect(await subject.moveCandidate('kb')).toBe('already_scoped')
  })

  it('keeps foreign file bindings untouched and skips the KB', async () => {
    await workspace('target')
    await kb()
    await document('kb', 50, { key: 'foreign-key' })
    await sql`INSERT INTO workspace_files (id, key, user_id, workspace_id, context, original_name, content_type, size_bytes)
      VALUES ('file', 'foreign-key', 'other', 'other-workspace', 'knowledge-base', 'file.txt', 'text/plain', 50)`
    expect(await subject.moveCandidate('kb')).toBe('file_conflict')
    expect((await scopedKb()).workspace_id).toBeNull()
    expect(
      (await sql`SELECT workspace_id FROM workspace_files WHERE id = 'file'`)[0].workspace_id
    ).toBe('other-workspace')
  })

  it('reconciles stale payer counters and retains remaining legacy and archived document bytes', async () => {
    await workspace('destination', 'payer')
    await workspace('source-workspace')
    await sql`UPDATE workspace SET storage_used_bytes = 70 WHERE id = 'source-workspace'`
    await kb()
    await kb('remaining', 'Remaining')
    await document('kb', 100)
    await document('kb', 30, { archived: true })
    await document('kb', 900, { deleted: true })
    await document('kb', 900, { connector: true })
    await document('remaining', 20)
    await workflow('destination', 2, 'kb')
    await sql`INSERT INTO user_stats (id, user_id, storage_used_bytes) VALUES ('stats', 'owner', 70)`
    expect(await subject.moveCandidate('kb')).toBe('moved')
    expect(await userBytes('owner')).toBe(90)
    expect(await userBytes('payer')).toBe(130)
    expect(
      Number(
        (await sql`SELECT storage_used_bytes FROM workspace WHERE id = 'destination'`)[0]
          .storage_used_bytes
      )
    ).toBe(130)
    expect(await subject.moveCandidate('kb')).toBe('already_scoped')
    expect(await userBytes('payer')).toBe(130)
  })

  it('moves organization-billed legacy bytes without losing organization-owned documents', async () => {
    await workspace('destination', 'payer')
    await sql`INSERT INTO organization (id, name, slug) VALUES ('org', 'Org', 'org')`
    await sql`INSERT INTO member (id, user_id, organization_id, role) VALUES ('member', 'owner', 'org', 'member')`
    await sql`INSERT INTO subscription (id, reference_id, plan, status) VALUES ('sub', 'org', 'team_6000', 'active')`
    await kb()
    await kb('remaining', 'Remaining')
    await kb('org-kb', 'Org docs')
    await sql`UPDATE knowledge_base SET organization_id = 'org', is_search_index = true WHERE id = 'org-kb'`
    await document('kb', 100)
    await document('remaining', 20)
    await document('org-kb', 30)
    expect(await subject.moveCandidate('kb')).toBe('moved')
    expect(await userBytes('payer')).toBe(100)
    expect(
      Number(
        (await sql`SELECT storage_used_bytes FROM organization WHERE id = 'org'`)[0]
          .storage_used_bytes
      )
    ).toBe(50)
    expect(await subject.moveCandidate('org-kb')).toBe('already_scoped')
  })

  it('reconciles a destination organization without double-counting moved bytes', async () => {
    await workspace('destination')
    await sql`INSERT INTO organization (id, name, slug) VALUES ('org', 'Org', 'org')`
    await sql`UPDATE workspace SET organization_id = 'org' WHERE id = 'destination'`
    await kb()
    await document('kb', 100)
    expect(await subject.moveCandidate('kb')).toBe('moved')
    expect(await userBytes('owner')).toBe(0)
    expect(
      Number(
        (await sql`SELECT storage_used_bytes FROM organization WHERE id = 'org'`)[0]
          .storage_used_bytes
      )
    ).toBe(100)
  })

  it('serializes concurrent moves with the same payer and colliding names', async () => {
    await workspace('destination')
    await kb('a')
    await kb('b')
    await document('a', 100)
    await document('b', 200)
    const outcomes = await Promise.all([subject.moveCandidate('a'), subject.moveCandidate('b')])
    expect(outcomes.sort()).toEqual(['moved', 'renamed'])
    const rows = await sql`SELECT name, workspace_id FROM knowledge_base ORDER BY id`
    expect(new Set(rows.map((row) => row.name)).size).toBe(2)
    expect(rows.every((row) => row.workspace_id === 'destination')).toBe(true)
    expect(await userBytes('owner')).toBe(300)
  })

  it('waits for an application-held workspace lock instead of aborting the migration', async () => {
    await workspace('destination')
    await kb()
    await document('kb', 100)
    let markWriterReady!: (pid: number) => void
    const writerReady = new Promise<number>((resolve) => {
      markWriterReady = resolve
    })
    let releaseWriter!: () => void
    const writerReleased = new Promise<void>((resolve) => {
      releaseWriter = resolve
    })
    const writer = sql.begin(async (tx) => {
      await tx`SELECT id FROM workspace WHERE id = 'destination' FOR NO KEY UPDATE`
      const [connection] = await tx<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`
      markWriterReady(connection.pid)
      await writerReleased
    })
    let move: Promise<LegacyKnowledgeBaseMoveOutcome> | undefined
    try {
      const writerPid = await Promise.race([
        writerReady,
        writer.then(() => {
          throw new Error('Workspace writer finished before the concurrency check')
        }),
      ])
      let settled = false
      move = subject.moveCandidate('kb')
      void move.then(
        () => {
          settled = true
        },
        () => {
          settled = true
        }
      )
      let waiting = false
      const deadline = Date.now() + 2_000
      while (!settled && Date.now() < deadline) {
        const [waiter] = await admin<{ waiting: boolean }[]>`
          SELECT EXISTS (SELECT 1 FROM pg_stat_activity
            WHERE ${writerPid} = ANY(pg_blocking_pids(pid)) AND wait_event_type = 'Lock') AS waiting
        `
        if (waiter.waiting) {
          waiting = true
          break
        }
        await sleep(1)
      }
      expect(waiting, 'The migration must wait for the workspace writer').toBe(true)
      /** Real lock contention must outlast the former five-second timeout. */
      await sleep(5_100)
      expect(settled).toBe(false)
      releaseWriter()
      await writer
      expect(await move).toBe('moved')
      expect((await scopedKb()).workspace_id).toBe('destination')
      expect(await userBytes('owner')).toBe(100)
    } finally {
      releaseWriter()
      await writer
      await move?.catch(() => undefined)
    }
  }, 15_000)

  it('rolls back scope, names, and accounting together on failure and resumes safely', async () => {
    await workspace('destination')
    await kb()
    await document('kb', 100)
    await sql`ALTER TABLE workspace ADD CONSTRAINT fixture_storage_limit CHECK (storage_used_bytes < 50)`
    try {
      await expect(subject.moveCandidate('kb')).rejects.toThrow()
      expect((await scopedKb()).workspace_id).toBeNull()
      expect(await userBytes('owner')).toBe(0)
    } finally {
      await sql`ALTER TABLE workspace DROP CONSTRAINT fixture_storage_limit`
    }
    expect(await subject.moveCandidate('kb')).toBe('moved')
    expect(await userBytes('owner')).toBe(100)
  })

  it('pages past skipped rows and never moves deleted, already scoped, or organization-owned KBs', async () => {
    await workspace('destination')
    await kb('a-skip')
    await sql`UPDATE knowledge_base SET user_id = 'no-access' WHERE id = 'a-skip'`
    await kb('b-move')
    await kb('c-deleted')
    await sql`UPDATE knowledge_base SET deleted_at = now() WHERE id = 'c-deleted'`
    await kb('d-scoped', 'Scoped', 'destination')
    await kb('e-org', 'Org')
    await sql`UPDATE knowledge_base SET organization_id = 'org', is_search_index = true WHERE id = 'e-org'`
    expect(await backfillLegacyKnowledgeBaseWorkspaces(subject, { batchSize: 1 })).toMatchObject({
      moved: 1,
      no_workspace: 1,
    })
    expect((await scopedKb('c-deleted')).workspace_id).toBeNull()
    expect((await scopedKb('e-org')).workspace_id).toBeNull()
    expect(await backfillLegacyKnowledgeBaseWorkspaces(subject)).toMatchObject({
      moved: 0,
      no_workspace: 1,
    })
  })
})
