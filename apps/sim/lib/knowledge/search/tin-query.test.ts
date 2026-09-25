import { describe, expect, it } from 'vitest'
import { tinQueryFromTsquery } from '@/lib/knowledge/search/tin-query'

/** Inputs are `websearch_to_tsquery('english', …)::text` exactly as PostgreSQL renders them. */
describe('tinQueryFromTsquery', () => {
  it('keeps punctuation and reserved words literal', () => {
    expect(tinQueryFromTsquery("'user@example.com' & 'https' & '/sim.ai/docs'")).toBe(
      '("user@example.com" AND "https" AND "/sim.ai/docs")'
    )
    expect(tinQueryFromTsquery("'near' & 'and'")).toBe('("near" AND "and")')
    expect(tinQueryFromTsquery("'snake_case' & 'it''s'")).toBe('("snake\\_case" AND "it\'s")')
  })

  it.each([
    ['', 'a query of stopwords only'],
    ["!'onlyneg'", 'a lone negation'],
    ["!'a' & !'b'", 'a conjunction of negations'],
    ["'a' | !'b'", 'a negated disjunct'],
    ["'appl':*", 'a prefix match'],
  ])('declines %j (%s)', (rendered) => {
    expect(tinQueryFromTsquery(rendered)).toBeNull()
  })
})
