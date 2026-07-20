/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { gitlabGetGroupTool } from '@/tools/gitlab/get_group'
import { gitlabListGroupsTool } from '@/tools/gitlab/list_groups'
import { gitlabListUserMembershipsTool } from '@/tools/gitlab/list_user_memberships'

interface MockResponseOptions {
  ok?: boolean
  status?: number
  json?: unknown
  text?: string
  headers?: Record<string, string>
}

function mockResponse({
  ok = true,
  status = 200,
  json,
  text = '',
  headers = {},
}: MockResponseOptions): Response {
  return {
    ok,
    status,
    json: async () => json,
    text: async () => text,
    headers: {
      get: (key: string) => headers[key.toLowerCase()] ?? null,
    },
  } as unknown as Response
}

describe('gitlab_get_group', () => {
  it('builds the group endpoint and URL-encodes a namespaced path', () => {
    expect(gitlabGetGroupTool.request.url({ accessToken: 'pat', groupId: '42' })).toBe(
      'https://gitlab.com/api/v4/groups/42'
    )
    expect(gitlabGetGroupTool.request.url({ accessToken: 'pat', groupId: 'parent/child' })).toBe(
      'https://gitlab.com/api/v4/groups/parent%2Fchild'
    )
  })

  it('honors a self-managed host', () => {
    expect(
      gitlabGetGroupTool.request.url({
        accessToken: 'pat',
        host: 'gitlab.example.com',
        groupId: '7',
      })
    ).toBe('https://gitlab.example.com/api/v4/groups/7')
  })

  it('returns the group on success', async () => {
    const result = await gitlabGetGroupTool.transformResponse?.(
      mockResponse({ json: { id: 42, name: 'Platform' } }),
      {} as never
    )
    expect(result?.success).toBe(true)
    expect(result?.output.group).toEqual({ id: 42, name: 'Platform' })
  })

  it('surfaces API errors', async () => {
    const result = await gitlabGetGroupTool.transformResponse?.(
      mockResponse({ ok: false, status: 404, text: 'Not found' }),
      {} as never
    )
    expect(result?.success).toBe(false)
    expect(result?.error).toContain('404')
  })
})

describe('gitlab_list_groups', () => {
  it('lists groups with no filters', () => {
    expect(gitlabListGroupsTool.request.url({ accessToken: 'pat' })).toBe(
      'https://gitlab.com/api/v4/groups'
    )
  })

  it('forwards filters and pagination', () => {
    const url = gitlabListGroupsTool.request.url({
      accessToken: 'pat',
      owned: true,
      search: 'plat',
      topLevelOnly: true,
      orderBy: 'name',
      sort: 'asc',
      perPage: 50,
      page: 2,
    })
    expect(url).toBe(
      'https://gitlab.com/api/v4/groups?owned=true&search=plat&top_level_only=true&order_by=name&sort=asc&per_page=50&page=2'
    )
  })

  it('forwards the documented visibility, min-access-level, and all-available filters', () => {
    const url = gitlabListGroupsTool.request.url({
      accessToken: 'pat',
      visibility: 'private',
      minAccessLevel: 30,
      allAvailable: true,
    })
    expect(url).toBe(
      'https://gitlab.com/api/v4/groups?visibility=private&min_access_level=30&all_available=true'
    )
  })

  it('rejects an out-of-enum minimum access level instead of sending it to GitLab', () => {
    expect(() =>
      gitlabListGroupsTool.request.url({ accessToken: 'pat', minAccessLevel: 31 })
    ).toThrow(/Invalid GitLab access level/)
    expect(() =>
      gitlabListGroupsTool.request.url({ accessToken: 'pat', minAccessLevel: 0 })
    ).toThrow(/Invalid GitLab access level/)
  })

  it('rejects similarity ordering without a search term, but allows it with one', () => {
    expect(() =>
      gitlabListGroupsTool.request.url({ accessToken: 'pat', orderBy: 'similarity' })
    ).toThrow(/similarity/)
    expect(
      gitlabListGroupsTool.request.url({
        accessToken: 'pat',
        orderBy: 'similarity',
        search: 'plat',
      })
    ).toBe('https://gitlab.com/api/v4/groups?search=plat&order_by=similarity')
  })

  it('reads the total from the x-total header, falling back to length', async () => {
    const withHeader = await gitlabListGroupsTool.transformResponse?.(
      mockResponse({ json: [{ id: 1 }, { id: 2 }], headers: { 'x-total': '17' } }),
      {} as never
    )
    expect(withHeader?.output.total).toBe(17)

    const withoutHeader = await gitlabListGroupsTool.transformResponse?.(
      mockResponse({ json: [{ id: 1 }, { id: 2 }] }),
      {} as never
    )
    expect(withoutHeader?.output.total).toBe(2)
  })
})

describe('gitlab_list_user_memberships', () => {
  it('builds the admin memberships endpoint', () => {
    expect(gitlabListUserMembershipsTool.request.url({ accessToken: 'pat', userId: '7' })).toBe(
      'https://gitlab.com/api/v4/users/7/memberships'
    )
  })

  it('forwards the type filter and pagination', () => {
    const url = gitlabListUserMembershipsTool.request.url({
      accessToken: 'pat',
      userId: '7',
      membershipType: 'Namespace',
      perPage: 25,
      page: 3,
    })
    expect(url).toBe(
      'https://gitlab.com/api/v4/users/7/memberships?type=Namespace&per_page=25&page=3'
    )
  })

  it('returns memberships on success', async () => {
    const result = await gitlabListUserMembershipsTool.transformResponse?.(
      mockResponse({
        json: [{ source_id: 1, source_name: 'grp', source_type: 'Namespace', access_level: 30 }],
        headers: { 'x-total': '1' },
      }),
      {} as never
    )
    expect(result?.success).toBe(true)
    expect(result?.output.memberships).toHaveLength(1)
    expect(result?.output.total).toBe(1)
  })

  it('surfaces a 403 for a non-admin token', async () => {
    const result = await gitlabListUserMembershipsTool.transformResponse?.(
      mockResponse({ ok: false, status: 403, text: 'Forbidden' }),
      {} as never
    )
    expect(result?.success).toBe(false)
    expect(result?.error).toContain('403')
  })
})
