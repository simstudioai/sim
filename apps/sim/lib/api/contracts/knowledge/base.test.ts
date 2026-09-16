/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  chunkingStrategyOptionsSchema,
  createKnowledgeBaseBodySchema,
  knowledgeBaseDataSchema,
  updateKnowledgeBaseBodySchema,
} from '@/lib/api/contracts/knowledge/base'
import { MAX_CHUNKING_SEPARATOR_LENGTH, MAX_CHUNKING_SEPARATORS } from '@/lib/chunkers/constants'

const separators = (count: number) => Array.from({ length: count }, (_, i) => `@@sep${i}@@`)

describe('knowledge base workspace ownership', () => {
  it.each([undefined, null, ''])('rejects creation with workspaceId %s', (workspaceId) => {
    expect(createKnowledgeBaseBodySchema.safeParse({ name: 'Docs', workspaceId }).success).toBe(
      false
    )
  })

  it.each([null, ''])('rejects detaching with workspaceId %s', (workspaceId) => {
    expect(updateKnowledgeBaseBodySchema.safeParse({ workspaceId }).success).toBe(false)
  })

  it('allows a workspace move and moving a KB to the folder root', () => {
    expect(
      updateKnowledgeBaseBodySchema.parse({ workspaceId: 'workspace-2', folderId: null })
    ).toEqual({ workspaceId: 'workspace-2', folderId: null })
  })

  it('leaves workspace ownership untouched when omitted from an update', () => {
    expect(updateKnowledgeBaseBodySchema.parse({ name: 'Renamed' })).toEqual({ name: 'Renamed' })
  })
})

describe('chunkingStrategyOptionsSchema.separators', () => {
  it('accepts a separator list at the bound', () => {
    const parsed = chunkingStrategyOptionsSchema.parse({
      separators: separators(MAX_CHUNKING_SEPARATORS),
    })
    expect(parsed.separators).toHaveLength(MAX_CHUNKING_SEPARATORS)
  })

  it('rejects more separators than the bound', () => {
    const result = chunkingStrategyOptionsSchema.safeParse({
      separators: separators(MAX_CHUNKING_SEPARATORS + 1),
    })
    expect(result.success).toBe(false)
  })

  it('rejects a separator longer than the per-item bound', () => {
    const result = chunkingStrategyOptionsSchema.safeParse({
      separators: ['|'.repeat(MAX_CHUNKING_SEPARATOR_LENGTH + 1)],
    })
    expect(result.success).toBe(false)
  })

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
