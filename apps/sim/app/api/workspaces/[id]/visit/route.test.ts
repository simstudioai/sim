import { createMockRequest, dbChainMockFns, resetDbChainMock } from '@sim/testing'
import { createRouteContext } from '@sim/testing/helpers/http'
import { authMockFns } from '@sim/testing/mocks/auth.mock'
import { workspaceAuthzMock, workspaceAuthzMockFns } from '@sim/testing/mocks/workspace-authz.mock'
import {
  workspaceContextMock,
  workspaceContextMockFns,
} from '@sim/testing/mocks/workspace-context.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@sim/platform-authz/workspace', () => workspaceAuthzMock)
vi.mock('@/lib/workspaces/application/context', () => workspaceContextMock)

import { OrchestrationError } from '@/lib/core/orchestration/types'
import { POST } from '@/app/api/workspaces/[id]/visit/route'

const mocks = {
  getSession: authMockFns.mockGetSession,
  role: workspaceAuthzMockFns.mockResolveEffectiveWorkspacePermission,
  context: workspaceContextMockFns.mockResolveActiveWorkspaceApplicationContext,
}

const routeContext = createRouteContext({ id: 'ws-1' })

describe('POST /api/workspaces/[id]/visit', () => {
  beforeEach(() => {
    resetDbChainMock()
    mocks.getSession.mockResolvedValue({ user: { id: 'user-1' }, session: { id: 'session-1' } })
    mocks.context.mockImplementation(async (workspaceId: string) => ({
      workspaceId,
      workspaceOrganizationId: null,
      allowPersonalApiKeys: true,
    }))
    mocks.role.mockResolvedValue('read')
  })

  it('answers 404 for a workspace outside the caller reach, same as a missing one', async () => {
    mocks.role.mockResolvedValue(null)
    const denied = await POST(createMockRequest('POST'), routeContext)

    mocks.context.mockRejectedValue(new OrchestrationError('not_found', 'Workspace not found'))
    const missing = await POST(createMockRequest('POST'), routeContext)

    expect(denied.status).toBe(404)
    expect(missing.status).toBe(404)
    expect(await denied.json()).toEqual(await missing.json())
    expect(dbChainMockFns.insert).not.toHaveBeenCalled()
  })

  /**
   * Account deletion removes the user row while a page load still carries its
   * session, so the visit insert loses the `user_id` foreign key. The caller is
   * no longer signed in as anyone, which is a 401, not a server fault.
   */
  it('answers 401 when the signed-in account is deleted before the visit lands', async () => {
    dbChainMockFns.onConflictDoUpdate.mockRejectedValueOnce(
      Object.assign(new Error('insert or update on table "workspace_visit" violates foreign key'), {
        code: '23503',
        constraint_name: 'workspace_visit_user_id_user_id_fk',
      })
    )

    const response = await POST(createMockRequest('POST'), routeContext)

    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: 'Unauthorized' })
  })

  it('keeps any other insert failure a server fault', async () => {
    dbChainMockFns.onConflictDoUpdate.mockRejectedValueOnce(
      Object.assign(new Error('insert or update on table "workspace_visit" violates foreign key'), {
        code: '23503',
        constraint_name: 'workspace_visit_workspace_id_workspace_id_fk',
      })
    )

    const response = await POST(createMockRequest('POST'), routeContext)

    expect(response.status).toBe(500)
  })
})
