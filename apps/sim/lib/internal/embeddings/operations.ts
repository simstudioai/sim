import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import {
  DEFAULT_MODEL_BY_PROVIDER,
  DEFAULT_OPENROUTER_EMBEDDING_MODEL,
  EmbeddingOutputLimitError,
  embed,
  embedOpenRouter,
  findEmbeddingModelInfo,
  resolveDimensions,
  toOllamaEmbeddingModelId,
} from '@/lib/embeddings'
import {
  getOllamaEmbeddingModelMetadata,
  OllamaEmbeddingModelNotFoundError,
  OllamaEmbeddingWidthUnknownError,
} from '@/lib/embeddings/ollama-model-catalog.server'
import {
  getOpenRouterEmbeddingModelMetadata,
  type OpenRouterEmbeddingModelMetadata,
  OpenRouterEmbeddingModelNotFoundError,
} from '@/lib/embeddings/openrouter-model-catalog.server'
import { normalizeOpenRouterEmbeddingModelId } from '@/lib/embeddings/openrouter-models'
import type { EmbedResult } from '@/lib/embeddings/types'
import {
  type EmbeddingsInput,
  MAX_EMBEDDING_INPUTS,
  MAX_EMBEDDING_TOTAL_CHARS,
} from '@/lib/internal/embeddings/schema'

const logger = createLogger('EmbeddingOperations')

export interface EmbeddingOperationContext {
  signal?: AbortSignal
}

function failureResponse(error: string, status: number): Response {
  return Response.json({ success: false, error }, { status })
}

export function normalizeEmbeddingInput(input: string | string[]): string[] {
  if (Array.isArray(input)) return input
  if (/^\s*\[/.test(input)) {
    try {
      const parsed: unknown = JSON.parse(input)
      if (Array.isArray(parsed) && parsed.every((entry) => typeof entry === 'string')) return parsed
    } catch {}
  }
  return [input]
}

export async function executeEmbedding(
  input: EmbeddingsInput,
  context: EmbeddingOperationContext
): Promise<Response> {
  context.signal?.throwIfAborted()
  const { provider, model, taskType, dimensions } = input
  /** Ollama takes no credential, so its input variant declares no `apiKey` at all. */
  const apiKey = provider === 'ollama' ? undefined : input.apiKey
  const texts = normalizeEmbeddingInput(input.input)
  if (texts.length === 0) return failureResponse('input must contain at least one text', 400)
  if (texts.length > MAX_EMBEDDING_INPUTS) {
    return failureResponse(
      `input cannot exceed ${MAX_EMBEDDING_INPUTS} texts, received ${texts.length}`,
      400
    )
  }
  const totalChars = texts.reduce((sum, text) => sum + text.length, 0)
  if (totalChars > MAX_EMBEDDING_TOTAL_CHARS) {
    return failureResponse(
      `Input is too large: ${totalChars} characters exceeds the ${MAX_EMBEDDING_TOTAL_CHARS} limit`,
      400
    )
  }
  if (texts.some((text) => !/\S/.test(text))) {
    return failureResponse('input entries cannot be empty', 400)
  }

  let resolvedModel: string
  let openRouterModelMetadata: OpenRouterEmbeddingModelMetadata | undefined
  /**
   * Width Ollama reports for the selected model. Resolved from the server rather
   * than requested by the caller: a local model's width is a property of what
   * the operator pulled, and it is what the client validates the response
   * against.
   */
  let ollamaDimensions: number | undefined
  if (provider === 'ollama') {
    try {
      resolvedModel = toOllamaEmbeddingModelId(model)
    } catch (error) {
      return failureResponse(getErrorMessage(error, 'Invalid Ollama embedding model'), 400)
    }
    try {
      ollamaDimensions = (await getOllamaEmbeddingModelMetadata(resolvedModel, context.signal))
        .dimensions
    } catch (error) {
      context.signal?.throwIfAborted()
      const userError =
        error instanceof OllamaEmbeddingModelNotFoundError ||
        error instanceof OllamaEmbeddingWidthUnknownError
      return failureResponse(
        getErrorMessage(error, 'Failed to load Ollama embedding model metadata'),
        userError ? 400 : 502
      )
    }
  } else if (provider === 'openrouter') {
    try {
      resolvedModel = normalizeOpenRouterEmbeddingModelId(
        model || DEFAULT_OPENROUTER_EMBEDDING_MODEL
      )
    } catch (error) {
      return failureResponse(getErrorMessage(error, 'Invalid OpenRouter embedding model'), 400)
    }
    try {
      openRouterModelMetadata = await getOpenRouterEmbeddingModelMetadata(
        resolvedModel,
        context.signal
      )
    } catch (error) {
      context.signal?.throwIfAborted()
      const notFound = error instanceof OpenRouterEmbeddingModelNotFoundError
      return failureResponse(
        getErrorMessage(
          error,
          notFound
            ? 'Unsupported OpenRouter embedding model'
            : 'Failed to load OpenRouter embedding model metadata'
        ),
        notFound ? 400 : 502
      )
    }
  } else {
    resolvedModel = model || DEFAULT_MODEL_BY_PROVIDER[provider]
  }

  if (provider !== 'openrouter') {
    const info = findEmbeddingModelInfo(resolvedModel)
    if (!info) return failureResponse(`Unsupported embedding model: ${resolvedModel}`, 400)
    if (info.provider !== provider) {
      return failureResponse(
        `Model ${resolvedModel} belongs to ${info.provider}, not ${provider}`,
        400
      )
    }
    try {
      resolveDimensions(info, ollamaDimensions ?? dimensions)
    } catch (error) {
      return failureResponse(getErrorMessage(error, 'Invalid dimensions'), 400)
    }
  }

  /** `resolvedModel` already carries a routing prefix for the providers that use one. */
  logger.info(`Embedding ${texts.length} input(s)`, { provider, model: resolvedModel })
  try {
    let result: EmbedResult
    if (provider === 'openrouter') {
      if (!openRouterModelMetadata) {
        throw new Error('Failed to load OpenRouter embedding model metadata')
      }
      result = await embedOpenRouter(texts, {
        model: resolvedModel,
        dimensions,
        apiKey: input.apiKey,
        maxInputTokens: openRouterModelMetadata.maxInputTokens,
        projectInputs: null,
        signal: context.signal,
      })
    } else {
      result = await embed(texts, {
        model: resolvedModel,
        taskType,
        /**
         * Ollama's width comes from the server, never from the caller: the
         * adapter cannot ask for a reduction, so a requested size could only
         * ever be an assertion, and the server already knows the answer.
         */
        dimensions: ollamaDimensions ?? dimensions,
        apiKey,
        projectInputs: null,
        signal: context.signal,
      })
    }
    context.signal?.throwIfAborted()
    return Response.json({
      success: true,
      embeddings: result.embeddings,
      model: result.modelName,
      provider,
      dimensions: result.dimensions,
      usage: { prompt_tokens: result.totalTokens, total_tokens: result.totalTokens },
      __embeddingTokens: result.totalTokens,
    })
  } catch (error) {
    context.signal?.throwIfAborted()
    const message = getErrorMessage(error, 'Embedding generation failed')
    if (error instanceof EmbeddingOutputLimitError) {
      logger.warn('Embedding output exceeds safe limit', { error: message })
      return failureResponse(message, 413)
    }
    logger.error('Embedding generation failed', { error: message })
    return failureResponse(message, 502)
  }
}
