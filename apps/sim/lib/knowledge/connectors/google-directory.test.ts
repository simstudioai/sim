/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MAX_GROUP_NESTING_DEPTH } from '@/lib/knowledge/access/external-groups'
import { listDomainGroups, listGroupMembers } from '@/lib/knowledge/connectors/google-directory'

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

    await expect(listDomainGroups('token', 'corp.com')).resolves.toEqual([
      { id: 'eng@corp.com', displayName: 'Engineering' },
    ])
  })

  it('drops a group with no email, which is the only identifier a grant carries', async () => {
    directory({}, [{ name: 'Nameless' }, { email: 'eng@corp.com' }])

    await expect(listDomainGroups('token', 'corp.com')).resolves.toEqual([{ id: 'eng@corp.com' }])
  })

  it('follows pagination rather than reporting the first page as the whole directory', async () => {
    mockFetch
      .mockResolvedValueOnce(
        jsonResponse({ groups: [{ email: 'a@corp.com' }], nextPageToken: 'p2' })
      )
      .mockResolvedValueOnce(jsonResponse({ groups: [{ email: 'b@corp.com' }] }))

    await expect(listDomainGroups('token', 'corp.com')).resolves.toHaveLength(2)
  })

  it('throws rather than returning a truncated directory', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ error: 'nope' }, 403))

    await expect(listDomainGroups('token', 'corp.com')).rejects.toThrow('403')
  })
})

describe('listGroupMembers', () => {
  const GROUP = { id: 'eng@corp.com' }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', mockFetch)
  })

  it('reports the people in a flat group, case-folded', async () => {
    directory({ 'eng@corp.com': [USER('Alice@Corp.com'), USER('bob@corp.com')] })

    await expect(listGroupMembers('token', GROUP)).resolves.toEqual({
      group: GROUP,
      memberEmails: ['alice@corp.com', 'bob@corp.com'],
      complete: true,
    })
  })

  /**
   * The deviation from Onyx that matters here: they read one level, so a person
   * who belongs only through a subgroup gets nothing despite the source
   * granting them access.
   */
  it('follows nested groups to the people inside them', async () => {
    directory({
      'eng@corp.com': [USER('alice@corp.com'), NESTED('backend@corp.com')],
      'backend@corp.com': [USER('bob@corp.com'), NESTED('platform@corp.com')],
      'platform@corp.com': [USER('carol@corp.com')],
    })

    const { memberEmails, complete } = await listGroupMembers('token', GROUP)

    expect(memberEmails.sort()).toEqual(['alice@corp.com', 'bob@corp.com', 'carol@corp.com'])
    expect(complete).toBe(true)
  })

  it('terminates on a directory that nests a group inside itself', async () => {
    directory({
      'eng@corp.com': [USER('alice@corp.com'), NESTED('backend@corp.com')],
      'backend@corp.com': [USER('bob@corp.com'), NESTED('eng@corp.com')],
    })

    const { memberEmails, complete } = await listGroupMembers('token', GROUP)

    expect(memberEmails.sort()).toEqual(['alice@corp.com', 'bob@corp.com'])
    expect(complete).toBe(true)
  })

  it('reports an incomplete walk rather than a truncated membership', async () => {
    const members: Record<string, unknown[]> = {}
    for (let depth = 0; depth <= MAX_GROUP_NESTING_DEPTH + 1; depth += 1) {
      members[`g${depth}@corp.com`] = [USER(`u${depth}@corp.com`), NESTED(`g${depth + 1}@corp.com`)]
    }
    directory(members)

    const { complete } = await listGroupMembers('token', { id: 'g0@corp.com' })

    expect(complete).toBe(false)
  })

  it('excludes a member the directory does not currently count as active', async () => {
    directory({
      'eng@corp.com': [
        USER('alice@corp.com'),
        { email: 'suspended@corp.com', type: 'USER', status: 'SUSPENDED' },
      ],
    })

    await expect(listGroupMembers('token', GROUP)).resolves.toMatchObject({
      memberEmails: ['alice@corp.com'],
    })
  })

  it('throws when a group cannot be read, so its membership is left alone', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ error: 'nope' }, 500))

    await expect(listGroupMembers('token', GROUP)).rejects.toThrow('500')
  })
})
