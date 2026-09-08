/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { listDomainGroups, openGoogleDirectory } from '@/connectors/google-drive/directory'

const mockFetch = vi.fn()

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

/** Routes each request by the group id in its path, so nesting can be described declaratively. */
function directory(members: Record<string, unknown[]>, groups: unknown[] = []) {
  mockFetch.mockImplementation(async (url: string) => {
    const path = new URL(String(url)).pathname
    const match = path.match(/\/groups\/([^/]+)\/members$/)
    if (match) {
      const key = decodeURIComponent(match[1])
      return jsonResponse({ members: members[key] ?? [] })
    }
    if (path.endsWith('/customer/my_customer/domains')) {
      return jsonResponse({
        domains: [
          { domainName: 'Corp.com', domainAliases: [{ domainAliasName: 'corp.io' }] },
          { domainName: 'sub.corp.com' },
        ],
      })
    }
    return jsonResponse({ groups })
  })
}

const USER = (email: string) => ({ email, type: 'USER', status: 'ACTIVE' })
const NESTED = (email: string) => ({ email, type: 'GROUP' })

describe('listDomainGroups', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', mockFetch)
  })

  it('folds group emails so they match the tokens a crawl writes', async () => {
    directory({}, [{ email: 'Eng@Corp.com', name: 'Engineering' }])

    await expect(listDomainGroups('token')).resolves.toEqual([{ id: 'eng@corp.com' }])
  })

  it('drops a group with no email, which is the only identifier a grant carries', async () => {
    directory({}, [{ name: 'Nameless' }, { email: 'eng@corp.com' }])

    await expect(listDomainGroups('token')).resolves.toEqual([{ id: 'eng@corp.com' }])
  })

  it('follows pagination rather than reporting the first page as the whole directory', async () => {
    mockFetch
      .mockResolvedValueOnce(
        jsonResponse({ groups: [{ email: 'a@corp.com' }], nextPageToken: 'p2' })
      )
      .mockResolvedValueOnce(jsonResponse({ groups: [{ email: 'b@corp.com' }] }))

    await expect(listDomainGroups('token')).resolves.toHaveLength(2)
  })

  it('throws rather than returning a truncated directory', async () => {
    mockFetch.mockReset()
    mockFetch.mockResolvedValueOnce(jsonResponse({ error: { message: 'forbidden' } }, 403))

    await expect(listDomainGroups('token')).rejects.toThrow()
  })
})

describe('the membership a directory reports', () => {
  const GROUP = { id: 'eng@corp.com' }

  /** The walk is reached the way the sync reaches it, through the directory. */
  function membersOf(group: { id: string }) {
    const dir = openGoogleDirectory('google-drive', 'token', 'admin@corp.com')
    if (!dir) throw new Error('the administrator names no domain')
    return dir.listGroupMembers(group)
  }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', mockFetch)
  })

  it('reports the people in a flat group, case-folded', async () => {
    directory({ 'eng@corp.com': [USER('Alice@Corp.com'), USER('bob@corp.com')] })

    await expect(membersOf(GROUP)).resolves.toEqual({
      group: GROUP,
      memberTokens: ['u:alice@corp.com', 'u:bob@corp.com'],
      complete: true,
    })
  })

  it('follows nested groups to the people inside them', async () => {
    directory({
      'eng@corp.com': [USER('alice@corp.com'), NESTED('backend@corp.com')],
      'backend@corp.com': [USER('bob@corp.com'), NESTED('platform@corp.com')],
      'platform@corp.com': [USER('carol@corp.com')],
    })

    const { memberTokens, complete } = await membersOf(GROUP)

    expect(memberTokens.sort()).toEqual(['u:alice@corp.com', 'u:bob@corp.com', 'u:carol@corp.com'])
    expect(complete).toBe(true)
  })

  it('terminates on a directory that nests a group inside itself', async () => {
    directory({
      'eng@corp.com': [USER('alice@corp.com'), NESTED('backend@corp.com')],
      'backend@corp.com': [USER('bob@corp.com'), NESTED('eng@corp.com')],
    })

    const { memberTokens, complete } = await membersOf(GROUP)

    expect(memberTokens.sort()).toEqual(['u:alice@corp.com', 'u:bob@corp.com'])
    expect(complete).toBe(true)
  })

  it('reports an incomplete walk rather than a truncated membership', async () => {
    const members: Record<string, unknown[]> = {}
    for (let depth = 0; depth <= 32; depth += 1) {
      members[`g${depth}@corp.com`] = [USER(`u${depth}@corp.com`), NESTED(`g${depth + 1}@corp.com`)]
    }
    directory(members)

    const { complete } = await membersOf({ id: 'g0@corp.com' })

    expect(complete).toBe(false)
  })

  it('stops the entire nested traversal when unique flattened members exceed the budget', async () => {
    const fetchedGroups: string[] = []
    mockFetch.mockImplementation(async (url: string) => {
      const parsed = new URL(url)
      if (parsed.pathname.endsWith('/domains')) return jsonResponse({ domains: [] })
      const group = decodeURIComponent(parsed.pathname.match(/\/groups\/([^/]+)\/members$/)![1])
      fetchedGroups.push(group)
      if (group === GROUP.id)
        return jsonResponse({
          members: [
            NESTED('a@corp.com'),
            NESTED('b@corp.com'),
            NESTED('c@corp.com'),
            NESTED('never@corp.com'),
          ],
        })
      const page = Number(parsed.searchParams.get('pageToken') ?? '0')
      return jsonResponse({
        members: Array.from({ length: 200 }, (_, index) =>
          USER(`${group[0]}${page * 200 + index}@corp.com`)
        ),
        ...(page < 199 ? { nextPageToken: String(page + 1) } : {}),
      })
    })

    const result = await membersOf(GROUP)
    expect(result.complete).toBe(false)
    expect(result.memberTokens).toHaveLength(100_000)
    expect(fetchedGroups).not.toContain('never@corp.com')
  })

  it('bounds unique visited groups even when they contain no people', async () => {
    let groupReads = 0
    mockFetch.mockImplementation(async (url: string) => {
      const parsed = new URL(url)
      if (parsed.pathname.endsWith('/domains')) return jsonResponse({ domains: [] })
      const group = decodeURIComponent(parsed.pathname.match(/\/groups\/([^/]+)\/members$/)![1])
      groupReads += 1
      if (group === GROUP.id) {
        const page = Number(parsed.searchParams.get('pageToken') ?? '0')
        return jsonResponse({
          members: Array.from({ length: 200 }, (_, index) =>
            NESTED(`branch${page * 200 + index}@corp.com`)
          ),
          ...(page < 4 ? { nextPageToken: String(page + 1) } : {}),
        })
      }
      if (group.startsWith('branch'))
        return jsonResponse({
          members: Array.from({ length: 100 }, (_, index) => NESTED(`leaf${index}-${group}`)),
        })
      return jsonResponse({ members: [] })
    })

    const result = await membersOf(GROUP)
    expect(result).toEqual({ group: GROUP, memberTokens: [], complete: false })
    /** Five root pages account for four requests beyond the unique-group budget. */
    expect(groupReads).toBe(100_004)
  }, 15_000)

  it('excludes a member the directory does not currently count as active', async () => {
    directory({
      'eng@corp.com': [
        USER('alice@corp.com'),
        { email: 'suspended@corp.com', type: 'USER', status: 'SUSPENDED' },
      ],
    })

    await expect(membersOf(GROUP)).resolves.toMatchObject({
      memberTokens: ['u:alice@corp.com'],
    })
  })

  it('throws when a group cannot be read, so its membership is left alone', async () => {
    directory({})
    mockFetch.mockImplementationOnce(async () => jsonResponse({ error: { message: 'gone' } }, 404))

    await expect(membersOf(GROUP)).rejects.toThrow()
  })

  /** A directory that hiccups must not cost a group its membership; transient errors are retried. */
  it('retries a transient directory error before giving up', async () => {
    directory({ 'eng@corp.com': [USER('alice@corp.com')] })
    const healthy = mockFetch.getMockImplementation()!
    let firstMemberRead = true
    mockFetch.mockImplementation(async (url: string, init?: RequestInit) => {
      if (String(url).includes('/members') && firstMemberRead) {
        firstMemberRead = false
        return jsonResponse(
          { error: { errors: [{ reason: 'backendError' }], message: 'try again' } },
          503
        )
      }
      return healthy(url, init)
    })

    await expect(membersOf(GROUP)).resolves.toMatchObject({
      memberTokens: ['u:alice@corp.com'],
      complete: true,
    })
  })
})

describe('openGoogleDirectory', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', mockFetch)
  })

  it('lists one synthetic group per domain the customer owns, after the real groups', async () => {
    directory({}, [{ email: 'eng@corp.com' }])
    const dir = openGoogleDirectory('google-drive', 'token', 'admin@corp.com')

    await expect(dir?.listGroups()).resolves.toEqual([
      { id: 'eng@corp.com' },
      { id: 'domain:corp.com' },
      { id: 'domain:corp.io' },
      { id: 'domain:sub.corp.com' },
    ])
  })

  /** The wildcard is what a reader at that domain matches; nobody is enumerated. */
  it('answers a synthetic domain group with its wildcard member and no directory call', async () => {
    directory({})
    const dir = openGoogleDirectory('google-drive', 'token', 'admin@corp.com')

    await expect(dir?.listGroupMembers({ id: 'domain:corp.com' })).resolves.toEqual({
      group: { id: 'domain:corp.com' },
      memberTokens: ['u:*@corp.com'],
      complete: true,
    })
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('stores a CUSTOMER member as the wildcard of every domain the customer owns', async () => {
    directory({ 'all@corp.com': [{ type: 'CUSTOMER', status: 'ACTIVE' }, USER('bob@corp.com')] })
    const dir = openGoogleDirectory('google-drive', 'token', 'admin@corp.com')

    const { memberTokens, complete } = await dir!.listGroupMembers({ id: 'all@corp.com' })

    expect(complete).toBe(true)
    expect(memberTokens.sort()).toEqual([
      'u:*@corp.com',
      'u:*@corp.io',
      'u:*@sub.corp.com',
      'u:bob@corp.com',
    ])
  })

  it('carries the provider and tenant every token of the directory names', () => {
    expect(openGoogleDirectory('google-drive', 'token', 'Admin@Corp.com')).toMatchObject({
      providerId: 'google-drive',
      tenantId: 'corp.com',
    })
    expect(openGoogleDirectory('google-drive', 'token', undefined)).toBeNull()
  })
})
