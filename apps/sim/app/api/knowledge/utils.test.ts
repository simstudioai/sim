/**
 * @vitest-environment node
 *
 * Knowledge Utils Unit Tests
 *
 * This file contains unit tests for the knowledge base utility functions,
 * including access checks, document processing, and embedding generation.
 */
import {
  dbChainMockFns,
  queueTableRows,
  resetDbChainMock,
  resetEnvMock,
  schemaMock,
  setEnv,
} from '@sim/testing'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import * as billingAttributionModule from '@/lib/billing/core/billing-attribution'
import * as documentsUtilsModule from '@/lib/knowledge/documents/utils'
import * as workspacesUtilsModule from '@/lib/workspaces/utils'

const UNSET_EMBEDDING_ENV = {
  OPENAI_API_KEY: undefined,
  OPENAI_API_KEY_1: undefined,
  OPENAI_API_KEY_2: undefined,
  OPENAI_API_KEY_3: undefined,
  AZURE_OPENAI_API_KEY: undefined,
  AZURE_OPENAI_ENDPOINT: undefined,
  AZURE_OPENAI_API_VERSION: undefined,
  KB_OPENAI_MODEL_NAME: undefined,
}

function setEmbeddingEnv(overrides: Record<string, string | undefined> = {}) {
  setEnv({ ...UNSET_EMBEDDING_ENV, ...overrides })
}

afterAll(() => {
  resetEnvMock()
  resetDbChainMock()
  retrySpy.mockRestore()
  vi.mocked(workspacesUtilsModule.getWorkspaceBilledAccountUserId).mockRestore()
  vi.mocked(billingAttributionModule.assertBillingAttributionSnapshot).mockRestore()
  vi.mocked(billingAttributionModule.checkAttributedUsageLimits).mockRestore()
  vi.mocked(billingAttributionModule.resolveBillingAttribution).mockRestore()
  vi.mocked(billingAttributionModule.toBillingContext).mockRestore()
})

/**
 * Spy on the real documents/utils namespace instead of vi.mock: the shared
 * `@/lib/knowledge/embeddings` module may be cached bound to the real module,
 * so patching the namespace is the only wiring that always applies.
 */
const retrySpy = vi
  .spyOn(documentsUtilsModule, 'retryWithExponentialBackoff')
  .mockImplementation(((fn: () => unknown) => fn()) as never)

const BILLING_ATTRIBUTION_FIXTURE = {
  actorUserId: 'billing-user-1',
  billedAccountUserId: 'billing-user-1',
  billingEntity: { type: 'user', id: 'billing-user-1' },
  billingPeriod: {
    start: '2026-07-01T00:00:00.000Z',
    end: '2026-08-01T00:00:00.000Z',
  },
  organizationId: null,
  payerSubscription: null,
  workspaceId: 'workspace1',
} as never

function applyBillingSpies() {
  vi.spyOn(workspacesUtilsModule, 'getWorkspaceBilledAccountUserId').mockResolvedValue('user1')
  vi.spyOn(billingAttributionModule, 'assertBillingAttributionSnapshot').mockImplementation(
    ((value: unknown) => value) as never
  )
  vi.spyOn(billingAttributionModule, 'checkAttributedUsageLimits').mockResolvedValue({
    isExceeded: false,
    payerUsage: { currentUsage: 0, limit: 100 },
  } as never)
  vi.spyOn(billingAttributionModule, 'resolveBillingAttribution').mockResolvedValue(
    BILLING_ATTRIBUTION_FIXTURE
  )
  vi.spyOn(billingAttributionModule, 'toBillingContext').mockImplementation((() => ({
    billingEntity: { type: 'user', id: 'billing-user-1' },
    billingPeriod: {
      start: new Date('2026-07-01T00:00:00.000Z'),
      end: new Date('2026-08-01T00:00:00.000Z'),
    },
  })) as never)
}

/**
 * Billing helpers are spied on the real namespaces (not vi.mock'd) for the
 * same shared-consumer reason as the retry spy above.
 */
applyBillingSpies()

vi.mock('@/lib/knowledge/documents/document-processor', () => ({
  processDocument: vi.fn().mockResolvedValue({
    chunks: [
      {
        text: 'alpha',
        tokenCount: 1,
        metadata: { startIndex: 0, endIndex: 4 },
      },
      {
        text: 'beta',
        tokenCount: 1,
        metadata: { startIndex: 5, endIndex: 8 },
      },
    ],
    metadata: {
      filename: 'dummy',
      fileSize: 10,
      mimeType: 'text/plain',
      characterCount: 9,
      tokenCount: 3,
      chunkCount: 2,
      processingMethod: 'file-parser',
    },
  }),
}))

function createEmbeddingFetchMock() {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      data: [
        { embedding: [0.1, 0.2], index: 0 },
        { embedding: [0.3, 0.4], index: 1 },
      ],
      usage: { prompt_tokens: 2, total_tokens: 2 },
    }),
  })
}

vi.stubGlobal('fetch', createEmbeddingFetchMock())

import { processDocumentAsync } from '@/lib/knowledge/documents/service'
import { generateEmbeddings } from '@/lib/knowledge/embeddings'
import {
  checkChunkAccess,
  checkDocumentAccess,
  checkKnowledgeBaseAccess,
} from '@/app/api/knowledge/utils'

describe('Knowledge Utils', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    // `unstubGlobals: true` removes the module-scope fetch stub after the
    // first test in the worker; re-stub it per test.
    vi.stubGlobal('fetch', createEmbeddingFetchMock())
    resetEnvMock()
    setEmbeddingEnv({ OPENAI_API_KEY: 'test-key' })
    retrySpy.mockImplementation(((fn: () => unknown) => fn()) as never)
    applyBillingSpies()
  })

  describe('processDocumentAsync', () => {
    it('should insert embeddings before updating document counters', async () => {
      /** Context prefetch JOIN (document × knowledge_base × workspace). */
      queueTableRows(schemaMock.document, [
        {
          workspaceId: 'workspace1',
          knowledgeBaseUserId: 'user1',
          chunkingConfig: { maxSize: 1024, minSize: 1, overlap: 200 },
          embeddingModel: 'text-embedding-3-small',
          billedAccountUserId: 'billing-user-1',
          uploadedBy: null,
        },
      ])
      /** In-transaction active-document recheck. */
      queueTableRows(schemaMock.document, [{ id: 'doc1' }])

      await processDocumentAsync(
        'kb1',
        'doc1',
        {
          filename: 'file.txt',
          fileUrl: 'https://example.com/file.txt',
          fileSize: 10,
          mimeType: 'text/plain',
        },
        {},
        {
          actorUserId: 'billing-user-1',
          billedAccountUserId: 'billing-user-1',
          billingEntity: { type: 'user', id: 'billing-user-1' },
          billingPeriod: {
            start: '2026-07-01T00:00:00.000Z',
            end: '2026-08-01T00:00:00.000Z',
          },
          organizationId: null,
          payerSubscription: null,
          workspaceId: 'workspace1',
        }
      )

      /**
       * Embeddings are inserted first, then the document counter update. The
       * status→'processing' update precedes both and a usage_log billing insert
       * (recordUsage) may trail after — assert relative order via the shared
       * spies' invocation order rather than exact call sequences.
       */
      const setPayloads = dbChainMockFns.set.mock.calls.map((call) => call[0])
      const completedIndex = setPayloads.findIndex((p) => p?.processingStatus === 'completed')
      expect(setPayloads[completedIndex]).toMatchObject({
        processingStatus: 'completed',
        chunkCount: 2,
      })

      expect(dbChainMockFns.values.mock.calls[0][0]).toHaveLength(2)
      expect(dbChainMockFns.values.mock.invocationCallOrder[0]).toBeLessThan(
        dbChainMockFns.set.mock.invocationCallOrder[completedIndex]
      )
    })
  })

  describe('checkKnowledgeBaseAccess', () => {
    it('should return success for owner', async () => {
      queueTableRows(schemaMock.knowledgeBase, [{ id: 'kb1', userId: 'user1' }])
      const result = await checkKnowledgeBaseAccess('kb1', 'user1')

      expect(result.hasAccess).toBe(true)
    })

    it('should return notFound when knowledge base is missing', async () => {
      const result = await checkKnowledgeBaseAccess('missing', 'user1')

      expect(result.hasAccess).toBe(false)
      expect('notFound' in result && result.notFound).toBe(true)
    })
  })

  describe('checkDocumentAccess', () => {
    it('should return unauthorized when user mismatch', async () => {
      queueTableRows(schemaMock.knowledgeBase, [{ id: 'kb1', userId: 'owner' }])
      const result = await checkDocumentAccess('kb1', 'doc1', 'intruder')

      expect(result.hasAccess).toBe(false)
      if ('reason' in result) {
        expect(result.reason).toBe('Unauthorized knowledge base access')
      }
    })
  })

  describe('checkChunkAccess', () => {
    it('should fail when document is not completed', async () => {
      queueTableRows(schemaMock.knowledgeBase, [{ id: 'kb1', userId: 'user1' }])
      queueTableRows(schemaMock.document, [
        { id: 'doc1', knowledgeBaseId: 'kb1', processingStatus: 'processing' },
      ])

      const result = await checkChunkAccess('kb1', 'doc1', 'chunk1', 'user1')

      expect(result.hasAccess).toBe(false)
      if ('reason' in result) {
        expect(result.reason).toContain('Document is not ready')
      }
    })

    it('should return success for valid access', async () => {
      queueTableRows(schemaMock.knowledgeBase, [{ id: 'kb1', userId: 'user1' }])
      queueTableRows(schemaMock.document, [
        { id: 'doc1', knowledgeBaseId: 'kb1', processingStatus: 'completed' },
      ])
      queueTableRows(schemaMock.embedding, [{ id: 'chunk1', documentId: 'doc1' }])

      const result = await checkChunkAccess('kb1', 'doc1', 'chunk1', 'user1')

      expect(result.hasAccess).toBe(true)
      if ('chunk' in result) {
        expect(result.chunk.id).toBe('chunk1')
      }
    })
  })

  describe('generateEmbeddings', () => {
    it('should return same length as input', async () => {
      const result = await generateEmbeddings(['a', 'b'])

      expect(result.embeddings.length).toBe(2)
    })

    it('should use Azure OpenAI when Azure config is provided', async () => {
      setEmbeddingEnv({
        AZURE_OPENAI_API_KEY: 'test-azure-key',
        AZURE_OPENAI_ENDPOINT: 'https://test.openai.azure.com',
        AZURE_OPENAI_API_VERSION: '2024-12-01-preview',
        KB_OPENAI_MODEL_NAME: 'text-embedding-ada-002',
        OPENAI_API_KEY: 'test-openai-key',
      })

      const fetchSpy = vi.mocked(fetch)
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [{ embedding: [0.1, 0.2], index: 0 }],
          usage: { prompt_tokens: 1, total_tokens: 1 },
        }),
      } as any)

      await generateEmbeddings(['test text'])

      expect(fetchSpy).toHaveBeenCalledWith(
        'https://test.openai.azure.com/openai/deployments/text-embedding-ada-002/embeddings?api-version=2024-12-01-preview',
        expect.objectContaining({
          headers: expect.objectContaining({
            'api-key': 'test-azure-key',
          }),
        })
      )
    })

    it('should fallback to OpenAI when no Azure config provided', async () => {
      setEmbeddingEnv({
        OPENAI_API_KEY: 'test-openai-key',
      })

      const fetchSpy = vi.mocked(fetch)
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [{ embedding: [0.1, 0.2], index: 0 }],
          usage: { prompt_tokens: 1, total_tokens: 1 },
        }),
      } as any)

      await generateEmbeddings(['test text'])

      expect(fetchSpy).toHaveBeenCalledWith(
        'https://api.openai.com/v1/embeddings',
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer test-openai-key',
          }),
        })
      )
    })

    it('should throw error when no API configuration provided', async () => {
      setEmbeddingEnv()

      await expect(generateEmbeddings(['test text'])).rejects.toThrow(
        'OPENAI_API_KEY is not configured'
      )
    })
  })
})
