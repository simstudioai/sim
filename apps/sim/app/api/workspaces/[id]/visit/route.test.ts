import { createMockRequest } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  role: vi.fn(),
  context: vi.fn(),
  record: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({ getSession: mocks.getSession }))
vi.mock('@sim/platform-authz/workspace', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@sim/platform-authz/workspace')>()),
  resolveEffectiveWorkspacePermission: mocks.role,
}))
vi.mock('@/lib/workspaces/application/workspace-context', () => ({
  resolveActiveWorkspaceApplicationContext: mocks.context,
}))
vi.mock('@/lib/workspaces/visits', () => ({ recordWorkspaceVisitRecord: mocks.record }))

import { OrchestrationError } from '@/lib/core/orchestration/types'
import { POST } from '@/app/api/workspaces/[id]/visit/route'

const routeContext = { params: Promise.resolve({ id: 'ws-1' }) }

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
