import {
  apiServerRoutesMock,
  apiServerRoutesMockFns,
} from '@sim/testing/mocks/api-server-routes.mock'
import { authMockFns } from '@sim/testing/mocks/auth.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/api/server/routes', () => apiServerRoutesMock)

vi.mock('@/lib/users/application/delete-account', () => ({
  deleteAccountUseCase: { execute: vi.fn() },
  previewAccountDeletionUseCase: { execute: vi.fn() },
}))

vi.mock('@/lib/users/application/operations', () => ({
  userAccountOperations: { delete: { id: 'user.delete' }, previewDeletion: { id: 'user.preview' } },
}))

import '@/app/api/users/me/deletion/route'

type RouteOptions = {
  finalizeResponse?: (args: { request: Request }) => Promise<{ headers?: HeadersInit }>
}

/** Captured at import time; the route registers itself once when the module loads. */
const routeOptions = apiServerRoutesMockFns.mockDefineInternalJsonRoute.mock.calls.map(
  (call) => call[0] as RouteOptions
)

describe('POST /api/users/me/deletion', () => {
  beforeEach(() => {
    authMockFns.mockSignOut.mockReset()
  })

  /**
   * The session row is deleted with the account, but the signed cookie cache
   * still authenticates the browser for its TTL; the response must clear it.
   */
  it('clears the session cookies on the deletion response', async () => {
    const options = routeOptions.find(
      (candidate) => typeof candidate.finalizeResponse === 'function'
    )
    expect(options?.finalizeResponse).toBeDefined()

    const cleared = new Headers([['set-cookie', 'better-auth.session_token=; Max-Age=0']])
    authMockFns.mockSignOut.mockResolvedValue({ headers: cleared, response: { success: true } })
    const request = new Request('http://localhost/api/users/me/deletion', {
      method: 'POST',
      headers: { cookie: 'better-auth.session_token=abc' },
    })

    const finalization = await options!.finalizeResponse!({ request })

    expect(authMockFns.mockSignOut).toHaveBeenCalledWith({
      headers: request.headers,
      returnHeaders: true,
    })
    expect(finalization.headers).toBe(cleared)
  })

  it('never fails a completed deletion because the cookies could not be cleared', async () => {
    const options = routeOptions.find(
      (candidate) => typeof candidate.finalizeResponse === 'function'
    )
    authMockFns.mockSignOut.mockRejectedValue(new Error('sign-out unavailable'))

    await expect(
      options!.finalizeResponse!({
        request: new Request('http://localhost/api/users/me/deletion', { method: 'POST' }),
      })
    ).resolves.toEqual({})
  })
})
