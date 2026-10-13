import { describe, expect, it } from 'vitest'
import {
  confluenceTextClause,
  holdsHalfTheTerms,
  jiraTextClause,
} from '@/lib/sim-search/live/text-match'

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

  it('pairs up to eight distinct terms of a long query', () => {
    const clause = jiraTextClause(
      'rotate expired gateway credentials before quarterly compliance audit deadline',
      'any'
    )
    expect(clause.match(/text ~/g)).toHaveLength(56)
  })

  it('spends one pair slot on a word and its plural, which Jira stems alike', () => {
    expect(jiraTextClause('token tokens rotation', 'any')).toBe(
      '(text ~ "rotation" OR text ~ "tokens")'
    )
    expect(jiraTextClause('processes process', 'any')).toBe('text ~ "processes process"')
    expect(jiraTextClause('statuses status', 'any')).toBe('text ~ "statuses status"')
    expect(jiraTextClause('status focus', 'any')).toBe('(text ~ "status" OR text ~ "focus")')
  })

  it('relaxes a Confluence query to its relevance-ranked site search', () => {
    expect(confluenceTextClause('release process', 'all')).toBe('text ~ "release process"')
    expect(confluenceTextClause('what is the release process', 'any')).toBe(
      'siteSearch ~ "what is the release process"'
    )
    expect(confluenceTextClause('token tokens rotation', 'any')).toBe(
      'siteSearch ~ "token tokens rotation"'
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

  describe('holdsHalfTheTerms', () => {
    it('needs at least half the distinct terms, rounding up', () => {
      const holds = holdsHalfTheTerms('glean token creator role request')
      expect(holds('Role request form')).toBe(false)
      expect(holds('Token creator role')).toBe(true)
    })

    it('counts a word and its plural as one term in either direction', () => {
      expect(holdsHalfTheTerms('glean token creator role request')('Glean tokens, creators')).toBe(
        true
      )
      expect(
        holdsHalfTheTerms('database release checklist owner')('Databases and weekly releases')
      ).toBe(true)
      expect(holdsHalfTheTerms('databases releases checklist owner')('Database release')).toBe(true)
    })

    it('folds -ies plurals of both -y and -ie words, as the Porter stemmer does', () => {
      expect(holdsHalfTheTerms('movies rotation schedule owner')('Movie rotation')).toBe(true)
      expect(holdsHalfTheTerms('policies review schedule owner')('Policy review')).toBe(true)
    })

    it('matches a term with punctuation inside it as written', () => {
      expect(holdsHalfTheTerms('ci/cd pipeline failure owner')('CI/CD pipeline')).toBe(true)
    })

    it('accepts one matching term for a two-term query', () => {
      expect(holdsHalfTheTerms('contractor offboarding')('Contractor directory')).toBe(true)
    })
  })
})
