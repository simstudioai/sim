import { getValidationErrorMessage } from '@/lib/api/server'
import { DEFAULT_MAX_JSON_BODY_BYTES } from '@/lib/api/server/validation'
import { executeEmbedding } from '@/lib/internal/embeddings/operations'
import { type EmbeddingProvider, embeddingsInputSchema } from '@/lib/internal/embeddings/schema'
import type { InternalToolOperationHandler } from '@/lib/internal/tool-operations/types'

const PROVIDERS_BY_TOOL_ID: Record<string, EmbeddingProvider> = {
  openai_embeddings: 'openai',
  embeddings_openai: 'openai',
  embeddings_openrouter: 'openrouter',
  embeddings_gemini: 'gemini',
  embeddings_cohere: 'cohere',
  embeddings_mistral: 'mistral',
}

export const executeEmbeddingsTool: InternalToolOperationHandler = async (request) => {
  request.signal?.throwIfAborted()
  if (!request.context.userId) {
    return Response.json({ success: false, error: 'Unauthorized' }, { status: 401 })
  }
  const expectedProvider = PROVIDERS_BY_TOOL_ID[request.toolId]
  if (!expectedProvider) {
    return Response.json(
      { success: false, error: `Unsupported embeddings tool: ${request.toolId}` },
      { status: 500 }
    )
  }
  let serializedInput: string
  try {
    serializedInput = JSON.stringify(request.input) ?? ''
  } catch {
    return Response.json({ success: false, error: 'Invalid request data' }, { status: 400 })
  }
  if (Buffer.byteLength(serializedInput, 'utf8') > DEFAULT_MAX_JSON_BODY_BYTES) {
    return Response.json(
      {
        success: false,
        error: `Request body exceeds the maximum allowed size of ${DEFAULT_MAX_JSON_BODY_BYTES} bytes`,
      },
      { status: 413 }
    )
  }
  const parsed = embeddingsInputSchema.safeParse(request.input)
  if (!parsed.success) {
    return Response.json(
      { success: false, error: getValidationErrorMessage(parsed.error, 'Invalid request data') },
      { status: 400 }
    )
  }
  if (parsed.data.provider !== expectedProvider) {
    return Response.json(
      { success: false, error: `Provider must be ${expectedProvider} for ${request.toolId}` },
      { status: 400 }
    )
  }
  return executeEmbedding(parsed.data, { signal: request.signal })
}
