import { db, dbFor, runOutsideTransactionContext } from '@sim/db'
import { eq, sql } from 'drizzle-orm'
import { pgTable, text } from 'drizzle-orm/pg-core'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { BoundedCleanup, cleanupQuery } from '@/lib/cleanup/bounded'
import { boundedDelete } from '@/lib/cleanup/bounded-delete'
import { pruneBoundedLargeValueMetadata } from '@/lib/cleanup/bounded-large-value-metadata'
import {
  enqueueRetentionStorageCleanup,
  processRetentionStorageCleanup,
  retentionStorageOutboxHandlers,
} from '@/lib/cleanup/storage-outbox'
import { processOutboxEventById } from '@/lib/core/outbox/service'
import { lockLargeValueKeysForReference } from '@/lib/execution/payloads/large-value-lock'

const { deleteStorageFiles } = vi.hoisted(() => ({ deleteStorageFiles: vi.fn() }))
vi.mock('@/lib/uploads', () => ({ StorageService: { deleteFiles: deleteStorageFiles } }))

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
  await db.execute(sql`CREATE TABLE outbox_event (
    id text PRIMARY KEY, event_type text NOT NULL, payload json NOT NULL,
    status text NOT NULL DEFAULT 'pending', attempts integer NOT NULL DEFAULT 0,
    max_attempts integer NOT NULL DEFAULT 10, available_at timestamp NOT NULL DEFAULT now(),
    locked_at timestamp, last_error text, created_at timestamp NOT NULL DEFAULT now(), processed_at timestamp
  )`)
  await db.execute(
    sql`CREATE TABLE execution_large_value_references (key text, workspace_id text, execution_id text, source text, PRIMARY KEY(key, execution_id, source))`
  )
  await db.execute(
    sql`CREATE TABLE execution_large_value_dependencies (parent_key text, child_key text, workspace_id text, PRIMARY KEY(parent_key, child_key))`
  )
  await db.execute(
    sql`CREATE TABLE execution_large_values (key text PRIMARY KEY, workspace_id text, deleted_at timestamp)`
  )
  await db.execute(
    sql`CREATE TABLE workspace_files (key text PRIMARY KEY, context text, deleted_at timestamp)`
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
  deleteStorageFiles.mockReset()
  await db.execute(sql`TRUNCATE outbox_event`)
  await db.execute(
    sql`TRUNCATE execution_large_value_references, execution_large_value_dependencies, execution_large_values, workflow_execution_logs, paused_executions, workspace_files`
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
  await db.execute(sql`DROP TABLE IF EXISTS outbox_event`)
  await db.execute(
    sql`DROP TABLE IF EXISTS execution_large_value_references, execution_large_value_dependencies, execution_large_values, workflow_execution_logs, paused_executions, workspace_files`
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
  it('rolls back child mutations when parent cleanup fails', async () => {
    const run = control(1)
    await expect(
      boundedDelete(run, 'workflows', roots, roots.id, eq(roots.id, 'a'), {
        beforeDelete: async (ids, tx) => {
          await tx.execute(sql`DELETE FROM cleanup_fixture_children WHERE root_id = ${ids[0]}`)
          throw new Error('child cleanup failed')
        },
      })
    ).rejects.toThrow('child cleanup failed')
    expect(await count('roots')).toBe(6)
    expect(await count('children')).toBe(120)
    expect(run.progress.stages.workflows?.deleted).toBe(0)
  })
  it('skips destructive hooks when a selected parent was restored', async () => {
    let changedChildren = false
    await boundedDelete(control(1), 'workflows', roots, roots.id, eq(roots.owner, 'one'), {
      before: async (ids) => {
        await db.update(roots).set({ owner: 'restored' }).where(eq(roots.id, ids[0]))
      },
      beforeDelete: async () => {
        changedChildren = true
      },
    })
    expect(changedChildren).toBe(false)
    expect(await count('children')).toBe(120)
  })
  it('holds the parent lock throughout destructive child work', async () => {
    await boundedDelete(control(1), 'workflows', roots, roots.id, eq(roots.id, 'a'), {
      beforeDelete: async () => {
        await expect(
          runOutsideTransactionContext(() =>
            db.transaction(async (tx) => {
              await tx.execute(sql`SET LOCAL lock_timeout = '100ms'`)
              await tx.update(roots).set({ owner: 'restored' }).where(eq(roots.id, 'a'))
            })
          )
        ).rejects.toThrow()
      },
    })
    expect(await count('roots')).toBe(5)
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

describe('large-value reference lifecycle locks', () => {
  it.each(['metadata', 'legacy'] as const)(
    'protects a %s key until its reference commits',
    async (kind) => {
      const table = kind === 'metadata' ? 'execution_large_values' : 'workspace_files'
      if (kind === 'metadata')
        await db.execute(sql`INSERT INTO execution_large_values VALUES ('live-key','one',NULL)`)
      else await db.execute(sql`INSERT INTO workspace_files VALUES ('live-key','execution',NULL)`)
      await db.transaction(async (tx) => {
        await lockLargeValueKeysForReference(tx, ['live-key'])
        await expect(
          runOutsideTransactionContext(() =>
            cleanupQuery(async (cleanupTx) => {
              await cleanupTx.execute(
                sql`SELECT key FROM ${sql.identifier(table)} WHERE key = 'live-key' FOR UPDATE`
              )
            })
          )
        ).rejects.toThrow()
      })
      await cleanupQuery(async (tx) => {
        await tx.execute(
          sql`UPDATE ${sql.identifier(table)} SET deleted_at = now() WHERE key = 'live-key'`
        )
      })
      await expect(
        db.transaction((tx) => lockLargeValueKeysForReference(tx, ['live-key']))
      ).rejects.toThrow('deleted large value')
    }
  )
  it('rejects reference creation after metadata has been purged', async () => {
    await expect(
      db.transaction((tx) => lockLargeValueKeysForReference(tx, ['missing-key']))
    ).rejects.toThrow('missing large value')
  })
})

describe('durable retention storage cleanup', () => {
  it('rolls back cleanup intents with the root deletion', async () => {
    await expect(
      cleanupQuery(async (tx) => {
        await tx.delete(roots).where(eq(roots.id, 'a'))
        await enqueueRetentionStorageCleanup(tx, ['blob'], 'execution', 1)
        throw new Error('abort transaction')
      })
    ).rejects.toThrow('abort transaction')
    expect(await count('roots')).toBe(6)
    expect((await db.execute(sql`SELECT id FROM outbox_event`)).length).toBe(0)
    expect(deleteStorageFiles).not.toHaveBeenCalled()
  })
  it('retries storage from the outbox after the root is gone', async () => {
    const [eventId] = await cleanupQuery(async (tx) => {
      await tx.delete(roots).where(eq(roots.id, 'a'))
      return enqueueRetentionStorageCleanup(tx, ['blob'], 'execution', 1)
    })
    deleteStorageFiles.mockResolvedValueOnce({
      deleted: 0,
      failed: [{ key: 'blob', error: 'offline' }],
    })
    await expect(
      processRetentionStorageCleanup(control(1), 'workflows', [eventId])
    ).rejects.toThrow('incomplete: pending')
    expect(await count('roots')).toBe(5)
    const [pending] = await db.execute<{ status: string; payload: { keys: string[] } }>(
      sql`SELECT status, payload FROM outbox_event WHERE id = ${eventId}`
    )
    expect(pending.status).toBe('pending')
    expect(pending.payload.keys).toEqual(['blob'])
    await db.execute(
      sql`UPDATE outbox_event SET available_at = now() - interval '1 second' WHERE id = ${eventId}`
    )
    deleteStorageFiles.mockResolvedValueOnce({ deleted: 1, failed: [] })
    await expect(processOutboxEventById(eventId, retentionStorageOutboxHandlers)).resolves.toBe(
      'completed'
    )
    expect(deleteStorageFiles).toHaveBeenCalledTimes(2)
    expect(await count('roots')).toBe(5)
  })
  it('bounds and deduplicates the persisted key batches', async () => {
    await cleanupQuery((tx) =>
      enqueueRetentionStorageCleanup(tx, ['a', 'b', 'a', 'c'], 'workspace', 2)
    )
    const events = await db.execute<{ payload: { keys: string[] } }>(
      sql`SELECT payload FROM outbox_event ORDER BY created_at, id`
    )
    expect(events.map((event) => event.payload.keys.length).sort()).toEqual([1, 2])
  })
})
