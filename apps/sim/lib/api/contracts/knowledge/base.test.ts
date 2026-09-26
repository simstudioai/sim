import { describe, expect, it } from 'vitest'
import {
  createKnowledgeBaseBodySchema,
  knowledgeBaseDataSchema,
} from '@/lib/api/contracts/knowledge/base'

const separators = (count: number) => Array.from({ length: count }, (_, i) => `@@sep${i}@@`)

describe('chunkingStrategyOptionsSchema.separators', () => {
  it('rejects an oversized list on the knowledge base create body', () => {
    const result = createKnowledgeBaseBodySchema.safeParse({
      name: 'kb',
      workspaceId: 'ws',
      chunkingConfig: {
        maxSize: 1024,
        minSize: 100,
        overlap: 200,
        strategy: 'recursive',
        strategyOptions: { separators: separators(5000) },
      },
    })
    expect(result.success).toBe(false)
  })
})

describe('knowledgeBaseDataSchema.chunkingConfig', () => {
  it('still reads a stored config written before the separator bound', () => {
    const result = knowledgeBaseDataSchema.safeParse({
      id: 'kb-1',
      userId: 'u-1',
      name: 'kb',
      description: null,
      tokenCount: 0,
      embeddingModel: 'text-embedding-3-small',
      embeddingDimension: 1536,
      chunkingConfig: {
        maxSize: 1024,
        minSize: 100,
        overlap: 200,
        strategy: 'recursive',
        strategyOptions: { separators: separators(5000) },
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      deletedAt: null,
      workspaceId: 'ws',
      folderId: null,
    })
    expect(result.success).toBe(true)
  })
})
