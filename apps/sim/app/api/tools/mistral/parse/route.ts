import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import { getBaseUrl } from '@/lib/core/utils/urls'
import { StorageService } from '@/lib/uploads'
import { FileInputSchema } from '@/lib/uploads/utils/file-schemas'
import {
  extractStorageKey,
  inferContextFromKey,
  isInternalFileUrl,
} from '@/lib/uploads/utils/file-utils'
import { verifyFileAccess } from '@/app/api/files/authorization'

export const dynamic = 'force-dynamic'

const logger = createLogger('MistralParseAPI')

const MistralParseSchema = z.object({
  apiKey: z.string().min(1, 'API key is required'),
  filePath: z.string().min(1, 'File path is required').optional(),
  fileData: FileInputSchema.optional(),
  resultType: z.string().optional(),
  pages: z.array(z.number()).optional(),
  includeImageBase64: z.boolean().optional(),
  imageLimit: z.number().optional(),
  imageMinSize: z.number().optional(),
})

export async function POST(request: NextRequest) {
  const requestId = generateRequestId()

  try {
    const authResult = await checkInternalAuth(request, { requireWorkflowId: false })

    if (!authResult.success || !authResult.userId) {
      logger.warn(`[${requestId}] Unauthorized Mistral parse attempt`, {
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
    const validatedData = MistralParseSchema.parse(body)

    const fileData = validatedData.fileData
    const filePath = typeof fileData === 'string' ? fileData : validatedData.filePath

    if (!fileData && (!filePath || filePath.trim() === '')) {
      return NextResponse.json(
        {
          success: false,
          error: 'File input is required',
        },
        { status: 400 }
      )
    }

    logger.info(`[${requestId}] Mistral parse request`, {
      hasFileData: Boolean(fileData),
      filePath,
      isWorkspaceFile: filePath ? isInternalFileUrl(filePath) : false,
      userId,
    })

    const mistralBody: any = {
      model: 'mistral-ocr-latest',
    }

    if (fileData && typeof fileData === 'object') {
      const base64 = (fileData as { base64?: string }).base64
      const mimeType = (fileData as { type?: string }).type || 'application/pdf'
      if (!base64) {
        return NextResponse.json(
          {
            success: false,
            error: 'File base64 content is required',
          },
          { status: 400 }
        )
      }
      const base64Payload = base64.startsWith('data:')
        ? base64
        : `data:${mimeType};base64,${base64}`
      mistralBody.document = {
        type: 'document_base64',
        document_base64: base64Payload,
      }
    } else if (filePath) {
      let fileUrl = filePath

      if (isInternalFileUrl(filePath)) {
        try {
          const storageKey = extractStorageKey(filePath)

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
      } else if (filePath.startsWith('/')) {
        const baseUrl = getBaseUrl()
        fileUrl = `${baseUrl}${filePath}`
      }

      mistralBody.document = {
        type: 'document_url',
        document_url: fileUrl,
      }
    }

    if (validatedData.pages) {
      mistralBody.pages = validatedData.pages
    }
    if (validatedData.includeImageBase64 !== undefined) {
      mistralBody.include_image_base64 = validatedData.includeImageBase64
    }
    if (validatedData.imageLimit) {
      mistralBody.image_limit = validatedData.imageLimit
    }
    if (validatedData.imageMinSize) {
      mistralBody.image_min_size = validatedData.imageMinSize
    }

    const mistralResponse = await fetch('https://api.mistral.ai/v1/ocr', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Bearer ${validatedData.apiKey}`,
      },
      body: JSON.stringify(mistralBody),
    })

    if (!mistralResponse.ok) {
      const errorText = await mistralResponse.text()
      logger.error(`[${requestId}] Mistral API error:`, errorText)
      return NextResponse.json(
        {
          success: false,
          error: `Mistral API error: ${mistralResponse.statusText}`,
        },
        { status: mistralResponse.status }
      )
    }

    const mistralData = await mistralResponse.json()

    logger.info(`[${requestId}] Mistral parse successful`)

    return NextResponse.json({
      success: true,
      output: mistralData,
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

    logger.error(`[${requestId}] Error in Mistral parse:`, error)

    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Internal server error',
      },
      { status: 500 }
    )
  }
}
