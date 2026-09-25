import { authMockFns, createMockRequest } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ listReferences: vi.fn() }))

vi.mock('@/lib/secrets/application/use-cases', () => ({
  listSecretReferencesUseCase: {
    operation: { id: 'secrets.references' },
    execute: mocks.listReferences,
  },
}))

import { GET } from '@/app/api/secrets/references/route'

const url = 'http://localhost/api/secrets/references?workspaceId=workspace-1&name=API_KEY'

describe('GET /api/secrets/references', () => {
  beforeEach(() => {
    authMockFns.mockGetSession.mockResolvedValue({
      user: { id: 'admin-1' },
      session: { id: 'session-1' },
    })
  })

  /**
   * The contract carries no `scope`. It used to, and because a reference scan is name-based and
   * never narrowed by scope, asserting `personal` skipped the admin gate outright — a member
   * could read the reference map for any workspace secret. A stray `scope` must therefore reach
   * neither the gate nor the scan.
   */
  it('ignores a scope the caller tries to assert', async () => {
    mocks.listReferences.mockResolvedValue({ workflows: [], resources: [], truncated: false })

    const response = await GET(createMockRequest('GET', undefined, {}, `${url}&scope=personal`))

    expect(response.status).toBe(200)
    expect(mocks.listReferences).toHaveBeenCalledTimes(1)
    expect(mocks.listReferences.mock.calls[0]?.[0]?.input).toEqual({
      workspaceId: 'workspace-1',
      name: 'API_KEY',
    })
  })
})
