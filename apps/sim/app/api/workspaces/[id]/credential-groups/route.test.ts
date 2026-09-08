/**
 * @vitest-environment node
 */

import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  list: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({ getSession: mocks.getSession }))

vi.mock('@/lib/credential-groups/application/manage-groups', () => ({
  getWorkspaceAccountsSettings: {
    operation: { id: 'credential_groups.workspace.read' },
    execute: mocks.list,
  },
}))

import { OrchestrationError } from '@/lib/core/orchestration/types'
import { GET } from '@/app/api/workspaces/[id]/credential-groups/route'

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111'
const context = { params: Promise.resolve({ id: WORKSPACE_ID }) }

function createRequest(): NextRequest {
  return new NextRequest(`http://localhost:3000/api/workspaces/${WORKSPACE_ID}/credential-groups`)
}

describe('credential groups collection route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getSession.mockResolvedValue({
      user: { id: 'user-1' },
      session: { id: 'session-1' },
    })
    mocks.list.mockResolvedValue({ credentialGroup: null, availableProviders: ['gmail'] })
  })

  it('enters the application use case with the authenticated session principal', async () => {
    const request = createRequest()
    const response = await GET(request, context)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ credentialGroup: null, availableProviders: ['gmail'] })
    expect(mocks.list).toHaveBeenCalledWith({
      principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
      input: { workspaceId: WORKSPACE_ID },
      request,
    })
  })

  it('preserves concealed entitlement failures from the application boundary', async () => {
    mocks.list.mockRejectedValue(
      new OrchestrationError('not_found', 'Credential Groups are not available')
    )

    const response = await GET(createRequest(), context)

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: 'Credential Groups are not available' })
  })
})
