import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import {
  secureFetchWithPinnedIP,
  validateUrlWithDNS,
} from '@/lib/core/security/input-validation.server'
import { generateRequestId } from '@/lib/core/utils/request'
import { type StorageContext, StorageService } from '@/lib/uploads'
import { RawFileInputSchema } from '@/lib/uploads/utils/file-schemas'
import {
  inferContextFromKey,
  isInternalFileUrl,
  processSingleFileToUserFile,
} from '@/lib/uploads/utils/file-utils'
import { resolveInternalFileUrl } from '@/lib/uploads/utils/file-utils.server'
import { verifyFileAccess } from '@/app/api/files/authorization'

export const dynamic = 'force-dynamic'

const logger = createLogger('PulseParseAPI')

const PulseParseSchema = z.object({
  apiKey: z.string().min(1, 'API key is required'),
  filePath: z.string().optional(),
  file: RawFileInputSchema.optional(),
  pages: z.string().optional(),
  extractFigure: z.boolean().optional(),
  figureDescription: z.boolean().optional(),
  returnHtml: z.boolean().optional(),
  chunking: z.string().optional(),
  chunkSize: z.number().optional(),
})

export async function POST(request: NextRequest) {
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
    const body = await request.json()
    const validatedData = PulseParseSchema.parse(body)

    const fileInput = validatedData.file
    let fileUrl = ''
    if (fileInput) {
      logger.info(`[${requestId}] Pulse parse request`, {
        fileName: fileInput.name,
        userId,
      })

      let userFile
      try {
        userFile = processSingleFileToUserFile(fileInput, requestId, logger)
      } catch (error) {
        return NextResponse.json(
          {
            success: false,
            error: error instanceof Error ? error.message : 'Failed to process file',
          },
          { status: 400 }
        )
      }

      fileUrl = userFile.url || ''
      if (fileUrl && isInternalFileUrl(fileUrl)) {
        const resolution = await resolveInternalFileUrl(fileUrl, userId, requestId, logger)
        if (resolution.error) {
          return NextResponse.json(
            {
              success: false,
              error: resolution.error.message,
            },
            { status: resolution.error.status }
          )
        }
        fileUrl = resolution.fileUrl || ''
      }
      if (!fileUrl && userFile.key) {
        const context = (userFile.context as StorageContext) || inferContextFromKey(userFile.key)
        const hasAccess = await verifyFileAccess(userFile.key, userId, undefined, context, false)
        if (!hasAccess) {
          logger.warn(`[${requestId}] Unauthorized presigned URL generation attempt`, {
            userId,
            key: userFile.key,
            context,
          })
          return NextResponse.json(
            {
              success: false,
              error: 'File not found',
            },
            { status: 404 }
          )
        }
        fileUrl = await StorageService.generatePresignedDownloadUrl(userFile.key, context, 5 * 60)
      }
    } else if (validatedData.filePath) {
      logger.info(`[${requestId}] Pulse parse request`, {
        filePath: validatedData.filePath,
        isWorkspaceFile: isInternalFileUrl(validatedData.filePath),
        userId,
      })

      fileUrl = validatedData.filePath
      const isInternalFilePath = isInternalFileUrl(validatedData.filePath)
      if (isInternalFilePath) {
        const resolution = await resolveInternalFileUrl(
          validatedData.filePath,
          userId,
          requestId,
          logger
        )
        if (resolution.error) {
          return NextResponse.json(
            {
              success: false,
              error: resolution.error.message,
            },
            { status: resolution.error.status }
          )
        }
        fileUrl = resolution.fileUrl || fileUrl
      } else if (validatedData.filePath.startsWith('/')) {
        logger.warn(`[${requestId}] Invalid internal path`, {
          userId,
          path: validatedData.filePath.substring(0, 50),
        })
        return NextResponse.json(
          {
            success: false,
            error: 'Invalid file path. Only uploaded files are supported for internal paths.',
          },
          { status: 400 }
        )
      } else {
        const urlValidation = await validateUrlWithDNS(fileUrl, 'filePath')
        if (!urlValidation.isValid) {
          return NextResponse.json(
            {
              success: false,
              error: urlValidation.error,
            },
            { status: 400 }
          )
        }
      }
    }

    if (!fileUrl) {
      return NextResponse.json(
        {
          success: false,
          error: 'File input is required',
        },
        { status: 400 }
      )
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
    if (error instanceof z.ZodError) {
      logger.warn(`[${requestId}] Invalid request data`, { errors: error.errors })
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid request data',
          details: error.errors,
        },
        { status: 400 }
      )
    }

    logger.error(`[${requestId}] Error in Pulse parse:`, error)

    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Internal server error',
      },
      { status: 500 }
    )
  }
}
