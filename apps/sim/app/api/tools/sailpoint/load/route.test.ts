/**
 * @vitest-environment node
 */
import { createMockRequest, hybridAuthMockFns } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { fetchMock } = vi.hoisted(() => ({
  fetchMock: vi.fn(),
}))

import { POST } from '@/app/api/tools/sailpoint/load/route'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function tokenResponse(): Response {
  return jsonResponse({ access_token: 'token-123', token_type: 'Bearer', expires_in: 3600 })
}

describe('SailPoint load route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', fetchMock)
    hybridAuthMockFns.mockCheckInternalAuth.mockResolvedValue({
      success: true,
      userId: 'user-123',
      authType: 'internal_jwt',
    })
  })

  it('triggers a source aggregation without a file and returns the task', async () => {
    fetchMock
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(jsonResponse({ id: 'task-1', type: 'ACCOUNT_AGGREGATION' }, 202))

    const request = createMockRequest('POST', {
      clientId: 'client-id',
      clientSecret: 'client-secret',
      tenant: 'acme-load',
      operation: 'sailpoint_load_accounts',
      sourceId: 'src-1',
    })

    const response = await POST(request)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      'https://acme-load.api.identitynow.com/v2025/sources/src-1/load-accounts'
    )
    const init = fetchMock.mock.calls[1]?.[1] as RequestInit
    expect(init.method).toBe('POST')
    expect(init.body).toBeInstanceOf(FormData)
    expect(data.output).toEqual({ task: { id: 'task-1', type: 'ACCOUNT_AGGREGATION' } })
  })

  it('rejects a load request that is missing a source ID', async () => {
    const request = createMockRequest('POST', {
      clientId: 'client-id',
      clientSecret: 'client-secret',
      tenant: 'acme-load',
      operation: 'sailpoint_load_entitlements',
    })

    const response = await POST(request)

    expect(response.status).toBe(400)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
