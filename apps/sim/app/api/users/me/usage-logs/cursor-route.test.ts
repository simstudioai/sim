/**
 * @vitest-environment node
 *
 * The unresolvable-cursor rejection, end to end on the session-only ledger route.
 *
 * Deliberately a separate file from `route.test.ts`: that suite replaces
 * `@/lib/billing/core/usage-log` with mocks, which is exactly the seam this case
 * has to cross. Here the real query runs against the shared `@sim/db` chain mock,
 * so the assertion covers the throw in billing core, `withRouteHandler`'s typed-error
 * projection, and the message the caller reads — the path that answered 500 while the
 * rejection was an `OrchestrationError` alone.
 */
import { authMockFns, createMockRequest, dbChainMockFns, resetDbChainMock } from '@sim/testing'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { UNKNOWN_CURSOR_MESSAGE } from '@/lib/billing/core/usage-log'
import { GET } from '@/app/api/users/me/usage-logs/route'

afterAll(() => {
  resetDbChainMock()
})

describe('GET /api/users/me/usage-logs cursor rejection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    authMockFns.mockGetSession.mockResolvedValue({ user: { id: 'user-1' } })
  })

  it('answers 400 when the cursor names no usage event', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([])

    const response = await GET(
      createMockRequest(
        'GET',
        undefined,
        {},
        'http://localhost:3000/api/users/me/usage-logs?cursor=log-from-another-ledger'
      )
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({ error: UNKNOWN_CURSOR_MESSAGE })
  })

  it('answers 200 for a request carrying no cursor', async () => {
    const response = await GET(createMockRequest('GET'))

    expect(response.status).toBe(200)
  })
})
