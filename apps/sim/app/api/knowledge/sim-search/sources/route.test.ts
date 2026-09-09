/** @vitest-environment node */
import { authMockFns, createMockRequest } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  connect: vi.fn(),
  overview: vi.fn(),
  adminOverview: vi.fn(),
}))
vi.mock('@/lib/knowledge/application/organization-search-overview', () => ({
  readOrganizationSearchOverview: {
    operation: { id: 'knowledge.search.integrations.overview' },
    execute: mocks.adminOverview,
  },
}))
vi.mock('@/lib/knowledge/application/sim-search', () => ({
  connectSimSearchConnector: {
    operation: { id: 'knowledge.simSearch.connect' },
    execute: mocks.connect,
  },
}))
vi.mock('@/lib/knowledge/application/search-sources', () => ({
  listSearchSources: { operation: { id: 'knowledge.search.sources.list' }, execute: mocks.execute },
}))
vi.mock('@/lib/knowledge/application/search-source-overview', () => ({
  readSearchSourceOverview: {
    operation: { id: 'knowledge.search.sources.overview' },
    execute: mocks.overview,
  },
}))
vi.mock('@/lib/knowledge/application/search', () => ({
  KnowledgeSearchProvenanceUnavailableError: class extends Error {},
}))
vi.mock('@/lib/knowledge/application/upload-sessions', () => ({
  KnowledgeDocumentUnsupportedMediaTypeError: class extends Error {},
}))

import { NoWorkspaceAccessError } from '@/lib/core/application/workspace-authorization'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { POST as connectSource } from '@/app/api/knowledge/sim-search/connect/route'
import { GET as getAdminOverview } from '@/app/api/knowledge/sim-search/integrations/overview/route'
import { GET as getOverview } from '@/app/api/knowledge/sim-search/sources/overview/route'
import { GET } from '@/app/api/knowledge/sim-search/sources/route'

const WORKSPACE_ID = '7d28e5e2-fb03-4118-9c52-4ab77ccff369'
const source = {
  knowledgeBaseId: 'search-index',
  connectorId: 'source',
  connectorType: 'google_drive',
  sourceDescription: 'Handbook',
  accessMode: 'admin',
  availability: 'available',
  enabled: true,
  isSyncing: false,
  lastSyncAt: null,
  hasSyncError: false,
  viewerDocumentCount: 0,
  viewerFailedDocumentCount: 0,
  viewerEmailVerified: true,
  connectionRequired: false,
  viewerMembership: null,
}

beforeEach(() => {
  vi.clearAllMocks()
  authMockFns.mockGetSession.mockResolvedValue({
    user: { id: 'reader' },
    session: { id: 'session' },
  })
  mocks.execute.mockResolvedValue({ sources: [source], nextCursor: null })
})

describe('GET Search sources', () => {
  it('preserves the explicit organization in source listing and member enrollment', async () => {
    const response = await GET(
      createMockRequest(
        'GET',
        undefined,
        {},
        `http://localhost/api/knowledge/sim-search/sources?organizationId=${WORKSPACE_ID}`
      )
    )
    expect(response.status).toBe(200)
    expect(mocks.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        input: { organizationId: WORKSPACE_ID },
      })
    )

    mocks.connect.mockResolvedValue({
      knowledgeBaseId: 'index',
      connectorId: 'source',
      url: 'http://localhost/credential-groups/enroll/token',
    })
    const body = { organizationId: WORKSPACE_ID, connectorType: 'gmail' }
    const connected = await connectSource(createMockRequest('POST', body))
    expect(connected.status).toBe(200)
    expect(mocks.connect).toHaveBeenCalledWith(expect.objectContaining({ input: body }))
  })

  it('authenticates before parsing the workspace query', async () => {
    authMockFns.mockGetSession.mockResolvedValue(null)
    const response = await GET(createMockRequest('GET'))
    expect(response.status).toBe(401)
    expect(mocks.execute).not.toHaveBeenCalled()
  })

  it('refuses a missing workspace before entering the use case', async () => {
    const response = await GET(createMockRequest('GET'))
    expect(response.status).toBe(400)
    expect(mocks.execute).not.toHaveBeenCalled()
  })

  it('passes the authenticated subject into the registered operation and projects only the contract fields', async () => {
    mocks.execute.mockResolvedValue({
      nextCursor: null,
      sources: [
        {
          ...source,
          credentialId: 'secret',
          sourceConfig: { token: 'secret' },
          lastSyncError: 'private failure',
        },
      ],
    })
    const response = await GET(
      createMockRequest(
        'GET',
        undefined,
        {},
        `http://localhost/api/knowledge/sim-search/sources?workspaceId=${WORKSPACE_ID}`
      )
    )
    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
    const body = await response.json()
    expect(body).toMatchObject({ success: true, data: { sources: [source], nextCursor: null } })
    expect(body.data.sources[0]).toEqual(source)
    expect(mocks.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        principal: { kind: 'session', userId: 'reader', sessionId: 'session' },
        input: { workspaceId: WORKSPACE_ID },
      })
    )
  })

  it('preserves authorization rejection and conceals source data', async () => {
    mocks.execute.mockRejectedValue(new NoWorkspaceAccessError())
    const response = await GET(
      createMockRequest(
        'GET',
        undefined,
        {},
        `http://localhost/api/knowledge/sim-search/sources?workspaceId=${WORKSPACE_ID}`
      )
    )
    expect(response.status).toBe(404)
    expect(await response.json()).not.toHaveProperty('data')
  })

  it('does not publish infrastructure errors or mistake failures for an empty list', async () => {
    mocks.execute.mockRejectedValue(new Error('database private connection string'))
    const response = await GET(
      createMockRequest(
        'GET',
        undefined,
        {},
        `http://localhost/api/knowledge/sim-search/sources?workspaceId=${WORKSPACE_ID}`
      )
    )
    expect(response.status).toBe(500)
    const body = await response.json()
    expect(body.error).toBe('Internal server error')
    expect(body).not.toHaveProperty('data')
  })
})

describe('Search pagination boundary', () => {
  it('forwards bounded source filters and opaque cursors to the authorized operation', async () => {
    const response = await GET(
      createMockRequest(
        'GET',
        undefined,
        {},
        `http://localhost/api/knowledge/sim-search/sources?workspaceId=${WORKSPACE_ID}&search=Handbook&mine=true&cursor=opaque&connectorType=google_drive`
      )
    )
    expect(response.status).toBe(200)
    expect(mocks.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        input: {
          workspaceId: WORKSPACE_ID,
          search: 'Handbook',
          mine: true,
          cursor: 'opaque',
          connectorType: 'google_drive',
        },
      })
    )
  })
  it.each([
    `search=${'x'.repeat(201)}`,
    `cursor=${'x'.repeat(1025)}`,
    `connectorType=${'x'.repeat(101)}`,
    'connectorType=%20',
  ])('rejects an oversized filter or cursor before source reads', async (filter) => {
    const response = await GET(
      createMockRequest(
        'GET',
        undefined,
        {},
        `http://localhost/api/knowledge/sim-search/sources?workspaceId=${WORKSPACE_ID}&${filter}`
      )
    )
    expect(response.status).toBe(400)
    expect(mocks.execute).not.toHaveBeenCalled()
  })
  it('serves only the bounded provider overview through the registered operation', async () => {
    mocks.overview.mockResolvedValue({
      providers: [{ connectorType: 'google_drive', isSyncing: true }],
      hasSearchableDocuments: false,
      credentials: 'private',
    })
    const response = await getOverview(
      createMockRequest(
        'GET',
        undefined,
        {},
        `http://localhost/api/knowledge/sim-search/sources/overview?workspaceId=${WORKSPACE_ID}`
      )
    )
    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
    expect(await response.json()).toEqual({
      success: true,
      data: {
        providers: [{ connectorType: 'google_drive', isSyncing: true }],
        hasSearchableDocuments: false,
      },
    })
    expect(mocks.overview).toHaveBeenCalledWith(
      expect.objectContaining({
        principal: { kind: 'session', userId: 'reader', sessionId: 'session' },
        input: { workspaceId: WORKSPACE_ID },
      })
    )
  })
  it('authenticates before parsing the overview scope', async () => {
    authMockFns.mockGetSession.mockResolvedValue(null)
    const response = await getOverview(createMockRequest('GET'))
    expect(response.status).toBe(401)
    expect(mocks.overview).not.toHaveBeenCalled()
  })
})

describe('organization administration overview boundary', () => {
  it('authenticates before parsing the organization', async () => {
    authMockFns.mockGetSession.mockResolvedValue(null)
    expect((await getAdminOverview(createMockRequest('GET'))).status).toBe(401)
    expect(mocks.adminOverview).not.toHaveBeenCalled()
  })
  it('projects only the bounded operational contract and forwards the current session', async () => {
    const provider = {
      connectorType: 'gmail',
      sourceCount: 1,
      approved: true,
      status: 'waiting_for_connections',
      isSyncing: false,
    }
    mocks.adminOverview.mockResolvedValue({
      providers: [{ ...provider, privateAccount: 'private' }],
      documentNames: ['private'],
    })
    const response = await getAdminOverview(
      createMockRequest(
        'GET',
        undefined,
        {},
        `http://localhost/api/knowledge/sim-search/integrations/overview?organizationId=${WORKSPACE_ID}`
      )
    )
    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
    expect(await response.json()).toEqual({ success: true, data: { providers: [provider] } })
    expect(mocks.adminOverview).toHaveBeenCalledWith(
      expect.objectContaining({
        principal: { kind: 'session', userId: 'reader', sessionId: 'session' },
        input: { organizationId: WORKSPACE_ID },
      })
    )
  })
  it('preserves a role refusal without exposing health data', async () => {
    mocks.adminOverview.mockRejectedValue(
      new OrchestrationError('forbidden', 'Organization administrator access is required')
    )
    const response = await getAdminOverview(
      createMockRequest(
        'GET',
        undefined,
        {},
        `http://localhost/api/knowledge/sim-search/integrations/overview?organizationId=${WORKSPACE_ID}`
      )
    )
    expect(response.status).toBe(403)
    expect(await response.json()).not.toHaveProperty('data')
  })
})
