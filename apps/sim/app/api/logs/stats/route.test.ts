import { authMockFns } from '@sim/testing/mocks/auth.mock'
import {
  permissionGroupScopeMock,
  permissionGroupScopeMockFns,
} from '@sim/testing/mocks/permission-group-scope.mock'
import { permissionsMock, permissionsMockFns } from '@sim/testing/mocks/permissions.mock'
import { createMockRequest } from '@sim/testing/mocks/request.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  expandFolderIdsWithDescendants: vi.fn(),
  readLogStatsBounds: vi.fn(),
  readLogStatsSegments: vi.fn(),
}))

vi.mock('@/lib/workspaces/permissions/utils', () => permissionsMock)

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
  return createMockRequest({
    url: `http://localhost:3000/api/logs/stats?workspaceId=workspace-1${query}`,
  })
}

describe('GET /api/logs/stats', () => {
  beforeEach(() => {
    authMockFns.mockGetSession.mockResolvedValue({ user: { id: 'user-1' } })
    permissionsMockFns.mockCheckWorkspaceAccess.mockResolvedValue({ hasAccess: true })
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
})
