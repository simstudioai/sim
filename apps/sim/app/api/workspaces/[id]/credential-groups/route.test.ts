/**
 * @vitest-environment node
 */

import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  getSession: vi.fn(),
  list: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({ getSession: mocks.getSession }))

vi.mock('@/lib/credential-groups/application/manage-groups', () => ({
  createCredentialGroupSettings: {
    operation: { id: 'credential_groups.create' },
    execute: mocks.create,
  },
  listCredentialGroupSettings: {
    operation: { id: 'credential_groups.settings.list' },
    execute: mocks.list,
  },
}))

import { OrchestrationError } from '@/lib/core/orchestration/types'
import { CredentialGroupProviderConfigurationError } from '@/lib/credential-groups/provider-adapter'
import { GET, POST } from '@/app/api/workspaces/[id]/credential-groups/route'

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111'
const context = { params: Promise.resolve({ id: WORKSPACE_ID }) }

function createRequest(method: 'GET' | 'POST', body?: Record<string, unknown>): NextRequest {
  return new NextRequest(`http://localhost:3000/api/workspaces/${WORKSPACE_ID}/credential-groups`, {
    method,
    ...(body
      ? { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }
      : {}),
  })
}

describe('credential groups collection route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getSession.mockResolvedValue({
      user: { id: 'user-1' },
      session: { id: 'session-1' },
    })
    mocks.list.mockResolvedValue({ credentialGroups: [], availableProviders: ['gmail'] })
  })

  it('authenticates before parsing the request body', async () => {
    mocks.getSession.mockResolvedValue(null)

    const response = await POST(createRequest('POST', {}), context)

    expect(response.status).toBe(401)
    expect(mocks.create).not.toHaveBeenCalled()
  })

  it('enters the application use case with the authenticated session principal', async () => {
    const request = createRequest('GET')
    const response = await GET(request, context)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ credentialGroups: [], availableProviders: ['gmail'] })
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

    const response = await GET(createRequest('GET'), context)

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: 'Credential Groups are not available' })
  })

  it('fails fast when managed Gmail OAuth is not configured', async () => {
    mocks.create.mockRejectedValue(
      new CredentialGroupProviderConfigurationError('Managed Gmail authorization is not configured')
    )

    const response = await POST(
      createRequest('POST', {
        name: 'Support inboxes',
        options: [{ provider: 'gmail', label: 'Gmail', required: true }],
      }),
      context
    )

    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({
      error: 'Managed Gmail authorization is not configured',
    })
  })
})
