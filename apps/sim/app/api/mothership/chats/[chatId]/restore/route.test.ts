import { createSessionPrincipal } from '@sim/testing/factories/principal.factory'
import { createRouteContext } from '@sim/testing/helpers/http'
import { authMockFns } from '@sim/testing/mocks/auth.mock'
import { dbChainMockFns, resetDbChainMock } from '@sim/testing/mocks/database.mock'
import {
  mothershipChatStatusMock,
  mothershipChatStatusMockFns,
} from '@sim/testing/mocks/mothership-chat-status.mock'
import {
  organizationAuthorizationMock,
  organizationAuthorizationMockFns,
} from '@sim/testing/mocks/organization-authorization.mock'
import { posthogServerMock, posthogServerMockFns } from '@sim/testing/mocks/posthog-server.mock'
import { createMockRequest } from '@sim/testing/mocks/request.mock'
import {
  workspaceAuthorizationMock,
  workspaceAuthorizationMockFns,
} from '@sim/testing/mocks/workspace-authorization.mock'
import {
  workspaceContextMock,
  workspaceContextMockFns,
} from '@sim/testing/mocks/workspace-context.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/core/application/workspace-authorization', () => workspaceAuthorizationMock)
vi.mock('@/lib/core/application/organization-authorization', () => organizationAuthorizationMock)
vi.mock('@/lib/workspaces/application/workspace-context', () => workspaceContextMock)
vi.mock('@/lib/mothership/chat-status', () => mothershipChatStatusMock)
vi.mock('@/lib/posthog/server', () => posthogServerMock)

import { OrchestrationError } from '@/lib/core/orchestration/types'
import { POST } from '@/app/api/mothership/chats/[chatId]/restore/route'

const mocks = {
  authorizeWorkspace: workspaceAuthorizationMockFns.mockAuthorizeWorkspaceOperation,
  publish: mothershipChatStatusMockFns.mockPublishChatStatusChanged,
  session: authMockFns.mockGetSession,
  workspace: workspaceContextMockFns.mockResolveActiveWorkspaceApplicationContext,
  analytics: posthogServerMockFns.mockCaptureServerEvent,
  authorizeOrganization: organizationAuthorizationMockFns.mockAuthorizeOrganizationOperation,
}

function request() {
  return createMockRequest({
    method: 'POST',
    url: 'http://localhost/api/mothership/chats/chat/restore',
  })
}
const context = createRouteContext({ chatId: 'chat' })

beforeEach(() => {
  resetDbChainMock()
  mocks.session.mockResolvedValue({ user: { id: 'actor' }, session: { id: 'session' } })
  mocks.workspace.mockResolvedValue({
    workspaceId: 'workspace',
    workspaceOrganizationId: 'org',
    allowPersonalApiKeys: true,
    billedAccountUserId: 'billing-owner',
  })
  mocks.authorizeWorkspace.mockResolvedValue(undefined)
  mocks.authorizeOrganization.mockResolvedValue(undefined)
  dbChainMockFns.limit.mockResolvedValue([{ workspaceId: 'workspace', organizationId: null }])
  dbChainMockFns.returning.mockResolvedValue([{ workspaceId: 'workspace', organizationId: null }])
})

describe('chat restore internal surface', () => {
  it('conceals missing or another user’s archived chat', async () => {
    dbChainMockFns.limit.mockResolvedValue([])
    const response = await POST(request(), context)
    expect(response.status).toBe(404)
    expect(await response.json()).toMatchObject({ success: false, error: 'Chat not found' })
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
  })
  it('preserves workspace access denial', async () => {
    mocks.authorizeWorkspace.mockRejectedValue(new OrchestrationError('forbidden', 'denied'))
    const response = await POST(request(), context)
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ error: 'Workspace access denied' })
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
  })
  it('does not publish or report analytics for a concurrent restore', async () => {
    dbChainMockFns.returning.mockResolvedValue([])
    expect((await POST(request(), context)).status).toBe(404)
    expect(mocks.publish).not.toHaveBeenCalled()
    expect(mocks.analytics).not.toHaveBeenCalled()
  })
  it('conceals organization refusal and does not use billing-owner identity', async () => {
    dbChainMockFns.limit.mockResolvedValue([{ workspaceId: null, organizationId: 'org' }])
    mocks.authorizeOrganization.mockRejectedValue(new OrchestrationError('forbidden', 'denied'))
    const response = await POST(request(), context)
    expect(response.status).toBe(404)
    expect(await response.json()).toMatchObject({ error: 'Chat not found' })
    expect(mocks.authorizeOrganization).toHaveBeenCalledWith(
      createSessionPrincipal({ userId: 'actor', sessionId: 'session' }),
      expect.any(Object),
      { organizationId: 'org' }
    )
  })
})
