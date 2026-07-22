/**
 * @vitest-environment node
 */
import {
  auditMock,
  createMockRequest,
  dbChainMockFns,
  queueTableRows,
  resetDbChainMock,
  schemaMock,
} from '@sim/testing'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockGetSession,
  mockGetUserEntityPermissions,
  mockGetWorkspaceById,
  mockEncryptSecret,
  mockDecryptSecret,
} = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockGetUserEntityPermissions: vi.fn(),
  mockGetWorkspaceById: vi.fn(),
  mockEncryptSecret: vi.fn(),
  mockDecryptSecret: vi.fn(),
}))

vi.mock('@sim/audit', () => auditMock)

vi.mock('@/lib/auth', () => ({
  getSession: mockGetSession,
}))

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

import { DELETE, GET, POST } from '@/app/api/workspaces/[id]/byok-keys/route'

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
    vi.clearAllMocks()
    resetDbChainMock()

    mockGetSession.mockResolvedValue({ user: { id: 'user-1' } })
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

    it('returns 401 when the user has no workspace permission', async () => {
      mockGetUserEntityPermissions.mockResolvedValue(null)

      const res = await GET(createMockRequest('GET'), routeContext)

      expect(res.status).toBe(401)
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

    it('adds a new key even when the provider already has keys', async () => {
      queueTableRows(schemaMock.workspaceBYOKKeys, [{ keyCount: 2 }])
      dbChainMockFns.returning.mockResolvedValueOnce([
        { id: 'key-3', providerId: 'openai', name: 'Backup', createdAt: new Date() },
      ])

      const res = await POST(
        createMockRequest('POST', { providerId: 'openai', apiKey: 'sk-new-key', name: 'Backup' }),
        routeContext
      )

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.success).toBe(true)
      expect(body.key).toMatchObject({ id: 'key-3', name: 'Backup' })
      expect(dbChainMockFns.values).toHaveBeenCalledWith(
        expect.objectContaining({
          workspaceId: WORKSPACE_ID,
          providerId: 'openai',
          encryptedApiKey: 'encrypted-value',
          name: 'Backup',
        })
      )
    })

    it('stores a null name when none is provided', async () => {
      queueTableRows(schemaMock.workspaceBYOKKeys, [{ keyCount: 0 }])
      dbChainMockFns.returning.mockResolvedValueOnce([
        { id: 'key-1', providerId: 'openai', name: null, createdAt: new Date() },
      ])

      const res = await POST(
        createMockRequest('POST', { providerId: 'openai', apiKey: 'sk-new-key' }),
        routeContext
      )

      expect(res.status).toBe(200)
      expect(dbChainMockFns.values).toHaveBeenCalledWith(expect.objectContaining({ name: null }))
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

    it('updates the targeted key in place when keyId is provided', async () => {
      queueTableRows(schemaMock.workspaceBYOKKeys, [{ id: 'key-2', name: 'Old name' }])

      const res = await POST(
        createMockRequest('POST', { providerId: 'openai', apiKey: 'sk-rotated', keyId: 'key-2' }),
        routeContext
      )

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.key).toMatchObject({ id: 'key-2', name: 'Old name' })
      expect(dbChainMockFns.set).toHaveBeenCalledWith(
        expect.objectContaining({ encryptedApiKey: 'encrypted-value', name: 'Old name' })
      )
      expect(dbChainMockFns.values).not.toHaveBeenCalled()
    })

    it('clears the name when updating with an empty name', async () => {
      queueTableRows(schemaMock.workspaceBYOKKeys, [{ id: 'key-2', name: 'Old name' }])

      const res = await POST(
        createMockRequest('POST', {
          providerId: 'openai',
          apiKey: 'sk-rotated',
          keyId: 'key-2',
          name: '',
        }),
        routeContext
      )

      expect(res.status).toBe(200)
      expect(dbChainMockFns.set).toHaveBeenCalledWith(expect.objectContaining({ name: null }))
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

    it('rejects an empty apiKey', async () => {
      const res = await POST(
        createMockRequest('POST', { providerId: 'openai', apiKey: '' }),
        routeContext
      )

      expect(res.status).toBe(400)
    })
  })

  describe('DELETE', () => {
    it('deletes a single key when keyId is provided', async () => {
      dbChainMockFns.returning.mockResolvedValueOnce([{ id: 'key-2' }])

      const res = await DELETE(
        createMockRequest('DELETE', { providerId: 'openai', keyId: 'key-2' }),
        routeContext
      )

      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ success: true })
    })

    it('returns 404 when keyId is provided but no key matches', async () => {
      dbChainMockFns.returning.mockResolvedValueOnce([])

      const res = await DELETE(
        createMockRequest('DELETE', { providerId: 'openai', keyId: 'missing' }),
        routeContext
      )

      expect(res.status).toBe(404)
    })

    it('deletes all provider keys when keyId is omitted', async () => {
      dbChainMockFns.returning.mockResolvedValueOnce([{ id: 'key-1' }, { id: 'key-2' }])

      const res = await DELETE(createMockRequest('DELETE', { providerId: 'openai' }), routeContext)

      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ success: true })
    })

    it('succeeds when keyId is omitted and the provider has no keys', async () => {
      dbChainMockFns.returning.mockResolvedValueOnce([])

      const res = await DELETE(createMockRequest('DELETE', { providerId: 'openai' }), routeContext)

      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ success: true })
    })

    it('returns 403 when the user is not a workspace admin', async () => {
      mockGetUserEntityPermissions.mockResolvedValue('write')

      const res = await DELETE(createMockRequest('DELETE', { providerId: 'openai' }), routeContext)

      expect(res.status).toBe(403)
      expect(dbChainMockFns.delete).not.toHaveBeenCalled()
    })
  })
})
