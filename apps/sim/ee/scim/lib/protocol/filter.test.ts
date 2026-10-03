import { describe, expect, it } from 'vitest'
import type { ScimError } from '@/ee/scim/lib/protocol/errors'
import { parseGroupFilter, parseUserFilter } from '@/ee/scim/lib/protocol/filter'

/**
 * The grammar is deliberately small, so these tests are as much about what is
 * refused as what is accepted. A filter this server silently widened would hand
 * a provider a different set of users than it asked for, and the provider would
 * reconcile against that set.
 */

function scimTypeOf(run: () => unknown): string | undefined {
  try {
    run()
  } catch (error) {
    return (error as ScimError).scimType
  }
  return undefined
}

describe('parseUserFilter', () => {
  it('parses the lookup Okta sends before every create', () => {
    expect(parseUserFilter('userName eq "ada@acme.test"')).toEqual([
      { field: 'userName', value: 'ada@acme.test' },
    ])
  })

  it('parses the work-email filtered path Entra sends', () => {
    expect(parseUserFilter('emails[type eq "work"].value eq "ada@acme.test"')).toEqual([
      { field: 'workEmail', value: 'ada@acme.test' },
    ])
  })

  it('keeps all-email and primary-only matching distinct from work-email matching', () => {
    expect(parseUserFilter('emails.value eq "ada@home.test"')).toEqual([
      { field: 'email', value: 'ada@home.test' },
    ])
    expect(parseUserFilter('emails[primary eq true].value eq "ada@home.test"')).toEqual([
      { field: 'primaryEmail', value: 'ada@home.test' },
    ])
  })

  it('does not split on the word and inside a quoted value', () => {
    expect(parseGroupFilter('displayName eq "Research and Development"')).toEqual([
      { field: 'displayName', value: 'Research and Development' },
    ])
  })

  it('refuses an operator outside the supported set', () => {
    expect(scimTypeOf(() => parseUserFilter('userName co "ada"'))).toBe('invalidFilter')
  })

  it('refuses an attribute this server cannot answer', () => {
    expect(scimTypeOf(() => parseUserFilter('nickName eq "Ada"'))).toBe('invalidFilter')
  })

  it('normalizes quoted boolean values and refuses other strings', () => {
    expect(parseUserFilter('active eq "False"')).toEqual([{ field: 'active', value: 'false' }])
    expect(scimTypeOf(() => parseUserFilter('active eq "not-a-boolean"'))).toBe('invalidFilter')
  })

  it('refuses an unquoted value', () => {
    expect(scimTypeOf(() => parseUserFilter('userName eq ada'))).toBe('invalidFilter')
  })

  it('refuses more than ten joined expressions', () => {
    const filter = Array.from({ length: 11 }, (_, index) => `userName eq "u${index}"`).join(' and ')
    expect(scimTypeOf(() => parseUserFilter(filter))).toBe('invalidFilter')
  })
})

describe('parseGroupFilter', () => {
  it('refuses a User attribute on the Group endpoint', () => {
    expect(scimTypeOf(() => parseGroupFilter('userName eq "a@b.test"'))).toBe('invalidFilter')
  })
})
