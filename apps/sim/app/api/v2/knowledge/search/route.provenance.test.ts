/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  resolveWorkspace: vi.fn(),
  resolvePermission: vi.fn(),
  getKnowledgeBase: vi.fn(),
  resolveBilling: vi.fn(),
  checkUsage: vi.fn(),
  checkActorUsage: vi.fn(),
  generateEmbedding: vi.fn(),
  executeSearch: vi.fn(),
  getDocumentMetadata: vi.fn(),
  getTagDefinitions: vi.fn(),
  recordEmbeddingUsage: vi.fn(),
}))

vi.mock('@sim/platform-authz/workspace', () => ({
  permissionSatisfies: (actual: string | null, required: string) => {
    const rank = { read: 1, write: 2, admin: 3 } as const
    return (
      actual !== null && rank[actual as keyof typeof rank] >= rank[required as keyof typeof rank]
    )
  },
  resolveEffectiveWorkspacePermission: mocks.resolvePermission,
}))

vi.mock('@/lib/billing/core/billing-attribution', () => ({
  resolveBillingAttribution: mocks.resolveBilling,
  resolveSystemBillingAttribution: mocks.resolveBilling,
  checkAttributedUsageLimits: mocks.checkUsage,
}))

/** Retrieval defaults are the flag's concern; here the flag is off so the search stays as configured. */
vi.mock('@/lib/knowledge/access/availability', () => ({
  isKnowledgeMemberAccessAvailable: async () => false,
}))

vi.mock('@/lib/billing/calculations/usage-monitor', () => ({
  checkActorUsageLimits: mocks.checkActorUsage,
}))

vi.mock('@/lib/knowledge/application/contexts', () => ({
  resolveKnowledgeWorkspaceContext: mocks.resolveWorkspace,
}))

vi.mock('@/lib/knowledge/service', () => ({
  getKnowledgeBaseById: mocks.getKnowledgeBase,
}))

vi.mock('@/lib/knowledge/embeddings', () => ({
  generateSearchEmbedding: mocks.generateEmbedding,
  recordSearchEmbeddingUsage: mocks.recordEmbeddingUsage,
}))

vi.mock('@/lib/knowledge/search/queries', () => ({
  generateSearchEmbedding: mocks.generateEmbedding,
  executeKnowledgeSearch: mocks.executeSearch,
  getDocumentMetadataByIds: mocks.getDocumentMetadata,
}))

vi.mock('@/lib/knowledge/tags/service', () => ({
  getDocumentTagDefinitions: mocks.getTagDefinitions,
}))

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
import { NextRequest } from 'next/server'
import { env } from '@/lib/core/config/env'
import {
  isDurableSecretProvenanceEnforced,
  resetDurableSecretProvenanceEnforcementCache,
} from '@/lib/execution/durable-secret-provenance-enforcement'
import { createKnowledgeDocumentSourceValue } from '@/lib/knowledge/secret-provenance'
import { POST } from '@/app/api/v2/knowledge/search/route'
import { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'

const provider = vi.hoisted(() => ({ fetch: vi.fn(), decrypt: vi.fn() }))
vi.mock('@/lib/api/server/routes/v2-api-key-auth', () => v2ApiKeyAuthModuleMock)
vi.mock('@/lib/core/rate-limiter', () => v2RateLimiterModuleMock)
vi.mock('@/lib/api-key/byok', () => ({ getBYOKKey: async () => null }))
vi.mock('@/lib/core/security/encryption', () => ({ decryptSecret: provider.decrypt }))

const SECRET = 'synthetic-audit-secret-7b88a2'
const CONTENT = `Stored knowledge contains ${SECRET} in this synthetic fixture.`
const HASH = sha256Hex(CONTENT)
const PRINCIPAL = { kind: 'personal_api_key', userId: 'user-1', keyId: 'key-1' } as const
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

function enforceKnowledge(enforced: boolean) {
  env.DURABLE_SECRET_PROVENANCE_ENFORCED_SURFACES = enforced ? 'all' : ''
  resetDurableSecretProvenanceEnforcementCache()
  expect(isDurableSecretProvenanceEnforced('knowledge')).toBe(enforced)
}

async function requestSearch(overrides: Partial<typeof requestInput> = {}) {
  return POST(
    new NextRequest('http://localhost/api/v2/knowledge/search', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': 'synthetic-key' },
      body: JSON.stringify({ ...requestInput, ...overrides }),
    })
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  resetDbChainMock()
  enforceKnowledge(true)
  env.COHERE_API_KEY = 'synthetic-cohere-key'
  provider.decrypt.mockResolvedValue({ decrypted: SECRET })
  provider.fetch.mockResolvedValue(
    new Response(JSON.stringify({ results: [{ index: 0, relevance_score: 0.9 }] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  )
  vi.stubGlobal('fetch', provider.fetch)
  mocks.resolveWorkspace.mockResolvedValue(workspace)
  mocks.resolvePermission.mockResolvedValue('read')
  mocks.getKnowledgeBase.mockResolvedValue(knowledgeBase)
  mocks.resolveBilling.mockResolvedValue({ actorUserId: 'user-1', workspaceId: 'workspace-1' })
  mocks.checkUsage.mockResolvedValue({ isExceeded: false })
  mocks.checkActorUsage.mockResolvedValue({ isExceeded: false })
  mocks.generateEmbedding.mockResolvedValue({ embedding: [0.1], isBYOK: false })
  mocks.executeSearch.mockResolvedValue([row])
  mocks.getDocumentMetadata.mockResolvedValue({
    'document-1': { filename: 'synthetic.txt', sourceUrl: null },
  })
  mocks.getTagDefinitions.mockResolvedValue([])
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
  it.each([false, true])(
    'redacts current known-secret chunks with enforcement=%s',
    async (enforced) => {
      enforceKnowledge(enforced)
      seedSidecar('exact')
      const response = await requestSearch()
      const body = await response.json()
      expect(response.status).toBe(200)
      expect(body.data.rerankerStatus).toBe('applied')
      expect(providerPayload().documents).toEqual([CONTENT.replace(SECRET, '{{TOKEN}}')])
      expect(body.data.results[0].content).toBe(CONTENT)
      expect(provider.decrypt).toHaveBeenCalledWith('synthetic-encrypted-token')
      expect(mocks.generateEmbedding).toHaveBeenCalledWith(
        requestInput.query,
        expect.anything(),
        'workspace-1'
      )
    }
  )

  it('does not assign a billing owner secret name to a workspace-key caller', async () => {
    seedSidecar('exact')
    v2RouteMocks.authenticate.mockResolvedValue({
      principal: { kind: 'workspace_api_key', workspaceId: 'workspace-1', keyId: 'key-1' },
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
    'refuses %s tracked provenance before provider HTTP when enforcement is enabled',
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

  it.each(['unknown', 'missing', 'stale', 'malformed'] as const)(
    'preserves existing flag-off compatibility for %s sidecars',
    async (status) => {
      enforceKnowledge(false)
      seedSidecar(status)
      const response = await requestSearch()
      expect(response.status).toBe(200)
      expect(providerPayload().documents).toEqual([CONTENT])
    }
  )

  it.each([false, true])(
    'keeps pre-tracking NULL rows readable with enforcement=%s',
    async (enforced) => {
      enforceKnowledge(enforced)
      seedSidecar('legacy')
      const response = await requestSearch()
      expect(response.status).toBe(200)
      expect(providerPayload().documents).toEqual([CONTENT])
    }
  )

  it('does not subject a raw public read without reranking to durable-model enforcement', async () => {
    seedSidecar('unknown')
    const response = await requestSearch({ rerankerEnabled: false })
    const body = await response.json()
    expect(response.status).toBe(200)
    expect(body.data.results[0].content).toBe(CONTENT)
    expect(provider.fetch).not.toHaveBeenCalled()
    expect(provider.decrypt).not.toHaveBeenCalled()
  })
})
