import { beforeEach, expect, test, vi } from 'vitest'

vi.mock('drizzle-orm', () => ({
  and: (...args: any[]) => args,
  eq: (...args: any[]) => args,
  isNull: () => true,
  sql: (strings: TemplateStringsArray, ...expr: any[]) => ({ strings, expr }),
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

var mockDocumentTable: any = {}
var mockKbTable: any = {}
var mockEmbeddingTable: any = {}

let kbRows: any[] = []
let docRows: any[] = []
let chunkRows: any[] = []

function resetDatasets() {
  kbRows = []
  docRows = []
  chunkRows = []
}

vi.mock('@/db', () => {
  const selectBuilder = {
    from(table: any) {
      return {
        where() {
          return {
            limit(n: number) {
              const tableSymbols = Object.getOwnPropertySymbols(table || {})
              const baseNameSymbol = tableSymbols.find((s) => s.toString().includes('BaseName'))
              const tableName = baseNameSymbol ? table[baseNameSymbol] : ''

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
      }
    },
  }

  return {
    db: {
      select: vi.fn(() => selectBuilder),
      update: () => ({
        set: () => ({
          where: () => Promise.resolve(),
        }),
      }),
      transaction: vi.fn(async (fn: any) => {
        await fn({
          insert: (table: any) => ({
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
                const label = dbOps.updatePayloads.length === 1 ? 'updateDoc' : 'updateKb'
                dbOps.order.push(label)
                return Promise.resolve()
              },
            }),
          }),
        })
      }),
    },
    document: mockDocumentTable,
    knowledgeBase: mockKbTable,
    embedding: mockEmbeddingTable,
  }
})

vi.mock('@/lib/env', () => ({ env: { OPENAI_API_KEY: 'test-key' } }))

vi.mock('@/lib/documents/utils', () => ({
  retryWithExponentialBackoff: (fn: any) => fn(),
}))

vi.mock('@/lib/documents/document-processor', () => ({
  processDocuments: vi.fn().mockResolvedValue([
    {
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
    },
  ]),
}))

vi.stubGlobal(
  'fetch',
  vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      data: [
        { embedding: [0.1, 0.2], index: 0 },
        { embedding: [0.3, 0.4], index: 1 },
      ],
    }),
  })
)

import { processDocumentAsync } from './utils'

beforeEach(() => {
  dbOps.order.length = 0
  dbOps.insertRecords.length = 0
  dbOps.updatePayloads.length = 0
})

test('processDocumentAsync inserts embeddings before updating document counters', async () => {
  await processDocumentAsync(
    'kb1',
    'doc1',
    {
      filename: 'file.txt',
      fileUrl: 'https://example.com/file.txt',
      fileSize: 10,
      mimeType: 'text/plain',
    },
    {}
  )

  expect(dbOps.order).toEqual(['insert', 'updateDoc', 'updateKb'])

  expect(dbOps.updatePayloads[0]).toMatchObject({
    processingStatus: 'completed',
    chunkCount: 2,
  })

  expect(dbOps.insertRecords[0].length).toBe(2)
})

import {
  checkChunkAccess,
  checkDocumentAccess,
  checkKnowledgeBaseAccess,
  generateEmbeddings,
} from './utils'

beforeEach(() => {
  dbOps.order.length = 0
  dbOps.insertRecords.length = 0
  dbOps.updatePayloads.length = 0
  resetDatasets()
})

test('checkKnowledgeBaseAccess returns success for owner', async () => {
  kbRows.push({ id: 'kb1', userId: 'user1' })
  const res = await checkKnowledgeBaseAccess('kb1', 'user1')
  expect(res.hasAccess).toBe(true)
})

test('checkKnowledgeBaseAccess returns notFound when kb missing', async () => {
  const res = await checkKnowledgeBaseAccess('missing', 'user1')
  expect(res.hasAccess).toBe(false)
  expect('notFound' in res && res.notFound).toBe(true)
})

test('checkDocumentAccess unauthorized when user mismatch', async () => {
  kbRows.push({ id: 'kb1', userId: 'owner' })
  const res = await checkDocumentAccess('kb1', 'doc1', 'intruder')
  expect(res.hasAccess).toBe(false)
  if ('reason' in res) {
    expect(res.reason).toBe('Unauthorized knowledge base access')
  }
})

test('checkChunkAccess fails when document not completed', async () => {
  kbRows.push({ id: 'kb1', userId: 'user1' })
  docRows.push({ id: 'doc1', knowledgeBaseId: 'kb1', processingStatus: 'processing' })
  const res = await checkChunkAccess('kb1', 'doc1', 'chunk1', 'user1')
  expect(res.hasAccess).toBe(false)
  if ('reason' in res) {
    expect(res.reason).toContain('Document is not ready')
  }
})

test('checkChunkAccess success path', async () => {
  kbRows.push({ id: 'kb1', userId: 'user1' })
  docRows.push({ id: 'doc1', knowledgeBaseId: 'kb1', processingStatus: 'completed' })
  chunkRows.push({ id: 'chunk1', documentId: 'doc1' })
  const res = await checkChunkAccess('kb1', 'doc1', 'chunk1', 'user1')
  expect(res.hasAccess).toBe(true)
  if ('chunk' in res) {
    expect(res.chunk.id).toBe('chunk1')
  }
})

test('generateEmbeddings returns same length as input', async () => {
  const result = await generateEmbeddings(['a', 'b'])
  expect(result.length).toBe(2)
})
