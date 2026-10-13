import { describe, expect, it } from 'vitest'
import { confluenceTextClause, jiraTextClause } from '@/lib/sim-search/live/text-match'

describe('text match clauses', () => {
  it('matches either term of a two-term query, leaving out stopwords', () => {
    expect(jiraTextClause('what is the release process', 'any')).toBe(
      '(text ~ "release" OR text ~ "process")'
    )
  })

  it('requires two of the terms of a longer query anywhere in the full text', () => {
    expect(jiraTextClause('contractor offboarding runbook', 'any')).toBe(
      '((text ~ "offboarding" AND text ~ "contractor") OR (text ~ "offboarding" AND text ~ "runbook") OR (text ~ "contractor" AND text ~ "runbook"))'
    )
  })

  it('counts a term once whatever its case, so a pair always holds two different words', () => {
    expect(jiraTextClause('API api rollout', 'any')).toBe('(text ~ "rollout" OR text ~ "API")')
  })

  it('relaxes a Confluence query to its relevance-ranked site search', () => {
    expect(confluenceTextClause('release process', 'all')).toBe('text ~ "release process"')
    expect(confluenceTextClause('what is the release process', 'any')).toBe(
      'siteSearch ~ "what is the release process"'
    )
  })

  it('escapes every term so a term cannot add query syntax', () => {
    expect(jiraTextClause('ci/cd say"hi', 'any')).toBe(
      String.raw`(text ~ "say\\\"hi" OR text ~ "ci\\/cd")`
    )
    expect(confluenceTextClause('ci/cd say"hi', 'any')).toBe(
      String.raw`siteSearch ~ "ci\\/cd say\\\"hi"`
    )
  })

  it('falls back to the all-terms clause when fewer than two terms are distinctive', () => {
    expect(jiraTextClause('how does it work', 'any')).toBe('text ~ "how does it work"')
  })
})
