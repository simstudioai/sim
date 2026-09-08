/**
 * @vitest-environment node
 */
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

  it('parses an externalId lookup, which Entra uses when it is the match attribute', () => {
    expect(parseUserFilter('externalId eq "00u1"')).toEqual([
      { field: 'externalId', value: '00u1' },
    ])
  })

  it('parses the work-email filtered path Entra sends', () => {
    expect(parseUserFilter('emails[type eq "work"].value eq "ada@acme.test"')).toEqual([
      { field: 'email', value: 'ada@acme.test' },
    ])
  })

  it('joins expressions with and', () => {
    expect(parseUserFilter('userName eq "ada@acme.test" and externalId eq "00u1"')).toEqual([
      { field: 'userName', value: 'ada@acme.test' },
      { field: 'externalId', value: '00u1' },
    ])
  })

  it('accepts a URN-qualified attribute name', () => {
    expect(
      parseUserFilter('urn:ietf:params:scim:schemas:core:2.0:User:userName eq "a@b.test"')
    ).toEqual([{ field: 'userName', value: 'a@b.test' }])
  })

  it('treats the operator as case-insensitive', () => {
    expect(parseUserFilter('userName Eq "a@b.test"')).toEqual([
      { field: 'userName', value: 'a@b.test' },
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

  it('accepts the unquoted booleans RFC 7644 writes for active', () => {
    expect(parseUserFilter('active eq true')).toEqual([{ field: 'active', value: 'true' }])
    expect(parseUserFilter('active eq false')).toEqual([{ field: 'active', value: 'false' }])
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
  it('parses the displayName lookup Okta sends before a group push', () => {
    expect(parseGroupFilter('displayName eq "Engineering"')).toEqual([
      { field: 'displayName', value: 'Engineering' },
    ])
  })

  it('refuses a User attribute on the Group endpoint', () => {
    expect(scimTypeOf(() => parseGroupFilter('userName eq "a@b.test"'))).toBe('invalidFilter')
  })
})
