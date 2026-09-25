import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getReadRestriction,
  listAncestorIds,
  listConfluenceSpaceMembership,
  listGroupMemberTokens,
  listSpaceReadPrincipals,
  openConfluenceDirectory,
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
  vi.stubGlobal('fetch', mockFetch)
})

describe('listSpaceReadPrincipals', () => {
  it('retains more than 5,000 readers in a space audience without expanding document ACLs', async () => {
    let page = 0
    mockFetch.mockImplementation(async () => {
      const offset = page++ * 250
      return jsonResponse({
        results: Array.from({ length: 250 }, (_, index) => ({
          principal: { type: 'user', id: `reader-${offset + index}` },
          operation: { key: 'read', targetType: 'space' },
        })),
        ...(page < 24 ? { _links: { next: `?cursor=${page}` } } : {}),
      })
    })
    const membership = await listConfluenceSpaceMembership('confluence', CLOUD, 'token', '123')
    expect(membership.complete).toBe(true)
    expect(membership.memberTokens).toHaveLength(6000)
    expect(membership.memberTokens[5999]).toBe('s:confluence:-:reader-5999')
    expect(mockFetch).toHaveBeenCalledTimes(24)
  })

  it.each(['space-readers:123', ' SPACE-READERS:123 '])(
    'rejects native groups in the reserved namespace: %s',
    async (id) => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ results: [{ id }] }))
      await expect(
        openConfluenceDirectory('confluence', CLOUD, 'token').listGroups()
      ).rejects.toThrow('invalid group ID')
    }
  )

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

  it('never grants public access for anonymous or unknown access classes', async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        results: [
          {
            principal: { type: 'ACCESS_CLASS', id: 'anonymous-users' },
            operation: { key: 'read', targetType: 'space' },
          },
          {
            principal: { type: 'access-class', id: 'unknown-class' },
            operation: { key: 'read', targetType: 'space' },
          },
        ],
      })
    )

    await expect(listSpaceReadPrincipals(CLOUD, 'token', 'space-1')).resolves.toEqual([])
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it('expands admin role assignments without granting ordinary licensed users', async () => {
    mockFetch
      .mockResolvedValueOnce(
        jsonResponse({
          results: [
            {
              principal: { type: 'role', id: 'reader-role' },
              operation: { key: 'read', targetType: 'space' },
            },
          ],
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          results: [
            { principal: { principalType: 'ACCESS_CLASS', principalId: 'all-product-admins' } },
            { principal: { principalType: 'USER', principalId: 'direct-user' } },
            { principal: { principalType: 'GROUP', principalId: 'admins' } },
          ],
        })
      )
      .mockResolvedValueOnce(jsonResponse({ results: [{ id: 'admins' }] }))
    await expect(listSpaceReadPrincipals(CLOUD, 'token', 'space-1')).resolves.toEqual([
      { kind: 'user', id: 'direct-user' },
      { kind: 'group', id: 'admins' },
    ])
    expect(String(mockFetch.mock.calls[1][0])).toContain('/spaces/space-1/role-assignments?')
    expect(new URL(String(mockFetch.mock.calls[2][0])).searchParams.get('accessType')).toBe('admin')
  })

  it.each(['denied', 'empty-continuation', 'missing-id'])(
    'fails closed on %s access group enumeration',
    async (failure) => {
      mockFetch
        .mockResolvedValueOnce(
          jsonResponse({
            results: [
              {
                principal: { type: 'access-class', id: 'ALL_PRODUCT_ADMINS' },
                operation: { key: 'read', targetType: 'space' },
              },
            ],
          })
        )
        .mockResolvedValueOnce(
          jsonResponse({
            results: [{ id: 'first' }],
            size: 1,
            _links: { next: '/rest/api/group?start=1' },
          })
        )
        .mockResolvedValueOnce(
          failure === 'denied'
            ? jsonResponse({}, 403)
            : failure === 'empty-continuation'
              ? jsonResponse({ results: [], _links: { next: '/rest/api/group?start=1' } })
              : jsonResponse({ results: [{ name: 'not-an-id' }] })
        )
      await expect(listSpaceReadPrincipals(CLOUD, 'token', 'space-1')).rejects.toThrow()
    }
  )

  it('legitimately grants nobody when an access class has no groups', async () => {
    mockFetch
      .mockResolvedValueOnce(
        jsonResponse({
          results: [
            {
              principal: { type: 'access-class', id: 'ALL_PRODUCT_ADMINS' },
              operation: { key: 'read', targetType: 'space' },
            },
          ],
        })
      )
      .mockResolvedValueOnce(jsonResponse({ results: [] }))
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

  it.each([
    '/wiki/api/v2/spaces/1/permissions?cursor=next',
    '/wiki/api/v2/spaces/1/permissions?limit=250',
  ])(
    'rejects a repeated or missing cursor without publishing partial permissions: %s',
    async (next) => {
      mockFetch
        .mockResolvedValueOnce(
          jsonResponse({ results: [{ id: 'first' }], _links: { next: '?cursor=next' } })
        )
        .mockResolvedValueOnce(jsonResponse({ results: [{ id: 'second' }], _links: { next } }))

      await expect(listSpaceReadPrincipals(CLOUD, 'token', 'space-1')).rejects.toThrow(
        'invalid or repeated permission continuation'
      )
      expect(mockFetch).toHaveBeenCalledTimes(2)
    }
  )

  it('rejects a malformed collection instead of treating it as a verified empty grant', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({}))
    await expect(listSpaceReadPrincipals(CLOUD, 'token', 'space-1')).rejects.toThrow(
      'invalid permission page'
    )
  })

  it('does not return a partial reader list when a later permission page fails', async () => {
    mockFetch
      .mockResolvedValueOnce(
        jsonResponse({
          results: [
            {
              principal: { type: 'user', id: 'reader' },
              operation: { key: 'read', targetType: 'space' },
            },
          ],
          _links: { next: '?cursor=next' },
        })
      )
      .mockResolvedValueOnce(jsonResponse({}, 403))
    await expect(listSpaceReadPrincipals(CLOUD, 'token', 'space')).rejects.toThrow('403')
    expect(mockFetch).toHaveBeenCalledTimes(2)
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

  it.each([150, 0, undefined])(
    'drains capped user restrictions with totalSize %s',
    async (totalSize) => {
      const users = Array.from({ length: 150 }, (_, i) => ({ accountId: `user-${i}` }))
      for (const start of [0, 100]) {
        const results = users.slice(start, start + 100)
        mockFetch.mockResolvedValueOnce(
          jsonResponse({
            restrictions: {
              user: { results, start, limit: 100, size: results.length, totalSize },
              group: { results: [] },
            },
          })
        )
      }

      await expect(getReadRestriction(CLOUD, 'token', 'page-1')).resolves.toEqual(
        users.map((user) => ({ kind: 'user', id: user.accountId }))
      )
      expect(
        mockFetch.mock.calls.map(([url]) => new URL(String(url)).searchParams.get('start'))
      ).toEqual(['0', '100'])
    }
  )

  it('bounds a provider that never finishes restriction pagination', async () => {
    mockFetch.mockImplementation(async (url: string) => {
      const start = Number(new URL(url).searchParams.get('start'))
      return jsonResponse({
        restrictions: {
          user: { results: [{ accountId: `user-${start}` }], start, limit: 1, size: 1 },
          group: { results: [] },
        },
      })
    })

    await expect(getReadRestriction(CLOUD, 'token', 'page-1')).rejects.toThrow('exceeded 100 pages')
    expect(mockFetch).toHaveBeenCalledTimes(100)
  })

  it.each([
    {},
    { restrictions: {} },
    { restrictions: { user: { results: [] }, group: {} } },
    { restrictions: { user: {}, group: { results: [] } } },
    { restrictions: { user: { results: [] }, group: { results: {} } } },
  ])(
    'rejects incomplete restriction data rather than inheriting space access: %j',
    async (body) => {
      mockFetch.mockResolvedValueOnce(jsonResponse(body))
      await expect(getReadRestriction(CLOUD, 'token', 'page-1')).rejects.toThrow(
        'expanded read-restriction collection'
      )
    }
  )
})

describe('listAncestorIds', () => {
  it('refuses cyclic ancestors instead of returning a partial grant chain', async () => {
    mockFetch
      .mockResolvedValueOnce(jsonResponse({ results: [{ id: 'parent' }] }))
      .mockResolvedValueOnce(jsonResponse({ results: [{ id: 'page-1' }] }))
    await expect(listAncestorIds(CLOUD, 'token', 'page-1')).rejects.toThrow('cyclic')
    expect(mockFetch).toHaveBeenCalledTimes(2)
  })

  it('fails closed when a later ancestor page is unreadable', async () => {
    mockFetch
      .mockResolvedValueOnce(jsonResponse({ results: [{ id: 'parent' }] }))
      .mockResolvedValueOnce(jsonResponse({}, 403))
    await expect(listAncestorIds(CLOUD, 'token', 'page-1')).rejects.toThrow('403')
  })
})

describe('listGroupMemberTokens', () => {
  const GROUP = { id: 'grp-1' }

  it('uses opaque account IDs even when every email is hidden', async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        results: [
          { accountId: '712020:Alice', accountType: 'atlassian', email: null },
          { accountId: 'app-subject', accountType: 'app' },
          { accountId: '712020:Alice', email: null },
        ],
      })
    )
    await expect(listGroupMemberTokens(CLOUD, 'token', GROUP)).resolves.toEqual({
      group: GROUP,
      memberTokens: ['s:confluence:-:712020:Alice', 's:confluence:-:app-subject'],
      complete: true,
    })
    expect(mockFetch).toHaveBeenCalledTimes(1)
    const request = new URL(String(mockFetch.mock.calls[0][0]))
    expect(request.pathname).toContain('/group/grp-1/membersByGroupId')
    expect(request.searchParams.get('limit')).toBe('200')
  })

  it('fails instead of freshening a partial membership on provider failure', async () => {
    mockFetch
      .mockResolvedValueOnce(
        jsonResponse({ results: [{ accountId: 'alice' }], _links: { next: '/next' } })
      )
      .mockResolvedValueOnce(jsonResponse({}, 403))
    await expect(listGroupMemberTokens(CLOUD, 'token', GROUP)).rejects.toThrow('403')
  })

  it('allows a confirmed empty group to revoke all former memberships', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ results: [] }))
    await expect(listGroupMemberTokens(CLOUD, 'token', GROUP)).resolves.toEqual({
      group: GROUP,
      memberTokens: [],
      complete: true,
    })
  })
})
