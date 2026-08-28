/**
 * @vitest-environment node
 */
import { createMockRequest } from '@sim/testing'
import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ status: 200 }))

vi.mock('@/lib/api/server/routes', () => ({
  defineInternalJsonRoute: vi.fn(
    () => async () =>
      new Response(JSON.stringify({ ok: mocks.status < 400 }), {
        status: mocks.status,
        headers: { 'Content-Type': 'application/json' },
      })
  ),
  extendInternalErrorPolicy: vi.fn(() => ({})),
  internalErrorResponse: vi.fn(),
  internalOrchestrationErrorPolicy: {},
  internalRateLimits: { none: vi.fn(() => ({ kind: 'none' })) },
  internalSessionAuth: {},
}))

import { POST } from '@/app/api/selectors/execute/route'

describe('POST /api/selectors/execute', () => {
  it('marks success, authentication, parse, and unhandled responses private and non-cacheable', async () => {
    for (const status of [200, 400, 401, 500]) {
      mocks.status = status
      const response = await POST(createMockRequest('POST', {}))

      expect(response.status).toBe(status)
      expect(response.headers.get('Cache-Control')).toBe('private, no-store')
    }
  })
})
