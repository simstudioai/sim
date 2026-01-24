import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import { getBaseUrl } from '@/lib/core/utils/urls'
import { StorageService } from '@/lib/uploads'
import {
  extractStorageKey,
  inferContextFromKey,
  isInternalFileUrl,
} from '@/lib/uploads/utils/file-utils'
import { verifyFileAccess } from '@/app/api/files/authorization'

export const dynamic = 'force-dynamic'

const logger = createLogger('PulseParseAPI')

const PulseParseSchema = z.object({
  apiKey: z.string().min(1, 'API key is required'),
  filePath: z.string().min(1, 'File path is required'),
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

    logger.info(`[${requestId}] Pulse parse request`, {
      filePath: validatedData.filePath,
      isWorkspaceFile: isInternalFileUrl(validatedData.filePath),
      userId,
    })

    let fileUrl = validatedData.filePath

    if (isInternalFileUrl(validatedData.filePath)) {
      try {
        const storageKey = extractStorageKey(validatedData.filePath)
        const context = inferContextFromKey(storageKey)

        const hasAccess = await verifyFileAccess(storageKey, userId, undefined, context, false)

        if (!hasAccess) {
          logger.warn(`[${requestId}] Unauthorized presigned URL generation attempt`, {
            userId,
            key: storageKey,
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

        fileUrl = await StorageService.generatePresignedDownloadUrl(storageKey, context, 5 * 60)
        logger.info(`[${requestId}] Generated presigned URL for ${context} file`)
      } catch (error) {
        logger.error(`[${requestId}] Failed to generate presigned URL:`, error)
        return NextResponse.json(
          {
            success: false,
            error: 'Failed to generate file access URL',
          },
          { status: 500 }
        )
      }
    } else if (validatedData.filePath?.startsWith('/')) {
      const baseUrl = getBaseUrl()
      fileUrl = `${baseUrl}${validatedData.filePath}`
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

    const pulseResponse = await fetch('https://api.runpulse.com/extract', {
      method: 'POST',
      headers: {
        'x-api-key': validatedData.apiKey,
      },
      body: formData,
    })

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
