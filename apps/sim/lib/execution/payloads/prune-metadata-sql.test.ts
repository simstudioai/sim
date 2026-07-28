/**
 * @vitest-environment node
 */

// Renders the real prune statements against the real drizzle dialect and
// schema. These are raw `sql` templates, so a rendering bug only surfaces at
// execution time — the global drizzle/schema mocks would hide it entirely.
import { describe, expect, it, vi } from 'vitest'

vi.unmock('drizzle-orm')
vi.unmock('@sim/db')
vi.unmock('@sim/db/schema')

process.env.DATABASE_URL ??= 'postgresql://user:pass@localhost:5432/test'

const { PgDialect } = await import('drizzle-orm/pg-core')
const { pruneLargeValueMetadata } = await import('@/lib/execution/payloads/large-value-metadata')

/** Captures the raw statements `pruneLargeValueMetadata` issues, without a database. */
async function renderPruneStatements(workspaceIds: string[]): Promise<string[]> {
  const dialect = new PgDialect()
  const rendered: string[] = []
  const capturingClient = {
    execute: async (query: Parameters<PgDialect['sqlToQuery']>[0]) => {
      rendered.push(dialect.sqlToQuery(query).sql)
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
  it('binds workspace ids as one array parameter, not a value list', async () => {
    const statements = await renderPruneStatements(['ws-1', 'ws-2'])

    expect(statements.length).toBeGreaterThan(0)
    for (const statement of statements) {
      // `ANY(($1, $2)::text[])` is what interpolating the raw JS array yields —
      // Postgres rejects it ("cannot cast type record to text[]"), and with a
      // single id `ANY(($1)::text[])` fails as 22P02 instead.
      expect(statement).not.toMatch(/ANY\(\(\$\d+/)
      expect(statement).toMatch(/ANY\(\$\d+::text\[\]\)/)
    }
  })

  it('renders identically for a single workspace id', async () => {
    const statements = await renderPruneStatements(['ws-only'])

    expect(statements.length).toBeGreaterThan(0)
    for (const statement of statements) {
      expect(statement).toMatch(/ANY\(\$\d+::text\[\]\)/)
    }
  })
})
