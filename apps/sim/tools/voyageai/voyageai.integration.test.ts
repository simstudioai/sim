/**
 * @vitest-environment node
 *
 * Integration tests for VoyageAI tools.
 * These tests call the real VoyageAI API and require a valid API key.
 * Set VOYAGEAI_API_KEY env var or they will be skipped.
 */
import { describe, expect, it } from 'vitest'
import { embeddingsTool } from '@/tools/voyageai/embeddings'
import { rerankTool } from '@/tools/voyageai/rerank'

const API_KEY = process.env.VOYAGEAI_API_KEY
const describeIntegration = API_KEY ? describe : describe.skip

/**
 * Use undici's fetch directly to bypass the global fetch mock set up in vitest.setup.ts.
 */
async function liveFetch(url: string, init: RequestInit): Promise<Response> {
  // vi.mocked(fetch) is the mock — call the real underlying impl
  const { request } = await import('undici')
  const resp = await request(url, {
    method: init.method as any,
    headers: init.headers as Record<string, string>,
    body: init.body as string,
  })
  const bodyText = await resp.body.text()
  return new Response(bodyText, {
    status: resp.statusCode,
    headers: resp.headers as Record<string, string>,
  })
}

describeIntegration('VoyageAI Integration Tests (live API)', () => {
  describe('Embeddings API', () => {
    it('should generate embeddings for a single text with voyage-3', async () => {
      const body = embeddingsTool.request.body!({
        apiKey: API_KEY!,
        input: 'Hello world, this is a test.',
      })
      const headers = embeddingsTool.request.headers({ apiKey: API_KEY!, input: '' })
      const url =
        typeof embeddingsTool.request.url === 'function'
          ? embeddingsTool.request.url({ apiKey: API_KEY!, input: '' })
          : embeddingsTool.request.url

      const response = await liveFetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      })

      expect(response.ok).toBe(true)

      const result = await embeddingsTool.transformResponse!(response)
      expect(result.success).toBe(true)
      expect(result.output.embeddings).toHaveLength(1)
      expect(result.output.embeddings[0].length).toBeGreaterThan(100)
      expect(result.output.model).toBe('voyage-3.5')
      expect(result.output.usage.total_tokens).toBeGreaterThan(0)
    }, 15000)

    it('should generate embeddings for multiple texts', async () => {
      const body = embeddingsTool.request.body!({
        apiKey: API_KEY!,
        input: ['First document about AI', 'Second document about cooking', 'Third about sports'],
      })
      const headers = embeddingsTool.request.headers({ apiKey: API_KEY!, input: '' })
      const url =
        typeof embeddingsTool.request.url === 'function'
          ? embeddingsTool.request.url({ apiKey: API_KEY!, input: '' })
          : embeddingsTool.request.url

      const response = await liveFetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      })

      expect(response.ok).toBe(true)

      const result = await embeddingsTool.transformResponse!(response)
      expect(result.success).toBe(true)
      expect(result.output.embeddings).toHaveLength(3)
      expect(result.output.embeddings[0].length).toBe(result.output.embeddings[1].length)
    }, 15000)

    it('should generate 1024-dimensional embeddings with voyage-3-large', async () => {
      const body = embeddingsTool.request.body!({
        apiKey: API_KEY!,
        input: 'Test embedding dimensions',
        model: 'voyage-3-large',
      })
      const headers = embeddingsTool.request.headers({ apiKey: API_KEY!, input: '' })
      const url =
        typeof embeddingsTool.request.url === 'function'
          ? embeddingsTool.request.url({ apiKey: API_KEY!, input: '' })
          : embeddingsTool.request.url

      const response = await liveFetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      })

      expect(response.ok).toBe(true)

      const result = await embeddingsTool.transformResponse!(response)
      expect(result.output.embeddings[0]).toHaveLength(1024)
      expect(result.output.model).toBe('voyage-3-large')
    }, 15000)

    it('should generate 512-dimensional embeddings with voyage-3-lite', async () => {
      const body = embeddingsTool.request.body!({
        apiKey: API_KEY!,
        input: 'Test lite model',
        model: 'voyage-3-lite',
      })
      const headers = embeddingsTool.request.headers({ apiKey: API_KEY!, input: '' })
      const url =
        typeof embeddingsTool.request.url === 'function'
          ? embeddingsTool.request.url({ apiKey: API_KEY!, input: '' })
          : embeddingsTool.request.url

      const response = await liveFetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      })

      expect(response.ok).toBe(true)

      const result = await embeddingsTool.transformResponse!(response)
      expect(result.output.embeddings[0]).toHaveLength(512)
      expect(result.output.model).toBe('voyage-3-lite')
    }, 15000)

    it('should respect input_type parameter', async () => {
      const body = embeddingsTool.request.body!({
        apiKey: API_KEY!,
        input: 'search query text',
        inputType: 'query',
      })
      const headers = embeddingsTool.request.headers({ apiKey: API_KEY!, input: '' })
      const url =
        typeof embeddingsTool.request.url === 'function'
          ? embeddingsTool.request.url({ apiKey: API_KEY!, input: '' })
          : embeddingsTool.request.url

      const response = await liveFetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      })

      expect(response.ok).toBe(true)

      const result = await embeddingsTool.transformResponse!(response)
      expect(result.success).toBe(true)
      expect(result.output.embeddings).toHaveLength(1)
    }, 15000)

    it('should produce different embeddings for different texts', async () => {
      const body = embeddingsTool.request.body!({
        apiKey: API_KEY!,
        input: ['The sun is bright', 'Quantum computing is complex'],
      })
      const headers = embeddingsTool.request.headers({ apiKey: API_KEY!, input: '' })
      const url =
        typeof embeddingsTool.request.url === 'function'
          ? embeddingsTool.request.url({ apiKey: API_KEY!, input: '' })
          : embeddingsTool.request.url

      const response = await liveFetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      })

      const result = await embeddingsTool.transformResponse!(response)
      const emb1 = result.output.embeddings[0]
      const emb2 = result.output.embeddings[1]

      expect(emb1).not.toEqual(emb2)

      const dotProduct = emb1.reduce(
        (sum: number, val: number, i: number) => sum + val * emb2[i],
        0
      )
      expect(dotProduct).toBeLessThan(1.0)
    }, 15000)

    it('should reject invalid API key', async () => {
      const headers = embeddingsTool.request.headers({ apiKey: 'invalid-key', input: '' })
      const body = embeddingsTool.request.body!({
        apiKey: 'invalid-key',
        input: 'test',
      })
      const url =
        typeof embeddingsTool.request.url === 'function'
          ? embeddingsTool.request.url({ apiKey: 'invalid-key', input: '' })
          : embeddingsTool.request.url

      const response = await liveFetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      })

      expect(response.ok).toBe(false)
      expect(response.status).toBe(401)
    }, 15000)
  })

  describe('Rerank API', () => {
    it('should rerank documents by relevance', async () => {
      const documents = [
        'The weather is sunny today',
        'Artificial intelligence is transforming healthcare',
        'Machine learning algorithms can detect patterns',
      ]

      const body = rerankTool.request.body!({
        apiKey: API_KEY!,
        query: 'What is artificial intelligence?',
        documents,
      })
      const headers = rerankTool.request.headers({ apiKey: API_KEY!, query: '', documents: [] })
      const url =
        typeof rerankTool.request.url === 'function'
          ? rerankTool.request.url({ apiKey: API_KEY!, query: '', documents: [] })
          : rerankTool.request.url

      const response = await liveFetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      })

      expect(response.ok).toBe(true)

      const result = await rerankTool.transformResponse!(response, {
        apiKey: API_KEY!,
        query: 'What is artificial intelligence?',
        documents,
      })

      expect(result.success).toBe(true)
      expect(result.output.results).toHaveLength(3)
      expect(result.output.model).toBe('rerank-2.5')
      expect(result.output.usage.total_tokens).toBeGreaterThan(0)

      for (const r of result.output.results) {
        expect(r.relevance_score).toBeGreaterThanOrEqual(0)
        expect(r.relevance_score).toBeLessThanOrEqual(1)
        expect(r.index).toBeGreaterThanOrEqual(0)
        expect(r.index).toBeLessThan(3)
        expect(r.document).toBeTruthy()
      }

      expect(result.output.results[0].relevance_score).toBeGreaterThanOrEqual(
        result.output.results[1].relevance_score
      )
    }, 15000)

    it('should respect top_k parameter', async () => {
      const documents = ['doc A', 'doc B', 'doc C', 'doc D', 'doc E']

      const body = rerankTool.request.body!({
        apiKey: API_KEY!,
        query: 'test query',
        documents,
        topK: 2,
      })
      const headers = rerankTool.request.headers({ apiKey: API_KEY!, query: '', documents: [] })
      const url =
        typeof rerankTool.request.url === 'function'
          ? rerankTool.request.url({ apiKey: API_KEY!, query: '', documents: [] })
          : rerankTool.request.url

      const response = await liveFetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      })

      expect(response.ok).toBe(true)

      const result = await rerankTool.transformResponse!(response, {
        apiKey: API_KEY!,
        query: 'test query',
        documents,
        topK: 2,
      })

      expect(result.output.results).toHaveLength(2)
    }, 15000)

    it('should work with rerank-2-lite model', async () => {
      const body = rerankTool.request.body!({
        apiKey: API_KEY!,
        query: 'Python programming',
        documents: ['Python is a language', 'Java is also a language'],
        model: 'rerank-2-lite',
      })
      const headers = rerankTool.request.headers({ apiKey: API_KEY!, query: '', documents: [] })
      const url =
        typeof rerankTool.request.url === 'function'
          ? rerankTool.request.url({ apiKey: API_KEY!, query: '', documents: [] })
          : rerankTool.request.url

      const response = await liveFetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      })

      expect(response.ok).toBe(true)

      const result = await rerankTool.transformResponse!(response, {
        apiKey: API_KEY!,
        query: 'Python programming',
        documents: ['Python is a language', 'Java is also a language'],
        model: 'rerank-2-lite',
      })

      expect(result.output.model).toBe('rerank-2-lite')
      expect(result.output.results).toHaveLength(2)
    }, 15000)

    it('should correctly map document text back from indices', async () => {
      const documents = ['Alpha document', 'Beta document', 'Gamma document']

      const body = rerankTool.request.body!({
        apiKey: API_KEY!,
        query: 'gamma',
        documents,
      })
      const headers = rerankTool.request.headers({ apiKey: API_KEY!, query: '', documents: [] })
      const url =
        typeof rerankTool.request.url === 'function'
          ? rerankTool.request.url({ apiKey: API_KEY!, query: '', documents: [] })
          : rerankTool.request.url

      const response = await liveFetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      })

      const result = await rerankTool.transformResponse!(response, {
        apiKey: API_KEY!,
        query: 'gamma',
        documents,
      })

      for (const r of result.output.results) {
        expect(r.document).toBe(documents[r.index])
      }
    }, 15000)

    it('should reject invalid API key', async () => {
      const headers = rerankTool.request.headers({ apiKey: 'invalid-key', query: '', documents: [] })
      const body = rerankTool.request.body!({
        apiKey: 'invalid-key',
        query: 'test',
        documents: ['doc'],
      })
      const url =
        typeof rerankTool.request.url === 'function'
          ? rerankTool.request.url({ apiKey: 'invalid-key', query: '', documents: [] })
          : rerankTool.request.url

      const response = await liveFetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      })

      expect(response.ok).toBe(false)
      expect(response.status).toBe(401)
    }, 15000)
  })

  describe('End-to-end workflow: Embed then Rerank', () => {
    it('should embed documents and then rerank them', async () => {
      const documents = [
        'Neural networks are inspired by biological neurons',
        'The recipe calls for two cups of flour',
        'Deep learning has revolutionized natural language processing',
        'Football is the most popular sport worldwide',
      ]

      const embedBody = embeddingsTool.request.body!({
        apiKey: API_KEY!,
        input: documents,
        inputType: 'document',
      })
      const embedHeaders = embeddingsTool.request.headers({ apiKey: API_KEY!, input: '' })
      const embedUrl =
        typeof embeddingsTool.request.url === 'function'
          ? embeddingsTool.request.url({ apiKey: API_KEY!, input: '' })
          : embeddingsTool.request.url

      const embedResponse = await liveFetch(embedUrl, {
        method: 'POST',
        headers: embedHeaders,
        body: JSON.stringify(embedBody),
      })

      const embedResult = await embeddingsTool.transformResponse!(embedResponse)
      expect(embedResult.success).toBe(true)
      expect(embedResult.output.embeddings).toHaveLength(4)

      const rerankBody = rerankTool.request.body!({
        apiKey: API_KEY!,
        query: 'What are neural networks used for?',
        documents,
      })
      const rerankHeaders = rerankTool.request.headers({ apiKey: API_KEY!, query: '', documents: [] })
      const rerankUrl =
        typeof rerankTool.request.url === 'function'
          ? rerankTool.request.url({ apiKey: API_KEY!, query: '', documents: [] })
          : rerankTool.request.url

      const rerankResponse = await liveFetch(rerankUrl, {
        method: 'POST',
        headers: rerankHeaders,
        body: JSON.stringify(rerankBody),
      })

      const rerankResult = await rerankTool.transformResponse!(rerankResponse, {
        apiKey: API_KEY!,
        query: 'What are neural networks used for?',
        documents,
      })

      expect(rerankResult.success).toBe(true)
      expect(rerankResult.output.results).toHaveLength(4)

      // Verify results are sorted by relevance (descending)
      for (let i = 0; i < rerankResult.output.results.length - 1; i++) {
        expect(rerankResult.output.results[i].relevance_score).toBeGreaterThanOrEqual(
          rerankResult.output.results[i + 1].relevance_score
        )
      }

      // Verify all documents are mapped back correctly
      for (const r of rerankResult.output.results) {
        expect(r.document).toBe(documents[r.index])
      }

      // The AI-related docs should score higher than the unrelated ones
      const aiDocIndices = [0, 2] // "Neural networks..." and "Deep learning..."
      const topTwoIndices = rerankResult.output.results.slice(0, 2).map((r: any) => r.index)
      const aiDocsInTop2 = topTwoIndices.filter((i: number) => aiDocIndices.includes(i))
      expect(aiDocsInTop2.length).toBeGreaterThanOrEqual(1)
    }, 30000)
  })

  describe('Multimodal Embeddings API', () => {
    const MULTIMODAL_URL = 'https://api.voyageai.com/v1/multimodalembeddings'
    const MULTIMODAL_HEADERS = {
      Authorization: `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
    }

    it('should generate multimodal embedding with text-only input', async () => {
      const response = await liveFetch(MULTIMODAL_URL, {
        method: 'POST',
        headers: MULTIMODAL_HEADERS,
        body: JSON.stringify({
          inputs: [{ content: [{ type: 'text', text: 'Hello world' }] }],
          model: 'voyage-multimodal-3.5',
        }),
      })

      expect(response.ok).toBe(true)
      const data = await response.json()
      expect(data.data).toHaveLength(1)
      expect(data.data[0].embedding.length).toBeGreaterThan(100)
      expect(data.model).toBe('voyage-multimodal-3.5')
      expect(data.usage.total_tokens).toBeGreaterThan(0)
    }, 15000)

    it('should generate multimodal embedding with image URL', async () => {
      const response = await liveFetch(MULTIMODAL_URL, {
        method: 'POST',
        headers: MULTIMODAL_HEADERS,
        body: JSON.stringify({
          inputs: [
            {
              content: [
                {
                  type: 'image_url',
                  image_url:
                    'https://raw.githubusercontent.com/voyage-ai/voyage-multimodal-3/refs/heads/main/images/banana.jpg',
                },
              ],
            },
          ],
          model: 'voyage-multimodal-3.5',
        }),
      })

      expect(response.ok).toBe(true)
      const data = await response.json()
      expect(data.data).toHaveLength(1)
      expect(data.data[0].embedding.length).toBeGreaterThan(100)
      expect(data.usage.image_pixels).toBeGreaterThan(0)
      expect(data.usage.total_tokens).toBeGreaterThan(0)
    }, 30000)

    it('should generate multimodal embedding with text + image combined', async () => {
      const response = await liveFetch(MULTIMODAL_URL, {
        method: 'POST',
        headers: MULTIMODAL_HEADERS,
        body: JSON.stringify({
          inputs: [
            {
              content: [
                { type: 'text', text: 'A yellow banana' },
                {
                  type: 'image_url',
                  image_url:
                    'https://raw.githubusercontent.com/voyage-ai/voyage-multimodal-3/refs/heads/main/images/banana.jpg',
                },
              ],
            },
          ],
          model: 'voyage-multimodal-3.5',
        }),
      })

      expect(response.ok).toBe(true)
      const data = await response.json()
      expect(data.data).toHaveLength(1)
      expect(data.usage.text_tokens).toBeGreaterThan(0)
      expect(data.usage.image_pixels).toBeGreaterThan(0)
      expect(data.usage.total_tokens).toBeGreaterThan(0)
    }, 30000)

    it('should produce 1024-dimensional embeddings', async () => {
      const response = await liveFetch(MULTIMODAL_URL, {
        method: 'POST',
        headers: MULTIMODAL_HEADERS,
        body: JSON.stringify({
          inputs: [{ content: [{ type: 'text', text: 'dimension check' }] }],
          model: 'voyage-multimodal-3.5',
        }),
      })

      const data = await response.json()
      expect(data.data[0].embedding).toHaveLength(1024)
    }, 15000)

    it('should reject invalid API key', async () => {
      const response = await liveFetch(MULTIMODAL_URL, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer invalid-key',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          inputs: [{ content: [{ type: 'text', text: 'test' }] }],
          model: 'voyage-multimodal-3.5',
        }),
      })

      expect(response.ok).toBe(false)
      expect(response.status).toBe(401)
    }, 15000)
  })
})
