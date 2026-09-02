/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  ACCESS_TOKEN_PATTERN,
  buildAclFromObservers,
  isAccessToken,
  isWorkspaceOnlyTokenSet,
  sortAccessTokens,
  subjectToken,
} from '@/lib/knowledge/access/tokens'

describe('access token shape', () => {
  it.each([
    'ws',
    'pub',
    'link',
    'u:alice@acme.com',
    's:confluence:-:557058:9f2b-uuid',
    's:google-drive:acme.com:1029384756',
    'g:sharepoint:tid-guid:sp:host,site,web:12',
  ])('accepts %s', (token) => {
    expect(isAccessToken(token)).toBe(true)
  })

  it.each([
    'u:Alice@acme.com',
    's:confluence:557058',
    'x:foo',
    '',
    'ws\npub',
    's::-:subject',
    'u:alice',
  ])('rejects %j', (token) => {
    expect(isAccessToken(token)).toBe(false)
  })

  it('mirrors the database check constraint per element', () => {
    expect(ACCESS_TOKEN_PATTERN.source).toContain('[gs]:[^\\n:]+:[^\\n:]+:[^\\n]+')
  })
})

describe('subjectToken', () => {
  it('derives the token from the credential row, substituting the no-tenant segment', () => {
    expect(
      subjectToken({
        providerId: 'confluence',
        providerTenantId: null,
        providerSubjectId: '557058:9f2b-uuid',
      })
    ).toBe('s:confluence:-:557058:9f2b-uuid')
    expect(
      subjectToken({
        providerId: 'google-drive',
        providerTenantId: 'acme.com',
        providerSubjectId: '1029384756',
      })
    ).toBe('s:google-drive:acme.com:1029384756')
  })

  it('treats an empty tenant like a missing one', () => {
    expect(
      subjectToken({ providerId: 'slack', providerTenantId: '', providerSubjectId: 'U1' })
    ).toBe('s:slack:-:U1')
  })

  it('fails loudly on a credential that cannot identify a person', () => {
    expect(() =>
      subjectToken({ providerId: 'confluence', providerTenantId: null, providerSubjectId: null })
    ).toThrow('requires a provider id')
    expect(() =>
      subjectToken({ providerId: null, providerTenantId: null, providerSubjectId: 'x' })
    ).toThrow('requires a provider id')
    expect(() =>
      subjectToken({ providerId: 'a:b', providerTenantId: null, providerSubjectId: 'x' })
    ).toThrow('cannot contain ":"')
    expect(() =>
      subjectToken({ providerId: 'slack', providerTenantId: 'T:1', providerSubjectId: 'x' })
    ).toThrow('cannot contain ":"')
  })
})

describe('sortAccessTokens / buildAclFromObservers', () => {
  it('sorts by code unit and dedupes', () => {
    expect(sortAccessTokens(['ws', 'pub', 's:b:-:1', 'pub', 's:B:-:1'])).toEqual([
      'pub',
      's:B:-:1',
      's:b:-:1',
      'ws',
    ])
  })

  it('never uses locale ordering', () => {
    expect(sortAccessTokens(['s:x:-:b', 's:x:-:B'])).toEqual(['s:x:-:B', 's:x:-:b'])
  })

  it('builds an empty ACL from no observers and rejects malformed tokens', () => {
    expect(buildAclFromObservers([])).toEqual([])
    expect(buildAclFromObservers(['s:confluence:-:2', 's:confluence:-:1'])).toEqual([
      's:confluence:-:1',
      's:confluence:-:2',
    ])
    expect(() => buildAclFromObservers(['s:confluence:-:1', 'bogus'])).toThrow('malformed')
  })
})

describe('isWorkspaceOnlyTokenSet', () => {
  it('distinguishes the workspace pair from a personal set', () => {
    expect(isWorkspaceOnlyTokenSet(['pub', 'ws'])).toBe(true)
    expect(isWorkspaceOnlyTokenSet(['pub', 's:confluence:-:1', 'ws'])).toBe(false)
  })
})
