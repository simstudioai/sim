/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  type ConfluencePrincipal,
  type ConfluenceRestriction,
  confluencePageAcl,
} from '@/lib/knowledge/access/confluence-permissions'
import { ACCESS_TOKEN_PATTERN } from '@/lib/knowledge/access/tokens'

const PROVIDER = 'confluence'
const TENANT = 'cloud-1'

const user = (id: string, email?: string | null): ConfluencePrincipal => ({
  kind: 'user',
  id,
  email,
})
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
  it('falls back to the space when no page in the chain is restricted', () => {
    expect(acl([user('a', 'Alice@corp.com'), group('g-eng')], [null, null]).acl).toEqual([
      `g:${PROVIDER}:${TENANT}:g-eng`,
      'u:alice@corp.com',
    ])
  })

  /**
   * A restriction replaces the space's permissions rather than narrowing them.
   * Space members not on the restriction lose access, which is the point.
   */
  it("lets a page's own restriction replace the space's permissions", () => {
    const result = acl(
      [user('a', 'alice@corp.com'), user('b', 'bob@corp.com')],
      [[user('b', 'bob@corp.com')]]
    )

    expect(result.acl).toEqual(['u:bob@corp.com'])
  })

  it('takes the closest restricted ancestor when the page itself is unrestricted', () => {
    const result = acl(
      [user('a', 'alice@corp.com')],
      [null, [user('b', 'bob@corp.com')], [user('c', 'carol@corp.com')]]
    )

    expect(result.acl).toEqual(['u:bob@corp.com'])
  })

  /**
   * `null` means "no restriction, inherit"; an empty list means "restricted to
   * nobody". Collapsing them would publish every deliberately-locked page.
   */
  it('distinguishes an unrestricted page from one restricted to nobody', () => {
    expect(acl([user('a', 'alice@corp.com')], [null]).acl).toEqual(['u:alice@corp.com'])
    expect(acl([user('a', 'alice@corp.com')], [[]]).acl).toEqual(['link'])
  })

  it('identifies a group by its id, which survives a rename', () => {
    expect(acl([group('g-eng')]).acl).toEqual([`g:${PROVIDER}:${TENANT}:g-eng`])
  })

  describe('a person Confluence will not name', () => {
    it('drops the grant and reports it rather than guessing', () => {
      const result = acl([user('a', null), user('b', 'bob@corp.com')])

      expect(result.acl).toEqual(['u:bob@corp.com'])
      expect(result.unattributedUsers).toBe(1)
    })

    it('hides a page whose every grant was withheld, rather than showing it', () => {
      const result = acl([user('a', null), user('b', undefined)])

      expect(result.acl).toEqual(['link'])
      expect(result.unattributedUsers).toBe(2)
    })

    it('counts only the grant that won, not the ones it replaced', () => {
      const result = acl([user('a', null), user('b', null)], [[user('c', 'carol@corp.com')]])

      expect(result.acl).toEqual(['u:carol@corp.com'])
      expect(result.unattributedUsers).toBe(0)
    })
  })

  it('hides a page in a space nobody may read', () => {
    expect(acl([]).acl).toEqual(['link'])
  })

  it('only ever emits tokens the document ACL constraint accepts', () => {
    const { acl: tokens } = acl([user('a', 'alice@corp.com'), group('g-eng')])
    for (const token of tokens) expect(token).toMatch(ACCESS_TOKEN_PATTERN)
  })
})
