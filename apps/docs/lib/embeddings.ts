import { z } from 'zod'

const EMBEDDING_TIMEOUT_MS = 1500
const embeddingResponse = z.object({
  data: z.array(z.object({ embedding: z.array(z.number().finite()).length(1536) })).min(1),
})

/** Generates the fixed-width vector used by the optional public docs index. */
export async function generateSearchEmbedding(
  query: string,
  signal?: AbortSignal
): Promise<number[]> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) throw new Error('OPENAI_API_KEY is required for semantic search')
  const timeout = AbortSignal.timeout(EMBEDDING_TIMEOUT_MS)
  const response = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      input: query,
      model: 'text-embedding-3-small',
      encoding_format: 'float',
    }),
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  })
  if (!response.ok) throw new Error(`Embedding provider returned HTTP ${response.status}`)
  const payload = embeddingResponse.parse(await response.json())
  return payload.data[0].embedding
}
