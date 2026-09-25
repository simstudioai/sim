import { authMockFns, createMockRequest } from '@sim/testing'
import { knowledgeSearchUseCaseMock } from '@sim/testing/mocks/knowledge-search-use-case.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SearchSourceSummary } from '@/lib/api/contracts/knowledge/connectors'

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  overview: vi.fn(),
  adminOverview: vi.fn(),
}))
vi.mock('@/lib/knowledge/application/organization-search-overview', () => ({
  readOrganizationSearchOverview: {
    operation: { id: 'knowledge.search.integrations.overview' },
    execute: mocks.adminOverview,
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
vi.mock('@/lib/knowledge/application/search', () => knowledgeSearchUseCaseMock)
vi.mock('@/lib/knowledge/application/upload-sessions', () => ({
  KnowledgeDocumentUnsupportedMediaTypeError: class extends Error {},
}))

import { NoWorkspaceAccessError } from '@/lib/core/application/workspace-authorization'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { GET as getAdminOverview } from '@/app/api/knowledge/sim-search/integrations/overview/route'
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
  hasViewerDocuments: false,
  viewerFailedDocumentCount: 0,
  viewerEmailVerified: true,
  viewerAccounts: [],
  connectionRequired: false,
  viewerMembership: null,
} satisfies SearchSourceSummary

beforeEach(() => {
  authMockFns.mockGetSession.mockResolvedValue({
    user: { id: 'reader' },
    session: { id: 'session' },
  })
  mocks.execute.mockResolvedValue({ sources: [source], nextCursor: null })
})

describe('GET Search sources', () => {
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
})

describe('organization administration overview boundary', () => {
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
