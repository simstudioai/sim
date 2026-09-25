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
})
