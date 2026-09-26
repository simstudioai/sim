import { authMockFns, createMockRequest, resetEnvMock, setEnv } from '@sim/testing'
import { jsonResponse } from '@sim/testing/helpers/http'
import { apiKeyByokMock, apiKeyByokMockFns } from '@sim/testing/mocks/api-key-byok.mock'
import { permissionsMock, permissionsMockFns } from '@sim/testing/mocks/permissions.mock'
import { providersUtilsMock, providersUtilsMockFns } from '@sim/testing/mocks/providers-utils.mock'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/providers/utils', () => providersUtilsMock)

vi.mock('@/lib/api-key/byok', () => apiKeyByokMock)

vi.mock('@/lib/workspaces/permissions/utils', () => permissionsMock)

import { GET } from '@/app/api/providers/baseten/models/route'

const mockGetSession = authMockFns.mockGetSession
const mockGetBYOKKey = apiKeyByokMockFns.mockGetBYOKKey
const { mockFilterBlacklistedModels, mockIsProviderBlacklisted } = providersUtilsMockFns
const { mockGetUserEntityPermissions } = permissionsMockFns

function setEnvKey(value: string | undefined): void {
  setEnv({ BASETEN_API_KEY: value })
}

function authHeaderFromLastFetch(mockFetch: ReturnType<typeof vi.fn>): unknown {
  const init = mockFetch.mock.calls.at(-1)?.[1] as RequestInit | undefined
  return (init?.headers as Record<string, string> | undefined)?.Authorization
}

describe('GET /api/providers/baseten/models', () => {
  let mockFetch: ReturnType<typeof vi.fn>

  beforeEach(() => {
    mockFetch = vi.fn()
    vi.stubGlobal('fetch', mockFetch)

    mockIsProviderBlacklisted.mockReturnValue(false)
    mockFilterBlacklistedModels.mockImplementation((models: string[]) => models)
    mockGetBYOKKey.mockResolvedValue(null)
    mockGetSession.mockResolvedValue(null)
    mockGetUserEntityPermissions.mockResolvedValue(null)
    setEnvKey(undefined)
  })

  afterAll(() => {
    resetEnvMock()
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
})
