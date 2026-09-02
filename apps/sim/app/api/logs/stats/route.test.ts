/**
 * @vitest-environment node
 */
import {
  authMockFns,
  createMockRequest,
  permissionGroupScopeMock,
  permissionGroupScopeMockFns,
} from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  checkWorkspaceAccess: vi.fn(),
  expandFolderIdsWithDescendants: vi.fn(),
  readLogStatsBounds: vi.fn(),
  readLogStatsSegments: vi.fn(),
}))

vi.mock('@/lib/workspaces/permissions/utils', () => ({
  checkWorkspaceAccess: mocks.checkWorkspaceAccess,
}))

vi.mock('@/lib/logs/folder-expansion', () => ({
  expandFolderIdsWithDescendants: mocks.expandFolderIdsWithDescendants,
}))

vi.mock('@/lib/logs/stats-queries', () => ({
  readLogStatsBounds: mocks.readLogStatsBounds,
  readLogStatsSegments: mocks.readLogStatsSegments,
}))

vi.mock('@/lib/permission-groups/config-scope.server', () => permissionGroupScopeMock)

import { capabilityRefusal } from '@/lib/permission-groups/capabilities'
import { GET } from '@/app/api/logs/stats/route'

const resolveGroupConfigMock = permissionGroupScopeMockFns.mockResolvePermissionGroupConfig

function makeRequest(query = '') {
  return createMockRequest(
    'GET',
    undefined,
    {},
    `http://localhost:3000/api/logs/stats?workspaceId=workspace-1${query}`
  )
}

describe('GET /api/logs/stats', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authMockFns.mockGetSession.mockResolvedValue({ user: { id: 'user-1' } })
    mocks.checkWorkspaceAccess.mockResolvedValue({ hasAccess: true })
    mocks.readLogStatsBounds.mockResolvedValue({
      minStartedAt: new Date('2026-08-01T00:00:00.000Z'),
      maxStartedAt: new Date('2026-08-02T00:00:00.000Z'),
    })
    mocks.readLogStatsSegments.mockResolvedValue([])
    resolveGroupConfigMock.mockResolvedValue(null)
  })

  it('refuses a cost-filtered read when the group withholds spend', async () => {
    resolveGroupConfigMock.mockResolvedValue({ hideCostInfo: true })

    const response = await GET(makeRequest('&costOperator=%3E&costValue=0.5'))

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({
      error: capabilityRefusal('logs.cost'),
      details: { code: 'PERMISSION_GROUP_CAPABILITY_BLOCKED' },
    })
    expect(mocks.readLogStatsBounds).not.toHaveBeenCalled()
  })

  it('answers an unfiltered read under the same group', async () => {
    resolveGroupConfigMock.mockResolvedValue({ hideCostInfo: true })

    const response = await GET(makeRequest())

    expect(response.status).toBe(200)
    expect(mocks.readLogStatsBounds).toHaveBeenCalled()
  })

  /**
   * The refusal needs both conditions, so an unfiltered read can never be
   * refused and the config lookup — which re-reads workspace and
   * organization/group state — is pure cost on the dashboard's common path.
   */
  it('does not consult the group for an unfiltered read', async () => {
    resolveGroupConfigMock.mockResolvedValue({ hideCostInfo: true })

    const response = await GET(makeRequest())

    expect(response.status).toBe(200)
    expect(resolveGroupConfigMock).not.toHaveBeenCalled()
  })

  it('answers the same cost-filtered read when no group withholds spend', async () => {
    const response = await GET(makeRequest('&costOperator=%3E&costValue=0.5'))

    expect(response.status).toBe(200)
    expect(mocks.readLogStatsBounds).toHaveBeenCalled()
  })

  /** A caller with no workspace access is answered with a zeroed 200, as before. */
  it('does not consult the group for a caller without workspace access', async () => {
    mocks.checkWorkspaceAccess.mockResolvedValue({ hasAccess: false })

    const response = await GET(makeRequest('&costOperator=%3E&costValue=0.5'))

    expect(response.status).toBe(200)
    expect(resolveGroupConfigMock).not.toHaveBeenCalled()
  })
})
