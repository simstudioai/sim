import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import {
  secureFetchWithPinnedIP,
  validateUrlWithDNS,
} from '@/lib/core/security/input-validation.server'
import { generateRequestId } from '@/lib/core/utils/request'
import { FileInputSchema } from '@/lib/uploads/utils/file-schemas'
import { isInternalFileUrl, processSingleFileToUserFile } from '@/lib/uploads/utils/file-utils'
import {
  downloadFileFromStorage,
  resolveInternalFileUrl,
} from '@/lib/uploads/utils/file-utils.server'

export const dynamic = 'force-dynamic'

const logger = createLogger('MistralParseAPI')

const MistralParseSchema = z.object({
  apiKey: z.string().min(1, 'API key is required'),
  filePath: z.string().min(1, 'File path is required').optional(),
  fileData: FileInputSchema.optional(),
  file: FileInputSchema.optional(),
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

    const fileData = validatedData.file || validatedData.fileData
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
      const rawFile = fileData
      let userFile
      try {
        userFile = processSingleFileToUserFile(rawFile, requestId, logger)
      } catch (error) {
        return NextResponse.json(
          {
            success: false,
            error: error instanceof Error ? error.message : 'Failed to process file',
          },
          { status: 400 }
        )
      }

      let mimeType = userFile.type
      if (!mimeType || mimeType === 'application/octet-stream') {
        const filename = userFile.name?.toLowerCase() || ''
        if (filename.endsWith('.pdf')) {
          mimeType = 'application/pdf'
        } else if (filename.endsWith('.png')) {
          mimeType = 'image/png'
        } else if (filename.endsWith('.jpg') || filename.endsWith('.jpeg')) {
          mimeType = 'image/jpeg'
        } else if (filename.endsWith('.gif')) {
          mimeType = 'image/gif'
        } else if (filename.endsWith('.webp')) {
          mimeType = 'image/webp'
        } else {
          mimeType = 'application/pdf'
        }
      }
      let base64 = userFile.base64
      if (!base64) {
        const buffer = await downloadFileFromStorage(userFile, requestId, logger)
        base64 = buffer.toString('base64')
      }
      const base64Payload = base64.startsWith('data:')
        ? base64
        : `data:${mimeType};base64,${base64}`

      // Mistral API uses different document types for images vs documents
      const isImage = mimeType.startsWith('image/')
      if (isImage) {
        mistralBody.document = {
          type: 'image_url',
          image_url: base64Payload,
        }
      } else {
        mistralBody.document = {
          type: 'document_url',
          document_url: base64Payload,
        }
      }
    } else if (filePath) {
      let fileUrl = filePath

      const isInternalFilePath = isInternalFileUrl(filePath)
      if (isInternalFilePath) {
        const resolution = await resolveInternalFileUrl(filePath, userId, requestId, logger)
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
      } else if (filePath.startsWith('/')) {
        logger.warn(`[${requestId}] Invalid internal path`, {
          userId,
          path: filePath.substring(0, 50),
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

      const imageExtensions = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif']
      const pathname = new URL(fileUrl).pathname.toLowerCase()
      const isImageUrl = imageExtensions.some((ext) => pathname.endsWith(ext))

      if (isImageUrl) {
        mistralBody.document = {
          type: 'image_url',
          image_url: fileUrl,
        }
      } else {
        mistralBody.document = {
          type: 'document_url',
          document_url: fileUrl,
        }
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

    const mistralEndpoint = 'https://api.mistral.ai/v1/ocr'
    const mistralValidation = await validateUrlWithDNS(mistralEndpoint, 'Mistral API URL')
    if (!mistralValidation.isValid) {
      logger.error(`[${requestId}] Mistral API URL validation failed`, {
        error: mistralValidation.error,
      })
      return NextResponse.json(
        {
          success: false,
          error: 'Failed to reach Mistral API',
        },
        { status: 502 }
      )
    }

    const mistralResponse = await secureFetchWithPinnedIP(
      mistralEndpoint,
      mistralValidation.resolvedIP!,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Authorization: `Bearer ${validatedData.apiKey}`,
        },
        body: JSON.stringify(mistralBody),
      }
    )

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
