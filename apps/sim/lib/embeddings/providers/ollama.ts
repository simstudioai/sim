import type { EmbeddingAdapterFactory, OllamaEmbeddingAdapterContext } from '@/lib/embeddings/types'

/**
 * Ollama documents no cap on `/api/embed`, but it embeds a batch on one local
 * model serially, so a large batch is a long single request against the
 * client's 60s timeout. Capping items keeps a slow local model's failures cheap
 * to retry — the same reason the shared batch token target sits below every
 * provider's documented maximum.
 */
const OLLAMA_MAX_ITEMS_PER_REQUEST = 64

interface OllamaEmbeddingResponse {
  embeddings: number[][]
  /** Ollama reports the tokens it actually embedded, after any truncation. */
  prompt_eval_count?: number
}

/**
 * Ollama `/api/embed` on the deployment's own server. Takes no credential:
 * Ollama exposes no authentication, so the server URL is the whole trust
 * boundary.
 *
 * `dimensions` is deliberately not forwarded. Only recent Ollama builds accept
 * it, and only for Matryoshka-capable models; an older server ignores unknown
 * fields rather than rejecting them, so sending it would silently produce
 * native-width vectors passing as reduced ones. The requested width is enforced
 * by the client's response validation instead, which names both the width asked
 * for and the width returned.
 */
export const createOllamaAdapter: EmbeddingAdapterFactory<OllamaEmbeddingAdapterContext> = ({
  modelName,
  baseUrl,
}) => ({
  maxItemsPerRequest: OLLAMA_MAX_ITEMS_PER_REQUEST,
  buildRequest: ({ inputs }) => ({
    apiUrl: `${baseUrl}/api/embed`,
    headers: { 'Content-Type': 'application/json' },
    body: {
      model: modelName,
      input: inputs,
      /**
       * Sim cannot know a local model's context length, so it holds inputs to a
       * common upper figure and lets Ollama shorten anything the loaded model
       * still cannot fit. Without this, a model with a small context rejects
       * the whole batch.
       */
      truncate: true,
    },
    parse: (json) => (json as OllamaEmbeddingResponse).embeddings,
    parseTokens: (json) => (json as OllamaEmbeddingResponse).prompt_eval_count,
  }),
})
