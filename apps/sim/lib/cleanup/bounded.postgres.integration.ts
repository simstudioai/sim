import { db, dbFor } from '@sim/db'
import { eq, sql } from 'drizzle-orm'
import { pgTable, text } from 'drizzle-orm/pg-core'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { BoundedCleanup, cleanupQuery } from '@/lib/cleanup/bounded'
import { boundedDelete } from '@/lib/cleanup/bounded-delete'
import { pruneBoundedLargeValueMetadata } from '@/lib/cleanup/bounded-large-value-metadata'

const url = new URL(process.env.DATABASE_URL ?? '')
if (url.hostname !== '127.0.0.1' || url.pathname !== '/bounded_cleanup_test') {
  throw new Error('This suite requires an isolated local bounded_cleanup_test database')
}
const roots = pgTable('cleanup_fixture_roots', {
  id: text('id').primaryKey(),
  owner: text('owner').notNull(),
})
const client = dbFor('cleanup')

beforeAll(async () => {
  await db.execute(
    sql`CREATE TABLE execution_large_value_references (key text, workspace_id text, execution_id text, source text, PRIMARY KEY(key, execution_id, source))`
  )
  await db.execute(
    sql`CREATE TABLE execution_large_value_dependencies (parent_key text, child_key text, workspace_id text, PRIMARY KEY(parent_key, child_key))`
  )
  await db.execute(
    sql`CREATE TABLE execution_large_values (key text PRIMARY KEY, workspace_id text, deleted_at timestamp)`
  )
  await db.execute(sql`CREATE TABLE workflow_execution_logs (execution_id text)`)
  await db.execute(sql`CREATE TABLE paused_executions (execution_id text, status text)`)

  await db.execute(
    sql`CREATE TABLE cleanup_fixture_roots (id text PRIMARY KEY, owner text NOT NULL)`
  )
  await db.execute(
    sql`CREATE TABLE cleanup_fixture_children (id serial PRIMARY KEY, root_id text REFERENCES cleanup_fixture_roots(id) ON DELETE CASCADE)`
  )
})
beforeEach(async () => {
  await db.execute(
    sql`TRUNCATE execution_large_value_references, execution_large_value_dependencies, execution_large_values, workflow_execution_logs, paused_executions`
  )

  await db.execute(sql`TRUNCATE cleanup_fixture_roots, cleanup_fixture_children`)
  await db
    .insert(roots)
    .values(
      ['a', 'b', 'c', 'd', 'e', 'f'].map((id, index) => ({ id, owner: index < 3 ? 'one' : 'two' }))
    )
  await db.execute(
    sql`INSERT INTO cleanup_fixture_children(root_id) SELECT id FROM cleanup_fixture_roots CROSS JOIN generate_series(1,20)`
  )
})
afterAll(async () => {
  await db.execute(
    sql`DROP TABLE IF EXISTS execution_large_value_references, execution_large_value_dependencies, execution_large_values, workflow_execution_logs, paused_executions`
  )

  await db.execute(sql`DROP TABLE IF EXISTS cleanup_fixture_children, cleanup_fixture_roots`)
  await client.$client.end()
  await db.$client.end()
})

function control(limit: number, dryRun = false) {
  return new BoundedCleanup(
    { limits: { workflows: limit }, batchSize: 2, requestId: 'pg', dryRun },
    async () => {}
  )
}
async function count(table: 'roots' | 'children') {
  const rows = await db.execute<{ count: number }>(
    sql`SELECT count(*)::int AS count FROM ${sql.identifier(`cleanup_fixture_${table}`)}`
  )
  return rows[0].count
}

describe('bounded cleanup against PostgreSQL', () => {
  it('uses one budget across owner scopes with small committed batches', async () => {
    const run = control(5)
    await boundedDelete(run, 'workflows', roots, roots.id, eq(roots.owner, 'one'))
    await boundedDelete(run, 'workflows', roots, roots.id, eq(roots.owner, 'two'))
    expect(await count('roots')).toBe(1)
    expect(run.progress.stages.workflows).toMatchObject({ selected: 5, deleted: 5 })
  })
  it('dry run counts distinct roots without touching roots or children', async () => {
    const run = control(5, true)
    await boundedDelete(run, 'workflows', roots, roots.id, sql`true`)
    expect(run.progress.stages.workflows?.selected).toBe(5)
    expect(await count('roots')).toBe(6)
    expect(await count('children')).toBe(120)
  })
  it('counts roots separately from cascaded child rows', async () => {
    const run = control(1)
    await boundedDelete(run, 'workflows', roots, roots.id, sql`true`)
    expect(run.progress.stages.workflows?.deleted).toBe(1)
    expect(await count('children')).toBe(100)
  })
  it('charges and skips a root restored between selection and deletion', async () => {
    const run = control(1)
    await boundedDelete(run, 'workflows', roots, roots.id, eq(roots.owner, 'one'), {
      before: async (ids) => {
        await db.update(roots).set({ owner: 'restored' }).where(eq(roots.id, ids[0]))
      },
    })
    expect(run.progress.stages.workflows).toMatchObject({ selected: 1, deleted: 0, skipped: 1 })
    expect(await count('roots')).toBe(6)
  })
  it('aborts a blocked delete after the local lock timeout and preserves prior batches', async () => {
    let signalLocked!: () => void
    let release!: () => void
    const locked = new Promise<void>((resolve) => {
      signalLocked = resolve
    })
    const released = new Promise<void>((resolve) => {
      release = resolve
    })
    const holding = db.transaction(async (tx) => {
      await tx.execute(sql`SELECT id FROM cleanup_fixture_roots WHERE id = 'c' FOR UPDATE`)
      signalLocked()
      await released
    })
    await locked
    const run = control(5)
    const started = Date.now()
    try {
      await expect(boundedDelete(run, 'workflows', roots, roots.id, sql`true`)).rejects.toThrow()
      expect(Date.now() - started).toBeLessThan(3000)
      expect(run.progress.stages.workflows).toMatchObject({ selected: 4, deleted: 2 })
      expect(await count('roots')).toBe(4)
    } finally {
      release()
      await holding
    }
  })
  it('enforces the 5s statement timeout and does not leak settings to the next transaction', async () => {
    const started = Date.now()
    await expect(cleanupQuery(async (tx) => tx.execute(sql`SELECT pg_sleep(10)`))).rejects.toThrow()
    expect(Date.now() - started).toBeGreaterThanOrEqual(4500)
    expect(Date.now() - started).toBeLessThan(8000)
    const settings = await client.execute<{ statement: string; lock: string }>(
      sql`SELECT current_setting('statement_timeout') AS statement, current_setting('lock_timeout') AS lock`
    )
    expect(settings[0]).toMatchObject({ statement: '0', lock: '0' })
  })
})

describe('bounded metadata SQL against PostgreSQL', () => {
  it('retains live log and paused references while bounding stale reference deletion', async () => {
    await db.execute(sql`INSERT INTO workflow_execution_logs VALUES ('live-log')`)
    await db.execute(sql`INSERT INTO paused_executions VALUES ('live-pause', 'paused')`)
    await db.execute(sql`INSERT INTO execution_large_value_references VALUES
      ('live-1','one','live-log','execution_log'), ('live-2','one','live-pause','paused_snapshot'),
      ('stale-1','one','missing-1','execution_log'), ('stale-2','one','missing-2','execution_log'),
      ('stale-3','one','missing-3','unknown')`)
    const run = new BoundedCleanup(
      { limits: { staleReferences: 2 }, batchSize: 1, requestId: 'refs', dryRun: false },
      async () => {}
    )
    await pruneBoundedLargeValueMetadata(run, ['one'])
    expect(run.progress.stages.staleReferences).toMatchObject({ selected: 2, deleted: 2 })
    const live = await db.execute(
      sql`SELECT key FROM execution_large_value_references WHERE key LIKE 'live-%'`
    )
    expect(live.length).toBe(2)
    expect((await db.execute(sql`SELECT key FROM execution_large_value_references`)).length).toBe(3)
  })
  it('previews distinct dependencies without deleting them', async () => {
    await db.execute(
      sql`INSERT INTO execution_large_value_dependencies VALUES ('gone-1','child','one'), ('gone-2','child','one'), ('gone-3','child','one')`
    )
    const run = new BoundedCleanup(
      { limits: { staleDependencies: 2 }, batchSize: 1, requestId: 'deps', dryRun: true },
      async () => {}
    )
    await pruneBoundedLargeValueMetadata(run, ['one'])
    expect(run.progress.stages.staleDependencies).toMatchObject({ selected: 2, deleted: 0 })
    expect(
      (await db.execute(sql`SELECT parent_key FROM execution_large_value_dependencies`)).length
    ).toBe(3)
  })
  it('retains parent tombstones with dependencies and respects the 30-day grace period', async () => {
    await db.execute(sql`INSERT INTO execution_large_values VALUES
      ('protected','one',now() - interval '40 days'), ('old','one',now() - interval '40 days'), ('recent','one',now())`)
    await db.execute(
      sql`INSERT INTO execution_large_value_dependencies VALUES ('protected','child','one')`
    )
    const run = new BoundedCleanup(
      { limits: { largeValueTombstones: 5 }, batchSize: 1, requestId: 'tombs', dryRun: false },
      async () => {}
    )
    await pruneBoundedLargeValueMetadata(run, ['one'])
    expect(run.progress.stages.largeValueTombstones).toMatchObject({ selected: 1, deleted: 1 })
    expect(
      (
        await db.execute<{ key: string }>(sql`SELECT key FROM execution_large_values ORDER BY key`)
      ).map((row) => row.key)
    ).toEqual(['protected', 'recent'])
  })
})
