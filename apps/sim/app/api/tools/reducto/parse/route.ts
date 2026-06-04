import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { reductoParseContract } from '@/lib/api/contracts/tools/media/document-parse'
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

const logger = createLogger('ReductoParseAPI')

export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()

  try {
    const authResult = await checkInternalAuth(request, { requireWorkflowId: false })

    if (!authResult.success || !authResult.userId) {
      logger.warn(`[${requestId}] Unauthorized Reducto parse attempt`, {
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
      reductoParseContract,
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

    logger.info(`[${requestId}] Reducto parse request`, {
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

    const reductoBody: Record<string, unknown> = {
      input: fileUrl,
    }

    if (validatedData.pages && validatedData.pages.length > 0) {
      // Reducto API expects page_range as an object with start/end, not an array
      const pages = validatedData.pages
      reductoBody.settings = {
        page_range: {
          start: Math.min(...pages),
          end: Math.max(...pages),
        },
      }
    }

    if (validatedData.tableOutputFormat) {
      reductoBody.formatting = {
        table_output_format: validatedData.tableOutputFormat,
      }
    }

    const reductoEndpoint = 'https://platform.reducto.ai/parse'
    const reductoValidation = await validateUrlWithDNS(reductoEndpoint, 'Reducto API URL')
    if (!reductoValidation.isValid) {
      logger.error(`[${requestId}] Reducto API URL validation failed`, {
        error: reductoValidation.error,
      })
      return NextResponse.json(
        {
          success: false,
          error: 'Failed to reach Reducto API',
        },
        { status: 502 }
      )
    }

    const reductoResponse = await secureFetchWithPinnedIP(
      reductoEndpoint,
      reductoValidation.resolvedIP!,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Authorization: `Bearer ${validatedData.apiKey}`,
        },
        body: JSON.stringify(reductoBody),
      }
    )

    if (!reductoResponse.ok) {
      const errorText = await reductoResponse.text()
      logger.error(`[${requestId}] Reducto API error:`, errorText)
      return NextResponse.json(
        {
          success: false,
          error: `Reducto API error: ${reductoResponse.statusText}`,
        },
        { status: reductoResponse.status }
      )
    }

    const reductoData = await reductoResponse.json()

    logger.info(`[${requestId}] Reducto parse successful`)

    return NextResponse.json({
      success: true,
      output: reductoData,
    })
  } catch (error) {
    logger.error(`[${requestId}] Error in Reducto parse:`, error)

    return NextResponse.json(
      {
        success: false,
        error: getErrorMessage(error, 'Internal server error'),
      },
      { status: 500 }
    )
  }
})
