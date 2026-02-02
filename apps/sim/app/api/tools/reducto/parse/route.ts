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

const logger = createLogger('ReductoParseAPI')

const ReductoParseSchema = z.object({
  apiKey: z.string().min(1, 'API key is required'),
  filePath: z.string().optional(),
  file: RawFileInputSchema.optional(),
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

    const fileInput = validatedData.file
    let fileUrl = ''
    if (fileInput) {
      logger.info(`[${requestId}] Reducto parse request`, {
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
      logger.info(`[${requestId}] Reducto parse request`, {
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
