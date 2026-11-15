import { authMockFns, createMockRequest } from '@sim/testing'
import { apiKeyByokMock, apiKeyByokMockFns } from '@sim/testing/mocks/api-key-byok.mock'
import { providersUtilsMock, providersUtilsMockFns } from '@sim/testing/mocks/providers-utils.mock'
import { workspaceAuthzMock, workspaceAuthzMockFns } from '@sim/testing/mocks/workspace-authz.mock'
import { workspaceContextMock } from '@sim/testing/mocks/workspace-context.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockFetch } = vi.hoisted(() => ({
  mockFetch: vi.fn(),
}))

vi.mock('@/providers/utils', () => providersUtilsMock)

vi.mock('@/lib/api-key/byok', () => apiKeyByokMock)

vi.mock('@sim/platform-authz/workspace', () => workspaceAuthzMock)

vi.mock('@/lib/workspaces/application/context', () => workspaceContextMock)

import { GET } from '@/app/api/providers/ollama-cloud/models/route'

const { mockGetBYOKKey } = apiKeyByokMockFns

const mockGetSession = authMockFns.mockGetSession
const { mockFilterBlacklistedModels, mockIsProviderBlacklisted } = providersUtilsMockFns
const { mockResolveEffectiveWorkspacePermission } = workspaceAuthzMockFns

/**
 * Builds a request whose query string carries the given workspaceId. Passing
 * `undefined` omits the param entirely; passing `''` produces `?workspaceId=`.
 */
const requestWithWorkspace = (workspaceId?: string) => {
  const url = new URL('http://localhost:3000/api/providers/ollama-cloud/models')
  if (workspaceId !== undefined) {
    url.searchParams.set('workspaceId', workspaceId)
  }
  return createMockRequest('GET', undefined, {}, url.toString())
}

/** Grants a session + workspace permission so the BYOK lookup is reached. */
const grantWorkspaceAccess = () => {
  mockGetSession.mockResolvedValue({ user: { id: 'user-1' }, session: { id: 'session-1' } })
  mockResolveEffectiveWorkspacePermission.mockResolvedValue('admin')
}

describe('GET /api/providers/ollama-cloud/models', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch)

    mockIsProviderBlacklisted.mockReturnValue(false)
    mockFilterBlacklistedModels.mockImplementation((models: string[]) => models)
    mockGetBYOKKey.mockResolvedValue(null)
    mockGetSession.mockResolvedValue(null)
    mockResolveEffectiveWorkspacePermission.mockResolvedValue(null)
  })

  it('returns empty models when the workspace has no stored BYOK key (never falls back to a hosted key)', async () => {
    grantWorkspaceAccess()
    mockGetBYOKKey.mockResolvedValue(null)

    const res = await GET(requestWithWorkspace('ws-1'))

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ models: [] })
    expect(mockGetBYOKKey).toHaveBeenCalledWith('ws-1', 'ollama-cloud')
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('does not call getBYOKKey when the session user lacks workspace permission', async () => {
    mockGetSession.mockResolvedValue({ user: { id: 'user-1' }, session: { id: 'session-1' } })
    mockResolveEffectiveWorkspacePermission.mockResolvedValue(null)

    const res = await GET(requestWithWorkspace('ws-1'))

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ models: [] })
    expect(mockGetBYOKKey).not.toHaveBeenCalled()
    expect(mockFetch).not.toHaveBeenCalled()
  })
})
