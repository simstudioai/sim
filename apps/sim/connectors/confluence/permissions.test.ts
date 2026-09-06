/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getReadRestriction,
  listAncestorIds,
  listGroupMemberTokens,
  listSpaceReadPrincipals,
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

  it('expands flattened licensed and admin classes into unique provider groups', async () => {
    mockFetch
      .mockResolvedValueOnce(
        jsonResponse({
          results: ['ALL_LICENSED_USERS', 'ALL_PRODUCT_ADMINS', 'ALL_LICENSED_USERS'].map((id) => ({
            principal: { type: 'access-class', id },
            operation: { key: 'read', targetType: 'space' },
          })),
        })
      )
      .mockResolvedValueOnce(jsonResponse({ results: [{ id: 'staff' }, { id: 'both' }] }))
      .mockResolvedValueOnce(jsonResponse({ results: [{ id: 'admins' }, { id: 'both' }] }))

    await expect(listSpaceReadPrincipals(CLOUD, 'token', 'space-1')).resolves.toEqual([
      { kind: 'group', id: 'staff' },
      { kind: 'group', id: 'both' },
      { kind: 'group', id: 'admins' },
    ])
    expect(
      mockFetch.mock.calls
        .slice(1)
        .map(([url]) => new URL(String(url)).searchParams.get('accessType'))
    ).toEqual(['user', 'admin'])
    expect(
      mockFetch.mock.calls.every(([url]) => String(url).includes(`/ex/confluence/${CLOUD}/`))
    ).toBe(true)
  })

  it('includes admin-only licensed users even when no admin class is assigned', async () => {
    mockFetch
      .mockResolvedValueOnce(
        jsonResponse({
          results: [
            {
              principal: { type: 'ACCESS_CLASS', id: 'ALL_LICENSED_USERS' },
              operation: { key: 'read', targetType: 'space' },
            },
          ],
        })
      )
      .mockResolvedValueOnce(jsonResponse({ results: [] }))
      .mockResolvedValueOnce(jsonResponse({ results: [{ id: 'admins' }] }))
    await expect(listSpaceReadPrincipals(CLOUD, 'token', 'space-1')).resolves.toEqual([
      { kind: 'group', id: 'admins' },
    ])
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

  it('drains access groups despite short pages and preserves its access filter', async () => {
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
      .mockResolvedValueOnce(jsonResponse({ results: [{ id: 'second' }] }))
    await expect(listSpaceReadPrincipals(CLOUD, 'token', 'space-1')).resolves.toEqual([
      { kind: 'group', id: 'first' },
      { kind: 'group', id: 'second' },
    ])
    const query = new URL(String(mockFetch.mock.calls[2][0])).searchParams
    expect(query.get('accessType')).toBe('admin')
    expect(query.get('start')).toBe('1')
    expect(query.get('limit')).toBe('200')
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

  it('bounds an access group provider that never terminates', async () => {
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
      .mockImplementation(async () =>
        jsonResponse({ results: [{ id: 'repeated' }], _links: { next: '/rest/api/group?start=1' } })
      )
    await expect(listSpaceReadPrincipals(CLOUD, 'token', 'space-1')).rejects.toThrow(
      'exceeded 100 pages'
    )
    expect(mockFetch).toHaveBeenCalledTimes(101)
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

  it('keeps provider account IDs without relying on disclosed email', async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        restrictions: {
          user: { results: [{ accountId: 'acc-1', email: 'alice@corp.com' }] },
          group: { results: [{ id: 'grp-1' }] },
        },
      })
    )

    await expect(getReadRestriction(CLOUD, 'token', 'page-1')).resolves.toEqual([
      { kind: 'user', id: 'acc-1' },
      { kind: 'group', id: 'grp-1' },
    ])
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

  it('rejects an incomplete continuation after reading some restrictions', async () => {
    mockFetch
      .mockResolvedValueOnce(
        jsonResponse({
          restrictions: {
            user: { results: Array.from({ length: 250 }, (_, i) => ({ accountId: `user-${i}` })) },
            group: { results: [] },
          },
        })
      )
      .mockResolvedValueOnce(jsonResponse({}))
    await expect(getReadRestriction(CLOUD, 'token', 'page-1')).rejects.toThrow(
      'expanded read-restriction collection'
    )
  })

  it('keeps a withheld address as absent rather than inventing one', async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        restrictions: {
          user: { results: [{ accountId: 'acc-1', email: null }] },
          group: { results: [] },
        },
      })
    )

    await expect(getReadRestriction(CLOUD, 'token', 'page-1')).resolves.toEqual([
      { kind: 'user', id: 'acc-1' },
    ])
  })
})

describe('listAncestorIds', () => {
  /** Each ancestor restriction remains a separate required grant. */
  it('returns ancestors closest parent first', async () => {
    mockFetch
      .mockResolvedValueOnce(
        jsonResponse({ results: [{ id: 'root' }, { id: 'section' }, { id: 'parent' }] })
      )
      .mockResolvedValueOnce(jsonResponse({ results: [] }))

    await expect(listAncestorIds(CLOUD, 'token', 'page-1')).resolves.toEqual([
      'parent',
      'section',
      'root',
    ])
    expect(String(mockFetch.mock.calls[0][0])).toContain('/api/v2/pages/page-1/ancestors')
  })

  it('continues from the first ancestor despite a short batch without next links', async () => {
    mockFetch
      .mockResolvedValueOnce(
        jsonResponse({
          results: [
            { id: 'section', type: 'page' },
            { id: 'parent', type: 'page' },
          ],
        })
      )
      .mockResolvedValueOnce(jsonResponse({ results: [{ id: 'root', type: 'page' }] }))
      .mockResolvedValueOnce(jsonResponse({ results: [] }))
    await expect(listAncestorIds(CLOUD, 'token', 'page-1')).resolves.toEqual([
      'parent',
      'section',
      'root',
    ])
    expect(mockFetch.mock.calls.map(([url]) => new URL(String(url)).pathname)).toEqual([
      '/ex/confluence/cloud-1/wiki/api/v2/pages/page-1/ancestors',
      '/ex/confluence/cloud-1/wiki/api/v2/pages/section/ancestors',
      '/ex/confluence/cloud-1/wiki/api/v2/pages/root/ancestors',
    ])
  })

  it('continues through a folder using its own ancestor endpoint', async () => {
    mockFetch
      .mockResolvedValueOnce(jsonResponse({ results: [{ id: 'folder', type: 'folder' }] }))
      .mockResolvedValueOnce(jsonResponse({ results: [{ id: 'root', type: 'page' }] }))
      .mockResolvedValueOnce(jsonResponse({ results: [] }))
    await expect(listAncestorIds(CLOUD, 'token', 'page-1')).resolves.toEqual(['folder', 'root'])
    expect(String(mockFetch.mock.calls[1][0])).toContain('/folders/folder/ancestors?')
  })

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

  it('bounds a provider that never reaches a root', async () => {
    let page = 0
    mockFetch.mockImplementation(async () =>
      jsonResponse({ results: [{ id: `ancestor-${page++}` }] })
    )
    await expect(listAncestorIds(CLOUD, 'token', 'page-1')).rejects.toThrow('exceeded 100 pages')
    expect(mockFetch).toHaveBeenCalledTimes(100)
  })

  it('reports a top-level page as having no ancestors', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ results: [] }))

    await expect(listAncestorIds(CLOUD, 'token', 'page-1')).resolves.toEqual([])
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

  it('drains all member pages and preserves case-sensitive identities', async () => {
    mockFetch
      .mockResolvedValueOnce(
        jsonResponse({ results: [{ accountId: 'Alice' }], size: 1, _links: { next: '/next' } })
      )
      .mockResolvedValueOnce(jsonResponse({ results: [{ accountId: 'alice' }] }))
    await expect(listGroupMemberTokens(CLOUD, 'token', GROUP)).resolves.toEqual({
      group: GROUP,
      memberTokens: ['s:confluence:-:Alice', 's:confluence:-:alice'],
      complete: true,
    })
    expect(new URL(String(mockFetch.mock.calls[1][0])).searchParams.get('start')).toBe('1')
  })

  it('fails instead of freshening a partial membership on provider failure', async () => {
    mockFetch
      .mockResolvedValueOnce(
        jsonResponse({ results: [{ accountId: 'alice' }], _links: { next: '/next' } })
      )
      .mockResolvedValueOnce(jsonResponse({}, 403))
    await expect(listGroupMemberTokens(CLOUD, 'token', GROUP)).rejects.toThrow('403')
  })

  it('refuses incomplete source identities instead of guessing from email', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ results: [{ email: 'alice@example.com' }] }))
    await expect(listGroupMemberTokens(CLOUD, 'token', GROUP)).rejects.toThrow('account id')
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
