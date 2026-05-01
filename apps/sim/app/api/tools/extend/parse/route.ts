import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { extendParseContract } from '@/lib/api/contracts/tools/media/document-parse'
import { getValidationErrorMessage, parseRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import {
  secureFetchWithPinnedIP,
  validateUrlWithDNS,
} from '@/lib/core/security/input-validation.server'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { isInternalFileUrl } from '@/lib/uploads/utils/file-utils'
import { resolveFileInputToUrl } from '@/lib/uploads/utils/file-utils.server'

export const dynamic = 'force-dynamic'

const logger = createLogger('ExtendParseAPI')

export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()

  try {
    const authResult = await checkInternalAuth(request, { requireWorkflowId: false })

    if (!authResult.success || !authResult.userId) {
      logger.warn(`[${requestId}] Unauthorized Extend parse attempt`, {
        error: authResult.error || 'Missing userId',
      })
      return NextResponse.json(
        {
          success: false,
          error: authResult.error || 'Unauthorized',
        },
        { status: 401 }
      )
    }

    const userId = authResult.userId

    const parsed = await parseRequest(
      extendParseContract,
      request,
      {},
      {
        validationErrorResponse: (error) => {
          logger.warn(`[${requestId}] Invalid request data`, { errors: error.issues })
          return NextResponse.json(
            {
              success: false,
              error: getValidationErrorMessage(error, 'Invalid request data'),
              details: error.issues,
            },
            { status: 400 }
          )
        },
      }
    )
    if (!parsed.success) return parsed.response

    const validatedData = parsed.data.body

    logger.info(`[${requestId}] Extend parse request`, {
      fileName: validatedData.file?.name,
      filePath: validatedData.filePath,
      isWorkspaceFile: validatedData.filePath ? isInternalFileUrl(validatedData.filePath) : false,
      userId,
    })

    const resolution = await resolveFileInputToUrl({
      file: validatedData.file,
      filePath: validatedData.filePath,
      userId,
      requestId,
      logger,
    })

    if (resolution.error) {
      return NextResponse.json(
        { success: false, error: resolution.error.message },
        { status: resolution.error.status }
      )
    }

    const fileUrl = resolution.fileUrl
    if (!fileUrl) {
      return NextResponse.json({ success: false, error: 'File input is required' }, { status: 400 })
    }

    const extendBody: Record<string, unknown> = {
      file: { fileUrl },
    }

    const config: Record<string, unknown> = {}

    if (validatedData.outputFormat) {
      config.target = validatedData.outputFormat
    }

    if (validatedData.chunking) {
      config.chunkingStrategy = { type: validatedData.chunking }
    }

    if (validatedData.engine) {
      config.engine = validatedData.engine
    }

    if (Object.keys(config).length > 0) {
      extendBody.config = config
    }

    const extendEndpoint = 'https://api.extend.ai/parse'
    const extendValidation = await validateUrlWithDNS(extendEndpoint, 'Extend API URL')
    if (!extendValidation.isValid) {
      logger.error(`[${requestId}] Extend API URL validation failed`, {
        error: extendValidation.error,
      })
      return NextResponse.json(
        {
          success: false,
          error: 'Failed to reach Extend API',
        },
        { status: 502 }
      )
    }

    const extendResponse = await secureFetchWithPinnedIP(
      extendEndpoint,
      extendValidation.resolvedIP!,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Authorization: `Bearer ${validatedData.apiKey}`,
          'x-extend-api-version': '2025-04-21',
        },
        body: JSON.stringify(extendBody),
      }
    )

    if (!extendResponse.ok) {
      const errorText = await extendResponse.text()
      logger.error(`[${requestId}] Extend API error:`, errorText)
      let clientError = `Extend API error: ${extendResponse.statusText || extendResponse.status}`
      try {
        const parsedError = JSON.parse(errorText)
        if (parsedError?.message || parsedError?.error) {
          clientError = (parsedError.message ?? parsedError.error) as string
        }
      } catch {
        // errorText is not JSON; keep generic message
      }
      return NextResponse.json(
        {
          success: false,
          error: clientError,
        },
        { status: extendResponse.status }
      )
    }

    const extendData = (await extendResponse.json()) as Record<string, unknown>

    logger.info(`[${requestId}] Extend parse successful`)

    return NextResponse.json({
      success: true,
      output: {
        id: extendData.id ?? null,
        status: extendData.status ?? 'PROCESSED',
        chunks: extendData.chunks ?? [],
        blocks: extendData.blocks ?? [],
        pageCount: extendData.pageCount ?? extendData.page_count ?? null,
        creditsUsed: extendData.creditsUsed ?? extendData.credits_used ?? null,
      },
    })
  } catch (error) {
    logger.error(`[${requestId}] Error in Extend parse:`, error)

    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Internal server error',
      },
      { status: 500 }
    )
  }
})
