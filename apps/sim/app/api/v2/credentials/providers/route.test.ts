/**
 * @vitest-environment node
 */
import {
  V2_OPERATION_RATE_LIMIT_ALLOWED,
  V2_PREAUTH_RATE_LIMIT_ALLOWED,
  v2ApiKeyAuthModuleMock,
  v2RateLimiterModuleMock,
  v2RouteMocks,
} from '@sim/testing'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ execute: vi.fn() }))

vi.mock('@/lib/api/server/routes/v2-api-key-auth', () => v2ApiKeyAuthModuleMock)
vi.mock('@/lib/core/rate-limiter', () => v2RateLimiterModuleMock)
vi.mock('@/lib/credentials/application/list-credential-providers', () => ({
  listCredentialProviders: {
    operation: { id: 'credentials.providers.list' },
    execute: mocks.execute,
  },
}))

import { GET } from '@/app/api/v2/credentials/providers/route'

const WORKSPACE_ID = '11111111-2222-4333-8444-555555555555'
const auth = {
  principal: {
    kind: 'workspace_api_key' as const,
    workspaceId: WORKSPACE_ID,
    keyId: 'key-1',
  },
  rateLimitSubjectIds: ['api-key:key-1', `workspace:${WORKSPACE_ID}`] as const,
  rateLimitSubscription: null,
  keyType: 'workspace' as const,
}
const providers = [
  {
    type: 'oauth' as const,
    serviceId: 'salesforce',
    name: 'Salesforce',
    description: 'Connect Salesforce.',
    providerFamily: 'salesforce',
    available: true,
    supportsReconnect: true,
    authorizationOptions: [
      { providerId: 'salesforce', label: 'Production' },
      { providerId: 'salesforce-sandbox', label: 'Sandbox' },
    ],
  },
  {
    type: 'service_account' as const,
    serviceId: 'salesforce-service-account',
    providerId: 'salesforce-service-account',
    name: 'Salesforce integration user app',
    description: 'Connect Salesforce with an integration user app.',
    providerFamily: 'salesforce',
    available: true,
    docsUrl: 'https://docs.sim.ai/integrations/salesforce-service-account',
    requiresClientGeneratedCredentialId: false,
    fields: [
      {
        id: 'clientSecret',
        label: 'Consumer secret',
        placeholder: 'Paste the consumer secret',
        required: false,
        secret: true,
        multiline: false,
        requiredForAuthMethods: ['client_credentials'],
      },
    ],
  },
]

describe('GET /api/v2/credentials/providers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    v2RouteMocks.authenticate.mockResolvedValue(auth)
    v2RouteMocks.preauthRate.mockResolvedValue(V2_PREAUTH_RATE_LIMIT_ALLOWED)
    v2RouteMocks.operationRate.mockResolvedValue(V2_OPERATION_RATE_LIMIT_ALLOWED)
    mocks.execute.mockResolvedValue({ providers })
  })

  it('returns OAuth and service-account connection methods', async () => {
    const request = new NextRequest(
      `http://localhost:3000/api/v2/credentials/providers?workspaceId=${WORKSPACE_ID}`
    )
    const response = await GET(request)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ data: providers, nextCursor: null })
    expect(mocks.execute).toHaveBeenCalledWith({
      principal: auth.principal,
      input: { workspaceId: WORKSPACE_ID },
      request,
    })
  })

  it('rejects unsupported pagination instead of ignoring it', async () => {
    const response = await GET(
      new NextRequest(
        `http://localhost:3000/api/v2/credentials/providers?workspaceId=${WORKSPACE_ID}&limit=1`
      )
    )

    expect(response.status).toBe(400)
    expect(mocks.execute).not.toHaveBeenCalled()
  })

  it('forwards a provider-name search to the authorized application use case', async () => {
    const request = new NextRequest(
      `http://localhost:3000/api/v2/credentials/providers?workspaceId=${WORKSPACE_ID}&search=%20Sales%20`
    )

    const response = await GET(request)

    expect(response.status).toBe(200)
    expect(mocks.execute).toHaveBeenCalledWith({
      principal: auth.principal,
      input: { workspaceId: WORKSPACE_ID, search: 'Sales' },
      request,
    })
  })

  it('rejects an empty provider search', async () => {
    const response = await GET(
      new NextRequest(
        `http://localhost:3000/api/v2/credentials/providers?workspaceId=${WORKSPACE_ID}&search=`
      )
    )

    expect(response.status).toBe(400)
    expect(mocks.execute).not.toHaveBeenCalled()
  })
})
