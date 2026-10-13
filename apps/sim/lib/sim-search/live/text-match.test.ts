import { describe, expect, it } from 'vitest'
import { atlassianTextClause, driveTextClause } from '@/lib/sim-search/live/text-match'

describe('text match clauses', () => {
  it('keeps one all-terms clause by default', () => {
    expect(atlassianTextClause('release process')).toBe('text ~ "release process"')
    expect(driveTextClause("q3 plan's owner")).toBe("fullText contains 'q3 plan\\'s owner'")
  })

  it('joins distinctive terms with OR, leaving out stopwords', () => {
    expect(atlassianTextClause('what is the release process', 'any')).toBe(
      '(text ~ "release" OR text ~ "process")'
    )
    expect(driveTextClause('roadmap for planning', 'any')).toBe(
      "(fullText contains 'planning' or fullText contains 'roadmap')"
    )
  })

  it('escapes every term so a term cannot add query syntax', () => {
    expect(atlassianTextClause('ci/cd say"hi rollout', 'any')).toBe(
      String.raw`(text ~ "rollout" OR text ~ "say\\\"hi" OR text ~ "ci\\/cd")`
    )
    expect(driveTextClause(String.raw`o'brien back\slash rollout`, 'any')).toBe(
      String.raw`(fullText contains 'back\\slash' or fullText contains 'o\'brien' or fullText contains 'rollout')`
    )
  })

  it('falls back to the all-terms clause when fewer than two terms are distinctive', () => {
    expect(atlassianTextClause('how does it work', 'any')).toBe('text ~ "how does it work"')
  })
})
