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
  mutableEnv,
} = vi.hoisted(() => ({
  mockFilterBlacklistedModels: vi.fn(),
  mockIsProviderBlacklisted: vi.fn(),
  mockGetBYOKKey: vi.fn(),
  mockGetSession: vi.fn(),
  mockGetUserEntityPermissions: vi.fn(),
  mockFetch: vi.fn(),
  mutableEnv: { TOGETHER_API_KEY: undefined as string | undefined },
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

vi.mock('@/lib/core/config/env', () => ({
  env: mutableEnv,
}))

import { GET } from '@/app/api/providers/together/models/route'

const TOGETHER_MODELS_URL = 'https://api.together.ai/v1/models'

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
    vi.clearAllMocks()
    vi.stubGlobal('fetch', mockFetch)

    mutableEnv.TOGETHER_API_KEY = undefined
    mockIsProviderBlacklisted.mockReturnValue(false)
    mockFilterBlacklistedModels.mockImplementation((models: string[]) => models)
    mockGetBYOKKey.mockResolvedValue(null)
    mockGetSession.mockResolvedValue(null)
    mockGetUserEntityPermissions.mockResolvedValue(null)
  })

  it('returns empty models without calling fetch when the provider is blacklisted', async () => {
    mockIsProviderBlacklisted.mockReturnValue(true)

    const res = await GET(requestWithWorkspace())

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ models: [] })
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('returns empty models when there is no workspaceId and no env key', async () => {
    const res = await GET(requestWithWorkspace())

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ models: [] })
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('fetches with the env key and prefixes each model id with together/', async () => {
    mutableEnv.TOGETHER_API_KEY = 'env-together-key'
    mockFetch.mockResolvedValue(
      okResponse([{ id: 'moonshotai/Kimi-K2-Instruct' }, { id: 'Qwen/Qwen2.5-72B-Instruct-Turbo' }])
    )

    const res = await GET(requestWithWorkspace())

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      models: ['together/moonshotai/Kimi-K2-Instruct', 'together/Qwen/Qwen2.5-72B-Instruct-Turbo'],
    })

    expect(mockFetch).toHaveBeenCalledTimes(1)
    expect(mockFetch.mock.calls[0][0]).toBe(TOGETHER_MODELS_URL)
    expect(fetchAuthHeader()).toBe('Bearer env-together-key')
  })

  it('uses the BYOK key when a workspace, session, and permission are present', async () => {
    mutableEnv.TOGETHER_API_KEY = 'env-together-key'
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

  it('falls back to the env key when a workspaceId is given but there is no session', async () => {
    mutableEnv.TOGETHER_API_KEY = 'env-together-key'
    mockGetSession.mockResolvedValue(null)
    mockFetch.mockResolvedValue(okResponse([{ id: 'moonshotai/Kimi-K2-Instruct' }]))

    const res = await GET(requestWithWorkspace('ws-1'))

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ models: ['together/moonshotai/Kimi-K2-Instruct'] })
    expect(mockGetBYOKKey).not.toHaveBeenCalled()
    expect(fetchAuthHeader()).toBe('Bearer env-together-key')
  })

  it('falls back to the env key when the session user lacks workspace permission', async () => {
    mutableEnv.TOGETHER_API_KEY = 'env-together-key'
    mockGetSession.mockResolvedValue({ user: { id: 'user-1' } })
    mockGetUserEntityPermissions.mockResolvedValue(null)
    mockFetch.mockResolvedValue(okResponse([{ id: 'moonshotai/Kimi-K2-Instruct' }]))

    const res = await GET(requestWithWorkspace('ws-1'))

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ models: ['together/moonshotai/Kimi-K2-Instruct'] })
    expect(mockGetBYOKKey).not.toHaveBeenCalled()
    expect(fetchAuthHeader()).toBe('Bearer env-together-key')
  })

  it('returns empty models when the upstream fetch responds non-ok', async () => {
    mutableEnv.TOGETHER_API_KEY = 'env-together-key'
    mockFetch.mockResolvedValue(errorResponse(401, 'Unauthorized'))

    const res = await GET(requestWithWorkspace())

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ models: [] })
  })

  it('returns empty models when the upstream fetch throws', async () => {
    mutableEnv.TOGETHER_API_KEY = 'env-together-key'
    mockFetch.mockRejectedValue(new Error('network down'))

    const res = await GET(requestWithWorkspace())

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

  it('dedupes duplicate model ids from the upstream array', async () => {
    mutableEnv.TOGETHER_API_KEY = 'env-together-key'
    mockFetch.mockResolvedValue(
      okResponse([
        { id: 'moonshotai/Kimi-K2-Instruct' },
        { id: 'moonshotai/Kimi-K2-Instruct' },
        { id: 'Qwen/Qwen2.5-72B-Instruct-Turbo' },
      ])
    )

    const res = await GET(requestWithWorkspace())

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      models: ['together/moonshotai/Kimi-K2-Instruct', 'together/Qwen/Qwen2.5-72B-Instruct-Turbo'],
    })
  })

  it('applies the blacklist filter to the deduped model list', async () => {
    mutableEnv.TOGETHER_API_KEY = 'env-together-key'
    mockFilterBlacklistedModels.mockImplementation((models: string[]) =>
      models.filter((m) => !m.includes('Qwen'))
    )
    mockFetch.mockResolvedValue(
      okResponse([{ id: 'moonshotai/Kimi-K2-Instruct' }, { id: 'Qwen/Qwen2.5-72B-Instruct-Turbo' }])
    )

    const res = await GET(requestWithWorkspace())

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ models: ['together/moonshotai/Kimi-K2-Instruct'] })
    expect(mockFilterBlacklistedModels).toHaveBeenCalledWith([
      'together/moonshotai/Kimi-K2-Instruct',
      'together/Qwen/Qwen2.5-72B-Instruct-Turbo',
    ])
  })

  it('filters out non-chat model types (image, embedding, rerank, etc.)', async () => {
    mutableEnv.TOGETHER_API_KEY = 'env-together-key'
    mockFetch.mockResolvedValue(
      okResponse([
        { id: 'meta-llama/Llama-3.3-70B-Instruct-Turbo', type: 'chat' },
        { id: 'black-forest-labs/FLUX.1-schnell', type: 'image' },
        { id: 'BAAI/bge-large-en-v1.5', type: 'embedding' },
        { id: 'Salesforce/Llama-Rank-V1', type: 'rerank' },
        { id: 'openai/whisper-large-v3', type: 'transcribe' },
      ])
    )

    const res = await GET(requestWithWorkspace())

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      models: ['together/meta-llama/Llama-3.3-70B-Instruct-Turbo'],
    })
  })
})
