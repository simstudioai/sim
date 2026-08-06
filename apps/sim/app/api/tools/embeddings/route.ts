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
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import {
  embed,
  findEmbeddingModelInfo,
  getModelsForProvider,
  resolveDimensions,
} from '@/lib/embeddings'

const logger = createLogger('EmbeddingsToolAPI')

export const dynamic = 'force-dynamic'

/** Accepts a single string, an array, or a JSON-encoded array from a reference expression. */
function normalizeInput(input: string | string[]): string[] {
  if (Array.isArray(input)) return input
  const trimmed = input.trim()
  if (trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed)
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
  const requestId = generateRequestId()

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
        logger.warn(`[${requestId}] Invalid embeddings request:`, error.issues)
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
  if (texts.some((text) => text.trim().length === 0)) {
    return NextResponse.json(
      { success: false, error: 'input entries cannot be empty' },
      { status: 400 }
    )
  }

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

  const resolvedModel = model || getModelsForProvider(provider)[0]
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

  logger.info(`[${requestId}] Embedding ${texts.length} input(s) with ${provider}/${resolvedModel}`)

  try {
    const result = await embed(texts, {
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
    logger.error(`[${requestId}] Embedding generation failed`, { error: message })
    return NextResponse.json({ success: false, error: message }, { status: 502 })
  }
})
