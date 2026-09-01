import { embeddingsOpenAITool } from '@/tools/embeddings/openai'
import type { EmbeddingsParams, EmbeddingsResponse } from '@/tools/embeddings/types'
import type { InternalToolConfig } from '@/tools/types'

/**
 * Legacy tool id retained for the sunset `openai` Embeddings block and for
 * copilot/VFS callers that reference it by name. It is an alias of
 * `embeddings_openai` so both ids execute the exact same code path; the output
 * shape only gains fields (`provider`, `dimensions`, and the internal
 * `__embeddingTokens`) relative to the original.
 */
export const embeddingsTool: InternalToolConfig<EmbeddingsParams, EmbeddingsResponse> = {
  ...embeddingsOpenAITool,
  id: 'openai_embeddings',
  name: 'OpenAI Embeddings',
}
