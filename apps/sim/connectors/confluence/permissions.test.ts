/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getReadRestriction,
  listAncestorIds,
  listGroupMemberEmails,
  listSpaceReadPrincipals,
  resolveUserEmails,
} from '@/connectors/confluence/permissions'

const mockFetch = vi.fn()
const CLOUD = 'cloud-1'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('fetch', mockFetch)
})

describe('listSpaceReadPrincipals', () => {
  it('keeps only the permission that grants reading the space', () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        results: [
          {
            principal: { type: 'user', id: 'acc-1' },
            operation: { key: 'read', targetType: 'space' },
          },
          {
            principal: { type: 'group', id: 'grp-1' },
            operation: { key: 'read', targetType: 'space' },
          },
          {
            principal: { type: 'user', id: 'acc-2' },
            operation: { key: 'delete', targetType: 'page' },
          },
          {
            principal: { type: 'user', id: 'acc-3' },
            operation: { key: 'read', targetType: 'page' },
          },
        ],
      })
    )

    return expect(listSpaceReadPrincipals(CLOUD, 'token', 'space-1')).resolves.toEqual([
      { kind: 'user', id: 'acc-1' },
      { kind: 'group', id: 'grp-1' },
    ])
  })

  /**
   * A space open to anonymous users is the Confluence equivalent of an open
   * Drive share, and gets the same treatment: not mapped, so not searchable.
   */
  it('grants nothing for an access-class principal such as anonymous', async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        results: [
          {
            principal: { type: 'ACCESS_CLASS', id: 'anonymous-users' },
            operation: { key: 'read', targetType: 'space' },
          },
        ],
      })
    )

    await expect(listSpaceReadPrincipals(CLOUD, 'token', 'space-1')).resolves.toEqual([])
  })

  it('follows the cursor rather than reporting the first page as the whole space', async () => {
    mockFetch
      .mockResolvedValueOnce(
        jsonResponse({
          results: [
            {
              principal: { type: 'user', id: 'acc-1' },
              operation: { key: 'read', targetType: 'space' },
            },
          ],
          _links: { next: '/wiki/api/v2/spaces/1/permissions?cursor=abc' },
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          results: [
            {
              principal: { type: 'user', id: 'acc-2' },
              operation: { key: 'read', targetType: 'space' },
            },
          ],
        })
      )

    await expect(listSpaceReadPrincipals(CLOUD, 'token', 'space-1')).resolves.toHaveLength(2)
    expect(String(mockFetch.mock.calls[1][0])).toContain('cursor=abc')
  })

  it('throws rather than returning a space it could not read in full', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ message: 'nope' }, 403))

    await expect(listSpaceReadPrincipals(CLOUD, 'token', 'space-1')).rejects.toThrow('403')
  })
})

describe('getReadRestriction', () => {
  /**
   * The distinction the whole ancestor walk rests on: empty means the page is
   * unrestricted and inherits, not that it is restricted to nobody.
   */
  it('reports an unrestricted page as inheriting, not as restricted to nobody', async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ restrictions: { user: { results: [] }, group: { results: [] } } })
    )

    await expect(getReadRestriction(CLOUD, 'token', 'page-1')).resolves.toBeNull()
  })

  it('carries the address Confluence disclosed alongside the account id', async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        restrictions: {
          user: { results: [{ accountId: 'acc-1', email: 'alice@corp.com' }] },
          group: { results: [{ id: 'grp-1' }] },
        },
      })
    )

    await expect(getReadRestriction(CLOUD, 'token', 'page-1')).resolves.toEqual([
      { kind: 'user', id: 'acc-1', email: 'alice@corp.com' },
      { kind: 'group', id: 'grp-1' },
    ])
  })

  it('keeps a withheld address as absent rather than inventing one', async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        restrictions: { user: { results: [{ accountId: 'acc-1', email: null }] }, group: {} },
      })
    )

    await expect(getReadRestriction(CLOUD, 'token', 'page-1')).resolves.toEqual([
      { kind: 'user', id: 'acc-1', email: null },
    ])
  })
})

describe('listAncestorIds', () => {
  /** The closest parent decides, and Confluence returns ancestors root-first. */
  it('returns ancestors closest parent first', async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ ancestors: [{ id: 'root' }, { id: 'section' }, { id: 'parent' }] })
    )

    await expect(listAncestorIds(CLOUD, 'token', 'page-1')).resolves.toEqual([
      'parent',
      'section',
      'root',
    ])
  })

  it('reports a top-level page as having no ancestors', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({}))

    await expect(listAncestorIds(CLOUD, 'token', 'page-1')).resolves.toEqual([])
  })
})

describe('resolveUserEmails', () => {
  it('folds addresses so they match the tokens a reader holds', async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ results: [{ accountId: 'acc-1', email: 'Alice@Corp.com' }] })
    )

    const emails = await resolveUserEmails(CLOUD, 'token', ['acc-1'])

    expect(emails.get('acc-1')).toBe('alice@corp.com')
  })

  it('omits an account whose address the site withholds', async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        results: [
          { accountId: 'acc-1', email: null },
          { accountId: 'acc-2', email: 'bob@corp.com' },
        ],
      })
    )

    const emails = await resolveUserEmails(CLOUD, 'token', ['acc-1', 'acc-2'])

    expect([...emails.keys()]).toEqual(['acc-2'])
  })

  it('survives a failed batch rather than losing the whole corpus', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ message: 'nope' }, 500))

    await expect(resolveUserEmails(CLOUD, 'token', ['acc-1'])).resolves.toEqual(new Map())
  })
})

describe('listGroupMemberEmails', () => {
  const GROUP = { id: 'grp-1' }

  it('reports a fully resolved group as complete', async () => {
    mockFetch
      .mockResolvedValueOnce(jsonResponse({ results: [{ accountId: 'acc-1' }] }))
      .mockResolvedValueOnce(
        jsonResponse({ results: [{ accountId: 'acc-1', email: 'alice@corp.com' }] })
      )

    await expect(listGroupMemberEmails(CLOUD, 'token', GROUP)).resolves.toEqual({
      group: GROUP,
      memberEmails: ['alice@corp.com'],
      complete: true,
    })
  })

  /**
   * A group is only usable as a grant if everyone in it can be named. Reporting
   * a partial membership as complete would let it replace a stored one and
   * revoke whoever the site withheld.
   */
  it('reports a group with a withheld member as incomplete', async () => {
    mockFetch
      .mockResolvedValueOnce(
        jsonResponse({ results: [{ accountId: 'acc-1' }, { accountId: 'acc-2' }] })
      )
      .mockResolvedValueOnce(
        jsonResponse({ results: [{ accountId: 'acc-1', email: 'alice@corp.com' }] })
      )

    await expect(listGroupMemberEmails(CLOUD, 'token', GROUP)).resolves.toMatchObject({
      memberEmails: ['alice@corp.com'],
      complete: false,
    })
  })
})
