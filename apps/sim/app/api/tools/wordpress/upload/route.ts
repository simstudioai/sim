import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import { RawFileInputSchema } from '@/lib/uploads/utils/file-schemas'
import {
  getFileExtension,
  getMimeTypeFromExtension,
  processSingleFileToUserFile,
} from '@/lib/uploads/utils/file-utils'
import { downloadFileFromStorage } from '@/lib/uploads/utils/file-utils.server'

export const dynamic = 'force-dynamic'

const logger = createLogger('WordPressUploadAPI')

const WORDPRESS_COM_API_BASE = 'https://public-api.wordpress.com/wp/v2/sites'

const WordPressUploadSchema = z.object({
  accessToken: z.string().min(1, 'Access token is required'),
  siteId: z.string().min(1, 'Site ID is required'),
  file: RawFileInputSchema.optional().nullable(),
  filename: z.string().optional().nullable(),
  title: z.string().optional().nullable(),
  caption: z.string().optional().nullable(),
  altText: z.string().optional().nullable(),
  description: z.string().optional().nullable(),
})

export async function POST(request: NextRequest) {
  const requestId = generateRequestId()

  try {
    const authResult = await checkInternalAuth(request, { requireWorkflowId: false })

    if (!authResult.success) {
      logger.warn(`[${requestId}] Unauthorized WordPress upload attempt: ${authResult.error}`)
      return NextResponse.json(
        {
          success: false,
          error: authResult.error || 'Authentication required',
        },
        { status: 401 }
      )
    }

    logger.info(
      `[${requestId}] Authenticated WordPress upload request via ${authResult.authType}`,
      {
        userId: authResult.userId,
      }
    )

    const body = await request.json()
    const validatedData = WordPressUploadSchema.parse(body)

    logger.info(`[${requestId}] Uploading file to WordPress`, {
      siteId: validatedData.siteId,
      filename: validatedData.filename,
      hasFile: !!validatedData.file,
    })

    if (!validatedData.file) {
      return NextResponse.json(
        {
          success: false,
          error: 'No file provided. Please upload a file.',
        },
        { status: 400 }
      )
    }

    // Process file - convert to UserFile format if needed
    const fileData = validatedData.file

    let userFile
    try {
      userFile = processSingleFileToUserFile(fileData, requestId, logger)
    } catch (error) {
      return NextResponse.json(
        {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to process file',
        },
        { status: 400 }
      )
    }

    logger.info(`[${requestId}] Downloading file from storage`, {
      fileName: userFile.name,
      key: userFile.key,
      size: userFile.size,
    })

    let fileBuffer: Buffer

    try {
      fileBuffer = await downloadFileFromStorage(userFile, requestId, logger)
    } catch (error) {
      logger.error(`[${requestId}] Failed to download file:`, error)
      return NextResponse.json(
        {
          success: false,
          error: `Failed to download file: ${error instanceof Error ? error.message : 'Unknown error'}`,
        },
        { status: 500 }
      )
    }

    // Use provided filename or fall back to the original file name
    const filename = validatedData.filename || userFile.name
    const mimeType = userFile.type || getMimeTypeFromExtension(getFileExtension(filename))

    logger.info(`[${requestId}] Uploading to WordPress`, {
      siteId: validatedData.siteId,
      filename,
      mimeType,
      size: fileBuffer.length,
    })

    // Upload to WordPress using multipart form data
    const formData = new FormData()
    // Convert Buffer to Uint8Array for Blob compatibility
    const uint8Array = new Uint8Array(fileBuffer)
    const blob = new Blob([uint8Array], { type: mimeType })
    formData.append('file', blob, filename)

    // Add optional metadata
    if (validatedData.title) {
      formData.append('title', validatedData.title)
    }
    if (validatedData.caption) {
      formData.append('caption', validatedData.caption)
    }
    if (validatedData.altText) {
      formData.append('alt_text', validatedData.altText)
    }
    if (validatedData.description) {
      formData.append('description', validatedData.description)
    }

    const uploadResponse = await fetch(`${WORDPRESS_COM_API_BASE}/${validatedData.siteId}/media`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${validatedData.accessToken}`,
      },
      body: formData,
    })

    if (!uploadResponse.ok) {
      const errorText = await uploadResponse.text()
      let errorMessage = `WordPress API error: ${uploadResponse.statusText}`

      try {
        const errorJson = JSON.parse(errorText)
        errorMessage = errorJson.message || errorJson.error || errorMessage
      } catch {
        // Use default error message
      }

      logger.error(`[${requestId}] WordPress API error:`, {
        status: uploadResponse.status,
        statusText: uploadResponse.statusText,
        error: errorText,
      })
      return NextResponse.json(
        {
          success: false,
          error: errorMessage,
        },
        { status: uploadResponse.status }
      )
    }

    const uploadData = await uploadResponse.json()

    logger.info(`[${requestId}] File uploaded successfully`, {
      mediaId: uploadData.id,
      sourceUrl: uploadData.source_url,
    })

    return NextResponse.json({
      success: true,
      output: {
        media: {
          id: uploadData.id,
          date: uploadData.date,
          slug: uploadData.slug,
          type: uploadData.type,
          link: uploadData.link,
          title: uploadData.title,
          caption: uploadData.caption,
          alt_text: uploadData.alt_text,
          media_type: uploadData.media_type,
          mime_type: uploadData.mime_type,
          source_url: uploadData.source_url,
          media_details: uploadData.media_details,
        },
      },
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

    logger.error(`[${requestId}] Error uploading file to WordPress:`, error)

    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Internal server error',
      },
      { status: 500 }
    )
  }
}
