/**
 * @vitest-environment node
 */
import { createMockRequest, queueTableRows, resetDbChainMock, schemaMock } from '@sim/testing'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockGetApiKeyDisplayFormat,
  mockGetSession,
  mockGetUserEntityPermissions,
  mockGetWorkspaceById,
} = vi.hoisted(() => ({
  mockGetApiKeyDisplayFormat: vi.fn(),
  mockGetSession: vi.fn(),
  mockGetUserEntityPermissions: vi.fn(),
  mockGetWorkspaceById: vi.fn(),
}))

vi.mock('@/lib/api-key/auth', () => ({
  getApiKeyDisplayFormat: mockGetApiKeyDisplayFormat,
}))

vi.mock('@/lib/api-key/orchestration', () => ({
  performCreateWorkspaceApiKey: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  auth: { api: { getSession: vi.fn() } },
  getSession: mockGetSession,
}))

vi.mock('@/lib/workspaces/permissions/utils', () => ({
  getUserEntityPermissions: mockGetUserEntityPermissions,
  getWorkspaceById: mockGetWorkspaceById,
}))

import { GET } from '@/app/api/workspaces/[id]/api-keys/route'

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
