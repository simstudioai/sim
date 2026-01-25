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

const logger = createLogger('SupabaseStorageUploadAPI')

const SupabaseStorageUploadSchema = z.object({
  apiKey: z.string().min(1, 'API key is required'),
  projectId: z.string().min(1, 'Project ID is required'),
  bucket: z.string().min(1, 'Bucket name is required'),
  fileName: z.string().min(1, 'File name is required'),
  path: z.string().optional().nullable(),
  fileUpload: z
    .object({
      name: z.string().optional(),
      type: z.string().optional(),
      url: z.string().optional(),
      path: z.string().optional(),
    })
    .optional()
    .nullable(),
  fileContent: z.string().optional().nullable(),
  contentType: z.string().optional().nullable(),
  upsert: z.boolean().optional().default(false),
})

/**
 * Detects if a string is base64 encoded and decodes it to a Buffer.
 * Handles both standard base64 and base64url encoding.
 */
function decodeBase64ToBuffer(content: string): Buffer {
  // Remove data URI prefix if present (e.g., "data:application/pdf;base64,")
  const base64Content = content.includes(',') ? content.split(',')[1] : content

  // Convert base64url to standard base64 if needed
  let normalizedBase64 = base64Content
  if (base64Content.includes('-') || base64Content.includes('_')) {
    normalizedBase64 = base64Content.replace(/-/g, '+').replace(/_/g, '/')
  }

  // Add padding if necessary
  const padding = normalizedBase64.length % 4
  if (padding > 0) {
    normalizedBase64 += '='.repeat(4 - padding)
  }

  return Buffer.from(normalizedBase64, 'base64')
}

/**
 * Checks if a string appears to be base64 encoded.
 */
function isBase64(str: string): boolean {
  // Remove data URI prefix if present
  const content = str.includes(',') ? str.split(',')[1] : str

  // Check if it matches base64 pattern (including base64url)
  const base64Regex = /^[A-Za-z0-9+/_-]*={0,2}$/
  if (!base64Regex.test(content)) {
    return false
  }

  // Additional heuristic: base64 strings are typically longer and don't contain spaces
  if (content.length < 4 || content.includes(' ')) {
    return false
  }

  // Try to decode and check if it produces valid bytes
  try {
    const decoded = decodeBase64ToBuffer(str)
    // If decoded length is significantly smaller than input, it's likely base64
    return decoded.length < content.length
  } catch {
    return false
  }
}

/**
 * Infer content type from file extension
 */
function inferContentType(fileName: string): string {
  const ext = fileName.split('.').pop()?.toLowerCase()
  const mimeTypes: Record<string, string> = {
    pdf: 'application/pdf',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    svg: 'image/svg+xml',
    txt: 'text/plain',
    html: 'text/html',
    css: 'text/css',
    js: 'application/javascript',
    json: 'application/json',
    xml: 'application/xml',
    zip: 'application/zip',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xls: 'application/vnd.ms-excel',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ppt: 'application/vnd.ms-powerpoint',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    mp3: 'audio/mpeg',
    mp4: 'video/mp4',
    wav: 'audio/wav',
    csv: 'text/csv',
  }
  return mimeTypes[ext || ''] || 'application/octet-stream'
}

export async function POST(request: NextRequest) {
  const requestId = generateRequestId()

  try {
    const authResult = await checkInternalAuth(request, { requireWorkflowId: false })

    if (!authResult.success || !authResult.userId) {
      logger.warn(
        `[${requestId}] Unauthorized Supabase storage upload attempt: ${authResult.error}`
      )
      return NextResponse.json(
        {
          success: false,
          error: authResult.error || 'Authentication required',
        },
        { status: 401 }
      )
    }

    const userId = authResult.userId

    logger.info(
      `[${requestId}] Authenticated Supabase storage upload request via ${authResult.authType}`,
      { userId }
    )

    const body = await request.json()
    const validatedData = SupabaseStorageUploadSchema.parse(body)

    // Build the full file path
    let fullPath = validatedData.fileName
    if (validatedData.path) {
      const folderPath = validatedData.path.endsWith('/')
        ? validatedData.path
        : `${validatedData.path}/`
      fullPath = `${folderPath}${validatedData.fileName}`
    }

    logger.info(`[${requestId}] Uploading to Supabase Storage`, {
      projectId: validatedData.projectId,
      bucket: validatedData.bucket,
      path: fullPath,
      upsert: validatedData.upsert,
      hasFileUpload: !!validatedData.fileUpload,
      hasFileContent: !!validatedData.fileContent,
    })

    // Determine content type
    let contentType = validatedData.contentType
    if (!contentType && validatedData.fileUpload?.type) {
      contentType = validatedData.fileUpload.type
    }
    if (!contentType) {
      contentType = inferContentType(validatedData.fileName)
    }

    // Get the file content - either from fileUpload (internal storage) or fileContent (base64)
    let uploadBody: Buffer

    if (validatedData.fileUpload) {
      // Handle file upload from internal storage
      const fileUrl = validatedData.fileUpload.url || validatedData.fileUpload.path

      if (!fileUrl) {
        return NextResponse.json(
          {
            success: false,
            error: 'File upload is missing URL or path',
          },
          { status: 400 }
        )
      }

      logger.info(`[${requestId}] Processing file upload from: ${fileUrl}`)

      // Check if it's an internal file URL (workspace file)
      if (isInternalFileUrl(fileUrl)) {
        try {
          const storageKey = extractStorageKey(fileUrl)
          const context = inferContextFromKey(storageKey)

          const hasAccess = await verifyFileAccess(storageKey, userId, undefined, context, false)

          if (!hasAccess) {
            logger.warn(`[${requestId}] Unauthorized file access attempt`, {
              userId,
              key: storageKey,
              context,
            })
            return NextResponse.json(
              {
                success: false,
                error: 'File not found or access denied',
              },
              { status: 404 }
            )
          }

          // Download file from internal storage
          const fileBuffer = await StorageService.downloadFile({ key: storageKey, context })
          uploadBody = Buffer.from(fileBuffer)
          logger.info(
            `[${requestId}] Downloaded file from internal storage: ${fileBuffer.byteLength} bytes`
          )
        } catch (error) {
          logger.error(`[${requestId}] Failed to download from internal storage:`, error)
          return NextResponse.json(
            {
              success: false,
              error: 'Failed to access uploaded file',
            },
            { status: 500 }
          )
        }
      } else {
        // External URL - fetch the file
        let fetchUrl = fileUrl
        if (fetchUrl.startsWith('/')) {
          const baseUrl = getBaseUrl()
          fetchUrl = `${baseUrl}${fetchUrl}`
        }

        try {
          const response = await fetch(fetchUrl)
          if (!response.ok) {
            throw new Error(`Failed to fetch file: ${response.status} ${response.statusText}`)
          }
          const arrayBuffer = await response.arrayBuffer()
          uploadBody = Buffer.from(arrayBuffer)
          logger.info(`[${requestId}] Downloaded file from URL: ${uploadBody.length} bytes`)
        } catch (error) {
          logger.error(`[${requestId}] Failed to fetch file from URL:`, error)
          return NextResponse.json(
            {
              success: false,
              error: `Failed to fetch file from URL: ${error instanceof Error ? error.message : 'Unknown error'}`,
            },
            { status: 500 }
          )
        }
      }
    } else if (validatedData.fileContent) {
      // Handle direct file content (base64 or plain text)
      if (isBase64(validatedData.fileContent)) {
        logger.info(`[${requestId}] Detected base64 content, decoding to binary`)
        uploadBody = decodeBase64ToBuffer(validatedData.fileContent)
      } else {
        logger.info(`[${requestId}] Using plain text content`)
        uploadBody = Buffer.from(validatedData.fileContent, 'utf-8')
      }
    } else {
      return NextResponse.json(
        {
          success: false,
          error: 'Either fileUpload or fileContent is required',
        },
        { status: 400 }
      )
    }

    logger.info(`[${requestId}] Upload body size: ${uploadBody.length} bytes`)

    // Build Supabase Storage URL
    const supabaseUrl = `https://${validatedData.projectId}.supabase.co/storage/v1/object/${validatedData.bucket}/${fullPath}`

    // Build headers
    const headers: Record<string, string> = {
      apikey: validatedData.apiKey,
      Authorization: `Bearer ${validatedData.apiKey}`,
      'Content-Type': contentType,
    }

    if (validatedData.upsert) {
      headers['x-upsert'] = 'true'
    }

    // Make the request to Supabase Storage
    // Convert Buffer to Uint8Array for fetch compatibility
    const response = await fetch(supabaseUrl, {
      method: 'POST',
      headers,
      body: new Uint8Array(uploadBody),
    })

    if (!response.ok) {
      let errorData: any
      try {
        errorData = await response.json()
      } catch {
        errorData = await response.text()
      }

      logger.error(`[${requestId}] Supabase Storage upload failed`, {
        status: response.status,
        statusText: response.statusText,
        error: errorData,
      })

      return NextResponse.json(
        {
          success: false,
          error:
            typeof errorData === 'object' && errorData.message
              ? errorData.message
              : `Upload failed: ${response.status} ${response.statusText}`,
        },
        { status: response.status }
      )
    }

    const result = await response.json()

    logger.info(`[${requestId}] File uploaded successfully to Supabase Storage`, {
      bucket: validatedData.bucket,
      path: fullPath,
    })

    // Build public URL for reference
    const publicUrl = `https://${validatedData.projectId}.supabase.co/storage/v1/object/public/${validatedData.bucket}/${fullPath}`

    return NextResponse.json({
      success: true,
      output: {
        message: 'Successfully uploaded file to storage',
        results: {
          ...result,
          publicUrl,
          bucket: validatedData.bucket,
          path: fullPath,
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

    logger.error(`[${requestId}] Error uploading to Supabase Storage:`, error)

    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Internal server error',
      },
      { status: 500 }
    )
  }
}
