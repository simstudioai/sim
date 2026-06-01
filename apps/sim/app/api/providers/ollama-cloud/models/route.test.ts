/**
 * @vitest-environment node
 */
import { createMockRequest } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockFilterBlacklistedModels,
  mockIsProviderBlacklisted,
  mockGetBYOKKey,
  mockGetSession,
  mockGetUserEntityPermissions,
  mockFetch,
} = vi.hoisted(() => ({
  mockFilterBlacklistedModels: vi.fn(),
  mockIsProviderBlacklisted: vi.fn(),
  mockGetBYOKKey: vi.fn(),
  mockGetSession: vi.fn(),
  mockGetUserEntityPermissions: vi.fn(),
  mockFetch: vi.fn(),
}))

vi.mock('@/providers/utils', () => ({
  filterBlacklistedModels: mockFilterBlacklistedModels,
  isProviderBlacklisted: mockIsProviderBlacklisted,
}))

vi.mock('@/lib/api-key/byok', () => ({
  getBYOKKey: mockGetBYOKKey,
}))

vi.mock('@/lib/auth', () => ({
  getSession: mockGetSession,
}))

vi.mock('@/lib/workspaces/permissions/utils', () => ({
  getUserEntityPermissions: mockGetUserEntityPermissions,
}))

import { GET } from '@/app/api/providers/ollama-cloud/models/route'

const OLLAMA_CLOUD_TAGS_URL = 'https://ollama.com/api/tags'

const okResponse = (body: unknown) => ({
  ok: true,
  status: 200,
  statusText: 'OK',
  json: vi.fn().mockResolvedValue(body),
})

const errorResponse = (status: number, statusText = 'Unauthorized') => ({
  ok: false,
  status,
  statusText,
  json: vi.fn().mockResolvedValue({}),
})

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

const fetchAuthHeader = () => {
  const init = mockFetch.mock.calls[0]?.[1] as RequestInit | undefined
  const headers = init?.headers as Record<string, string> | undefined
  return headers?.Authorization
}

/** Grants a session + workspace permission so the BYOK lookup is reached. */
const grantWorkspaceAccess = () => {
  mockGetSession.mockResolvedValue({ user: { id: 'user-1' } })
  mockGetUserEntityPermissions.mockResolvedValue('admin')
}

describe('GET /api/providers/ollama-cloud/models', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', mockFetch)

    mockIsProviderBlacklisted.mockReturnValue(false)
    mockFilterBlacklistedModels.mockImplementation((models: string[]) => models)
    mockGetBYOKKey.mockResolvedValue(null)
    mockGetSession.mockResolvedValue(null)
    mockGetUserEntityPermissions.mockResolvedValue(null)
  })

  it('returns empty models without calling fetch when the provider is blacklisted', async () => {
    mockIsProviderBlacklisted.mockReturnValue(true)

    const res = await GET(requestWithWorkspace('ws-1'))

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ models: [] })
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('returns empty models when there is no workspaceId (BYOK only, no env fallback)', async () => {
    const res = await GET(requestWithWorkspace())

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ models: [] })
    expect(mockFetch).not.toHaveBeenCalled()
    expect(mockGetBYOKKey).not.toHaveBeenCalled()
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

  it('fetches /api/tags with the BYOK key and prefixes each model name with ollama-cloud/', async () => {
    grantWorkspaceAccess()
    mockGetBYOKKey.mockResolvedValue({ apiKey: 'byok-ollama-key' })
    mockFetch.mockResolvedValue(
      okResponse({
        models: [{ name: 'gpt-oss:120b' }, { name: 'deepseek-v3.1:671b' }],
      })
    )

    const res = await GET(requestWithWorkspace('ws-1'))

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      models: ['ollama-cloud/gpt-oss:120b', 'ollama-cloud/deepseek-v3.1:671b'],
    })

    expect(mockFetch).toHaveBeenCalledTimes(1)
    expect(mockFetch.mock.calls[0][0]).toBe(OLLAMA_CLOUD_TAGS_URL)
    expect(fetchAuthHeader()).toBe('Bearer byok-ollama-key')
  })

  it('does not call getBYOKKey when there is a workspaceId but no session', async () => {
    mockGetSession.mockResolvedValue(null)

    const res = await GET(requestWithWorkspace('ws-1'))

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ models: [] })
    expect(mockGetBYOKKey).not.toHaveBeenCalled()
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

  it('returns empty models when the upstream fetch responds non-ok', async () => {
    grantWorkspaceAccess()
    mockGetBYOKKey.mockResolvedValue({ apiKey: 'byok-ollama-key' })
    mockFetch.mockResolvedValue(errorResponse(401, 'Unauthorized'))

    const res = await GET(requestWithWorkspace('ws-1'))

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ models: [] })
  })

  it('returns empty models when the upstream fetch throws', async () => {
    grantWorkspaceAccess()
    mockGetBYOKKey.mockResolvedValue({ apiKey: 'byok-ollama-key' })
    mockFetch.mockRejectedValue(new Error('network down'))

    const res = await GET(requestWithWorkspace('ws-1'))

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ models: [] })
  })

  it('returns a validation error for an empty workspaceId query param', async () => {
    const res = await GET(requestWithWorkspace(''))

    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBe('Validation error')
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('dedupes duplicate model names from the upstream response', async () => {
    grantWorkspaceAccess()
    mockGetBYOKKey.mockResolvedValue({ apiKey: 'byok-ollama-key' })
    mockFetch.mockResolvedValue(
      okResponse({
        models: [{ name: 'gpt-oss:120b' }, { name: 'gpt-oss:120b' }, { name: 'qwen3-coder:480b' }],
      })
    )

    const res = await GET(requestWithWorkspace('ws-1'))

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      models: ['ollama-cloud/gpt-oss:120b', 'ollama-cloud/qwen3-coder:480b'],
    })
  })

  it('applies the blacklist filter to the deduped model list', async () => {
    grantWorkspaceAccess()
    mockGetBYOKKey.mockResolvedValue({ apiKey: 'byok-ollama-key' })
    mockFilterBlacklistedModels.mockImplementation((models: string[]) =>
      models.filter((m) => !m.includes('qwen'))
    )
    mockFetch.mockResolvedValue(
      okResponse({
        models: [{ name: 'gpt-oss:120b' }, { name: 'qwen3-coder:480b' }],
      })
    )

    const res = await GET(requestWithWorkspace('ws-1'))

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ models: ['ollama-cloud/gpt-oss:120b'] })
    expect(mockFilterBlacklistedModels).toHaveBeenCalledWith([
      'ollama-cloud/gpt-oss:120b',
      'ollama-cloud/qwen3-coder:480b',
    ])
  })
})
