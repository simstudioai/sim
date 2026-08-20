/**
 * @vitest-environment node
 */
import {
  V2_OPERATION_RATE_LIMIT_ALLOWED,
  V2_PREAUTH_RATE_LIMIT_ALLOWED,
  v2ApiKeyAuthModuleMock,
  v2GateModuleMock,
  v2RateLimiterModuleMock,
  v2RouteMocks,
} from '@sim/testing'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ enrichments: vi.fn() }))

vi.mock('@/lib/api/server/routes/v2-api-key-auth', () => v2ApiKeyAuthModuleMock)
vi.mock('@/lib/core/rate-limiter', () => v2RateLimiterModuleMock)
vi.mock('@/app/api/v2/lib/gate', () => v2GateModuleMock)
vi.mock('@/lib/catalog/application/list-connector-types', () => ({
  listCatalogConnectorTypes: {
    operation: { id: 'catalog.connector_types.list' },
    execute: mocks.connectorTypes,
  },
}))
vi.mock('@/lib/catalog/application/list-enrichments', () => ({
  listCatalogEnrichments: {
    operation: { id: 'catalog.enrichments.list' },
    execute: mocks.enrichments,
  },
}))

import { OrchestrationError } from '@/lib/core/orchestration/types'
import { GET } from '@/app/api/v2/enrichments/route'

const WORKSPACE_ID = '11111111-2222-4333-8444-555555555555'

const auth = {
  principal: { kind: 'workspace_api_key' as const, workspaceId: WORKSPACE_ID, keyId: 'key-1' },
  rolloutUserId: 'billing-owner-1',
  rateLimitSubjectIds: ['api-key:key-1'] as const,
  rateLimitSubscription: null,
  keyType: 'workspace' as const,
}

const enrichment = {
  id: 'work-email',
  name: 'Work email',
  description: 'Find a work email.',
  inputs: [{ id: 'fullName', name: 'Full name', type: 'string' as const, required: true }],
  outputs: [{ id: 'email', name: 'Work email', type: 'string' as const }],
  providers: [{ id: 'hunter', label: 'Hunter', toolId: 'hunter_email_finder' }],
}

function request(url: string) {
  return new NextRequest(`http://localhost:3000${url}`, { headers: { 'x-api-key': 'key' } })
}

describe('/api/v2/enrichments', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    v2RouteMocks.authenticate.mockResolvedValue(auth)
    v2RouteMocks.gate.mockResolvedValue(null)
    v2RouteMocks.preauthRate.mockResolvedValue(V2_PREAUTH_RATE_LIMIT_ALLOWED)
    v2RouteMocks.operationRate.mockResolvedValue(V2_OPERATION_RATE_LIMIT_ALLOWED)
    mocks.enrichments.mockResolvedValue({ enrichments: [enrichment] })
  })

  it('returns the whole catalog in one page and keeps it out of shared caches', async () => {
    const response = await GET(request(`/api/v2/enrichments?workspaceId=${WORKSPACE_ID}`))

    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
    expect(await response.json()).toEqual({ data: [enrichment], nextCursor: null })
  })

  it('publishes the provider cascade in the order it is attempted', async () => {
    const response = await GET(request(`/api/v2/enrichments?workspaceId=${WORKSPACE_ID}`))

    expect((await response.json()).data[0].providers).toEqual(enrichment.providers)
  })

  it('rejects pagination params a full-set list does not implement', async () => {
    const response = await GET(request(`/api/v2/enrichments?workspaceId=${WORKSPACE_ID}&cursor=x`))

    expect(response.status).toBe(400)
    expect(mocks.enrichments).not.toHaveBeenCalled()
  })

  it('requires the workspace whose availability rules decide the answer', async () => {
    expect((await GET(request('/api/v2/enrichments'))).status).toBe(400)
    expect(mocks.enrichments).not.toHaveBeenCalled()
  })

  it('conceals a workspace the caller cannot reach as absent', async () => {
    mocks.enrichments.mockRejectedValue(new OrchestrationError('not_found', 'Workspace not found'))

    const response = await GET(request(`/api/v2/enrichments?workspaceId=${WORKSPACE_ID}`))

    expect(response.status).toBe(404)
    expect((await response.json()).error).toMatchObject({
      code: 'NOT_FOUND',
      message: 'Workspace not found',
    })
  })
})
