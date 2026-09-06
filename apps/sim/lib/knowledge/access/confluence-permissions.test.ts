/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  type ConfluencePrincipal,
  type ConfluenceRestriction,
  confluencePageAcl,
  confluenceSubjectToken,
} from '@/lib/knowledge/access/confluence-permissions'
import { ACCESS_TOKEN_PATTERN, subjectToken } from '@/lib/knowledge/access/tokens'

const PROVIDER = 'confluence'
const TENANT = 'cloud-1'
const user = (id: string): ConfluencePrincipal => ({ kind: 'user', id })
const group = (id: string): ConfluencePrincipal => ({ kind: 'group', id })

function acl(
  spacePrincipals: ConfluencePrincipal[],
  restrictionChain: ConfluenceRestriction[] = []
) {
  return confluencePageAcl({
    spacePrincipals,
    restrictionChain,
    providerId: PROVIDER,
    tenantId: TENANT,
  })
}

describe('confluencePageAcl', () => {
  it('uses native identities without needing email addresses', () => {
    expect(acl([user('Alice'), group('g-eng')], [null, null]).acl).toEqual([
      `g:${PROVIDER}:${TENANT}:g-eng`,
      's:confluence:-:Alice',
    ])
  })

  it('requires both the space and the page restriction', () => {
    const result = acl([user('a'), user('b')], [[user('b')]])
    expect(result.acl).toEqual(['s:confluence:-:a', 's:confluence:-:b'])
    expect(result.requirements).toEqual([['s:confluence:-:b']])
  })

  it('retains every restricted ancestor when the page itself is unrestricted', () => {
    const result = acl([user('a')], [null, [user('b')], [user('c')]])
    expect(result.acl).toEqual(['s:confluence:-:a'])
    expect(result.requirements).toEqual([['s:confluence:-:b'], ['s:confluence:-:c']])
  })

  it('distinguishes an unrestricted page from one restricted to nobody', () => {
    expect(acl([user('a')], [null]).acl).toEqual(['s:confluence:-:a'])
    expect(acl([user('a')], [[]]).requirements).toEqual([[]])
  })

  it('keeps group grants scoped to their source site', () => {
    const one = acl([group('same-group')]).acl
    const two = confluencePageAcl({
      spacePrincipals: [group('same-group')],
      restrictionChain: [],
      providerId: PROVIDER,
      tenantId: 'other-cloud',
    }).acl
    expect(one).toEqual(['g:confluence:cloud-1:same-group'])
    expect(two).toEqual(['g:confluence:other-cloud:same-group'])
  })

  it('matches the global identity verified by Confluence managed OAuth', () => {
    const credential = {
      providerId: 'confluence',
      providerTenantId: null,
      providerSubjectId: '712020:Alice',
    }
    expect(confluenceSubjectToken(credential.providerSubjectId)).toBe(subjectToken(credential))
    expect(confluenceSubjectToken('712020:Alice')).not.toBe(confluenceSubjectToken('712020:alice'))
    expect(confluenceSubjectToken('712020:Alice')).not.toBe(
      subjectToken({ ...credential, providerId: 'jira' })
    )
  })

  it('refuses a malformed native subject rather than broadening access', () => {
    expect(() => acl([user('')])).toThrow()
    expect(() => acl([user('a\nb')])).toThrow()
  })

  it('hides a page in a space nobody may read', () => {
    expect(acl([]).acl).toEqual(['link'])
  })

  it('only emits tokens accepted by the document ACL constraint', () => {
    const { acl: tokens } = acl([user('712020:Alice'), group('g-eng')])
    for (const token of tokens) expect(token).toMatch(ACCESS_TOKEN_PATTERN)
  })
})
