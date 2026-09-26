import { createMockRequest } from '@sim/testing'
import { authInternalMock, authInternalMockFns } from '@sim/testing/mocks/auth-internal.mock'
import { createMockFetch } from '@sim/testing/mocks/fetch.mock'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { env } from '@/lib/core/config/env'

vi.mock('@/lib/auth/internal', () => authInternalMock)

import { GET } from '@/app/api/cron/onprem-usage-report/route'

describe('GET /api/cron/onprem-usage-report', () => {
  let fetchMock: ReturnType<typeof createMockFetch>

  beforeEach(() => {
    env.ONPREM_TELEMETRY_ENABLED = undefined
    fetchMock = createMockFetch({ json: { accepted: 0 } })
    vi.stubGlobal('fetch', fetchMock)
    authInternalMockFns.mockVerifyCronAuth.mockReturnValue(null)
  })

  afterEach(() => vi.unstubAllGlobals())

  it('requires cron authentication', async () => {
    authInternalMockFns.mockVerifyCronAuth.mockReturnValueOnce(
      new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })
    )
    const response = await GET(createMockRequest('GET'))
    expect(response.status).toBe(401)
  })

  it('answers disabled without any outbound request when telemetry is off', async () => {
    const response = await GET(createMockRequest('GET'))
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      success: true,
      status: 'disabled',
      reason: 'ONPREM_TELEMETRY_ENABLED is not set',
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
