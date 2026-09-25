import { authMockFns, createMockRequest, resetEnvMock, setEnv } from '@sim/testing'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

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

import { GET } from '@/app/api/providers/together/models/route'

const mockGetSession = authMockFns.mockGetSession

const okResponse = (body: unknown) => ({
  ok: true,
  status: 200,
  statusText: 'OK',
  json: vi.fn().mockResolvedValue(body),
})

/**
 * Builds a request whose query string carries the given workspaceId. Passing
 * `undefined` omits the param entirely; passing `''` produces `?workspaceId=`.
 */
const requestWithWorkspace = (workspaceId?: string) => {
  const url = new URL('http://localhost:3000/api/providers/together/models')
  if (workspaceId !== undefined) {
    url.searchParams.set('workspaceId', workspaceId)
  }
  return createMockRequest('GET', undefined, {}, url.toString())
}

const fetchAuthHeader = () => {
  const init = mockFetch.mock.calls[0]?.[1] as RequestInit | undefined
  const headers = init?.headers as Record<string, string> | undefined
  return headers?.Authorization
}

describe('GET /api/providers/together/models', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch)

    setEnv({ TOGETHER_API_KEY: undefined })
    mockIsProviderBlacklisted.mockReturnValue(false)
    mockFilterBlacklistedModels.mockImplementation((models: string[]) => models)
    mockGetBYOKKey.mockResolvedValue(null)
    mockGetSession.mockResolvedValue(null)
    mockGetUserEntityPermissions.mockResolvedValue(null)
  })

  afterAll(() => {
    resetEnvMock()
  })

  it('uses the BYOK key when a workspace, session, and permission are present', async () => {
    setEnv({ TOGETHER_API_KEY: 'env-together-key' })
    mockGetSession.mockResolvedValue({ user: { id: 'user-1' } })
    mockGetUserEntityPermissions.mockResolvedValue('admin')
    mockGetBYOKKey.mockResolvedValue({ apiKey: 'byok-together-key' })
    mockFetch.mockResolvedValue(okResponse([{ id: 'moonshotai/Kimi-K2-Instruct' }]))

    const res = await GET(requestWithWorkspace('ws-1'))

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ models: ['together/moonshotai/Kimi-K2-Instruct'] })

    expect(mockGetBYOKKey).toHaveBeenCalledWith('ws-1', 'together')
    expect(fetchAuthHeader()).toBe('Bearer byok-together-key')
  })

  it('falls back to the env key when the session user lacks workspace permission', async () => {
    setEnv({ TOGETHER_API_KEY: 'env-together-key' })
    mockGetSession.mockResolvedValue({ user: { id: 'user-1' } })
    mockGetUserEntityPermissions.mockResolvedValue(null)
    mockFetch.mockResolvedValue(okResponse([{ id: 'moonshotai/Kimi-K2-Instruct' }]))

    const res = await GET(requestWithWorkspace('ws-1'))

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ models: ['together/moonshotai/Kimi-K2-Instruct'] })
    expect(mockGetBYOKKey).not.toHaveBeenCalled()
    expect(fetchAuthHeader()).toBe('Bearer env-together-key')
  })
})
