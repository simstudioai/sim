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

const mocks = vi.hoisted(() => ({ connectorTypes: vi.fn() }))

vi.mock('@/lib/api/server/routes/v2-api-key-auth', () => v2ApiKeyAuthModuleMock)
vi.mock('@/lib/core/rate-limiter', () => v2RateLimiterModuleMock)
vi.mock('@/lib/catalog/application/list-connector-types', () => ({
  listCatalogConnectorTypes: {
    operation: { id: 'catalog.connector_types.list' },
    execute: mocks.connectorTypes,
  },
}))

import { OrchestrationError } from '@/lib/core/orchestration/types'
import { GET } from '@/app/api/v2/connector-types/route'

const WORKSPACE_ID = '11111111-2222-4333-8444-555555555555'

const auth = {
  principal: { kind: 'workspace_api_key' as const, workspaceId: WORKSPACE_ID, keyId: 'key-1' },
  rateLimitSubjectIds: ['api-key:key-1'] as const,
  rateLimitSubscription: null,
  keyType: 'workspace' as const,
}

const connectorType = {
  connectorType: 'google_drive',
  name: 'Google Drive',
  description: 'Sync Drive documents.',
  version: '1.0.0',
  auth: { mode: 'oauth' as const, provider: 'google-drive' },
  configFields: [
    {
      id: 'folderSelector',
      title: 'Folder',
      type: 'selector' as const,
      canonicalParamId: 'folderId',
      mode: 'basic' as const,
      multi: true,
    },
  ],
  supportsIncrementalSync: true,
  tagDefinitions: [],
}

function request(url: string) {
  return new NextRequest(`http://localhost:3000${url}`, { headers: { 'x-api-key': 'key' } })
}

describe('/api/v2/connector-types', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    v2RouteMocks.authenticate.mockResolvedValue(auth)
    v2RouteMocks.preauthRate.mockResolvedValue(V2_PREAUTH_RATE_LIMIT_ALLOWED)
    v2RouteMocks.operationRate.mockResolvedValue(V2_OPERATION_RATE_LIMIT_ALLOWED)
    mocks.connectorTypes.mockResolvedValue({ connectorTypes: [connectorType] })
  })

  it('returns the whole catalog in one page and keeps it out of shared caches', async () => {
    const response = await GET(request(`/api/v2/connector-types?workspaceId=${WORKSPACE_ID}`))

    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
    expect(await response.json()).toEqual({ data: [connectorType], nextCursor: null })
  })

  it('publishes the multi and canonical-pair properties a caller configures against', async () => {
    const response = await GET(request(`/api/v2/connector-types?workspaceId=${WORKSPACE_ID}`))

    const [field] = (await response.json()).data[0].configFields
    expect(field.multi).toBe(true)
    expect(field.canonicalParamId).toBe('folderId')
  })

  it('rejects pagination params a full-set list does not implement', async () => {
    const response = await GET(
      request(`/api/v2/connector-types?workspaceId=${WORKSPACE_ID}&limit=1`)
    )

    expect(response.status).toBe(400)
    expect(mocks.connectorTypes).not.toHaveBeenCalled()
  })

  it('requires the workspace whose availability rules decide the answer', async () => {
    expect((await GET(request('/api/v2/connector-types'))).status).toBe(400)
    expect(mocks.connectorTypes).not.toHaveBeenCalled()
  })

  it('conceals a workspace the caller cannot reach as absent', async () => {
    mocks.connectorTypes.mockRejectedValue(
      new OrchestrationError('not_found', 'Workspace not found')
    )

    const response = await GET(request(`/api/v2/connector-types?workspaceId=${WORKSPACE_ID}`))

    expect(response.status).toBe(404)
    expect((await response.json()).error).toMatchObject({
      code: 'NOT_FOUND',
      message: 'Workspace not found',
    })
  })
})
