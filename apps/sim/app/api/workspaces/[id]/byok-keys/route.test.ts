import {
  auditMock,
  authMockFns,
  createMockRequest,
  dbChainMockFns,
  queueTableRows,
  resetDbChainMock,
  schemaMock,
} from '@sim/testing'
import { createRouteContext } from '@sim/testing/helpers/http'
import { encryptionMock, encryptionMockFns } from '@sim/testing/mocks/encryption.mock'
import { permissionsMock, permissionsMockFns } from '@sim/testing/mocks/permissions.mock'
import { posthogServerMock } from '@sim/testing/mocks/posthog-server.mock'
import { workspaceAuthzMock, workspaceAuthzMockFns } from '@sim/testing/mocks/workspace-authz.mock'
import {
  createMockWorkspaceApplicationContext,
  workspaceContextMock,
  workspaceContextMockFns,
} from '@sim/testing/mocks/workspace-context.mock'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@sim/audit', () => auditMock)

vi.mock('@/lib/core/security/encryption', () => encryptionMock)

vi.mock('@/lib/posthog/server', () => posthogServerMock)

vi.mock('@/lib/workspaces/permissions/utils', () => permissionsMock)

vi.mock('@/lib/workspaces/application/workspace-context', () => workspaceContextMock)
vi.mock('@sim/platform-authz/workspace', () => workspaceAuthzMock)

import { GET, POST } from '@/app/api/workspaces/[id]/byok-keys/route'

const mockGetSession = authMockFns.mockGetSession
const { mockGetUserEntityPermissions, mockGetWorkspaceById } = permissionsMockFns
const { mockEncryptSecret, mockDecryptSecret } = encryptionMockFns
workspaceAuthzMockFns.mockResolveEffectiveWorkspacePermission.mockImplementation(
  (...args: unknown[]) => mockGetUserEntityPermissions(...args)
)
workspaceContextMockFns.mockLoadActiveWorkspaceApplicationContext.mockImplementation(
  async (workspaceId: string) =>
    createMockWorkspaceApplicationContext({ workspaceId, billedAccountUserId: 'billing' })
)

const WORKSPACE_ID = 'workspace-1'
const routeContext = createRouteContext({ id: WORKSPACE_ID })

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
