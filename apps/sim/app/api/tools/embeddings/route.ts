import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import {
  embeddingsToolContract,
  MAX_EMBEDDING_INPUTS,
  MAX_EMBEDDING_TOTAL_CHARS,
} from '@/lib/api/contracts/tools/embeddings'
import { getValidationErrorMessage, parseRequest, validationErrorResponse } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import {
  DEFAULT_MODEL_BY_PROVIDER,
  DEFAULT_OPENROUTER_EMBEDDING_MODEL,
  embed,
  embedOpenRouter,
  findEmbeddingModelInfo,
  resolveDimensions,
} from '@/lib/embeddings'
import {
  getOpenRouterEmbeddingModelMetadata,
  type OpenRouterEmbeddingModelMetadata,
  OpenRouterEmbeddingModelNotFoundError,
} from '@/lib/embeddings/openrouter-model-catalog.server'
import { normalizeOpenRouterEmbeddingModelId } from '@/lib/embeddings/openrouter-models'

const logger = createLogger('EmbeddingsToolAPI')

export const dynamic = 'force-dynamic'

/**
 * Accepts a single string, an array, or a JSON-encoded array from a reference
 * expression. Probes for the opening bracket with a regex rather than `trim()`,
 * which would copy the whole payload just to read one character.
 */
function normalizeInput(input: string | string[]): string[] {
  if (Array.isArray(input)) return input
  if (/^\s*\[/.test(input)) {
    try {
      const parsed = JSON.parse(input)
      if (Array.isArray(parsed) && parsed.every((entry) => typeof entry === 'string')) {
        return parsed
      }
    } catch {
      // Not JSON — fall through and embed the raw string
    }
  }
  return [input]
}

export const POST = withRouteHandler(async (request: NextRequest) => {
  const authResult = await checkInternalAuth(request, { requireWorkflowId: false })
  if (!authResult.success || !authResult.userId) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
  }

  const parsed = await parseRequest(
    embeddingsToolContract,
    request,
    {},
    {
      validationErrorResponse: (error) => {
        logger.warn('Invalid embeddings request', { issues: error.issues })
        return validationErrorResponse(
          error,
          getValidationErrorMessage(error, 'Invalid request data')
        )
      },
    }
  )
  if (!parsed.success) return parsed.response

  const { provider, apiKey, model, input, taskType, dimensions } = parsed.data.body
  const texts = normalizeInput(input)

  /**
   * The contract bounds the array arm, but a JSON-encoded array arrives as a
   * plain string and is only expanded here, after validation. Re-checking the
   * normalized list is what makes the bounds hold for the reference-expression
   * path too, rather than only for a native array body.
   */
  if (texts.length === 0) {
    return NextResponse.json(
      { success: false, error: 'input must contain at least one text' },
      { status: 400 }
    )
  }
  if (texts.length > MAX_EMBEDDING_INPUTS) {
    return NextResponse.json(
      {
        success: false,
        error: `input cannot exceed ${MAX_EMBEDDING_INPUTS} texts, received ${texts.length}`,
      },
      { status: 400 }
    )
  }
  /**
   * Summing lengths is cheap and runs before the per-entry whitespace scan, so
   * an oversized body is rejected without walking every character.
   */
  const totalChars = texts.reduce((sum, text) => sum + text.length, 0)
  if (totalChars > MAX_EMBEDDING_TOTAL_CHARS) {
    return NextResponse.json(
      {
        success: false,
        error: `Input is too large: ${totalChars} characters exceeds the ${MAX_EMBEDDING_TOTAL_CHARS} limit`,
      },
      { status: 400 }
    )
  }

  if (texts.some((text) => !/\S/.test(text))) {
    return NextResponse.json(
      { success: false, error: 'input entries cannot be empty' },
      { status: 400 }
    )
  }

  let resolvedModel: string
  let openRouterModelMetadata: OpenRouterEmbeddingModelMetadata | undefined
  if (provider === 'openrouter') {
    try {
      resolvedModel = normalizeOpenRouterEmbeddingModelId(
        model || DEFAULT_OPENROUTER_EMBEDDING_MODEL
      )
    } catch (error) {
      return NextResponse.json(
        { success: false, error: getErrorMessage(error, 'Invalid OpenRouter embedding model') },
        { status: 400 }
      )
    }
    try {
      openRouterModelMetadata = await getOpenRouterEmbeddingModelMetadata(resolvedModel)
    } catch (error) {
      const modelError = error instanceof OpenRouterEmbeddingModelNotFoundError
      return NextResponse.json(
        {
          success: false,
          error: getErrorMessage(
            error,
            modelError
              ? 'Unsupported OpenRouter embedding model'
              : 'Failed to load OpenRouter embedding model metadata'
          ),
        },
        { status: modelError ? 400 : 502 }
      )
    }
  } else {
    resolvedModel = model || DEFAULT_MODEL_BY_PROVIDER[provider]
  }

  if (provider !== 'openrouter') {
    const info = findEmbeddingModelInfo(resolvedModel)
    if (!info) {
      return NextResponse.json(
        { success: false, error: `Unsupported embedding model: ${resolvedModel}` },
        { status: 400 }
      )
    }
    if (info.provider !== provider) {
      return NextResponse.json(
        {
          success: false,
          error: `Model ${resolvedModel} belongs to ${info.provider}, not ${provider}`,
        },
        { status: 400 }
      )
    }

    /**
     * Resolved here as well as inside `embed()` so an unsupported `dimensions`
     * is reported as the client error it is. The block's dropdown constrains the
     * field, but a reference expression can put any value on the wire.
     */
    try {
      resolveDimensions(info, dimensions)
    } catch (error) {
      return NextResponse.json(
        { success: false, error: getErrorMessage(error, 'Invalid dimensions') },
        { status: 400 }
      )
    }
  }

  logger.info(`Embedding ${texts.length} input(s) with ${provider}/${resolvedModel}`)

  try {
    let result
    if (provider === 'openrouter') {
      if (!openRouterModelMetadata) {
        throw new Error('OpenRouter embedding model metadata was not resolved')
      }
      result = await embedOpenRouter(texts, {
        model: resolvedModel,
        dimensions,
        apiKey,
        maxInputTokens: openRouterModelMetadata.maxInputTokens,
        projectInputs: null,
      })
    } else {
      result = await embed(texts, {
        model: resolvedModel,
        taskType,
        dimensions,
        apiKey,
        /**
         * Callers reach this route through a tool whose `request.modelInput`
         * already projected `input` at the HTTP hop, so projecting again here
         * would run the substitution over already-projected content.
         */
        projectInputs: null,
      })
    }

    return NextResponse.json({
      success: true,
      embeddings: result.embeddings,
      model: result.modelName,
      provider,
      dimensions: result.dimensions,
      usage: {
        prompt_tokens: result.totalTokens,
        total_tokens: result.totalTokens,
      },
      __embeddingTokens: result.totalTokens,
    })
  } catch (error) {
    const message = getErrorMessage(error, 'Embedding generation failed')
    logger.error('Embedding generation failed', { error: message })
    return NextResponse.json({ success: false, error: message }, { status: 502 })
  }
})
