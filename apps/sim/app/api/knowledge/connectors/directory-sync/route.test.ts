/**
 * @vitest-environment node
 */
import { createMockRequest } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockVerifyCronAuth,
  mockConnectorRows,
  mockResolveIdentity,
  mockResolveToken,
  mockRefreshDirectory,
} = vi.hoisted(() => ({
  mockVerifyCronAuth: vi.fn(() => null),
  mockConnectorRows: vi.fn(),
  mockResolveIdentity: vi.fn(),
  mockResolveToken: vi.fn(),
  mockRefreshDirectory: vi.fn(),
}))

vi.mock('@/lib/auth/internal', () => ({ verifyCronAuth: mockVerifyCronAuth }))
vi.mock('@/lib/credentials/access', () => ({
  resolveCredentialTokenIdentity: mockResolveIdentity,
}))
vi.mock('@/lib/knowledge/connectors/access-token', () => ({
  resolveConnectorAccessToken: mockResolveToken,
}))
vi.mock('@/lib/knowledge/connectors/external-group-sync', () => ({
  refreshMirroredDirectory: mockRefreshDirectory,
}))
vi.mock('@/connectors/registry.server', () => ({
  CONNECTOR_REGISTRY: {
    google_drive: { auth: { mode: 'oauth', provider: 'google-drive' }, openDirectory: vi.fn() },
    notion: { auth: { mode: 'oauth', provider: 'notion' } },
  },
}))
vi.mock('@sim/db', () => ({
  db: {
    select: () => ({
      from: () => ({
        innerJoin: () => ({ where: () => ({ limit: () => mockConnectorRows() }) }),
      }),
    }),
  },
}))

import { GET } from '@/app/api/knowledge/connectors/directory-sync/route'

function connector(overrides: Record<string, unknown> = {}) {
  return {
    id: 'connector-1',
    connectorType: 'google_drive',
    credentialId: 'credential-1',
    encryptedApiKey: null,
    sourceConfig: { adminEmail: 'admin@corp.com' },
    workspaceId: 'ws-1',
    knowledgeBaseOwnerId: 'owner-1',
    ...overrides,
  }
}

async function run() {
  const response = await GET(createMockRequest('GET'))
  return response.json()
}

describe('connector directory sync scheduler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockVerifyCronAuth.mockReturnValue(null)
    mockResolveIdentity.mockResolvedValue({ kind: 'service_account' })
    mockResolveToken.mockResolvedValue({ accessToken: 'token' })
    mockRefreshDirectory.mockResolvedValue(undefined)
  })

  it('refreshes the directory of every admin-mode connector it finds', async () => {
    mockConnectorRows.mockResolvedValue([connector(), connector({ id: 'connector-2' })])

    await expect(run()).resolves.toMatchObject({ considered: 2, refreshed: 2, failed: 0 })
    expect(mockRefreshDirectory).toHaveBeenCalledTimes(2)
  })

  /**
   * The tick refreshes every workspace's directory, so one workspace's lapsed
   * credential or unreachable source must not stop the others.
   */
  it('contains a failure to the connector that caused it', async () => {
    mockConnectorRows.mockResolvedValue([connector(), connector({ id: 'connector-2' })])
    mockRefreshDirectory.mockRejectedValueOnce(new Error('directory unreachable'))

    await expect(run()).resolves.toMatchObject({ considered: 2, refreshed: 1, failed: 1 })
  })

  it('reports a connector whose credential no longer resolves rather than failing', async () => {
    mockConnectorRows.mockResolvedValue([connector()])
    mockResolveToken.mockResolvedValue(null)

    await expect(run()).resolves.toMatchObject({ unusable: 1, refreshed: 0 })
    expect(mockRefreshDirectory).not.toHaveBeenCalled()
  })

  it('skips a connector whose source has no directory to read', async () => {
    mockConnectorRows.mockResolvedValue([connector({ connectorType: 'notion' })])

    await expect(run()).resolves.toMatchObject({ skipped: 1, refreshed: 0 })
    expect(mockRefreshDirectory).not.toHaveBeenCalled()
  })

  /**
   * Token reads are scoped to the credential's own account owner, not the
   * knowledge base owner, who is routinely a different member.
   */
  it('resolves the token as the credential owner for an OAuth credential', async () => {
    mockConnectorRows.mockResolvedValue([connector()])
    mockResolveIdentity.mockResolvedValue({ kind: 'oauth', userId: 'credential-owner' })

    await run()

    expect(mockResolveToken).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'credential-owner' })
    )
  })

  it('refuses an unauthenticated tick', async () => {
    mockVerifyCronAuth.mockReturnValue(new Response('nope', { status: 401 }))

    const response = await GET(createMockRequest('GET'))

    expect(response.status).toBe(401)
    expect(mockConnectorRows).not.toHaveBeenCalled()
  })
})
