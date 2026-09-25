import {
  auditMock,
  authMockFns,
  createMockRequest,
  dbChainMockFns,
  queueTableRows,
  resetDbChainMock,
  schemaMock,
} from '@sim/testing'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetUserEntityPermissions, mockGetWorkspaceById, mockEncryptSecret, mockDecryptSecret } =
  vi.hoisted(() => ({
    mockGetUserEntityPermissions: vi.fn(),
    mockGetWorkspaceById: vi.fn(),
    mockEncryptSecret: vi.fn(),
    mockDecryptSecret: vi.fn(),
  }))

vi.mock('@sim/audit', () => auditMock)

vi.mock('@/lib/core/security/encryption', () => ({
  encryptSecret: mockEncryptSecret,
  decryptSecret: mockDecryptSecret,
}))

vi.mock('@/lib/posthog/server', () => ({
  captureServerEvent: vi.fn(),
}))

vi.mock('@/lib/workspaces/permissions/utils', () => ({
  getUserEntityPermissions: mockGetUserEntityPermissions,
  getWorkspaceById: mockGetWorkspaceById,
}))

vi.mock('@/lib/workspaces/application/workspace-context', () => ({
  loadActiveWorkspaceApplicationContext: async (workspaceId: string) => ({
    workspaceId,
    workspaceOrganizationId: null,
    allowPersonalApiKeys: true,
    billedAccountUserId: 'billing',
  }),
}))
vi.mock('@sim/platform-authz/workspace', () => ({
  resolveEffectiveWorkspacePermission: (...args: unknown[]) =>
    mockGetUserEntityPermissions(...args),
  permissionSatisfies: (actual: string, required: string) =>
    actual === 'admin' || actual === required || (actual === 'write' && required === 'read'),
}))

import { GET, POST } from '@/app/api/workspaces/[id]/byok-keys/route'

const mockGetSession = authMockFns.mockGetSession

const WORKSPACE_ID = 'workspace-1'
const routeContext = { params: Promise.resolve({ id: WORKSPACE_ID }) }

const storedKeyRow = (id: string, name: string | null = null) => ({
  id,
  providerId: 'openai',
  encryptedApiKey: `encrypted-${id}`,
  name,
  createdBy: 'user-1',
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
})

describe('workspace BYOK keys route', () => {
  beforeEach(() => {
    resetDbChainMock()

    mockGetSession.mockResolvedValue({ user: { id: 'user-1' }, session: { id: 'session' } })
    mockGetUserEntityPermissions.mockResolvedValue('admin')
    mockGetWorkspaceById.mockResolvedValue({ id: WORKSPACE_ID })
    mockEncryptSecret.mockResolvedValue({ encrypted: 'encrypted-value', iv: 'iv' })
    mockDecryptSecret.mockImplementation(async (encrypted: string) => ({
      decrypted: encrypted.replace('encrypted-', 'sk-decrypted-value-'),
    }))
  })

  afterAll(() => {
    resetDbChainMock()
  })

  describe('GET', () => {
    it('lists every stored key with name and masked value', async () => {
      queueTableRows(schemaMock.workspaceBYOKKeys, [
        storedKeyRow('key-1', 'Production'),
        storedKeyRow('key-2'),
      ])

      const res = await GET(createMockRequest('GET'), routeContext)

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.keys).toHaveLength(2)
      expect(body.keys[0]).toMatchObject({ id: 'key-1', name: 'Production', providerId: 'openai' })
      expect(body.keys[0].maskedKey).toBe('sk-dec...ey-1')
      expect(body.keys[1]).toMatchObject({ id: 'key-2', name: null })
    })
  })

  describe('POST', () => {
    it('returns 403 when the user is not a workspace admin', async () => {
      mockGetUserEntityPermissions.mockResolvedValue('write')

      const res = await POST(
        createMockRequest('POST', { providerId: 'openai', apiKey: 'sk-new' }),
        routeContext
      )

      expect(res.status).toBe(403)
      expect(dbChainMockFns.values).not.toHaveBeenCalled()
    })

    it('rejects adding a key beyond the per-provider cap', async () => {
      queueTableRows(schemaMock.workspaceBYOKKeys, [{ keyCount: 10 }])

      const res = await POST(
        createMockRequest('POST', { providerId: 'openai', apiKey: 'sk-new-key' }),
        routeContext
      )

      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.error).toContain('at most 10 keys')
      expect(dbChainMockFns.values).not.toHaveBeenCalled()
      expect(mockEncryptSecret).not.toHaveBeenCalled()
    })

    it('returns 404 when the keyId does not exist in the workspace', async () => {
      queueTableRows(schemaMock.workspaceBYOKKeys, [])

      const res = await POST(
        createMockRequest('POST', { providerId: 'openai', apiKey: 'sk-rotated', keyId: 'missing' }),
        routeContext
      )

      expect(res.status).toBe(404)
      expect(dbChainMockFns.set).not.toHaveBeenCalled()
      expect(mockEncryptSecret).not.toHaveBeenCalled()
    })
  })
})
