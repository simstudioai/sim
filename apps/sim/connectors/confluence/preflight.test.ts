/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { confluenceConnector } from '@/connectors/confluence/confluence'

const CONFIG = { domain: 'example.atlassian.net', spaceKey: ['ENG', 'PRODUCT'] }
const CONTEXT = {
  cloudId: 'cloud-1',
  credentialDomain: 'example.atlassian.net',
  mirrorsSourceAcls: true,
}
const fetchMock = vi.fn<typeof fetch>()

function pathOf(input: string | URL | Request): string {
  return new URL(input instanceof Request ? input.url : String(input)).pathname
}

function responseFor(path: string): Response {
  if (path.endsWith('/spaces')) {
    return Response.json({
      results: [
        { id: '101', key: 'ENG' },
        { id: '102', key: 'PRODUCT' },
      ],
    })
  }
  if (path.endsWith('/group')) {
    return Response.json({ results: [{ id: 'group-1' }] })
  }
  if (path.endsWith('/permissions')) {
    return Response.json({
      results: [{ principal: { type: 'role' }, operation: { key: 'read', targetType: 'space' } }],
    })
  }
  if (path.endsWith('/pages')) return Response.json({ results: [{ id: '201' }] })
  if (path.endsWith('/blogposts')) return Response.json({ results: [{ id: '301' }] })
  if (path.endsWith('/restriction/byOperation/read')) {
    return Response.json({ restrictions: { user: { results: [] }, group: { results: [] } } })
  }
  return Response.json({ results: [] })
}

function requestPaths(): string[] {
  return fetchMock.mock.calls.map(([input]) => pathOf(input))
}

beforeEach(() => {
  fetchMock.mockReset()
  fetchMock.mockImplementation(async (input) => responseFor(pathOf(input)))
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('Confluence mirrored permission preflight', () => {
  it('accepts a central token after checking directory, membership, roles, and page permissions', async () => {
    await expect(confluenceConnector.validateConfig('token', CONFIG, CONTEXT)).resolves.toEqual({
      valid: true,
    })
    expect(requestPaths()).toEqual(
      expect.arrayContaining([
        '/ex/confluence/cloud-1/wiki/rest/api/group',
        '/ex/confluence/cloud-1/wiki/rest/api/group/group-1/membersByGroupId',
        '/ex/confluence/cloud-1/wiki/api/v2/spaces/101/permissions',
        '/ex/confluence/cloud-1/wiki/api/v2/spaces/101/role-assignments',
        '/ex/confluence/cloud-1/wiki/rest/api/content/201/restriction/byOperation/read',
        '/ex/confluence/cloud-1/wiki/api/v2/pages/201/ancestors',
      ])
    )
    expect(fetchMock).toHaveBeenCalledTimes(8)
  })

  it.each([
    [undefined, undefined],
    [false, true],
    ['true', undefined],
  ])(
    'does not require permission reads without the trusted central flag (%s)',
    async (mirrorsSourceAcls, perMemberListing) => {
      await expect(
        confluenceConnector.validateConfig('token', CONFIG, {
          ...CONTEXT,
          mirrorsSourceAcls,
          perMemberListing,
        })
      ).resolves.toEqual({ valid: true })
      expect(fetchMock).toHaveBeenCalledTimes(1)
    }
  )

  it.each([
    ['/group', 'group directory', 'read:group:confluence'],
    ['/membersByGroupId', 'group membership', 'read:user:confluence'],
    ['/permissions', 'space permissions', 'read:space:confluence'],
    ['/role-assignments', 'space role assignments', 'read:space.permission:confluence'],
    ['/restriction/byOperation/read', 'content restrictions', 'read:confluence-content.all'],
    ['/ancestors', 'ancestor metadata', 'read:content.metadata:confluence'],
  ])('rejects missing access to %s with a useful scope hint', async (suffix, capability, scope) => {
    fetchMock.mockImplementation(async (input) => {
      const path = pathOf(input)
      return path.endsWith(suffix)
        ? Response.json({ error: 'provider-secret-do-not-echo' }, { status: 403 })
        : responseFor(path)
    })

    const result = await confluenceConnector.validateConfig('token', CONFIG, CONTEXT)
    expect(result.valid).toBe(false)
    expect(result.error).toContain(capability)
    expect(result.error).toContain(scope)
    expect(result.error).not.toContain('provider-secret-do-not-echo')
  })

  it('allows empty spaces and directories without claiming an item-level probe', async () => {
    fetchMock.mockImplementation(async (input) => {
      const path = pathOf(input)
      return path.endsWith('/spaces') ? responseFor(path) : Response.json({ results: [] })
    })
    await expect(confluenceConnector.validateConfig('token', CONFIG, CONTEXT)).resolves.toEqual({
      valid: true,
    })
    expect(fetchMock).toHaveBeenCalledTimes(4)
    expect(requestPaths().some((path) => path.includes('restriction'))).toBe(false)
    expect(requestPaths().some((path) => path.includes('membersByGroupId'))).toBe(false)
  })

  it('checks blog restrictions without requiring page or ancestor access for a blog-only source', async () => {
    await expect(
      confluenceConnector.validateConfig('token', { ...CONFIG, contentType: 'blogpost' }, CONTEXT)
    ).resolves.toEqual({ valid: true })
    expect(requestPaths()).toContain(
      '/ex/confluence/cloud-1/wiki/rest/api/content/301/restriction/byOperation/read'
    )
    expect(
      requestPaths().some((path) => path.endsWith('/pages') || path.endsWith('/ancestors'))
    ).toBe(false)
  })

  it('bounds all-content validation to one space and one item of each type, ignoring every continuation', async () => {
    fetchMock.mockImplementation(async (input) => {
      const body = await responseFor(pathOf(input)).json()
      return Response.json({ ...body, _links: { next: '/next?cursor=do-not-follow&start=1' } })
    })
    await expect(
      confluenceConnector.validateConfig('token', { ...CONFIG, contentType: 'all' }, CONTEXT)
    ).resolves.toEqual({ valid: true })
    expect(fetchMock).toHaveBeenCalledTimes(10)
    expect(requestPaths().some((path) => path.includes('/spaces/102/'))).toBe(false)
    for (const [input] of fetchMock.mock.calls.slice(1)) {
      const url = new URL(String(input))
      expect(url.searchParams.has('cursor')).toBe(false)
      expect(Number(url.searchParams.get('limit'))).toBeLessThanOrEqual(250)
    }
  })

  it('rejects missing source spaces before making permission probes', async () => {
    await expect(
      confluenceConnector.validateConfig('token', { ...CONFIG, spaceKey: [] }, CONTEXT)
    ).resolves.toEqual({ valid: false, error: 'Domain and at least one space key are required' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects a malformed directory response instead of treating it as an empty directory', async () => {
    fetchMock.mockImplementation(async (input) =>
      pathOf(input).endsWith('/group') ? Response.json({}) : responseFor(pathOf(input))
    )
    await expect(confluenceConnector.validateConfig('token', CONFIG, CONTEXT)).resolves.toEqual({
      valid: false,
      error: 'Confluence returned an invalid group directory response. Try again.',
    })
  })

  it('rejects unexpanded content restrictions', async () => {
    fetchMock.mockImplementation(async (input) =>
      pathOf(input).includes('/restriction/')
        ? Response.json({ restrictions: {} })
        : responseFor(pathOf(input))
    )
    await expect(confluenceConnector.validateConfig('token', CONFIG, CONTEXT)).resolves.toEqual({
      valid: false,
      error: 'Confluence returned invalid content restrictions. Try again.',
    })
  })

  it('bounds provider response bytes even when a requested one-item response is oversized', async () => {
    fetchMock.mockImplementation(async (input) =>
      pathOf(input).endsWith('/group')
        ? Response.json({ results: [{ id: 'group-1' }], padding: 'x'.repeat(256 * 1024) })
        : responseFor(pathOf(input))
    )
    const result = await confluenceConnector.validateConfig('token', CONFIG, CONTEXT)
    expect(result.valid).toBe(false)
    expect(result.error).toContain('group directory')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('declines provider retry waits longer than the validation budget', async () => {
    fetchMock.mockImplementation(async (input) =>
      pathOf(input).endsWith('/group')
        ? Response.json({}, { status: 429, headers: { 'Retry-After': '120' } })
        : responseFor(pathOf(input))
    )
    const result = await confluenceConnector.validateConfig('token', CONFIG, CONTEXT)
    expect(result.valid).toBe(false)
    expect(result.error).toContain('group directory')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('cancels subsequent probes when the shared validation deadline expires', async () => {
    const deadline = new AbortController()
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(deadline.signal)
    fetchMock.mockImplementation(async (input) => {
      if (pathOf(input).endsWith('/group')) deadline.abort(new Error('Validation deadline'))
      return responseFor(pathOf(input))
    })
    const result = await confluenceConnector.validateConfig('token', CONFIG, CONTEXT)
    expect(timeout).toHaveBeenCalledWith(10_000)
    expect(result.valid).toBe(false)
    expect(result.error).toBe('Confluence permission checks timed out. Try again.')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
