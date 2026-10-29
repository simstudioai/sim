import { authMockFns } from '@sim/testing'
import { createRouteContext } from '@sim/testing/helpers/http'
import { createMockRequest } from '@sim/testing/mocks/request.mock'
import {
  workspaceFilesListMock,
  workspaceFilesListMockFns,
} from '@sim/testing/mocks/workspace-files-list.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/workspace-files/application/list-workspace-files', () => workspaceFilesListMock)

import { GET } from '@/app/api/workspaces/[id]/files/folder-stats/route'

const WORKSPACE_ID = 'workspace-1'
const stats = workspaceFilesListMockFns.mockGetWorkspaceFileFolderStats

describe('GET /api/workspaces/[id]/files/folder-stats', () => {
  beforeEach(() => {
    authMockFns.mockGetSession.mockResolvedValue({
      user: { id: 'user-1', name: 'Test User', email: 'test@sim.ai' },
      session: { id: 'session-1' },
    })
    stats.mockResolvedValue({ folders: [] })
  })

  it.each([
    ['omitted', ''],
    ['root', '?parentId=root'],
  ])('reads the root children when parentId is %s', async (_label, query) => {
    const response = await GET(
      createMockRequest({
        method: 'GET',
        url: `/api/workspaces/${WORKSPACE_ID}/files/folder-stats${query}`,
      }),
      createRouteContext({ id: WORKSPACE_ID })
    )

    expect(response.status).toBe(200)
    expect(stats.mock.calls[0][0].input).toEqual({ workspaceId: WORKSPACE_ID, parentIds: [null] })
  })

  it('reads several parents at once, the root spelled `root`, in place of parentId', async () => {
    const response = await GET(
      createMockRequest({
        method: 'GET',
        url: `/api/workspaces/${WORKSPACE_ID}/files/folder-stats?parentId=folder-9&parentIds=folder-2,root`,
      }),
      createRouteContext({ id: WORKSPACE_ID })
    )

    expect(response.status).toBe(200)
    expect(stats.mock.calls[0][0].input).toEqual({
      workspaceId: WORKSPACE_ID,
      parentIds: ['folder-2', null],
    })
  })
})
