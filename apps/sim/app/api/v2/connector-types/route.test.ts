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

import { REFILTERED_CURSOR_MESSAGE } from '@/lib/api/cursor-binding'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { GET } from '@/app/api/v2/connector-types/route'

const WORKSPACE_ID = '11111111-2222-4333-8444-555555555555'

const auth = {
  principal: { kind: 'workspace_api_key' as const, workspaceId: WORKSPACE_ID, keyId: 'key-1' },
  rateLimitSubjectIds: ['api-key:key-1'] as const,
  rateLimitSubscription: null,
  keyType: 'workspace' as const,
}

const connectorTypeSummary = {
  connectorType: 'google_drive',
  name: 'Google Drive',
  description: 'Sync Drive documents.',
  auth: { mode: 'oauth' as const },
}

const connectorType = {
  ...connectorTypeSummary,
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

function page<T>(
  entries: T[],
  overrides: { offset?: number; limit?: number; hasMore?: boolean } = {}
) {
  return { entries, offset: 0, limit: 25, hasMore: false, ...overrides }
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
    mocks.connectorTypes.mockResolvedValue(page([connectorTypeSummary]))
  })

  /**
   * The whole catalog with every config schema was 178 K characters. The
   * default is a bounded page of summaries; the schema is one `detail=full` away.
   */
  it('asks for a summary page of 25 by default and keeps it out of shared caches', async () => {
    const response = await GET(request(`/api/v2/connector-types?workspaceId=${WORKSPACE_ID}`))

    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
    expect(await response.json()).toEqual({ data: [connectorTypeSummary], nextCursor: null })
    expect(mocks.connectorTypes).toHaveBeenCalledWith(
      expect.objectContaining({
        input: {
          workspaceId: WORKSPACE_ID,
          search: undefined,
          detail: 'summary',
          limit: 25,
          offset: 0,
        },
      })
    )
  })

  it('publishes the full config schema, with its multi and canonical-pair properties, on detail=full', async () => {
    mocks.connectorTypes.mockResolvedValue(page([connectorType]))

    const response = await GET(
      request(`/api/v2/connector-types?workspaceId=${WORKSPACE_ID}&detail=full`)
    )

    expect(response.status).toBe(200)
    const [item] = (await response.json()).data
    expect(item).toEqual(connectorType)
    expect(item.configFields[0]).toMatchObject({ multi: true, canonicalParamId: 'folderId' })
    expect(mocks.connectorTypes).toHaveBeenCalledWith(
      expect.objectContaining({ input: expect.objectContaining({ detail: 'full' }) })
    )
  })

  it('mints a cursor when more remain and resumes from it under the same filters', async () => {
    mocks.connectorTypes.mockResolvedValue(
      page([connectorTypeSummary], { limit: 1, hasMore: true })
    )

    const first = await GET(
      request(`/api/v2/connector-types?workspaceId=${WORKSPACE_ID}&limit=1&search=drive`)
    )
    const { nextCursor } = await first.json()
    expect(typeof nextCursor).toBe('string')

    mocks.connectorTypes.mockResolvedValue(page([], { offset: 1, limit: 1 }))
    const second = await GET(
      request(
        `/api/v2/connector-types?workspaceId=${WORKSPACE_ID}&limit=1&search=drive&cursor=${encodeURIComponent(nextCursor)}`
      )
    )

    expect(second.status).toBe(200)
    expect(mocks.connectorTypes).toHaveBeenLastCalledWith(
      expect.objectContaining({ input: expect.objectContaining({ offset: 1, search: 'drive' }) })
    )
  })

  it('refuses a cursor minted under a different projection', async () => {
    mocks.connectorTypes.mockResolvedValue(
      page([connectorTypeSummary], { limit: 1, hasMore: true })
    )
    const { nextCursor } = await (
      await GET(request(`/api/v2/connector-types?workspaceId=${WORKSPACE_ID}&limit=1`))
    ).json()

    const response = await GET(
      request(
        `/api/v2/connector-types?workspaceId=${WORKSPACE_ID}&limit=1&detail=full&cursor=${encodeURIComponent(nextCursor)}`
      )
    )

    expect(response.status).toBe(400)
    expect((await response.json()).error.message).toBe(REFILTERED_CURSOR_MESSAGE)
  })

  it('rejects an unknown projection and an out-of-range page size', async () => {
    expect(
      (await GET(request(`/api/v2/connector-types?workspaceId=${WORKSPACE_ID}&detail=all`))).status
    ).toBe(400)
    expect(
      (await GET(request(`/api/v2/connector-types?workspaceId=${WORKSPACE_ID}&limit=0`))).status
    ).toBe(400)
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
