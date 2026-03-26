/**
 * @vitest-environment node
 */
import { ToolTester } from '@sim/testing/builders'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { embeddingsTool } from '@/tools/voyageai/embeddings'
import { multimodalEmbeddingsTool } from '@/tools/voyageai/multimodal-embeddings'
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

  describe('Tool metadata', () => {
    it('should have correct id and name', () => {
      expect(embeddingsTool.id).toBe('voyageai_embeddings')
      expect(embeddingsTool.name).toBe('Voyage AI Embeddings')
      expect(embeddingsTool.version).toBe('1.0')
    })

    it('should have all required params defined', () => {
      expect(embeddingsTool.params.input).toBeDefined()
      expect(embeddingsTool.params.input.required).toBe(true)
      expect(embeddingsTool.params.apiKey).toBeDefined()
      expect(embeddingsTool.params.apiKey.required).toBe(true)
      expect(embeddingsTool.params.model).toBeDefined()
      expect(embeddingsTool.params.model.required).toBe(false)
      expect(embeddingsTool.params.model.default).toBe('voyage-3.5')
      expect(embeddingsTool.params.inputType).toBeDefined()
      expect(embeddingsTool.params.inputType.required).toBe(false)
    })

    it('should have apiKey visibility as user-only', () => {
      expect(embeddingsTool.params.apiKey.visibility).toBe('user-only')
    })

    it('should have output schema defined', () => {
      expect(embeddingsTool.outputs).toBeDefined()
      expect(embeddingsTool.outputs!.success).toBeDefined()
      expect(embeddingsTool.outputs!.output).toBeDefined()
    })

    it('should use POST method', () => {
      expect(embeddingsTool.request.method).toBe('POST')
    })
  })

  describe('URL Construction', () => {
    it('should return the VoyageAI embeddings endpoint', () => {
      expect(tester.getRequestUrl({ apiKey: 'test-key', input: 'hello' })).toBe(
        'https://api.voyageai.com/v1/embeddings'
      )
    })

    it('should return the same URL regardless of params', () => {
      expect(tester.getRequestUrl({ apiKey: 'key', input: 'a', model: 'voyage-3-large' })).toBe(
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

    it('should use the exact apiKey provided', () => {
      const headers = tester.getRequestHeaders({ apiKey: 'pa-abc123xyz', input: 'hello' })
      expect(headers.Authorization).toBe('Bearer pa-abc123xyz')
    })

    it('should only have Authorization and Content-Type headers', () => {
      const headers = tester.getRequestHeaders({ apiKey: 'key', input: 'hello' })
      expect(Object.keys(headers)).toEqual(['Authorization', 'Content-Type'])
    })
  })

  describe('Body Construction', () => {
    it('should wrap single string input into array', () => {
      const body = tester.getRequestBody({ apiKey: 'key', input: 'hello world' })
      expect(body.input).toEqual(['hello world'])
      expect(Array.isArray(body.input)).toBe(true)
    })

    it('should pass array input directly', () => {
      const body = tester.getRequestBody({ apiKey: 'key', input: ['text1', 'text2'] })
      expect(body.input).toEqual(['text1', 'text2'])
    })

    it('should handle single-element array input', () => {
      const body = tester.getRequestBody({ apiKey: 'key', input: ['only one'] })
      expect(body.input).toEqual(['only one'])
    })

    it('should handle empty string input', () => {
      const body = tester.getRequestBody({ apiKey: 'key', input: '' })
      expect(body.input).toEqual([''])
    })

    it('should handle large array of inputs', () => {
      const inputs = Array.from({ length: 100 }, (_, i) => `text ${i}`)
      const body = tester.getRequestBody({ apiKey: 'key', input: inputs })
      expect(body.input).toHaveLength(100)
      expect(body.input[99]).toBe('text 99')
    })

    it('should use default model voyage-3 when not specified', () => {
      const body = tester.getRequestBody({ apiKey: 'key', input: 'hello' })
      expect(body.model).toBe('voyage-3.5')
    })

    it('should use specified model voyage-3-large', () => {
      const body = tester.getRequestBody({ apiKey: 'key', input: 'hello', model: 'voyage-3-large' })
      expect(body.model).toBe('voyage-3-large')
    })

    it('should use specified model voyage-3-lite', () => {
      const body = tester.getRequestBody({ apiKey: 'key', input: 'hello', model: 'voyage-3-lite' })
      expect(body.model).toBe('voyage-3-lite')
    })

    it('should use specified model voyage-code-3', () => {
      const body = tester.getRequestBody({ apiKey: 'key', input: 'hello', model: 'voyage-code-3' })
      expect(body.model).toBe('voyage-code-3')
    })

    it('should use specified model voyage-finance-2', () => {
      const body = tester.getRequestBody({
        apiKey: 'key',
        input: 'hello',
        model: 'voyage-finance-2',
      })
      expect(body.model).toBe('voyage-finance-2')
    })

    it('should use specified model voyage-law-2', () => {
      const body = tester.getRequestBody({ apiKey: 'key', input: 'hello', model: 'voyage-law-2' })
      expect(body.model).toBe('voyage-law-2')
    })

    it('should include input_type query when provided', () => {
      const body = tester.getRequestBody({ apiKey: 'key', input: 'hello', inputType: 'query' })
      expect(body.input_type).toBe('query')
    })

    it('should include input_type document when provided', () => {
      const body = tester.getRequestBody({ apiKey: 'key', input: 'hello', inputType: 'document' })
      expect(body.input_type).toBe('document')
    })

    it('should omit input_type when not provided', () => {
      const body = tester.getRequestBody({ apiKey: 'key', input: 'hello' })
      expect(body.input_type).toBeUndefined()
      expect('input_type' in body).toBe(false)
    })

    it('should not include apiKey in body', () => {
      const body = tester.getRequestBody({ apiKey: 'key', input: 'hello' })
      expect(body.apiKey).toBeUndefined()
    })
  })

  describe('Response Transformation', () => {
    it('should extract embeddings, model, and usage for multiple inputs', async () => {
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

    it('should handle single embedding result', async () => {
      tester.setup({
        data: [{ embedding: [0.1, 0.2, 0.3, 0.4, 0.5], index: 0 }],
        model: 'voyage-3-lite',
        usage: { total_tokens: 3 },
      })

      const result = await tester.execute({ apiKey: 'key', input: 'single text' })
      expect(result.success).toBe(true)
      expect(result.output.embeddings).toHaveLength(1)
      expect(result.output.embeddings[0]).toEqual([0.1, 0.2, 0.3, 0.4, 0.5])
      expect(result.output.model).toBe('voyage-3-lite')
    })

    it('should handle high-dimensional embeddings (1024d)', async () => {
      const embedding = Array.from({ length: 1024 }, () => Math.random())
      tester.setup({
        data: [{ embedding, index: 0 }],
        model: 'voyage-3-large',
        usage: { total_tokens: 5 },
      })

      const result = await tester.execute({ apiKey: 'key', input: 'test' })
      expect(result.success).toBe(true)
      expect(result.output.embeddings[0]).toHaveLength(1024)
    })

    it('should correctly pass through token count of 0', async () => {
      tester.setup({
        data: [{ embedding: [0.1], index: 0 }],
        model: 'voyage-3',
        usage: { total_tokens: 0 },
      })

      const result = await tester.execute({ apiKey: 'key', input: '' })
      expect(result.output.usage.total_tokens).toBe(0)
    })
  })

  describe('Error Handling', () => {
    it('should handle 401 unauthorized error', async () => {
      tester.setup({ error: 'Invalid API key' }, { ok: false, status: 401 })
      const result = await tester.execute({ apiKey: 'bad-key', input: 'hello' })
      expect(result.success).toBe(false)
    })

    it('should handle 429 rate limit error', async () => {
      tester.setup({ error: 'Rate limited' }, { ok: false, status: 429 })
      const result = await tester.execute({ apiKey: 'key', input: 'hello' })
      expect(result.success).toBe(false)
    })

    it('should handle 500 server error', async () => {
      tester.setup({ error: 'Internal error' }, { ok: false, status: 500 })
      const result = await tester.execute({ apiKey: 'key', input: 'hello' })
      expect(result.success).toBe(false)
    })

    it('should handle network errors', async () => {
      tester.setupError('Network error')
      const result = await tester.execute({ apiKey: 'key', input: 'hello' })
      expect(result.success).toBe(false)
      expect(result.error).toContain('Network error')
    })

    it('should handle connection refused', async () => {
      tester.setupError('ECONNREFUSED')
      const result = await tester.execute({ apiKey: 'key', input: 'hello' })
      expect(result.success).toBe(false)
      expect(result.error).toContain('ECONNREFUSED')
    })

    it('should handle timeout errors', async () => {
      tester.setupError('timeout')
      const result = await tester.execute({ apiKey: 'key', input: 'hello' })
      expect(result.success).toBe(false)
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

  describe('Tool metadata', () => {
    it('should have correct id and name', () => {
      expect(rerankTool.id).toBe('voyageai_rerank')
      expect(rerankTool.name).toBe('Voyage AI Rerank')
      expect(rerankTool.version).toBe('1.0')
    })

    it('should have all required params defined', () => {
      expect(rerankTool.params.query).toBeDefined()
      expect(rerankTool.params.query.required).toBe(true)
      expect(rerankTool.params.documents).toBeDefined()
      expect(rerankTool.params.documents.required).toBe(true)
      expect(rerankTool.params.apiKey).toBeDefined()
      expect(rerankTool.params.apiKey.required).toBe(true)
      expect(rerankTool.params.model).toBeDefined()
      expect(rerankTool.params.model.required).toBe(false)
      expect(rerankTool.params.model.default).toBe('rerank-2.5')
      expect(rerankTool.params.topK).toBeDefined()
      expect(rerankTool.params.topK.required).toBe(false)
    })

    it('should have output schema with results, model, usage', () => {
      expect(rerankTool.outputs).toBeDefined()
      expect(rerankTool.outputs!.output.properties!.results).toBeDefined()
      expect(rerankTool.outputs!.output.properties!.model).toBeDefined()
      expect(rerankTool.outputs!.output.properties!.usage).toBeDefined()
    })
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
    it('should send query, documents, and default model', () => {
      const body = tester.getRequestBody({
        apiKey: 'key',
        query: 'what is AI?',
        documents: ['AI is...', 'Machine learning is...'],
      })
      expect(body.query).toBe('what is AI?')
      expect(body.documents).toEqual(['AI is...', 'Machine learning is...'])
      expect(body.model).toBe('rerank-2.5')
    })

    it('should parse JSON string documents into array', () => {
      const body = tester.getRequestBody({
        apiKey: 'key',
        query: 'test',
        documents: '["doc1", "doc2"]',
      })
      expect(body.documents).toEqual(['doc1', 'doc2'])
      expect(Array.isArray(body.documents)).toBe(true)
    })

    it('should handle direct array documents', () => {
      const docs = ['first doc', 'second doc', 'third doc']
      const body = tester.getRequestBody({
        apiKey: 'key',
        query: 'test',
        documents: docs,
      })
      expect(body.documents).toEqual(docs)
    })

    it('should handle large number of documents', () => {
      const docs = Array.from({ length: 50 }, (_, i) => `document number ${i}`)
      const body = tester.getRequestBody({
        apiKey: 'key',
        query: 'test',
        documents: docs,
      })
      expect(body.documents).toHaveLength(50)
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

    it('should handle top_k of 1', () => {
      const body = tester.getRequestBody({
        apiKey: 'key',
        query: 'test',
        documents: ['doc1', 'doc2'],
        topK: 1,
      })
      expect(body.top_k).toBe(1)
    })

    it('should omit top_k when not provided', () => {
      const body = tester.getRequestBody({
        apiKey: 'key',
        query: 'test',
        documents: ['doc1'],
      })
      expect(body.top_k).toBeUndefined()
    })

    it('should omit top_k when 0 (falsy)', () => {
      const body = tester.getRequestBody({
        apiKey: 'key',
        query: 'test',
        documents: ['doc1'],
        topK: 0,
      })
      expect(body.top_k).toBeUndefined()
    })

    it('should use specified model rerank-2-lite', () => {
      const body = tester.getRequestBody({
        apiKey: 'key',
        query: 'test',
        documents: ['doc1'],
        model: 'rerank-2-lite',
      })
      expect(body.model).toBe('rerank-2-lite')
    })

    it('should not include apiKey in body', () => {
      const body = tester.getRequestBody({
        apiKey: 'key',
        query: 'test',
        documents: ['doc1'],
      })
      expect(body.apiKey).toBeUndefined()
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
      expect(result.output.results).toHaveLength(2)
      expect(result.output.results[0]).toEqual({
        index: 1,
        relevance_score: 0.95,
        document: 'AI is artificial intelligence',
      })
      expect(result.output.results[1]).toEqual({
        index: 0,
        relevance_score: 0.72,
        document: 'Machine learning basics',
      })
      expect(result.output.model).toBe('rerank-2')
      expect(result.output.usage.total_tokens).toBe(25)
    })

    it('should handle single result', async () => {
      tester.setup({
        data: [{ index: 0, relevance_score: 0.88 }],
        model: 'rerank-2-lite',
        usage: { total_tokens: 5 },
      })

      const result = await tester.execute({
        apiKey: 'key',
        query: 'test',
        documents: ['only doc'],
      })

      expect(result.success).toBe(true)
      expect(result.output.results).toHaveLength(1)
      expect(result.output.results[0].document).toBe('only doc')
      expect(result.output.results[0].relevance_score).toBe(0.88)
    })

    it('should handle three documents reranked', async () => {
      tester.setup({
        data: [
          { index: 2, relevance_score: 0.99 },
          { index: 0, relevance_score: 0.75 },
          { index: 1, relevance_score: 0.30 },
        ],
        model: 'rerank-2',
        usage: { total_tokens: 40 },
      })

      const result = await tester.execute({
        apiKey: 'key',
        query: 'query',
        documents: ['doc A', 'doc B', 'doc C'],
      })

      expect(result.output.results[0].document).toBe('doc C')
      expect(result.output.results[1].document).toBe('doc A')
      expect(result.output.results[2].document).toBe('doc B')
    })

    it('should handle out-of-range index gracefully with empty string', async () => {
      tester.setup({
        data: [{ index: 99, relevance_score: 0.5 }],
        model: 'rerank-2',
        usage: { total_tokens: 5 },
      })

      const result = await tester.execute({
        apiKey: 'key',
        query: 'test',
        documents: ['doc1'],
      })

      expect(result.output.results[0].document).toBe('')
    })

    it('should resolve documents from JSON string params', async () => {
      tester.setup({
        data: [{ index: 0, relevance_score: 0.9 }],
        model: 'rerank-2',
        usage: { total_tokens: 5 },
      })

      const result = await tester.execute({
        apiKey: 'key',
        query: 'test',
        documents: '["parsed doc"]',
      })

      expect(result.output.results[0].document).toBe('parsed doc')
    })
  })

  describe('Error Handling', () => {
    it('should handle 401 error', async () => {
      tester.setup({ error: 'Unauthorized' }, { ok: false, status: 401 })
      const result = await tester.execute({ apiKey: 'bad', query: 'test', documents: ['doc'] })
      expect(result.success).toBe(false)
    })

    it('should handle 429 rate limit error', async () => {
      tester.setup({ error: 'Rate limited' }, { ok: false, status: 429 })
      const result = await tester.execute({ apiKey: 'key', query: 'test', documents: ['doc1'] })
      expect(result.success).toBe(false)
    })

    it('should handle 400 bad request', async () => {
      tester.setup({ error: 'Bad request' }, { ok: false, status: 400 })
      const result = await tester.execute({ apiKey: 'key', query: 'test', documents: ['doc1'] })
      expect(result.success).toBe(false)
    })

    it('should handle network errors', async () => {
      tester.setupError('Connection refused')
      const result = await tester.execute({ apiKey: 'key', query: 'test', documents: ['doc1'] })
      expect(result.success).toBe(false)
      expect(result.error).toContain('Connection refused')
    })

    it('should handle DNS resolution failure', async () => {
      tester.setupError('ENOTFOUND api.voyageai.com')
      const result = await tester.execute({ apiKey: 'key', query: 'test', documents: ['doc1'] })
      expect(result.success).toBe(false)
      expect(result.error).toContain('ENOTFOUND')
    })
  })
})

describe('Voyage AI Multimodal Embeddings Tool', () => {
  describe('Tool metadata', () => {
    it('should have correct id and name', () => {
      expect(multimodalEmbeddingsTool.id).toBe('voyageai_multimodal_embeddings')
      expect(multimodalEmbeddingsTool.name).toBe('Voyage AI Multimodal Embeddings')
      expect(multimodalEmbeddingsTool.version).toBe('1.0')
    })

    it('should have apiKey as required and input as optional', () => {
      expect(multimodalEmbeddingsTool.params.apiKey.required).toBe(true)
      expect(multimodalEmbeddingsTool.params.input.required).toBe(false)
      expect(multimodalEmbeddingsTool.params.imageFiles.required).toBe(false)
      expect(multimodalEmbeddingsTool.params.videoFile.required).toBe(false)
    })

    it('should default to voyage-multimodal-3.5 model', () => {
      expect(multimodalEmbeddingsTool.params.model.default).toBe('voyage-multimodal-3.5')
    })

    it('should use internal proxy URL', () => {
      expect(multimodalEmbeddingsTool.request.url).toBe(
        '/api/tools/voyageai/multimodal-embeddings'
      )
    })

    it('should use POST method', () => {
      expect(multimodalEmbeddingsTool.request.method).toBe('POST')
    })

    it('should have output schema with embeddings, model, usage', () => {
      expect(multimodalEmbeddingsTool.outputs).toBeDefined()
      expect(multimodalEmbeddingsTool.outputs!.output.properties!.embeddings).toBeDefined()
      expect(multimodalEmbeddingsTool.outputs!.output.properties!.model).toBeDefined()
      expect(multimodalEmbeddingsTool.outputs!.output.properties!.usage).toBeDefined()
    })
  })

  describe('Body Construction', () => {
    it('should pass all params to internal route', () => {
      const body = multimodalEmbeddingsTool.request.body!({
        apiKey: 'key',
        input: 'hello',
        imageUrls: 'https://example.com/img.jpg',
        model: 'voyage-multimodal-3.5',
      })
      expect(body.apiKey).toBe('key')
      expect(body.input).toBe('hello')
      expect(body.imageUrls).toBe('https://example.com/img.jpg')
      expect(body.model).toBe('voyage-multimodal-3.5')
    })

    it('should use default model when not specified', () => {
      const body = multimodalEmbeddingsTool.request.body!({
        apiKey: 'key',
        input: 'hello',
      })
      expect(body.model).toBe('voyage-multimodal-3.5')
    })

    it('should pass image files through', () => {
      const files = [{ id: '1', name: 'img.jpg', size: 100, type: 'image/jpeg' }]
      const body = multimodalEmbeddingsTool.request.body!({
        apiKey: 'key',
        imageFiles: files,
      })
      expect(body.imageFiles).toEqual(files)
    })

    it('should pass video file through', () => {
      const file = { id: '1', name: 'vid.mp4', size: 1000, type: 'video/mp4' }
      const body = multimodalEmbeddingsTool.request.body!({
        apiKey: 'key',
        videoFile: file,
      })
      expect(body.videoFile).toEqual(file)
    })

    it('should pass video URL through', () => {
      const body = multimodalEmbeddingsTool.request.body!({
        apiKey: 'key',
        videoUrl: 'https://example.com/video.mp4',
      })
      expect(body.videoUrl).toBe('https://example.com/video.mp4')
    })

    it('should pass inputType through', () => {
      const body = multimodalEmbeddingsTool.request.body!({
        apiKey: 'key',
        input: 'test',
        inputType: 'query',
      })
      expect(body.inputType).toBe('query')
    })
  })

  describe('Response Transformation', () => {
    it('should extract embeddings from internal route response', async () => {
      const mockResponse = {
        ok: true,
        json: async () => ({
          output: {
            embeddings: [[0.1, 0.2, 0.3]],
            model: 'voyage-multimodal-3.5',
            usage: { text_tokens: 5, image_pixels: 200000, total_tokens: 362 },
          },
        }),
      } as Response

      const result = await multimodalEmbeddingsTool.transformResponse!(mockResponse)
      expect(result.success).toBe(true)
      expect(result.output.embeddings).toEqual([[0.1, 0.2, 0.3]])
      expect(result.output.model).toBe('voyage-multimodal-3.5')
      expect(result.output.usage.text_tokens).toBe(5)
      expect(result.output.usage.image_pixels).toBe(200000)
      expect(result.output.usage.total_tokens).toBe(362)
    })

    it('should handle response with video_pixels', async () => {
      const mockResponse = {
        ok: true,
        json: async () => ({
          output: {
            embeddings: [[0.4, 0.5]],
            model: 'voyage-multimodal-3.5',
            usage: { text_tokens: 0, video_pixels: 5000000, total_tokens: 4464 },
          },
        }),
      } as Response

      const result = await multimodalEmbeddingsTool.transformResponse!(mockResponse)
      expect(result.output.usage.video_pixels).toBe(5000000)
    })
  })
})
