/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(),
  createAuth: vi.fn(),
  resolveForPrincipal: vi.fn(),
  UnauthenticatedError: class InternalUnauthenticatedError extends Error {},
}))

vi.mock('@/lib/api/server/routes', () => ({
  createInternalSessionOrExecutorAuth: mocks.createAuth.mockReturnValue({
    authenticate: mocks.authenticate,
  }),
  InternalUnauthenticatedError: mocks.UnauthenticatedError,
}))
vi.mock('@/lib/selectors/application/resolve-authorized-context', () => ({
  SELECTOR_DELEGATION_AUDIENCE: 'sim:selectors',
  resolveAuthorizedSelectorContextForPrincipal: mocks.resolveForPrincipal,
}))

import { authenticateSelectorRequest } from '@/lib/selectors/server/resolve-authorized-context'

const principal = { kind: 'session', userId: 'viewer-1', sessionId: 'session-1' } as const

describe('selector request authentication adapter', () => {
  beforeEach(() => {
    mocks.authenticate.mockReset()
    mocks.resolveForPrincipal.mockReset()
  })

  it('authenticates with the selector audience and returns the Principal', async () => {
    mocks.authenticate.mockResolvedValue(principal)

    await expect(authenticateSelectorRequest({} as never)).resolves.toEqual({
      ok: true,
      principal,
    })
    expect(mocks.createAuth).toHaveBeenCalledWith({ audience: 'sim:selectors' })
  })

  it('returns a sanitized 401 when authentication fails', async () => {
    mocks.authenticate.mockRejectedValue(new mocks.UnauthenticatedError('Unauthorized'))

    await expect(authenticateSelectorRequest({} as never)).resolves.toEqual({
      ok: false,
      status: 401,
      error: 'Unauthorized',
    })
  })
})
