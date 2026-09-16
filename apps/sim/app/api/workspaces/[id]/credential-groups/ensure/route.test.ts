/**
 * @vitest-environment node
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ ensure: vi.fn(), getSession: vi.fn() }))
vi.mock('@/lib/auth', () => ({ getSession: mocks.getSession }))
vi.mock('@/lib/credential-groups/application/manage-groups', () => ({
  ensureWorkspaceAccounts: {
    operation: { id: 'credential_groups.workspace.ensure' },
    execute: mocks.ensure,
  },
}))

import { OrchestrationError } from '@/lib/core/orchestration/types'
import { POST } from '@/app/api/workspaces/[id]/credential-groups/ensure/route'

const workspaceId = '11111111-1111-4111-8111-111111111111'
const credentialGroup = {
  id: '22222222-2222-4222-8222-222222222222',
  workspaceId,
  name: 'Connected accounts',
  description: null,
  options: [],
  mcpServers: [],
  status: 'active',
  createdAt: '2026-09-04T00:00:00.000Z',
  updatedAt: '2026-09-04T00:00:00.000Z',
}
const context = { params: Promise.resolve({ id: workspaceId }) }
const request = () =>
  new NextRequest(`http://localhost:3000/api/workspaces/${workspaceId}/credential-groups/ensure`, {
    method: 'POST',
  })

describe('workspace connected accounts setup route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getSession.mockResolvedValue({
      user: { id: 'admin-1' },
      session: { id: 'session-1' },
    })
    mocks.ensure.mockResolvedValue({ credentialGroup, created: true })
  })

  it('authenticates before validating workspace parameters', async () => {
    mocks.getSession.mockResolvedValue(null)
    const response = await POST(request(), { params: Promise.resolve({ id: '' }) })
    expect(response.status).toBe(401)
    expect(mocks.ensure).not.toHaveBeenCalled()
  })

  it.each([true, false])(
    'returns the same account shape when newly created is %s',
    async (created) => {
      mocks.ensure.mockResolvedValue({ credentialGroup, created })
      const input = request()
      const response = await POST(input, context)
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({ credentialGroup })
      expect(mocks.ensure).toHaveBeenCalledWith({
        principal: { kind: 'session', userId: 'admin-1', sessionId: 'session-1' },
        input: { workspaceId },
        request: input,
      })
    }
  )

  it('preserves the application authorization refusal', async () => {
    mocks.ensure.mockRejectedValue(new OrchestrationError('forbidden', 'Admin access required'))
    const response = await POST(request(), context)
    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({ error: 'Admin access required' })
  })
})
