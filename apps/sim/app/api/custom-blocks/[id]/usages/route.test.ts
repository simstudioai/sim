/**
 * @vitest-environment node
 */
import { createMockRequest } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetSession, mockIsFeatureEnabled, mockHasWorkspaceAdminAccess, mockOperations } =
  vi.hoisted(() => ({
    mockGetSession: vi.fn(),
    mockIsFeatureEnabled: vi.fn(),
    mockHasWorkspaceAdminAccess: vi.fn(),
    mockOperations: {
      getCustomBlockManageContext: vi.fn(),
      getCustomBlockUsages: vi.fn(),
    },
  }))

vi.mock('@/lib/auth', () => ({
  getSession: mockGetSession,
}))

vi.mock('@/lib/core/config/feature-flags', () => ({
  isFeatureEnabled: mockIsFeatureEnabled,
}))

vi.mock('@/lib/workspaces/permissions/utils', () => ({
  hasWorkspaceAdminAccess: mockHasWorkspaceAdminAccess,
}))

vi.mock('@/lib/workflows/custom-blocks/operations', () => mockOperations)

import { GET } from '@/app/api/custom-blocks/[id]/usages/route'

const MANAGE_CONTEXT = {
  organizationId: 'org-1',
  sourceWorkspaceId: 'ws-1',
  type: 'custom_block_abc123',
  name: 'Invoice Parser',
}

const USAGE = {
  workflowId: 'wf-1',
  workflowName: 'Billing Pipeline',
  workspaceId: 'ws-2',
  workspaceName: 'Finance',
  isDeployed: true,
  inLiveState: true,
  inActiveDeployment: true,
}

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
    mockOperations.getCustomBlockUsages.mockResolvedValue([USAGE])
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
    expect(mockOperations.getCustomBlockUsages).not.toHaveBeenCalled()
  })

  it('returns the org-scoped usages for the block type', async () => {
    const response = await callRoute()
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ usages: [USAGE] })
    expect(mockOperations.getCustomBlockUsages).toHaveBeenCalledWith('org-1', 'custom_block_abc123')
  })
})
