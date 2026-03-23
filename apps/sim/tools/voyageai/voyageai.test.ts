/**
 * @vitest-environment node
 */
import { ToolTester } from '@sim/testing/builders'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { embeddingsTool } from '@/tools/voyageai/embeddings'
import { rerankTool } from '@/tools/voyageai/rerank'

describe('Voyage AI Embeddings Tool', () => {
  let tester: ToolTester<any, any>

  beforeEach(() => {
    tester = new ToolTester(embeddingsTool as any)
  })

  afterEach(() => {
    tester.cleanup()
    vi.resetAllMocks()
  })

  describe('URL Construction', () => {
    it('should return the VoyageAI embeddings endpoint', () => {
      expect(tester.getRequestUrl({ apiKey: 'test-key', input: 'hello' })).toBe(
        'https://api.voyageai.com/v1/embeddings'
      )
    })
  })

  describe('Headers Construction', () => {
    it('should include bearer auth and content type', () => {
      const headers = tester.getRequestHeaders({ apiKey: 'va-test-key', input: 'hello' })
      expect(headers.Authorization).toBe('Bearer va-test-key')
      expect(headers['Content-Type']).toBe('application/json')
    })
  })

  describe('Body Construction', () => {
    it('should wrap single string input into array', () => {
      const body = tester.getRequestBody({ apiKey: 'key', input: 'hello world' })
      expect(body.input).toEqual(['hello world'])
    })

    it('should pass array input directly', () => {
      const body = tester.getRequestBody({ apiKey: 'key', input: ['text1', 'text2'] })
      expect(body.input).toEqual(['text1', 'text2'])
    })

    it('should use default model when not specified', () => {
      const body = tester.getRequestBody({ apiKey: 'key', input: 'hello' })
      expect(body.model).toBe('voyage-3')
    })

    it('should use specified model', () => {
      const body = tester.getRequestBody({ apiKey: 'key', input: 'hello', model: 'voyage-3-large' })
      expect(body.model).toBe('voyage-3-large')
    })

    it('should include input_type when provided', () => {
      const body = tester.getRequestBody({ apiKey: 'key', input: 'hello', inputType: 'query' })
      expect(body.input_type).toBe('query')
    })

    it('should omit input_type when not provided', () => {
      const body = tester.getRequestBody({ apiKey: 'key', input: 'hello' })
      expect(body.input_type).toBeUndefined()
    })
  })

  describe('Response Transformation', () => {
    it('should extract embeddings, model, and usage', async () => {
      tester.setup({
        data: [
          { embedding: [0.1, 0.2, 0.3], index: 0 },
          { embedding: [0.4, 0.5, 0.6], index: 1 },
        ],
        model: 'voyage-3',
        usage: { total_tokens: 10 },
      })

      const result = await tester.execute({ apiKey: 'key', input: ['text1', 'text2'] })
      expect(result.success).toBe(true)
      expect(result.output.embeddings).toEqual([
        [0.1, 0.2, 0.3],
        [0.4, 0.5, 0.6],
      ])
      expect(result.output.model).toBe('voyage-3')
      expect(result.output.usage.total_tokens).toBe(10)
    })
  })

  describe('Error Handling', () => {
    it('should handle error responses', async () => {
      tester.setup({ error: 'Invalid API key' }, { ok: false, status: 401 })
      const result = await tester.execute({ apiKey: 'bad-key', input: 'hello' })
      expect(result.success).toBe(false)
    })

    it('should handle network errors', async () => {
      tester.setupError('Network error')
      const result = await tester.execute({ apiKey: 'key', input: 'hello' })
      expect(result.success).toBe(false)
      expect(result.error).toContain('Network error')
    })
  })
})

describe('Voyage AI Rerank Tool', () => {
  let tester: ToolTester<any, any>

  beforeEach(() => {
    tester = new ToolTester(rerankTool as any)
  })

  afterEach(() => {
    tester.cleanup()
    vi.resetAllMocks()
  })

  describe('URL Construction', () => {
    it('should return the VoyageAI rerank endpoint', () => {
      expect(
        tester.getRequestUrl({ apiKey: 'key', query: 'test', documents: ['doc1'] })
      ).toBe('https://api.voyageai.com/v1/rerank')
    })
  })

  describe('Headers Construction', () => {
    it('should include bearer auth and content type', () => {
      const headers = tester.getRequestHeaders({
        apiKey: 'va-test-key',
        query: 'test',
        documents: ['doc1'],
      })
      expect(headers.Authorization).toBe('Bearer va-test-key')
      expect(headers['Content-Type']).toBe('application/json')
    })
  })

  describe('Body Construction', () => {
    it('should send query, documents, and model', () => {
      const body = tester.getRequestBody({
        apiKey: 'key',
        query: 'what is AI?',
        documents: ['AI is...', 'Machine learning is...'],
      })
      expect(body.query).toBe('what is AI?')
      expect(body.documents).toEqual(['AI is...', 'Machine learning is...'])
      expect(body.model).toBe('rerank-2')
    })

    it('should parse JSON string documents', () => {
      const body = tester.getRequestBody({
        apiKey: 'key',
        query: 'test',
        documents: '["doc1", "doc2"]',
      })
      expect(body.documents).toEqual(['doc1', 'doc2'])
    })

    it('should include top_k when provided', () => {
      const body = tester.getRequestBody({
        apiKey: 'key',
        query: 'test',
        documents: ['doc1'],
        topK: 5,
      })
      expect(body.top_k).toBe(5)
    })

    it('should omit top_k when not provided', () => {
      const body = tester.getRequestBody({
        apiKey: 'key',
        query: 'test',
        documents: ['doc1'],
      })
      expect(body.top_k).toBeUndefined()
    })

    it('should use specified model', () => {
      const body = tester.getRequestBody({
        apiKey: 'key',
        query: 'test',
        documents: ['doc1'],
        model: 'rerank-2-lite',
      })
      expect(body.model).toBe('rerank-2-lite')
    })
  })

  describe('Response Transformation', () => {
    it('should map results with index, score, and document text', async () => {
      tester.setup({
        data: [
          { index: 1, relevance_score: 0.95 },
          { index: 0, relevance_score: 0.72 },
        ],
        model: 'rerank-2',
        usage: { total_tokens: 25 },
      })

      const result = await tester.execute({
        apiKey: 'key',
        query: 'what is AI?',
        documents: ['Machine learning basics', 'AI is artificial intelligence'],
      })

      expect(result.success).toBe(true)
      expect(result.output.results).toEqual([
        { index: 1, relevance_score: 0.95, document: 'AI is artificial intelligence' },
        { index: 0, relevance_score: 0.72, document: 'Machine learning basics' },
      ])
      expect(result.output.model).toBe('rerank-2')
      expect(result.output.usage.total_tokens).toBe(25)
    })
  })

  describe('Error Handling', () => {
    it('should handle error responses', async () => {
      tester.setup({ error: 'Rate limited' }, { ok: false, status: 429 })
      const result = await tester.execute({
        apiKey: 'key',
        query: 'test',
        documents: ['doc1'],
      })
      expect(result.success).toBe(false)
    })

    it('should handle network errors', async () => {
      tester.setupError('Connection refused')
      const result = await tester.execute({
        apiKey: 'key',
        query: 'test',
        documents: ['doc1'],
      })
      expect(result.success).toBe(false)
      expect(result.error).toContain('Connection refused')
    })
  })
})
