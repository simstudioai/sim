/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  defineInternalJsonRoute: vi.fn(() => vi.fn()),
  signOut: vi.fn(),
}))

vi.mock('@/lib/api/server/routes', () => ({
  defineInternalJsonRoute: mocks.defineInternalJsonRoute,
  internalOrchestrationErrorPolicy: { project: vi.fn(), unhandled: vi.fn() },
  internalRateLimits: { none: vi.fn(() => ({ kind: 'none' })) },
  internalSessionAuth: { authenticate: vi.fn() },
}))

vi.mock('@/lib/auth', () => ({
  auth: { api: { signOut: mocks.signOut } },
  getSession: vi.fn(),
}))

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
const routeOptions = mocks.defineInternalJsonRoute.mock.calls.map((call) => call[0] as RouteOptions)

describe('POST /api/users/me/deletion', () => {
  beforeEach(() => {
    mocks.signOut.mockReset()
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
    mocks.signOut.mockResolvedValue({ headers: cleared, response: { success: true } })
    const request = new Request('http://localhost/api/users/me/deletion', {
      method: 'POST',
      headers: { cookie: 'better-auth.session_token=abc' },
    })

    const finalization = await options!.finalizeResponse!({ request })

    expect(mocks.signOut).toHaveBeenCalledWith({ headers: request.headers, returnHeaders: true })
    expect(finalization.headers).toBe(cleared)
  })

  it('never fails a completed deletion because the cookies could not be cleared', async () => {
    const options = routeOptions.find(
      (candidate) => typeof candidate.finalizeResponse === 'function'
    )
    mocks.signOut.mockRejectedValue(new Error('sign-out unavailable'))

    await expect(
      options!.finalizeResponse!({
        request: new Request('http://localhost/api/users/me/deletion', { method: 'POST' }),
      })
    ).resolves.toEqual({})
  })
})
