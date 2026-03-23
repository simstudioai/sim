/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { VoyageAIBlock } from '@/blocks/blocks/voyageai'

describe('VoyageAIBlock', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('block properties', () => {
    it('should have required properties', () => {
      expect(VoyageAIBlock.type).toBe('voyageai')
      expect(VoyageAIBlock.name).toBe('Voyage AI')
      expect(VoyageAIBlock.category).toBe('tools')
      expect(VoyageAIBlock.icon).toBeDefined()
      expect(VoyageAIBlock.tools.access).toEqual(['voyageai_embeddings', 'voyageai_rerank'])
    })

    it('should have subBlocks with correct operation conditions', () => {
      const embeddingsBlocks = VoyageAIBlock.subBlocks.filter(
        (sb) =>
          sb.condition &&
          typeof sb.condition === 'object' &&
          'value' in sb.condition &&
          sb.condition.value === 'embeddings'
      )
      const rerankBlocks = VoyageAIBlock.subBlocks.filter(
        (sb) =>
          sb.condition &&
          typeof sb.condition === 'object' &&
          'value' in sb.condition &&
          sb.condition.value === 'rerank'
      )
      expect(embeddingsBlocks.length).toBeGreaterThan(0)
      expect(rerankBlocks.length).toBeGreaterThan(0)
    })
  })

  describe('tools.config.tool', () => {
    const toolFunction = VoyageAIBlock.tools.config?.tool

    if (!toolFunction) {
      throw new Error('VoyageAIBlock.tools.config.tool is missing')
    }

    it('should return voyageai_embeddings for embeddings operation', () => {
      expect(toolFunction({ operation: 'embeddings' })).toBe('voyageai_embeddings')
    })

    it('should return voyageai_rerank for rerank operation', () => {
      expect(toolFunction({ operation: 'rerank' })).toBe('voyageai_rerank')
    })

    it('should throw for invalid operation', () => {
      expect(() => toolFunction({ operation: 'invalid' })).toThrow('Invalid Voyage AI operation')
    })
  })

  describe('tools.config.params', () => {
    const paramsFunction = VoyageAIBlock.tools.config?.params

    if (!paramsFunction) {
      throw new Error('VoyageAIBlock.tools.config.params is missing')
    }

    it('should pass correct fields for embeddings operation', () => {
      const result = paramsFunction({
        operation: 'embeddings',
        apiKey: 'va-key',
        input: 'hello world',
        embeddingModel: 'voyage-3-large',
        inputType: 'query',
      })
      expect(result).toEqual({
        apiKey: 'va-key',
        input: 'hello world',
        model: 'voyage-3-large',
        inputType: 'query',
      })
    })

    it('should omit inputType when not provided', () => {
      const result = paramsFunction({
        operation: 'embeddings',
        apiKey: 'va-key',
        input: 'hello world',
        embeddingModel: 'voyage-3',
      })
      expect(result.inputType).toBeUndefined()
    })

    it('should parse JSON string documents for rerank', () => {
      const result = paramsFunction({
        operation: 'rerank',
        apiKey: 'va-key',
        query: 'search query',
        documents: '["doc1", "doc2"]',
        rerankModel: 'rerank-2',
      })
      expect(result).toEqual({
        apiKey: 'va-key',
        query: 'search query',
        documents: ['doc1', 'doc2'],
        model: 'rerank-2',
      })
    })

    it('should handle array documents for rerank', () => {
      const result = paramsFunction({
        operation: 'rerank',
        apiKey: 'va-key',
        query: 'search query',
        documents: ['doc1', 'doc2'],
        rerankModel: 'rerank-2',
      })
      expect(result.documents).toEqual(['doc1', 'doc2'])
    })

    it('should convert topK string to number', () => {
      const result = paramsFunction({
        operation: 'rerank',
        apiKey: 'va-key',
        query: 'search query',
        documents: ['doc1'],
        rerankModel: 'rerank-2',
        topK: '5',
      })
      expect(result.topK).toBe(5)
    })

    it('should omit topK when not provided', () => {
      const result = paramsFunction({
        operation: 'rerank',
        apiKey: 'va-key',
        query: 'search query',
        documents: ['doc1'],
        rerankModel: 'rerank-2',
      })
      expect(result.topK).toBeUndefined()
    })
  })
})
