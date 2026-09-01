/**
 * @vitest-environment node
 */
import { authMockFns, createMockRequest } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CredentialAccessRequiredError } from '@/lib/credentials/application/authorized-credential-use-case'

const mocks = vi.hoisted(() => ({
  read: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
}))

vi.mock('@/lib/credentials/application/credential-crud', () => ({
  CredentialProviderOperationError: class CredentialProviderOperationError extends Error {},
  getWorkspaceCredentialUseCase: {
    operation: { id: 'credentials.read' },
    execute: mocks.read,
  },
  updateWorkspaceCredentialUseCase: {
    operation: { id: 'credentials.update' },
    execute: mocks.update,
  },
}))

vi.mock('@/lib/credentials/application/service-account', () => ({
  deleteCredentialUseCase: {
    operation: { id: 'credentials.delete' },
    execute: mocks.remove,
  },
}))

import { GET } from '@/app/api/credentials/[id]/route'

const CREDENTIAL_ID = 'credential-1'
const routeContext = { params: Promise.resolve({ id: CREDENTIAL_ID }) }

describe('GET /api/credentials/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authMockFns.mockGetSession.mockResolvedValue({
      user: { id: 'writer-1' },
      session: { id: 'session-1' },
    })
  })

  it('preserves the generic denial for a workspace writer without credential access', async () => {
    mocks.read.mockRejectedValue(new CredentialAccessRequiredError())

    const response = await GET(
      createMockRequest('GET', undefined, {}, `http://localhost/api/credentials/${CREDENTIAL_ID}`),
      routeContext
    )

    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({ error: 'Forbidden' })
  })
})
