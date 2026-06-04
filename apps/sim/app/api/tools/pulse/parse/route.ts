import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { pulseParseContract } from '@/lib/api/contracts/tools/media/document-parse'
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

const logger = createLogger('PulseParseAPI')

export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()

  try {
    const authResult = await checkInternalAuth(request, { requireWorkflowId: false })

    if (!authResult.success || !authResult.userId) {
      logger.warn(`[${requestId}] Unauthorized Pulse parse attempt`, {
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
      pulseParseContract,
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

    logger.info(`[${requestId}] Pulse parse request`, {
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

    const formData = new FormData()
    formData.append('file_url', fileUrl)

    if (validatedData.pages) {
      formData.append('pages', validatedData.pages)
    }
    if (validatedData.extractFigure !== undefined) {
      formData.append('extract_figure', String(validatedData.extractFigure))
    }
    if (validatedData.figureDescription !== undefined) {
      formData.append('figure_description', String(validatedData.figureDescription))
    }
    if (validatedData.returnHtml !== undefined) {
      formData.append('return_html', String(validatedData.returnHtml))
    }
    if (validatedData.chunking) {
      formData.append('chunking', validatedData.chunking)
    }
    if (validatedData.chunkSize !== undefined) {
      formData.append('chunk_size', String(validatedData.chunkSize))
    }

    const pulseEndpoint = 'https://api.runpulse.com/extract'
    const pulseValidation = await validateUrlWithDNS(pulseEndpoint, 'Pulse API URL')
    if (!pulseValidation.isValid) {
      logger.error(`[${requestId}] Pulse API URL validation failed`, {
        error: pulseValidation.error,
      })
      return NextResponse.json(
        {
          success: false,
          error: 'Failed to reach Pulse API',
        },
        { status: 502 }
      )
    }

    const pulsePayload = new Response(formData)
    const contentType = pulsePayload.headers.get('content-type') || 'multipart/form-data'
    const bodyBuffer = Buffer.from(await pulsePayload.arrayBuffer())
    const pulseResponse = await secureFetchWithPinnedIP(
      pulseEndpoint,
      pulseValidation.resolvedIP!,
      {
        method: 'POST',
        headers: {
          'x-api-key': validatedData.apiKey,
          'Content-Type': contentType,
        },
        body: bodyBuffer,
      }
    )

    if (!pulseResponse.ok) {
      const errorText = await pulseResponse.text()
      logger.error(`[${requestId}] Pulse API error:`, errorText)
      return NextResponse.json(
        {
          success: false,
          error: `Pulse API error: ${pulseResponse.statusText}`,
        },
        { status: pulseResponse.status }
      )
    }

    const pulseData = await pulseResponse.json()

    logger.info(`[${requestId}] Pulse parse successful`)

    return NextResponse.json({
      success: true,
      output: pulseData,
    })
  } catch (error) {
    logger.error(`[${requestId}] Error in Pulse parse:`, error)

    return NextResponse.json(
      {
        success: false,
        error: getErrorMessage(error, 'Internal server error'),
      },
      { status: 500 }
    )
  }
})
