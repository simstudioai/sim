/**
 * @vitest-environment node
 */
import { authMockFns, createMockRequest } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockIsFeatureEnabled, mockHasWorkspaceAdminAccess, mockOperations } = vi.hoisted(() => ({
  mockIsFeatureEnabled: vi.fn(),
  mockHasWorkspaceAdminAccess: vi.fn(),
  mockOperations: {
    getCustomBlockManageContext: vi.fn(),
    getCustomBlockUsageCounts: vi.fn(),
  },
}))

vi.mock('@/lib/core/config/feature-flags', () => ({
  isFeatureEnabled: mockIsFeatureEnabled,
}))

vi.mock('@/lib/workspaces/permissions/utils', () => ({
  hasWorkspaceAdminAccess: mockHasWorkspaceAdminAccess,
}))

vi.mock('@/lib/workflows/custom-blocks/operations', () => mockOperations)

import { GET } from '@/app/api/custom-blocks/[id]/usages/route'

const mockGetSession = authMockFns.mockGetSession

const MANAGE_CONTEXT = {
  organizationId: 'org-1',
  sourceWorkspaceId: 'ws-1',
  type: 'custom_block_abc123',
  name: 'Invoice Parser',
}

const USAGE_COUNTS = { usageCount: 3, deployedUsageCount: 2 }

function callRoute(id = 'cb-1') {
  return GET(createMockRequest('GET'), { params: Promise.resolve({ id }) })
}

describe('GET /api/custom-blocks/[id]/usages', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSession.mockResolvedValue({ user: { id: 'user-1' } })
    mockIsFeatureEnabled.mockResolvedValue(true)
    mockHasWorkspaceAdminAccess.mockResolvedValue(true)
    mockOperations.getCustomBlockManageContext.mockResolvedValue(MANAGE_CONTEXT)
    mockOperations.getCustomBlockUsageCounts.mockResolvedValue(USAGE_COUNTS)
  })

  it('returns 401 without a session', async () => {
    mockGetSession.mockResolvedValue(null)
    const response = await callRoute()
    expect(response.status).toBe(401)
  })

  it('returns 404 for an unknown block', async () => {
    mockOperations.getCustomBlockManageContext.mockResolvedValue(null)
    const response = await callRoute()
    expect(response.status).toBe(404)
  })

  it('returns 403 when the feature flag is off', async () => {
    mockIsFeatureEnabled.mockResolvedValue(false)
    const response = await callRoute()
    expect(response.status).toBe(403)
  })

  it('returns 403 for a non-admin of the source workspace', async () => {
    mockHasWorkspaceAdminAccess.mockResolvedValue(false)
    const response = await callRoute()
    expect(response.status).toBe(403)
    expect(mockOperations.getCustomBlockUsageCounts).not.toHaveBeenCalled()
  })

  it('returns the org-scoped usage counts for the block type', async () => {
    const response = await callRoute()
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(USAGE_COUNTS)
    expect(mockOperations.getCustomBlockUsageCounts).toHaveBeenCalledWith(
      'org-1',
      'custom_block_abc123'
    )
  })
})
