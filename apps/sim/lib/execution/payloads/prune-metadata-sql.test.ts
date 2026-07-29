/**
 * @vitest-environment node
 */

// Renders the real prune statements against the real drizzle dialect and
// schema. These are raw `sql` templates, so a rendering bug only surfaces at
// execution time — the global drizzle/schema mocks would hide it entirely.
//
// The shared client sets `fetch_types: false` (packages/db/db.ts), which skips
// loading array type OIDs. That makes an array *parameter* unserializable —
// postgres.js sends it in a form Postgres rejects with 22P02. Only scalar bind
// params are safe here, so these tests assert no array parameter is emitted.
import { describe, expect, it, vi } from 'vitest'

vi.unmock('drizzle-orm')
vi.unmock('@sim/db')
vi.unmock('@sim/db/schema')

process.env.DATABASE_URL ??= 'postgresql://user:pass@localhost:5432/test'

const { PgDialect } = await import('drizzle-orm/pg-core')
const { pruneLargeValueMetadata } = await import('@/lib/execution/payloads/large-value-metadata')

interface RenderedQuery {
  sql: string
  params: unknown[]
}

/** Captures the raw statements `pruneLargeValueMetadata` issues, without a database. */
async function renderPruneStatements(workspaceIds: string[]): Promise<RenderedQuery[]> {
  const dialect = new PgDialect()
  const rendered: RenderedQuery[] = []
  const capturingClient = {
    execute: async (query: Parameters<PgDialect['sqlToQuery']>[0]) => {
      rendered.push(dialect.sqlToQuery(query))
      return [{ count: 0 }]
    },
  }

  await pruneLargeValueMetadata({
    workspaceIds,
    tombstonesDeletedBefore: new Date('2026-01-01T00:00:00Z'),
    dbClient: capturingClient as unknown as Parameters<
      typeof pruneLargeValueMetadata
    >[0]['dbClient'],
  })

  return rendered
}

describe('pruneLargeValueMetadata SQL', () => {
  for (const [label, ids] of [
    ['multiple workspace ids', ['ws-1', 'ws-2']],
    ['a single workspace id', ['ws-only']],
  ] as const) {
    describe(label, () => {
      it('matches workspaces with an IN list of scalar params', async () => {
        const statements = await renderPruneStatements([...ids])

        expect(statements.length).toBeGreaterThan(0)
        for (const { sql: text } of statements) {
          expect(text).toMatch(/workspace_id IN \(\$\d+/)
          // `= IN (...)` is a syntax error Postgres only reports at execution.
          expect(text).not.toMatch(/=\s*IN\s*\(/)
          // `ANY(($1)::text[])` / `ANY(($1, $2)::text[])` — the row-constructor cast.
          expect(text).not.toMatch(/ANY\(\(\$\d+/)
        }
      })

      it('never binds an array as a parameter', async () => {
        const statements = await renderPruneStatements([...ids])

        for (const { params } of statements) {
          for (const param of params) {
            expect(Array.isArray(param)).toBe(false)
          }
        }
      })
    })
  }
})
