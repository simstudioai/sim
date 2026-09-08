/** @vitest-environment node */
import { createMockRequest } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ session: vi.fn(), execute: vi.fn() }))
vi.mock('@/lib/auth', () => ({ getSession: mocks.session }))
vi.mock('@/lib/credential-groups/application/slack-managed-users', () => ({
  startSlackCredentialGroupConfiguration: {
    get operation() {
      return credentialGroupOperations.startSlackConfiguration
    },
    execute: mocks.execute,
  },
}))

import { OrchestrationError } from '@/lib/core/orchestration/types'
import { credentialGroupOperations } from '@/lib/credential-groups/application/operations'
import { POST } from '@/app/api/organizations/[id]/connected-accounts/[groupId]/slack-managed-users/route'

const body = {
  appId: 'A123',
  teamId: 'T123',
  clientId: 'fixture-client-id',
  clientSecret: 'fixture-client-secret',
}
const context = { params: Promise.resolve({ id: 'org-a', groupId: 'group-a' }) }
function request(input: unknown = body) {
  return createMockRequest(
    'POST',
    input,
    undefined,
    'http://localhost:3000/api/organizations/org-a/connected-accounts/group-a/slack-managed-users'
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.session.mockResolvedValue({ user: { id: 'actor' }, session: { id: 'session' } })
  mocks.execute.mockResolvedValue({
    authorizationUrl: 'https://slack.com/oauth/v2/authorize',
    state: 'opaque-state',
  })
})

describe('organization Slack setup route', () => {
  it('authenticates before parsing setup secrets', async () => {
    mocks.session.mockResolvedValue(null)
    const response = await POST(request({}), context)
    expect(response.status).toBe(401)
    expect(mocks.execute).not.toHaveBeenCalled()
  })

  it('maps the canonical route id to organization ownership without a workspace alias', async () => {
    const response = await POST(request(), context)
    expect(response.status).toBe(200)
    expect(mocks.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        principal: { kind: 'session', sessionId: 'session', userId: 'actor' },
        input: { ...body, organizationId: 'org-a', credentialGroupId: 'group-a' },
      })
    )
  })

  it('rejects a client-supplied workspace owner', async () => {
    const response = await POST(request({ ...body, workspaceId: 'workspace-a' }), context)
    expect(response.status).toBe(400)
    expect(mocks.execute).not.toHaveBeenCalled()
  })

  it('preserves refusal when current organization authority is insufficient', async () => {
    mocks.execute.mockRejectedValue(
      new OrchestrationError('forbidden', 'Organization admin required')
    )
    const response = await POST(request(), context)
    expect(response.status).toBe(403)
  })
})
