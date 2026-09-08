/**
 * @vitest-environment node
 */
import { createMockRequest } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ session: vi.fn(), execute: vi.fn() }))
vi.mock('@/lib/auth', () => ({ getSession: mocks.session }))
vi.mock('@/lib/invitations/application/send-invitation-batch', () => {
  const operation = {
    id: 'invitations.send_batch',
    capability: 'invitations.send',
    principalKinds: ['session'],
  }
  return {
    invitationOperations: { sendBatch: operation },
    sendInvitationBatch: { operation, execute: mocks.execute },
  }
})

import { WorkspaceInvitationError } from '@/lib/invitations/workspace-invitations'
import { POST } from '@/app/api/workspaces/invitations/batch/route'

function request(body: unknown) {
  return createMockRequest(
    'POST',
    body,
    undefined,
    'http://localhost:3000/api/workspaces/invitations/batch'
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.session.mockResolvedValue({ user: { id: 'actor' }, session: { id: 'session' } })
  mocks.execute.mockResolvedValue({
    success: true,
    successful: ['person@example.com'],
    added: [],
    failed: [],
    invitations: [],
  })
})

describe('invitation batch route', () => {
  it('authenticates before parsing or calling the operation', async () => {
    mocks.session.mockResolvedValue(null)
    const response = await POST(request({}), { params: Promise.resolve({}) })
    expect(response.status).toBe(401)
    expect(mocks.execute).not.toHaveBeenCalled()
  })

  it('forwards a canonical session principal and explicit organization-only input', async () => {
    const body = {
      organizationId: 'org-target',
      workspaceIds: [],
      emails: ['person@example.com'],
      membership: 'member',
    }
    const response = await POST(request(body), { params: Promise.resolve({}) })
    expect(response.status).toBe(200)
    expect(mocks.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        principal: { kind: 'session', sessionId: 'session', userId: 'actor' },
        input: body,
      })
    )
  })

  it('rejects empty unscoped workspace lists before use-case execution', async () => {
    const response = await POST(request({ workspaceIds: [], emails: ['person@example.com'] }), {
      params: Promise.resolve({}),
    })
    expect(response.status).toBe(400)
    expect(mocks.execute).not.toHaveBeenCalled()
  })

  it('preserves authorization refusal status and error shape', async () => {
    mocks.execute.mockRejectedValue(
      new WorkspaceInvitationError({
        message: 'Only organization owners and admins can invite members.',
        status: 403,
      })
    )
    const response = await POST(
      request({ organizationId: 'org', workspaceIds: [], emails: ['person@example.com'] }),
      { params: Promise.resolve({}) }
    )
    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({
      error: 'Only organization owners and admins can invite members.',
    })
  })
})
