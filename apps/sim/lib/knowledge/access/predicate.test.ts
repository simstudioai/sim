/**
 * @vitest-environment node
 */

/**
 * Renders the real predicate against the real drizzle dialect and schema. The
 * shared client sets `fetch_types: false` (packages/db/db.ts), under which an
 * array bound as one parameter fails at execution with 22P02, so the assertion
 * that matters is that every bind is a scalar.
 */
import { describe, expect, it, vi } from 'vitest'

vi.unmock('drizzle-orm')
vi.unmock('@sim/db')
vi.unmock('@sim/db/schema')

process.env.DATABASE_URL ??= 'postgresql://user:pass@localhost:5432/test'

const { PgDialect } = await import('drizzle-orm/pg-core')
const { knowledgeAccessCondition } = await import('@/lib/knowledge/access/predicate')
const { SYSTEM_ACCESS_SCOPE } = await import('@/lib/knowledge/access/types')

function render(condition: ReturnType<typeof knowledgeAccessCondition>) {
  return new PgDialect().sqlToQuery(condition)
}

describe('knowledgeAccessCondition', () => {
  it('overlaps the ACL with the tokens as a literal array of scalar binds', () => {
    const { sql, params } = render(
      knowledgeAccessCondition({
        kind: 'user',
        userId: 'user-1',
        tokens: ['pub', 's:confluence:-:557058:abc', 'ws'],
      })
    )
    expect(sql).toContain('"document"."acl" && ARRAY[$1, $2, $3]::text[]')
    expect(params.slice(0, 3)).toEqual(['pub', 's:confluence:-:557058:abc', 'ws'])
    for (const param of params) expect(Array.isArray(param)).toBe(false)
  })

  it('renders the workspace pair for actorless callers', () => {
    const { sql, params } = render(
      knowledgeAccessCondition({ kind: 'workspace', tokens: ['pub', 'ws'] })
    )
    expect(sql).toContain('"document"."acl" && ARRAY[$1, $2]::text[]')
    expect(params.slice(0, 2)).toEqual(['pub', 'ws'])
  })

  it('denies everything for an empty token set', () => {
    expect(render(knowledgeAccessCondition({ kind: 'user', userId: 'u', tokens: [] })).sql).toBe(
      'false'
    )
  })

  it('exempts only the branded system scope', () => {
    expect(render(knowledgeAccessCondition(SYSTEM_ACCESS_SCOPE)).sql).toBe('true')
  })
})
