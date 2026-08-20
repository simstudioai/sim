/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  listAccessible: vi.fn(),
  getDetail: vi.fn(),
  loadContext: vi.fn(),
}))

vi.mock('@/lib/workspaces/utils', () => ({
  listAccessibleWorkspaceRowsForUser: mocks.listAccessible,
}))
vi.mock('@/lib/workspaces/public-queries', () => ({
  getPublicWorkspaceDetail: mocks.getDetail,
}))
vi.mock('@/lib/workspaces/application/workspace-context', () => ({
  loadActiveWorkspaceApplicationContext: mocks.loadContext,
}))

import { listPublicWorkspaces } from '@/lib/workspaces/application/list-public-workspaces'

const workspace = (id: string, name: string, allowPersonalApiKeys: boolean, day: number) => ({
  id,
  name,
  allowPersonalApiKeys,
  createdAt: new Date(`2026-01-${String(day).padStart(2, '0')}T00:00:00Z`),
  updatedAt: new Date(`2026-02-${String(day).padStart(2, '0')}T00:00:00Z`),
})

describe('listPublicWorkspaces', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getDetail.mockImplementation(async (id: string) => ({
      id,
      name: id,
      color: '#33C482',
      logoUrl: null,
      memberCount: 1,
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-02T00:00:00Z'),
    }))
  })

  it('lists every accessible workspace where personal keys are enabled', async () => {
    mocks.listAccessible.mockResolvedValue([
      {
        workspace: workspace('workspace-b', 'Beta', true, 2),
        permissionType: 'read',
        viaOrgAdmin: false,
      },
      {
        workspace: workspace('workspace-disabled', 'Disabled', false, 3),
        permissionType: 'admin',
        viaOrgAdmin: true,
      },
      {
        workspace: workspace('workspace-a', 'Alpha', true, 1),
        permissionType: 'write',
        viaOrgAdmin: false,
      },
    ])

    const result = await listPublicWorkspaces.execute({
      principal: { kind: 'personal_api_key', userId: 'user-1', keyId: 'key-1' },
      input: { sortBy: 'name', sortOrder: 'asc', limit: 1, offset: 0 },
    })

    expect(result.workspaces.map(({ id }) => id)).toEqual(['workspace-a'])
    expect(result.hasMore).toBe(true)
    expect(mocks.getDetail).not.toHaveBeenCalledWith('workspace-disabled')
  })

  it('limits a workspace key to its bound active workspace', async () => {
    mocks.loadContext.mockResolvedValue({
      workspaceId: 'workspace-bound',
      workspaceOrganizationId: null,
      allowPersonalApiKeys: false,
      billedAccountUserId: 'owner-1',
    })

    const result = await listPublicWorkspaces.execute({
      principal: {
        kind: 'workspace_api_key',
        workspaceId: 'workspace-bound',
        keyId: 'key-1',
      },
      input: { sortBy: 'createdAt', sortOrder: 'desc', limit: 50, offset: 0 },
    })

    expect(result.workspaces.map(({ id }) => id)).toEqual(['workspace-bound'])
    expect(mocks.listAccessible).not.toHaveBeenCalled()
  })
})
