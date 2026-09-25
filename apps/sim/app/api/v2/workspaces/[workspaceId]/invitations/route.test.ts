import {
  V2_OPERATION_RATE_LIMIT_ALLOWED,
  V2_PREAUTH_RATE_LIMIT_ALLOWED,
  v2ApiKeyAuthModuleMock,
  v2RateLimiterModuleMock,
  v2RouteMocks,
} from '@sim/testing'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ send: vi.fn() }))
vi.mock('@/lib/api/server/routes/v2-api-key-auth', () => v2ApiKeyAuthModuleMock)
vi.mock('@/lib/core/rate-limiter', () => v2RateLimiterModuleMock)
vi.mock('@/lib/invitations/application/send-invitation-batch', () => ({
  sendInvitationBatch: { operation: { id: 'invitations.send_batch' }, execute: mocks.send },
}))

import { NoWorkspaceAccessError } from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { POST } from '@/app/api/v2/workspaces/[workspaceId]/invitations/route'

const workspaceId = 'workspace-123'
const principal = { kind: 'personal_api_key', userId: 'caller', keyId: 'key' } as const
const call = (body: unknown, query = '') =>
  POST(
    new NextRequest(`http://localhost/api/v2/workspaces/${workspaceId}/invitations${query}`, {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'content-type': 'application/json' },
    }),
    { params: Promise.resolve({ workspaceId }) }
  )

beforeEach(() => {
  v2RouteMocks.authenticate.mockResolvedValue({
    principal,
    keyType: 'personal',
    rateLimitSubjectIds: ['user:caller'],
    rateLimitSubscription: null,
  })
  v2RouteMocks.preauthRate.mockResolvedValue(V2_PREAUTH_RATE_LIMIT_ALLOWED)
  v2RouteMocks.operationRate.mockResolvedValue(V2_OPERATION_RATE_LIMIT_ALLOWED)
})

describe('workspace invitation public adapter', () => {
  it.each([
    { emails: [] },
    { emails: Array.from({ length: 51 }, () => 'member@example.com') },
    { emails: ['invalid'] },
    { emails: ['member@example.com'], workspaceIds: ['different-workspace'] },
    { emails: ['member@example.com'], organizationId: 'other-organization' },
    { emails: ['member@example.com'], permission: 'owner' },
  ])('rejects invalid or unsupported invitation inputs before executing', async (body) => {
    expect((await call(body)).status).toBe(400)
    expect(mocks.send).not.toHaveBeenCalled()
  })

  it.each([
    new NoWorkspaceAccessError(),
    new OrchestrationError('not_found', 'Workspace not found'),
  ])('conceals absent and inaccessible workspace targets identically', async (error) => {
    mocks.send.mockRejectedValue(error)
    const response = await call({ emails: ['member@example.com'] })
    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({
      error: { code: 'NOT_FOUND', message: 'Workspace not found' },
    })
  })
})
