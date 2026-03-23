/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { VoyageAIBlock } from '@/blocks/blocks/voyageai'
import { AuthMode, IntegrationType } from '@/blocks/types'

describe('VoyageAIBlock', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('block properties', () => {
    it('should have correct type and name', () => {
      expect(VoyageAIBlock.type).toBe('voyageai')
      expect(VoyageAIBlock.name).toBe('Voyage AI')
    })

    it('should be in the tools category', () => {
      expect(VoyageAIBlock.category).toBe('tools')
    })

    it('should have AI integration type', () => {
      expect(VoyageAIBlock.integrationType).toBe(IntegrationType.AI)
    })

    it('should have correct tags', () => {
      expect(VoyageAIBlock.tags).toEqual(['llm', 'vector-search'])
    })

    it('should use API key auth mode', () => {
      expect(VoyageAIBlock.authMode).toBe(AuthMode.ApiKey)
    })

    it('should have an icon defined', () => {
      expect(VoyageAIBlock.icon).toBeDefined()
      expect(typeof VoyageAIBlock.icon).toBe('function')
    })

    it('should have a description and long description', () => {
      expect(VoyageAIBlock.description).toBeTruthy()
      expect(VoyageAIBlock.longDescription).toBeTruthy()
    })

    it('should have a background color', () => {
      expect(VoyageAIBlock.bgColor).toBe('#1A1A2E')
    })

    it('should list both tool IDs in access', () => {
      expect(VoyageAIBlock.tools.access).toEqual(['voyageai_embeddings', 'voyageai_rerank'])
    })

    it('should have tools.config.tool and tools.config.params functions', () => {
      expect(VoyageAIBlock.tools.config).toBeDefined()
      expect(typeof VoyageAIBlock.tools.config!.tool).toBe('function')
      expect(typeof VoyageAIBlock.tools.config!.params).toBe('function')
    })
  })

  describe('subBlocks structure', () => {
    it('should have an operation dropdown as first subBlock', () => {
      const opBlock = VoyageAIBlock.subBlocks[0]
      expect(opBlock.id).toBe('operation')
      expect(opBlock.type).toBe('dropdown')
    })

    it('should have embeddings and rerank operations', () => {
      const opBlock = VoyageAIBlock.subBlocks[0] as any
      const optionIds = opBlock.options.map((o: any) => o.id)
      expect(optionIds).toContain('embeddings')
      expect(optionIds).toContain('rerank')
    })

    it('should default to embeddings operation', () => {
      const opBlock = VoyageAIBlock.subBlocks[0] as any
      expect(opBlock.value()).toBe('embeddings')
    })

    it('should have embeddings-specific subBlocks with correct conditions', () => {
      const embeddingsBlocks = VoyageAIBlock.subBlocks.filter(
        (sb) =>
          sb.condition &&
          typeof sb.condition === 'object' &&
          'value' in sb.condition &&
          sb.condition.value === 'embeddings'
      )
      const ids = embeddingsBlocks.map((sb) => sb.id)
      expect(ids).toContain('input')
      expect(ids).toContain('embeddingModel')
      expect(ids).toContain('inputType')
    })

    it('should have rerank-specific subBlocks with correct conditions', () => {
      const rerankBlocks = VoyageAIBlock.subBlocks.filter(
        (sb) =>
          sb.condition &&
          typeof sb.condition === 'object' &&
          'value' in sb.condition &&
          sb.condition.value === 'rerank'
      )
      const ids = rerankBlocks.map((sb) => sb.id)
      expect(ids).toContain('query')
      expect(ids).toContain('documents')
      expect(ids).toContain('rerankModel')
      expect(ids).toContain('topK')
    })

    it('should have apiKey subBlock without condition (always visible)', () => {
      const apiKeyBlock = VoyageAIBlock.subBlocks.find((sb) => sb.id === 'apiKey')
      expect(apiKeyBlock).toBeDefined()
      expect(apiKeyBlock!.condition).toBeUndefined()
      expect(apiKeyBlock!.required).toBe(true)
      expect((apiKeyBlock as any).password).toBe(true)
    })

    it('should have input as required', () => {
      const inputBlock = VoyageAIBlock.subBlocks.find((sb) => sb.id === 'input')
      expect(inputBlock).toBeDefined()
      expect(inputBlock!.required).toBe(true)
    })

    it('should have query as required for rerank', () => {
      const queryBlock = VoyageAIBlock.subBlocks.find((sb) => sb.id === 'query')
      expect(queryBlock).toBeDefined()
      expect(queryBlock!.required).toBe(true)
    })

    it('should have documents as required for rerank', () => {
      const docsBlock = VoyageAIBlock.subBlocks.find((sb) => sb.id === 'documents')
      expect(docsBlock).toBeDefined()
      expect(docsBlock!.required).toBe(true)
      expect(docsBlock!.type).toBe('code')
    })

    it('should have inputType in advanced mode', () => {
      const inputTypeBlock = VoyageAIBlock.subBlocks.find((sb) => sb.id === 'inputType')
      expect(inputTypeBlock).toBeDefined()
      expect(inputTypeBlock!.mode).toBe('advanced')
    })

    it('should have topK in advanced mode', () => {
      const topKBlock = VoyageAIBlock.subBlocks.find((sb) => sb.id === 'topK')
      expect(topKBlock).toBeDefined()
      expect(topKBlock!.mode).toBe('advanced')
    })

    it('should have all 6 embedding models in the dropdown', () => {
      const modelBlock = VoyageAIBlock.subBlocks.find((sb) => sb.id === 'embeddingModel') as any
      expect(modelBlock).toBeDefined()
      const modelIds = modelBlock.options.map((o: any) => o.id)
      expect(modelIds).toContain('voyage-3-large')
      expect(modelIds).toContain('voyage-3')
      expect(modelIds).toContain('voyage-3-lite')
      expect(modelIds).toContain('voyage-code-3')
      expect(modelIds).toContain('voyage-finance-2')
      expect(modelIds).toContain('voyage-law-2')
    })

    it('should have both rerank models in the dropdown', () => {
      const modelBlock = VoyageAIBlock.subBlocks.find((sb) => sb.id === 'rerankModel') as any
      expect(modelBlock).toBeDefined()
      const modelIds = modelBlock.options.map((o: any) => o.id)
      expect(modelIds).toContain('rerank-2')
      expect(modelIds).toContain('rerank-2-lite')
    })
  })

  describe('inputs and outputs', () => {
    it('should define all input fields', () => {
      const inputKeys = Object.keys(VoyageAIBlock.inputs)
      expect(inputKeys).toContain('operation')
      expect(inputKeys).toContain('input')
      expect(inputKeys).toContain('embeddingModel')
      expect(inputKeys).toContain('inputType')
      expect(inputKeys).toContain('query')
      expect(inputKeys).toContain('documents')
      expect(inputKeys).toContain('rerankModel')
      expect(inputKeys).toContain('topK')
      expect(inputKeys).toContain('apiKey')
    })

    it('should define output fields', () => {
      const outputKeys = Object.keys(VoyageAIBlock.outputs)
      expect(outputKeys).toContain('embeddings')
      expect(outputKeys).toContain('results')
      expect(outputKeys).toContain('model')
      expect(outputKeys).toContain('usage')
    })
  })

  describe('tools.config.tool', () => {
    const toolFunction = VoyageAIBlock.tools.config!.tool!

    it('should return voyageai_embeddings for embeddings operation', () => {
      expect(toolFunction({ operation: 'embeddings' })).toBe('voyageai_embeddings')
    })

    it('should return voyageai_rerank for rerank operation', () => {
      expect(toolFunction({ operation: 'rerank' })).toBe('voyageai_rerank')
    })

    it('should throw for invalid operation', () => {
      expect(() => toolFunction({ operation: 'invalid' })).toThrow('Invalid Voyage AI operation')
    })

    it('should throw for empty operation', () => {
      expect(() => toolFunction({ operation: '' })).toThrow()
    })

    it('should throw for undefined operation', () => {
      expect(() => toolFunction({})).toThrow()
    })
  })

  describe('tools.config.params', () => {
    const paramsFunction = VoyageAIBlock.tools.config!.params!

    describe('embeddings operation', () => {
      it('should pass correct fields with all options', () => {
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
        expect('inputType' in result).toBe(false)
      })

      it('should omit inputType when empty string', () => {
        const result = paramsFunction({
          operation: 'embeddings',
          apiKey: 'va-key',
          input: 'hello',
          embeddingModel: 'voyage-3',
          inputType: '',
        })
        expect(result.inputType).toBeUndefined()
      })

      it('should map embeddingModel to model param', () => {
        const result = paramsFunction({
          operation: 'embeddings',
          apiKey: 'va-key',
          input: 'hello',
          embeddingModel: 'voyage-code-3',
        })
        expect(result.model).toBe('voyage-code-3')
        expect(result.embeddingModel).toBeUndefined()
      })

      it('should not include rerank-specific fields', () => {
        const result = paramsFunction({
          operation: 'embeddings',
          apiKey: 'va-key',
          input: 'hello',
          embeddingModel: 'voyage-3',
          query: 'should not appear',
          documents: '["should not appear"]',
        })
        expect(result.query).toBeUndefined()
        expect(result.documents).toBeUndefined()
      })
    })

    describe('rerank operation', () => {
      it('should parse JSON string documents', () => {
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

      it('should handle array documents directly', () => {
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
          query: 'q',
          documents: ['doc1'],
          rerankModel: 'rerank-2',
          topK: '5',
        })
        expect(result.topK).toBe(5)
        expect(typeof result.topK).toBe('number')
      })

      it('should handle topK as number directly', () => {
        const result = paramsFunction({
          operation: 'rerank',
          apiKey: 'va-key',
          query: 'q',
          documents: ['doc1'],
          rerankModel: 'rerank-2',
          topK: 10,
        })
        expect(result.topK).toBe(10)
      })

      it('should omit topK when not provided', () => {
        const result = paramsFunction({
          operation: 'rerank',
          apiKey: 'va-key',
          query: 'q',
          documents: ['doc1'],
          rerankModel: 'rerank-2',
        })
        expect(result.topK).toBeUndefined()
      })

      it('should omit topK when empty string', () => {
        const result = paramsFunction({
          operation: 'rerank',
          apiKey: 'va-key',
          query: 'q',
          documents: ['doc1'],
          rerankModel: 'rerank-2',
          topK: '',
        })
        expect(result.topK).toBeUndefined()
      })

      it('should map rerankModel to model param', () => {
        const result = paramsFunction({
          operation: 'rerank',
          apiKey: 'va-key',
          query: 'q',
          documents: ['doc1'],
          rerankModel: 'rerank-2-lite',
        })
        expect(result.model).toBe('rerank-2-lite')
        expect(result.rerankModel).toBeUndefined()
      })

      it('should throw on invalid JSON documents string', () => {
        expect(() =>
          paramsFunction({
            operation: 'rerank',
            apiKey: 'va-key',
            query: 'q',
            documents: 'not valid json',
            rerankModel: 'rerank-2',
          })
        ).toThrow()
      })

      it('should not include embedding-specific fields', () => {
        const result = paramsFunction({
          operation: 'rerank',
          apiKey: 'va-key',
          query: 'q',
          documents: ['doc'],
          rerankModel: 'rerank-2',
          input: 'should not appear',
          embeddingModel: 'should not appear',
        })
        expect(result.input).toBeUndefined()
        expect(result.embeddingModel).toBeUndefined()
      })
    })
  })
})
