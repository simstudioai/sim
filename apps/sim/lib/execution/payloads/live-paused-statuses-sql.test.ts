/**
 * @vitest-environment node
 */

// Renders the real predicate against the real drizzle dialect and schema: the
// bug this guards against is a SQL *rendering* bug, so the global drizzle-orm
// and schema mocks would hide it entirely.
import { describe, expect, it, vi } from 'vitest'

vi.unmock('drizzle-orm')
vi.unmock('@sim/db')
vi.unmock('@sim/db/schema')

process.env.DATABASE_URL ??= 'postgresql://user:pass@localhost:5432/test'

const { PgDialect } = await import('drizzle-orm/pg-core')
const { LIVE_PAUSED_REFERENCE_STATUSES, unreferencedLargeValuePredicate } = await import(
  '@/lib/execution/payloads/large-value-metadata'
)

describe('unreferencedLargeValuePredicate SQL', () => {
  const { sql: text, params } = new PgDialect().sqlToQuery(unreferencedLargeValuePredicate())

  it('compares paused status against an IN list', () => {
    expect(text).toMatch(/\.status IN \(\$\d+, \$\d+, \$\d+\)/)
    expect(params).toEqual(expect.arrayContaining([...LIVE_PAUSED_REFERENCE_STATUSES]))
  })

  it('never emits ANY() over drizzle-expanded statuses', () => {
    // Drizzle renders a JS array as `($1, $2, $3)` — correct for IN, but
    // `ANY((...)::text[])` makes Postgres reject the whole statement with
    // "cannot cast type record to text[]", which killed cleanup-logs for two months.
    expect(text).not.toMatch(/ANY\(\(\$\d+/)
  })

  it('never emits a dangling comparison operator before IN', () => {
    // `status = IN (...)` is a syntax error Postgres only reports at execution time.
    expect(text).not.toMatch(/=\s*IN\s*\(/)
  })

  it('never binds an array as a parameter', () => {
    // The invariant that matters: the app pools set `fetch_types: false`, so an
    // array bound as one parameter fails at execution even though the rendered
    // SQL (`ANY($1::text[])`) is valid. Only the params can reveal it.
    for (const param of params) {
      expect(Array.isArray(param)).toBe(false)
    }
  })
})
