import { createMockRequest } from '@sim/testing'
import { createRouteContext } from '@sim/testing/helpers/http'
import { authMockFns } from '@sim/testing/mocks/auth.mock'
import { workspaceAuthzMock, workspaceAuthzMockFns } from '@sim/testing/mocks/workspace-authz.mock'
import {
  workspaceContextMock,
  workspaceContextMockFns,
} from '@sim/testing/mocks/workspace-context.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const hoisted = vi.hoisted(() => ({
  record: vi.fn(),
}))

vi.mock('@sim/platform-authz/workspace', () => workspaceAuthzMock)
vi.mock('@/lib/workspaces/application/workspace-context', () => workspaceContextMock)
vi.mock('@/lib/workspaces/visits', () => ({ recordWorkspaceVisitRecord: hoisted.record }))

import { OrchestrationError } from '@/lib/core/orchestration/types'
import { POST } from '@/app/api/workspaces/[id]/visit/route'

const mocks = {
  ...hoisted,
  getSession: authMockFns.mockGetSession,
  role: workspaceAuthzMockFns.mockResolveEffectiveWorkspacePermission,
  context: workspaceContextMockFns.mockResolveActiveWorkspaceApplicationContext,
}

const routeContext = createRouteContext({ id: 'ws-1' })

describe('POST /api/workspaces/[id]/visit', () => {
  beforeEach(() => {
    mocks.getSession.mockResolvedValue({ user: { id: 'user-1' }, session: { id: 'session-1' } })
    mocks.context.mockImplementation(async (workspaceId: string) => ({
      workspaceId,
      workspaceOrganizationId: null,
      allowPersonalApiKeys: true,
    }))
    mocks.role.mockResolvedValue('read')
    mocks.record.mockResolvedValue(undefined)
  })

  it('answers 404 for a workspace outside the caller reach, same as a missing one', async () => {
    mocks.role.mockResolvedValue(null)
    const denied = await POST(createMockRequest('POST'), routeContext)

    mocks.context.mockRejectedValue(new OrchestrationError('not_found', 'Workspace not found'))
    const missing = await POST(createMockRequest('POST'), routeContext)

    expect(denied.status).toBe(404)
    expect(missing.status).toBe(404)
    expect(await denied.json()).toEqual(await missing.json())
    expect(mocks.record).not.toHaveBeenCalled()
  })
})
