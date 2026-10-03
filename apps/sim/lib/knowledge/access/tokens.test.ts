import { describe, expect, it } from 'vitest'
import {
  ACCESS_TOKEN_PATTERN,
  groupToken,
  isAccessToken,
  isDirectoryMemberToken,
  isIdentityToken,
  MAX_ACL_TOKENS,
  sortAccessTokens,
  subjectToken,
  userToken,
  validateAcl,
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

describe('sortAccessTokens', () => {
  it('never uses locale ordering', () => {
    expect(sortAccessTokens(['s:x:-:b', 's:x:-:B'])).toEqual(['s:x:-:B', 's:x:-:b'])
  })
})

describe('userToken', () => {
  it('folds case and surrounding whitespace so one person is one token', () => {
    expect(userToken('  Alice@Corp.com ')).toBe('u:alice@corp.com')
  })

  it('refuses to invent an identity for a principal with no address', () => {
    expect(userToken(null)).toBeNull()
    expect(userToken(undefined)).toBeNull()
    expect(userToken('   ')).toBeNull()
    expect(userToken('not-an-email')).toBeNull()
  })
})

describe('groupToken', () => {
  it('refuses segments that would be mistaken for the separator', () => {
    expect(groupToken({ providerId: 'a:b', tenantId: null, groupId: 'g' })).toBeNull()
    expect(groupToken({ providerId: 'p', tenantId: 'T:1', groupId: 'g' })).toBeNull()
  })
})

describe('validateAcl', () => {
  it('names the token the database would have rejected', () => {
    expect(validateAcl(['ws', 'u:NOT-FOLDED@corp.com'])).toEqual({
      valid: false,
      reason: 'malformed_token',
      sample: 'u:NOT-FOLDED@corp.com',
    })
  })

  it('refuses an ACL past the ceiling, and accepts one exactly at it', () => {
    const at = Array.from({ length: MAX_ACL_TOKENS }, (_u, i) => `u:p${i}@corp.com`)
    expect(validateAcl(at).valid).toBe(true)
    expect(validateAcl([...at, 'u:extra@corp.com'])).toEqual({
      valid: false,
      reason: 'too_many_tokens',
    })
  })
})

describe('directory identity tokens', () => {
  it.each([
    'ws',
    'pub',
    'link',
    'g:confluence:cloud:group',
    'alice@corp.com',
    'u:Alice@corp.com',
    'u: alice@corp.com ',
    's:confluence:missing',
  ])('rejects noncanonical member %s', (token) => {
    expect(isIdentityToken(token)).toBe(false)
  })
})

describe('nested directory memberships', () => {
  const directory = {
    providerId: 'confluence',
    tenantId: 'cloud',
    externalGroupId: 'space-readers:123',
  }
  it.each([
    'g:jira:cloud:engineering',
    'g:confluence:other:engineering',
    'g:confluence:cloud:Engineering',
    'g:confluence:cloud: engineering ',
    'g:confluence:cloud:space-readers:456',
    'ws',
    'link',
    'pub',
  ])('rejects %s', (value) => {
    expect(isDirectoryMemberToken(value, directory)).toBe(false)
  })

  it('rejects nesting in native groups and other providers', () => {
    expect(
      isDirectoryMemberToken('g:confluence:cloud:engineering', {
        ...directory,
        externalGroupId: 'native',
      })
    ).toBe(false)
    expect(
      isDirectoryMemberToken('g:google-drive:cloud:engineering', {
        ...directory,
        providerId: 'google-drive',
      })
    ).toBe(false)
  })
})
