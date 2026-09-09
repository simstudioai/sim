/** @vitest-environment node */
import { authMockFns, createMockRequest } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getMissingRequiredScopes } from '@/lib/oauth/utils'

const mocks = vi.hoisted(() => ({ execute: vi.fn() }))

vi.mock('@/lib/credentials/application/organization-credentials', () => {
  const operation = {
    id: 'organization_credentials.list',
    oauthScope: 'api:read',
    minimumRole: 'admin',
    principalKinds: ['session', 'personal_api_key', 'oauth_access_token'],
    capability: 'integrations.manage',
  } as const
  return {
    organizationCredentialOperations: { list: operation },
    listOrganizationCredentials: { operation, execute: mocks.execute },
  }
})

import { GET } from '@/app/api/organization-credentials/oauth/route'

const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.readonly'
const METADATA_SCOPE = 'https://www.googleapis.com/auth/drive.metadata.readonly'
const request = () =>
  createMockRequest(
    'GET',
    undefined,
    {},
    'http://localhost:3000/api/organization-credentials/oauth?organizationId=org-1&providerId=google-drive'
  )

describe('GET /api/organization-credentials/oauth', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authMockFns.mockGetSession.mockResolvedValue({
      user: { id: 'admin-1' },
      session: { id: 'session-1' },
    })
  })

  it('preserves per-account grants through the HTTP contract for access recovery', async () => {
    mocks.execute.mockResolvedValue({
      credentials: [
        {
          id: 'full-credential',
          displayName: 'Full access',
          providerId: 'google-drive',
          scopes: [DRIVE_SCOPE, METADATA_SCOPE],
          accountId: 'private-account-full',
          encryptedValue: 'private-secret',
        },
        {
          id: 'limited-credential',
          displayName: 'Limited access',
          providerId: 'google-drive',
          scopes: [METADATA_SCOPE],
          accountId: 'private-account-limited',
        },
        {
          id: 'unknown-credential',
          displayName: 'Unknown access',
          providerId: 'google-drive',
          scopes: [],
        },
      ],
    })

    const response = await GET(request())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.credentials).toEqual([
      {
        id: 'full-credential',
        name: 'Full access',
        provider: 'google-drive',
        type: 'oauth',
        scopes: [DRIVE_SCOPE, METADATA_SCOPE],
      },
      {
        id: 'limited-credential',
        name: 'Limited access',
        provider: 'google-drive',
        type: 'oauth',
        scopes: [METADATA_SCOPE],
      },
      {
        id: 'unknown-credential',
        name: 'Unknown access',
        provider: 'google-drive',
        type: 'oauth',
        scopes: [],
      },
    ])
    expect(getMissingRequiredScopes(body.credentials[0], [DRIVE_SCOPE, METADATA_SCOPE])).toEqual([])
    expect(getMissingRequiredScopes(body.credentials[1], [DRIVE_SCOPE, METADATA_SCOPE])).toEqual([
      DRIVE_SCOPE,
    ])
    expect(getMissingRequiredScopes(body.credentials[2], [DRIVE_SCOPE, METADATA_SCOPE])).toEqual([
      DRIVE_SCOPE,
      METADATA_SCOPE,
    ])
    expect(mocks.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        principal: { kind: 'session', userId: 'admin-1', sessionId: 'session-1' },
        input: { organizationId: 'org-1', providerId: 'google-drive', type: 'oauth' },
      })
    )
  })

  it('still returns an empty authorized list without fabricating a credential', async () => {
    mocks.execute.mockResolvedValue({ credentials: [] })

    const response = await GET(request())

    expect(response.status).toBe(200)
    expect((await response.json()).credentials).toEqual([])
  })

  it('requires a session before entering the protected credential list', async () => {
    authMockFns.mockGetSession.mockResolvedValue(null)

    const response = await GET(request())

    expect(response.status).toBe(401)
    expect(mocks.execute).not.toHaveBeenCalled()
  })
})
