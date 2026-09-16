/** @vitest-environment node */
import { dbChainMockFns, resetDbChainMock } from '@sim/testing'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  authorizeWorkspace: vi.fn(),
  workspace: vi.fn(),
  publish: vi.fn(),
  analytics: vi.fn(),
  authorizeOrganization: vi.fn(),
}))
vi.mock('@/lib/auth', () => ({ getSession: mocks.session }))
vi.mock('@/lib/core/application/workspace-authorization', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/core/application/workspace-authorization')>()),
  authorizeWorkspaceOperation: mocks.authorizeWorkspace,
}))
vi.mock('@/lib/core/application/organization-authorization', () => ({
  authorizeOrganizationOperation: mocks.authorizeOrganization,
}))
vi.mock('@/lib/workspaces/application/workspace-context', () => ({
  resolveActiveWorkspaceApplicationContext: mocks.workspace,
}))
vi.mock('@/lib/mothership/chat-status', () => ({ publishChatStatusChanged: mocks.publish }))
vi.mock('@/lib/posthog/server', () => ({ captureServerEvent: mocks.analytics }))

import { OrchestrationError } from '@/lib/core/orchestration/types'
import { POST } from '@/app/api/mothership/chats/[chatId]/restore/route'

function request() {
  return new NextRequest('http://localhost/api/mothership/chats/chat/restore', { method: 'POST' })
}
const context = { params: Promise.resolve({ chatId: 'chat' }) }

beforeEach(() => {
  vi.clearAllMocks()
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
  it('authenticates using a real session before any chat lookup', async () => {
    mocks.session.mockResolvedValue(null)
    expect((await POST(request(), context)).status).toBe(401)
    expect(dbChainMockFns.select).not.toHaveBeenCalled()
  })
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
  it('restores and publishes before workspace-only analytics', async () => {
    const response = await POST(request(), context)
    expect(await response.json()).toEqual({ success: true })
    expect(dbChainMockFns.set).toHaveBeenCalledWith({
      deletedAt: null,
      updatedAt: expect.any(Date),
      lastSeenAt: expect.any(Date),
    })
    expect(mocks.publish).toHaveBeenCalledWith(
      { workspaceId: 'workspace', organizationId: null, userId: 'actor' },
      { chatId: 'chat', type: 'created' }
    )
    expect(mocks.analytics).toHaveBeenCalledWith(
      'actor',
      'task_restored',
      { workspace_id: 'workspace' },
      { groups: { workspace: 'workspace' } }
    )
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
      { kind: 'session', userId: 'actor', sessionId: 'session' },
      expect.any(Object),
      { organizationId: 'org' }
    )
  })
  it('restores an organization chat without emitting workspace analytics', async () => {
    dbChainMockFns.limit.mockResolvedValue([{ workspaceId: null, organizationId: 'org' }])
    dbChainMockFns.returning.mockResolvedValue([{ workspaceId: null, organizationId: 'org' }])
    expect((await POST(request(), context)).status).toBe(200)
    expect(mocks.analytics).not.toHaveBeenCalled()
  })
})
