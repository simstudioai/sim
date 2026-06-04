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
  mutableEnv,
} = vi.hoisted(() => ({
  mockFilterBlacklistedModels: vi.fn(),
  mockIsProviderBlacklisted: vi.fn(),
  mockGetBYOKKey: vi.fn(),
  mockGetSession: vi.fn(),
  mockGetUserEntityPermissions: vi.fn(),
  mutableEnv: { BASETEN_API_KEY: undefined as string | undefined },
}))

vi.mock('@/lib/core/config/env', () => ({ env: mutableEnv }))

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

import { GET } from '@/app/api/providers/baseten/models/route'

const BASETEN_MODELS_URL = 'https://inference.baseten.co/v1/models'

function jsonResponse(body: unknown, init: { ok?: boolean; status?: number } = {}): Response {
  const status = init.status ?? 200
  const ok = init.ok ?? (status >= 200 && status < 300)
  return {
    ok,
    status,
    statusText: ok ? 'OK' : 'Error',
    json: vi.fn(async () => body),
  } as unknown as Response
}

function setEnvKey(value: string | undefined): void {
  mutableEnv.BASETEN_API_KEY = value
}

function authHeaderFromLastFetch(mockFetch: ReturnType<typeof vi.fn>): unknown {
  const init = mockFetch.mock.calls.at(-1)?.[1] as RequestInit | undefined
  return (init?.headers as Record<string, string> | undefined)?.Authorization
}

describe('GET /api/providers/baseten/models', () => {
  let mockFetch: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.clearAllMocks()

    mockFetch = vi.fn()
    vi.stubGlobal('fetch', mockFetch)

    mockIsProviderBlacklisted.mockReturnValue(false)
    mockFilterBlacklistedModels.mockImplementation((models: string[]) => models)
    mockGetBYOKKey.mockResolvedValue(null)
    mockGetSession.mockResolvedValue(null)
    mockGetUserEntityPermissions.mockResolvedValue(null)
    setEnvKey(undefined)
  })

  it('returns empty models without fetching when the provider is blacklisted', async () => {
    mockIsProviderBlacklisted.mockReturnValue(true)
    setEnvKey('env-key')

    const res = await GET(createMockRequest('GET'))

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ models: [] })
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('returns empty models when no workspaceId and no env key are available', async () => {
    const res = await GET(createMockRequest('GET'))

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ models: [] })
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('fetches models with the env key and prefixes each id with baseten/', async () => {
    setEnvKey('env-key')
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        data: [{ id: 'openai/gpt-oss-120b' }, { id: 'deepseek-ai/DeepSeek-V3' }],
      })
    )

    const res = await GET(createMockRequest('GET'))

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      models: ['baseten/openai/gpt-oss-120b', 'baseten/deepseek-ai/DeepSeek-V3'],
    })

    expect(mockFetch).toHaveBeenCalledTimes(1)
    const [url, init] = mockFetch.mock.calls[0]
    expect(url).toBe(BASETEN_MODELS_URL)
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer env-key')
  })

  it('uses the BYOK key when workspaceId, session, and permission are present', async () => {
    setEnvKey('env-key')
    mockGetSession.mockResolvedValue({ user: { id: 'user-1' } })
    mockGetUserEntityPermissions.mockResolvedValue('admin')
    mockGetBYOKKey.mockResolvedValue({ apiKey: 'byok-key', isBYOK: true })
    mockFetch.mockResolvedValueOnce(jsonResponse({ data: [{ id: 'model-a' }] }))

    const res = await GET(
      createMockRequest('GET', undefined, {}, 'http://localhost:3000/api/test?workspaceId=ws-1')
    )

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ models: ['baseten/model-a'] })

    expect(mockGetBYOKKey).toHaveBeenCalledWith('ws-1', 'baseten')
    expect(authHeaderFromLastFetch(mockFetch)).toBe('Bearer byok-key')
  })

  it('falls back to the env key when there is a workspaceId but no session', async () => {
    setEnvKey('env-key')
    mockGetSession.mockResolvedValue(null)
    mockFetch.mockResolvedValueOnce(jsonResponse({ data: [{ id: 'model-a' }] }))

    const res = await GET(
      createMockRequest('GET', undefined, {}, 'http://localhost:3000/api/test?workspaceId=ws-1')
    )

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ models: ['baseten/model-a'] })
    expect(mockGetBYOKKey).not.toHaveBeenCalled()
    expect(authHeaderFromLastFetch(mockFetch)).toBe('Bearer env-key')
  })

  it('falls back to the env key when the user lacks workspace permission', async () => {
    setEnvKey('env-key')
    mockGetSession.mockResolvedValue({ user: { id: 'user-1' } })
    mockGetUserEntityPermissions.mockResolvedValue(null)
    mockFetch.mockResolvedValueOnce(jsonResponse({ data: [{ id: 'model-a' }] }))

    const res = await GET(
      createMockRequest('GET', undefined, {}, 'http://localhost:3000/api/test?workspaceId=ws-1')
    )

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ models: ['baseten/model-a'] })
    expect(mockGetBYOKKey).not.toHaveBeenCalled()
    expect(authHeaderFromLastFetch(mockFetch)).toBe('Bearer env-key')
  })

  it('returns empty models when the upstream responds 401', async () => {
    setEnvKey('env-key')
    mockFetch.mockResolvedValueOnce(jsonResponse({}, { ok: false, status: 401 }))

    const res = await GET(createMockRequest('GET'))

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ models: [] })
  })

  it('returns empty models when the upstream responds 500', async () => {
    setEnvKey('env-key')
    mockFetch.mockResolvedValueOnce(jsonResponse({}, { ok: false, status: 500 }))

    const res = await GET(createMockRequest('GET'))

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ models: [] })
  })

  it('returns empty models when fetch throws', async () => {
    setEnvKey('env-key')
    mockFetch.mockRejectedValueOnce(new Error('network down'))

    const res = await GET(createMockRequest('GET'))

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ models: [] })
  })

  it('returns empty models when the upstream data array is empty', async () => {
    setEnvKey('env-key')
    mockFetch.mockResolvedValueOnce(jsonResponse({ data: [] }))

    const res = await GET(createMockRequest('GET'))

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ models: [] })
  })

  it('returns empty models when the upstream omits the data field', async () => {
    setEnvKey('env-key')
    mockFetch.mockResolvedValueOnce(jsonResponse({ object: 'list' }))

    const res = await GET(createMockRequest('GET'))

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ models: [] })
  })

  it('dedupes repeated model ids', async () => {
    setEnvKey('env-key')
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        data: [{ id: 'model-a' }, { id: 'model-a' }, { id: 'model-b' }],
      })
    )

    const res = await GET(createMockRequest('GET'))

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ models: ['baseten/model-a', 'baseten/model-b'] })
  })

  it('drops models removed by the blacklist filter', async () => {
    setEnvKey('env-key')
    mockFilterBlacklistedModels.mockImplementation((models: string[]) =>
      models.filter((m) => m !== 'baseten/blocked-model')
    )
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        data: [{ id: 'allowed-model' }, { id: 'blocked-model' }],
      })
    )

    const res = await GET(createMockRequest('GET'))

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ models: ['baseten/allowed-model'] })
  })
})
