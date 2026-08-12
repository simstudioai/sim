/**
 * @vitest-environment node
 */
import {
  authMockFns,
  createMockRequest,
  queueTableRows,
  resetDbChainMock,
  schemaMock,
} from '@sim/testing'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockGetApiKeyDisplayFormat,
  mockGetUserEntityPermissions,
  mockGetWorkspaceById,
  mockPerformCreateWorkspaceApiKey,
} = vi.hoisted(() => ({
  mockGetApiKeyDisplayFormat: vi.fn(),
  mockGetUserEntityPermissions: vi.fn(),
  mockGetWorkspaceById: vi.fn(),
  mockPerformCreateWorkspaceApiKey: vi.fn(),
}))

vi.mock('@/lib/api-key/auth', () => ({
  getApiKeyDisplayFormat: mockGetApiKeyDisplayFormat,
}))

vi.mock('@/lib/api-key/orchestration', () => ({
  performCreateWorkspaceApiKey: mockPerformCreateWorkspaceApiKey,
}))

vi.mock('@/lib/workspaces/permissions/utils', () => ({
  getUserEntityPermissions: mockGetUserEntityPermissions,
  getWorkspaceById: mockGetWorkspaceById,
}))

import { GET, POST } from '@/app/api/workspaces/[id]/api-keys/route'

const mockGetSession = authMockFns.mockGetSession

describe('GET /api/workspaces/[id]/api-keys', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    mockGetSession.mockResolvedValue({ user: { id: 'reader-1' } })
    mockGetWorkspaceById.mockResolvedValue({ id: 'workspace-1' })
    mockGetUserEntityPermissions.mockResolvedValue('read')
    mockGetApiKeyDisplayFormat.mockResolvedValue('sim_••••legacy')
    queueTableRows(schemaMock.apiKey, [
      {
        id: 'key-1',
        name: 'Legacy key',
        key: 'sim_plaintext_legacy_secret',
        createdAt: new Date('2026-07-01T00:00:00.000Z'),
        lastUsed: null,
        expiresAt: null,
        createdBy: 'owner-1',
      },
    ])
  })

  afterAll(() => {
    resetDbChainMock()
  })

  it('returns metadata without exposing the stored key value', async () => {
    const response = await GET(createMockRequest('GET'), {
      params: Promise.resolve({ id: 'workspace-1' }),
    })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.keys).toEqual([
      {
        id: 'key-1',
        name: 'Legacy key',
        displayKey: 'sim_••••legacy',
        createdAt: '2026-07-01T00:00:00.000Z',
        lastUsed: null,
        expiresAt: null,
        createdBy: 'owner-1',
      },
    ])
    expect(body.keys[0]).not.toHaveProperty('key')
    expect(mockGetApiKeyDisplayFormat).toHaveBeenCalledWith('sim_plaintext_legacy_secret')
  })
})

/**
 * Deploying a workflow only requires workspace `write`, but a workspace API key
 * can invoke every deployed workflow in the workspace, so minting one stays
 * admin-only. These pin that boundary.
 */
describe('POST /api/workspaces/[id]/api-keys', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    mockGetSession.mockResolvedValue({ user: { id: 'editor-1' } })
    mockGetWorkspaceById.mockResolvedValue({ id: 'workspace-1' })
  })

  afterAll(() => {
    resetDbChainMock()
  })

  it.each(['write', 'read'] as const)(
    'rejects a %s member without reaching key creation',
    async (permission) => {
      mockGetUserEntityPermissions.mockResolvedValue(permission)

      const response = await POST(createMockRequest('POST', { name: 'deploy-key' }), {
        params: Promise.resolve({ id: 'workspace-1' }),
      })

      expect(response.status).toBe(403)
      expect(mockPerformCreateWorkspaceApiKey).not.toHaveBeenCalled()
    }
  )

  it('allows an admin to create a workspace key', async () => {
    mockGetSession.mockResolvedValue({ user: { id: 'admin-1' } })
    mockGetUserEntityPermissions.mockResolvedValue('admin')
    mockPerformCreateWorkspaceApiKey.mockResolvedValue({
      success: true,
      key: {
        id: 'key-2',
        name: 'deploy-key',
        key: 'sim_plaintext_new_secret',
        createdAt: new Date('2026-08-01T00:00:00.000Z'),
      },
    })

    const response = await POST(createMockRequest('POST', { name: 'deploy-key' }), {
      params: Promise.resolve({ id: 'workspace-1' }),
    })

    expect(response.status).toBe(200)
    expect(mockPerformCreateWorkspaceApiKey).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: 'workspace-1', userId: 'admin-1', name: 'deploy-key' })
    )
  })

  it('maps a forbidden orchestration result to 403', async () => {
    mockGetUserEntityPermissions.mockResolvedValue('admin')
    mockPerformCreateWorkspaceApiKey.mockResolvedValue({
      success: false,
      error: 'Admin permission is required to create a workspace API key',
      errorCode: 'forbidden',
    })

    const response = await POST(createMockRequest('POST', { name: 'deploy-key' }), {
      params: Promise.resolve({ id: 'workspace-1' }),
    })

    expect(response.status).toBe(403)
  })
})
