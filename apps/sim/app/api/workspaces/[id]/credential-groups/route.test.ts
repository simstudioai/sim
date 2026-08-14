/**
 * @vitest-environment node
 */

import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockAuthorizeCredentialGroupSettings,
  mockCreateCredentialGroup,
  mockGetSession,
  mockListCredentialGroups,
} = vi.hoisted(() => ({
  mockAuthorizeCredentialGroupSettings: vi.fn(),
  mockCreateCredentialGroup: vi.fn(),
  mockGetSession: vi.fn(),
  mockListCredentialGroups: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({ getSession: mockGetSession }))

vi.mock('@/lib/credential-groups/access', async () => {
  class CredentialGroupAccessError extends Error {
    constructor(
      message: string,
      readonly status: 403 | 404
    ) {
      super(message)
      this.name = 'CredentialGroupAccessError'
    }
  }

  return {
    authorizeCredentialGroupSettings: mockAuthorizeCredentialGroupSettings,
    CredentialGroupAccessError,
  }
})

vi.mock('@/lib/credential-groups/service', () => ({
  createCredentialGroup: mockCreateCredentialGroup,
  listCredentialGroups: mockListCredentialGroups,
}))

import { CredentialGroupAccessError } from '@/lib/credential-groups/access'
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
    mockGetSession.mockResolvedValue({ user: { id: 'user-1' } })
    mockAuthorizeCredentialGroupSettings.mockResolvedValue({})
    mockListCredentialGroups.mockResolvedValue([])
  })

  it('authenticates before parsing the request body', async () => {
    mockGetSession.mockResolvedValue(null)

    const response = await POST(createRequest('POST', {}), context)

    expect(response.status).toBe(401)
    expect(mockAuthorizeCredentialGroupSettings).not.toHaveBeenCalled()
  })

  it('returns configured groups to an authorized workspace admin', async () => {
    const response = await GET(createRequest('GET'), context)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ credentialGroups: [] })
    expect(mockAuthorizeCredentialGroupSettings).toHaveBeenCalledWith(WORKSPACE_ID, 'user-1')
  })

  it('hides the surface when the entitlement gate rejects access', async () => {
    mockAuthorizeCredentialGroupSettings.mockRejectedValue(
      new CredentialGroupAccessError('Credential Groups are not available', 404)
    )

    const response = await GET(createRequest('GET'), context)

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: 'Credential Groups are not available' })
  })

  it('fails fast when managed Gmail OAuth is not configured', async () => {
    mockCreateCredentialGroup.mockRejectedValue(
      new CredentialGroupProviderConfigurationError('Managed Gmail authorization is not configured')
    )

    const response = await POST(
      createRequest('POST', {
        name: 'Support inboxes',
        options: [
          {
            provider: 'gmail',
            label: 'Gmail',
            required: true,
          },
        ],
      }),
      context
    )

    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({
      error: 'Managed Gmail authorization is not configured',
    })
  })
})
