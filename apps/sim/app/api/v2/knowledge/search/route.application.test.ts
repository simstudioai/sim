import {
  createPersonalApiKeyPrincipal,
  createWorkspaceApiKeyPrincipal,
} from '@sim/testing/factories/principal.factory'
import { apiKeyByokMock } from '@sim/testing/mocks/api-key-byok.mock'
import {
  billingAttributionMock,
  billingAttributionMockFns,
} from '@sim/testing/mocks/billing-attribution.mock'
import {
  billingUsageGateCacheMock,
  billingUsageGateCacheMockFns,
} from '@sim/testing/mocks/billing-usage-gate-cache.mock'
import {
  billingUsageMonitorMock,
  billingUsageMonitorMockFns,
} from '@sim/testing/mocks/billing-usage-monitor.mock'
import { encryptionMock, encryptionMockFns } from '@sim/testing/mocks/encryption.mock'
import {
  knowledgeAvailabilityMock,
  knowledgeAvailabilityMockFns,
} from '@sim/testing/mocks/knowledge-availability.mock'
import {
  knowledgeContextsMock,
  knowledgeContextsMockFns,
} from '@sim/testing/mocks/knowledge-contexts.mock'
import {
  knowledgeEmbeddingsMock,
  knowledgeEmbeddingsMockFns,
} from '@sim/testing/mocks/knowledge-embeddings.mock'
import {
  knowledgeServiceMock,
  knowledgeServiceMockFns,
} from '@sim/testing/mocks/knowledge-service.mock'
import {
  knowledgeTagsServiceMock,
  knowledgeTagsServiceMockFns,
} from '@sim/testing/mocks/knowledge-tags-service.mock'
import { createMockRequest } from '@sim/testing/mocks/request.mock'
import { workspaceAuthzMock, workspaceAuthzMockFns } from '@sim/testing/mocks/workspace-authz.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getKnowledgeBase: vi.fn(),
  executeSearch: vi.fn(),
}))

vi.mock('@sim/platform-authz/workspace', () => workspaceAuthzMock)

vi.mock('@/lib/billing/core/billing-attribution', () => billingAttributionMock)

vi.mock('@/lib/billing/core/usage-gate-cache', () => billingUsageGateCacheMock)

/** Retrieval defaults are the flag's concern; here the flag is off so the search stays as configured. */
vi.mock('@/lib/knowledge/access/availability', () => knowledgeAvailabilityMock)

vi.mock('@/lib/billing/calculations/usage-monitor', () => billingUsageMonitorMock)

vi.mock('@/lib/knowledge/application/contexts', () => knowledgeContextsMock)

vi.mock('@/lib/knowledge/service', () => knowledgeServiceMock)

vi.mock('@/lib/knowledge/embeddings', () => knowledgeEmbeddingsMock)

vi.mock('@/lib/knowledge/search/queries', () => ({
  generateSearchEmbedding: knowledgeEmbeddingsMockFns.mockGenerateSearchEmbedding,
  retrieveKnowledgeSearch: async (...args: unknown[]) => ({
    rows: await mocks.executeSearch(...args),
    retrieval: { status: 'complete', timedOutLegs: [] },
  }),
}))

vi.mock('@/lib/knowledge/tags/service', () => knowledgeTagsServiceMock)

vi.mock('@/lib/knowledge/tags/utils', () => ({
  buildUndefinedTagsError: (tags: string[]) => `Undefined tags: ${tags.join(', ')}`,
  validateTagValue: () => null,
}))

import { searchKnowledge } from '@/lib/knowledge/application/search'

const workspace = {
  workspaceId: 'workspace-1',
  workspaceOrganizationId: null,
  allowPersonalApiKeys: true,
  billedAccountUserId: 'billing-owner-1',
}

const knowledgeBase = {
  id: 'knowledge-1',
  userId: 'user-1',
  name: 'Docs',
  workspaceId: 'workspace-1',
  embeddingModel: 'text-embedding-3-small',
  embeddingDimension: 1536,
}

import { document, embedding } from '@sim/db/schema'
import { sha256Hex } from '@sim/security/hash'
import {
  queueTableRows,
  resetDbChainMock,
  V2_OPERATION_RATE_LIMIT_ALLOWED,
  V2_PREAUTH_RATE_LIMIT_ALLOWED,
  v2ApiKeyAuthModuleMock,
  v2RateLimiterModuleMock,
  v2RouteMocks,
} from '@sim/testing'
import { env } from '@/lib/core/config/env'
import { createKnowledgeDocumentSourceValue } from '@/lib/knowledge/secret-provenance'
import { POST } from '@/app/api/v2/knowledge/search/route'
import { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'

const { mockGetDocumentTagDefinitions } = knowledgeTagsServiceMockFns

knowledgeServiceMockFns.mockGetActiveKnowledgeBaseReferences.mockImplementation((ids: string[]) =>
  Promise.all(ids.map((id) => mocks.getKnowledgeBase(id)))
)
const { mockGenerateSearchEmbedding } = knowledgeEmbeddingsMockFns
const { mockCheckSearchUsageLimits } = billingUsageGateCacheMockFns
const { mockCheckActorUsageLimits } = billingUsageMonitorMockFns

knowledgeAvailabilityMockFns.mockIsKnowledgeMemberAccessAvailable.mockResolvedValue(false)

const provider = vi.hoisted(() => ({ fetch: vi.fn() }))
vi.mock('@/lib/api/server/routes/v2-api-key-auth', () => v2ApiKeyAuthModuleMock)
vi.mock('@/lib/core/rate-limiter', () => v2RateLimiterModuleMock)
vi.mock('@/lib/core/rate-limiter/storage/factory', () => ({
  createStorageAdapter: () => ({
    consumeTokensAtomically: async () => ({ allowed: true, retryAfterMs: 0 }),
    getCooldownUntil: async () => null,
    setCooldownUntil: async () => undefined,
  }),
}))
vi.mock('@/lib/api-key/byok', () => apiKeyByokMock)
vi.mock('@/lib/core/security/encryption', () => encryptionMock)

const SECRET = 'synthetic-audit-secret-7b88a2'
const CONTENT = `Stored knowledge contains ${SECRET} in this synthetic fixture.`
const HASH = sha256Hex(CONTENT)
const PRINCIPAL = createPersonalApiKeyPrincipal()
const requestInput = {
  workspaceId: 'workspace-1',
  knowledgeBaseIds: ['knowledge-1'],
  query: 'find the fixture',
  topK: 1,
  rerankerEnabled: true,
  rerankerModel: 'rerank-v4.0-fast',
}
const source = createKnowledgeDocumentSourceValue({
  filename: 'synthetic.txt',
  fileUrl: 'https://example.invalid/synthetic.txt',
})
const row = {
  id: 'embedding-1',
  documentId: 'document-1',
  knowledgeBaseId: 'knowledge-1',
  content: CONTENT,
  chunkIndex: 0,
  distance: 0.2,
  tag1: null,
  tag2: null,
  tag3: null,
  tag4: null,
  tag5: null,
  tag6: null,
  tag7: null,
  number1: null,
  number2: null,
  number3: null,
  number4: null,
  number5: null,
  date1: null,
  date2: null,
  boolean1: null,
  boolean2: null,
  boolean3: null,
}

function seedSidecar(status: 'exact' | 'unknown' | 'legacy' | 'missing' | 'stale' | 'malformed') {
  queueTableRows(embedding, [
    {
      ...row,
      secretProvenanceVersion: status === 'legacy' ? null : 1,
      chunkHash: HASH,
      provenanceContentHash: status === 'stale' ? 'old-hash' : HASH,
      status: status === 'missing' ? null : status === 'unknown' ? 'unknown' : 'exact',
      entries:
        status === 'malformed'
          ? [{ encryptedValue: 123 }]
          : status === 'exact'
            ? [
                {
                  name: 'TOKEN',
                  encryptedValue: 'synthetic-encrypted-token',
                  sourceUserId: 'user-1',
                  sourceWorkspaceId: 'workspace-1',
                },
              ]
            : [],
    },
  ])
  queueTableRows(document, [
    {
      id: 'document-1',
      ...source,
      secretProvenanceVersion: null,
      provenanceSourceHash: null,
      status: null,
      entries: null,
    },
  ])
}

function providerPayload() {
  expect(provider.fetch).toHaveBeenCalledTimes(1)
  expect(provider.fetch.mock.calls[0][0]).toBe('https://api.cohere.com/v2/rerank')
  return JSON.parse(provider.fetch.mock.calls[0][1].body)
}

async function requestSearch(overrides: Partial<typeof requestInput> = {}) {
  return POST(
    createMockRequest({
      method: 'POST',
      url: 'http://localhost/api/v2/knowledge/search',
      headers: { 'x-api-key': 'synthetic-key' },
      body: { ...requestInput, ...overrides },
    })
  )
}

beforeEach(() => {
  resetDbChainMock()
  env.COHERE_API_KEY = 'synthetic-cohere-key'
  encryptionMockFns.mockDecryptSecret.mockResolvedValue({ decrypted: SECRET })
  provider.fetch.mockResolvedValue(
    new Response(JSON.stringify({ results: [{ index: 0, relevance_score: 0.9 }] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  )
  vi.stubGlobal('fetch', provider.fetch)
  knowledgeContextsMockFns.mockResolveKnowledgeWorkspaceContext.mockResolvedValue(workspace)
  workspaceAuthzMockFns.mockResolveEffectiveWorkspacePermission.mockResolvedValue('read')
  mocks.getKnowledgeBase.mockResolvedValue(knowledgeBase)
  billingAttributionMockFns.mockResolveBillingAttribution.mockResolvedValue({
    actorUserId: 'user-1',
    workspaceId: 'workspace-1',
  })
  billingAttributionMockFns.mockResolveSystemBillingAttribution.mockResolvedValue({
    actorUserId: 'user-1',
    workspaceId: 'workspace-1',
  })
  mockCheckSearchUsageLimits.mockResolvedValue({ isExceeded: false })
  mockCheckActorUsageLimits.mockResolvedValue({ isExceeded: false })
  mockGenerateSearchEmbedding.mockResolvedValue({ embedding: [0.1], isBYOK: false })
  mocks.executeSearch.mockResolvedValue([row])
  mockGetDocumentTagDefinitions.mockResolvedValue([])
  v2RouteMocks.preauthRate.mockResolvedValue(V2_PREAUTH_RATE_LIMIT_ALLOWED)
  v2RouteMocks.operationRate.mockResolvedValue(V2_OPERATION_RATE_LIMIT_ALLOWED)
  v2RouteMocks.authenticate.mockResolvedValue({
    principal: PRINCIPAL,
    rateLimitSubjectIds: ['api-key:key-1', 'workspace:workspace-1'],
    rateLimitSubscription: null,
    keyType: 'personal',
  })
})

/** The route, use case, sidecar binding/import, registry, projection and provider request builder are real. */
describe('Knowledge search provenance through the V2 route and reranker HTTP boundary', () => {
  it('redacts current known-secret chunks', async () => {
    seedSidecar('exact')
    const response = await requestSearch()
    const body = await response.json()
    expect(response.status).toBe(200)
    expect(body.data.rerankerStatus).toBe('applied')
    expect(providerPayload().documents).toEqual([CONTENT.replace(SECRET, '{{TOKEN}}')])
    expect(body.data.results[0].content).toBe(CONTENT)
    expect(encryptionMockFns.mockDecryptSecret).toHaveBeenCalledWith('synthetic-encrypted-token')
    expect(mockGenerateSearchEmbedding).toHaveBeenCalledWith(
      requestInput.query,
      expect.anything(),
      'workspace-1',
      undefined
    )
  })

  it('does not assign a billing owner secret name to a workspace-key caller', async () => {
    seedSidecar('exact')
    v2RouteMocks.authenticate.mockResolvedValue({
      principal: createWorkspaceApiKeyPrincipal(),
      rateLimitSubjectIds: ['api-key:key-1', 'workspace:workspace-1'],
      rateLimitSubscription: null,
      keyType: 'workspace',
    })
    const response = await requestSearch()
    expect(response.status).toBe(200)
    expect(providerPayload().documents).toEqual([CONTENT.replace(SECRET, '[REDACTED_SECRET]')])
  })

  it('keeps a trusted incoming registry for existing internal and tool callers', async () => {
    seedSidecar('exact')
    const registry = new ResolvedSecretTraceRegistry([], {
      userId: 'user-1',
      workspaceId: 'workspace-1',
    })
    const result = await searchKnowledge.execute({
      principal: PRINCIPAL,
      input: { ...requestInput, resultSecretRegistry: registry },
    })
    expect(result.rerankerStatus).toBe('applied')
    expect(result.resultSecretRegistry).toBe(registry)
    expect(providerPayload().documents).toEqual([CONTENT.replace(SECRET, '{{TOKEN}}')])
  })

  it.each(['unknown', 'missing', 'stale', 'malformed'] as const)(
    'refuses %s tracked provenance before provider HTTP',
    async (status) => {
      seedSidecar(status)
      const response = await requestSearch()
      expect(response.status).toBe(409)
      expect(await response.json()).toMatchObject({
        error: { code: 'CONFLICT', message: 'Knowledge result secret provenance is unavailable' },
      })
      expect(provider.fetch).not.toHaveBeenCalled()
    }
  )

  it('keeps pre-tracking NULL rows readable', async () => {
    seedSidecar('legacy')
    const response = await requestSearch()
    expect(response.status).toBe(200)
    expect(providerPayload().documents).toEqual([CONTENT])
  })

  it('does not subject a raw public read without reranking to durable-model enforcement', async () => {
    seedSidecar('unknown')
    const response = await requestSearch({ rerankerEnabled: false })
    const body = await response.json()
    expect(response.status).toBe(200)
    expect(body.data.results[0].content).toBe(CONTENT)
    expect(provider.fetch).not.toHaveBeenCalled()
    expect(encryptionMockFns.mockDecryptSecret).not.toHaveBeenCalled()
  })
})
