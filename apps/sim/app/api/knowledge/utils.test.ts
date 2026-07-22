/**
 * @vitest-environment node
 *
 * Knowledge Utils Unit Tests
 *
 * This file contains unit tests for the knowledge base utility functions,
 * including access checks, document processing, and embedding generation.
 */
import { defaultMockEnv } from '@sim/testing'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import * as billingAttributionModule from '@/lib/billing/core/billing-attribution'
import { env } from '@/lib/core/config/env'
import * as documentsUtilsModule from '@/lib/knowledge/documents/utils'
import * as workspacesUtilsModule from '@/lib/workspaces/utils'

const envSnapshot = { ...env }

afterAll(() => {
  for (const key of Object.keys(env)) {
    delete (env as Record<string, unknown>)[key]
  }
  Object.assign(env, envSnapshot)
  retrySpy.mockRestore()
  vi.mocked(workspacesUtilsModule.getWorkspaceBilledAccountUserId).mockRestore()
  vi.mocked(billingAttributionModule.assertBillingAttributionSnapshot).mockRestore()
  vi.mocked(billingAttributionModule.checkAttributedUsageLimits).mockRestore()
  vi.mocked(billingAttributionModule.resolveBillingAttribution).mockRestore()
  vi.mocked(billingAttributionModule.toBillingContext).mockRestore()
})

vi.mock('drizzle-orm', () => ({
  and: (...args: any[]) => args,
  eq: (...args: any[]) => args,
  isNull: () => true,
  sql: (strings: TemplateStringsArray, ...expr: any[]) => ({ strings, expr }),
}))

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

const dbOps: {
  order: string[]
  insertRecords: any[][]
  updatePayloads: any[]
} = {
  order: [],
  insertRecords: [],
  updatePayloads: [],
}

let kbRows: any[] = []
let docRows: any[] = []
let chunkRows: any[] = []

function resetDatasets() {
  kbRows = []
  docRows = []
  chunkRows = []
}

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

vi.mock('@sim/db', async () => {
  const { schemaMock } = (await import('@sim/testing')) as typeof import('@sim/testing')
  const tableNameFor = (table: any) => {
    if (table === schemaMock.knowledgeBase) return 'knowledge_base'
    if (table === schemaMock.document) return 'document'
    if (table === schemaMock.embedding) return 'embedding'
    return ''
  }
  const selectBuilder = {
    from(table: any) {
      return {
        where() {
          return {
            limit(n: number) {
              const tableName = tableNameFor(table)

              if (tableName === 'knowledge_base') {
                return Promise.resolve(kbRows.slice(0, n))
              }
              if (tableName === 'document') {
                return Promise.resolve(docRows.slice(0, n))
              }
              if (tableName === 'embedding') {
                return Promise.resolve(chunkRows.slice(0, n))
              }

              return Promise.resolve([])
            },
          }
        },
        innerJoin() {
          // document × knowledge_base context JOIN — return the first kb and
          // doc row merged (covers processDocumentAsync's prefetch).
          return {
            leftJoin: () => ({
              where: () => ({
                limit: (n: number) =>
                  Promise.resolve(
                    kbRows.length > 0 && docRows.length > 0
                      ? [
                          { ...kbRows[0], ...docRows[0], billedAccountUserId: 'billing-user-1' },
                        ].slice(0, n)
                      : []
                  ),
              }),
            }),
            where: () => ({
              limit: (n: number) =>
                Promise.resolve(
                  kbRows.length > 0 && docRows.length > 0
                    ? [{ ...kbRows[0], ...docRows[0] }].slice(0, n)
                    : []
                ),
            }),
          }
        },
      }
    },
  }

  return {
    db: {
      select: vi.fn(() => selectBuilder),
      update: (table: any) => ({
        set: (payload: any) => ({
          where: () => {
            const tableName = tableNameFor(table)
            if (tableName === 'knowledge_base') {
              dbOps.order.push('updateKb')
              dbOps.updatePayloads.push(payload)
            } else if (tableName === 'document') {
              if (payload.processingStatus !== 'processing') {
                dbOps.order.push('updateDoc')
                dbOps.updatePayloads.push(payload)
              }
            }
            return Promise.resolve()
          },
        }),
      }),
      delete: () => ({
        where: () => Promise.resolve(),
      }),
      insert: () => ({
        values: (records: any) => {
          dbOps.order.push('insert')
          dbOps.insertRecords.push(records)
          return Promise.resolve()
        },
      }),
      transaction: vi.fn(async (fn: any) => {
        await fn({
          select: () => ({
            from: () => ({
              innerJoin: () => ({
                where: () => ({
                  limit: () => Promise.resolve([{ id: 'doc1' }]),
                }),
              }),
              where: () => ({
                limit: () => Promise.resolve([{}]),
              }),
            }),
          }),
          delete: () => ({
            where: () => Promise.resolve(),
          }),
          insert: () => ({
            values: (records: any) => {
              dbOps.order.push('insert')
              dbOps.insertRecords.push(records)
              return Promise.resolve()
            },
          }),
          update: () => ({
            set: (payload: any) => ({
              where: () => {
                dbOps.updatePayloads.push(payload)
                const label = payload.processingStatus !== undefined ? 'updateDoc' : 'updateKb'
                dbOps.order.push(label)
                return Promise.resolve()
              },
            }),
          }),
        })
      }),
    },
    document: {},
    knowledgeBase: {},
    embedding: {},
  }
})

import { processDocumentAsync } from '@/lib/knowledge/documents/service'
import { generateEmbeddings } from '@/lib/knowledge/embeddings'
import {
  checkChunkAccess,
  checkDocumentAccess,
  checkKnowledgeBaseAccess,
} from '@/app/api/knowledge/utils'

describe('Knowledge Utils', () => {
  beforeEach(() => {
    dbOps.order.length = 0
    dbOps.insertRecords.length = 0
    dbOps.updatePayloads.length = 0
    resetDatasets()
    vi.clearAllMocks()
    // `unstubGlobals: true` removes the module-scope fetch stub after the
    // first test in the worker; re-stub it per test.
    vi.stubGlobal('fetch', createEmbeddingFetchMock())
    // Under `isolate: false` the shared `@/lib/knowledge/embeddings` module may
    // be cached bound to the REAL env module, so reset the real `env` object
    // per test instead of vi.mock'ing a file-local replacement that a cached
    // consumer would never see.
    for (const key of Object.keys(env)) {
      delete (env as Record<string, unknown>)[key]
    }
    Object.assign(env, { ...defaultMockEnv, OPENAI_API_KEY: 'test-key' })
    retrySpy.mockImplementation(((fn: () => unknown) => fn()) as never)
    applyBillingSpies()
  })

  describe('processDocumentAsync', () => {
    it('should insert embeddings before updating document counters', async () => {
      kbRows.push({
        id: 'kb1',
        userId: 'user1',
        workspaceId: 'workspace1',
        embeddingModel: 'text-embedding-3-small',
        chunkingConfig: { maxSize: 1024, minSize: 1, overlap: 200 },
      })
      docRows.push({ id: 'doc1', knowledgeBaseId: 'kb1' })

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

      // Embeddings are inserted first, then the document counter update. A
      // usage_log billing insert (recordUsage) may trail after updateDoc and is
      // irrelevant to this ordering invariant, so assert position rather than
      // exact array equality.
      expect(dbOps.order[0]).toBe('insert')
      expect(dbOps.order.indexOf('updateDoc')).toBeGreaterThan(0)

      expect(dbOps.updatePayloads[0]).toMatchObject({
        processingStatus: 'completed',
        chunkCount: 2,
      })

      expect(dbOps.insertRecords[0].length).toBe(2)
    })
  })

  describe('checkKnowledgeBaseAccess', () => {
    it('should return success for owner', async () => {
      kbRows.push({ id: 'kb1', userId: 'user1' })
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
      kbRows.push({ id: 'kb1', userId: 'owner' })
      const result = await checkDocumentAccess('kb1', 'doc1', 'intruder')

      expect(result.hasAccess).toBe(false)
      if ('reason' in result) {
        expect(result.reason).toBe('Unauthorized knowledge base access')
      }
    })
  })

  describe('checkChunkAccess', () => {
    it('should fail when document is not completed', async () => {
      kbRows.push({ id: 'kb1', userId: 'user1' })
      docRows.push({ id: 'doc1', knowledgeBaseId: 'kb1', processingStatus: 'processing' })

      const result = await checkChunkAccess('kb1', 'doc1', 'chunk1', 'user1')

      expect(result.hasAccess).toBe(false)
      if ('reason' in result) {
        expect(result.reason).toContain('Document is not ready')
      }
    })

    it('should return success for valid access', async () => {
      kbRows.push({ id: 'kb1', userId: 'user1' })
      docRows.push({ id: 'doc1', knowledgeBaseId: 'kb1', processingStatus: 'completed' })
      chunkRows.push({ id: 'chunk1', documentId: 'doc1' })

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
      const { env } = await import('@/lib/core/config/env')
      Object.keys(env).forEach((key) => delete (env as any)[key])
      Object.assign(env, {
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

      Object.keys(env).forEach((key) => delete (env as any)[key])
    })

    it('should fallback to OpenAI when no Azure config provided', async () => {
      const { env } = await import('@/lib/core/config/env')
      Object.keys(env).forEach((key) => delete (env as any)[key])
      Object.assign(env, {
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

      Object.keys(env).forEach((key) => delete (env as any)[key])
    })

    it('should throw error when no API configuration provided', async () => {
      const { env } = await import('@/lib/core/config/env')
      Object.keys(env).forEach((key) => delete (env as any)[key])

      await expect(generateEmbeddings(['test text'])).rejects.toThrow(
        'OPENAI_API_KEY is not configured'
      )
    })
  })
})
