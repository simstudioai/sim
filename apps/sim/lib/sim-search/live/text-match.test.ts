import { describe, expect, it } from 'vitest'
import {
  confluenceTextClause,
  driveTextClause,
  jiraTextClause,
} from '@/lib/sim-search/live/text-match'

describe('text match clauses', () => {
  it('joins distinctive terms with OR, leaving out stopwords', () => {
    expect(jiraTextClause('what is the release process', 'any')).toBe(
      '(text ~ "release" OR text ~ "process")'
    )
    expect(driveTextClause('roadmap for planning', 'any')).toBe(
      "(fullText contains 'planning' or fullText contains 'roadmap')"
    )
  })

  it('relaxes a Confluence query to its relevance-ranked site search', () => {
    expect(confluenceTextClause('release process', 'all')).toBe('text ~ "release process"')
    expect(confluenceTextClause('what is the release process', 'any')).toBe(
      'siteSearch ~ "what is the release process"'
    )
  })

  it('escapes every term so a term cannot add query syntax', () => {
    expect(jiraTextClause('ci/cd say"hi rollout', 'any')).toBe(
      String.raw`(text ~ "rollout" OR text ~ "say\\\"hi" OR text ~ "ci\\/cd")`
    )
    expect(confluenceTextClause('ci/cd say"hi', 'any')).toBe(
      String.raw`siteSearch ~ "ci\\/cd say\\\"hi"`
    )
    expect(driveTextClause(String.raw`o'brien back\slash rollout`, 'any')).toBe(
      String.raw`(fullText contains 'back\\slash' or fullText contains 'o\'brien' or fullText contains 'rollout')`
    )
  })

  it('falls back to the all-terms clause when fewer than two terms are distinctive', () => {
    expect(jiraTextClause('how does it work', 'any')).toBe('text ~ "how does it work"')
  })
})
