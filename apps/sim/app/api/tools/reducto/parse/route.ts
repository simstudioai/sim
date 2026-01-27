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

const logger = createLogger('ReductoParseAPI')

const ReductoParseSchema = z.object({
  apiKey: z.string().min(1, 'API key is required'),
  filePath: z.string().min(1, 'File path is required'),
  pages: z.array(z.number()).optional(),
  tableOutputFormat: z.enum(['html', 'md']).optional(),
})

export async function POST(request: NextRequest) {
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
    const body = await request.json()
    const validatedData = ReductoParseSchema.parse(body)

    logger.info(`[${requestId}] Reducto parse request`, {
      filePath: validatedData.filePath,
      isWorkspaceFile: isInternalFileUrl(validatedData.filePath),
      userId,
    })

    let fileUrl = validatedData.filePath

    if (isInternalFileUrl(validatedData.filePath)) {
      try {
        const storageKey = extractStorageKey(validatedData.filePath)
        const context = inferContextFromKey(storageKey)

        const hasAccess = await verifyFileAccess(
          storageKey,
          userId,
          undefined, // customConfig
          context, // context
          false // isLocal
        )

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

    const reductoBody: Record<string, unknown> = {
      input: fileUrl,
    }

    if (validatedData.pages && validatedData.pages.length > 0) {
      reductoBody.settings = {
        page_range: validatedData.pages,
      }
    }

    if (validatedData.tableOutputFormat) {
      reductoBody.formatting = {
        table_output_format: validatedData.tableOutputFormat,
      }
    }

    const reductoResponse = await fetch('https://platform.reducto.ai/parse', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Bearer ${validatedData.apiKey}`,
      },
      body: JSON.stringify(reductoBody),
    })

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

    logger.error(`[${requestId}] Error in Reducto parse:`, error)

    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Internal server error',
      },
      { status: 500 }
    )
  }
}
