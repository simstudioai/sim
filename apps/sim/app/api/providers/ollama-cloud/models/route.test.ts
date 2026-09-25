import { authMockFns, createMockRequest } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockFilterBlacklistedModels,
  mockIsProviderBlacklisted,
  mockGetBYOKKey,
  mockGetUserEntityPermissions,
  mockFetch,
} = vi.hoisted(() => ({
  mockFilterBlacklistedModels: vi.fn(),
  mockIsProviderBlacklisted: vi.fn(),
  mockGetBYOKKey: vi.fn(),
  mockGetUserEntityPermissions: vi.fn(),
  mockFetch: vi.fn(),
}))

vi.mock('@/providers/utils', () => ({
  isFunctionToolCall: (toolCall: unknown) =>
    typeof toolCall === 'object' &&
    toolCall !== null &&
    'function' in toolCall &&
    (toolCall as { function?: unknown }).function != null,
  filterBlacklistedModels: mockFilterBlacklistedModels,
  isProviderBlacklisted: mockIsProviderBlacklisted,
}))

vi.mock('@/lib/api-key/byok', () => ({
  getBYOKKey: mockGetBYOKKey,
}))

vi.mock('@/lib/workspaces/permissions/utils', () => ({
  getUserEntityPermissions: mockGetUserEntityPermissions,
}))

import { GET } from '@/app/api/providers/ollama-cloud/models/route'

const mockGetSession = authMockFns.mockGetSession

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
  mockGetSession.mockResolvedValue({ user: { id: 'user-1' } })
  mockGetUserEntityPermissions.mockResolvedValue('admin')
}

describe('GET /api/providers/ollama-cloud/models', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch)

    mockIsProviderBlacklisted.mockReturnValue(false)
    mockFilterBlacklistedModels.mockImplementation((models: string[]) => models)
    mockGetBYOKKey.mockResolvedValue(null)
    mockGetSession.mockResolvedValue(null)
    mockGetUserEntityPermissions.mockResolvedValue(null)
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
    mockGetSession.mockResolvedValue({ user: { id: 'user-1' } })
    mockGetUserEntityPermissions.mockResolvedValue(null)

    const res = await GET(requestWithWorkspace('ws-1'))

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ models: [] })
    expect(mockGetBYOKKey).not.toHaveBeenCalled()
    expect(mockFetch).not.toHaveBeenCalled()
  })
})
