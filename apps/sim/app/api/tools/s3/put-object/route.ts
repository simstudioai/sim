import { type ObjectCannedACL, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkHybridAuth } from '@/lib/auth/hybrid'
import { createLogger } from '@/lib/logs/console/logger'
import { extractStorageKey } from '@/lib/uploads/file-utils'
import { downloadFile } from '@/lib/uploads/storage-client'
import { generateRequestId } from '@/lib/utils'
import { downloadExecutionFile } from '@/lib/workflows/execution-file-storage'
import { isExecutionFile } from '@/lib/workflows/execution-files'

export const dynamic = 'force-dynamic'

const logger = createLogger('S3PutObjectAPI')

const S3PutObjectSchema = z.object({
  accessKeyId: z.string().min(1, 'Access Key ID is required'),
  secretAccessKey: z.string().min(1, 'Secret Access Key is required'),
  region: z.string().min(1, 'Region is required'),
  bucketName: z.string().min(1, 'Bucket name is required'),
  objectKey: z.string().min(1, 'Object key is required'),
  file: z.any().optional().nullable(),
  content: z.string().optional().nullable(),
  contentType: z.string().optional().nullable(),
  acl: z.string().optional().nullable(),
})

export async function POST(request: NextRequest) {
  const requestId = generateRequestId()

  try {
    const authResult = await checkHybridAuth(request, { requireWorkflowId: false })

    if (!authResult.success) {
      logger.warn(`[${requestId}] Unauthorized S3 put object attempt: ${authResult.error}`)
      return NextResponse.json(
        {
          success: false,
          error: authResult.error || 'Authentication required',
        },
        { status: 401 }
      )
    }

    logger.info(`[${requestId}] Authenticated S3 put object request via ${authResult.authType}`, {
      userId: authResult.userId,
    })

    const body = await request.json()
    const validatedData = S3PutObjectSchema.parse(body)

    logger.info(`[${requestId}] Uploading to S3`, {
      bucket: validatedData.bucketName,
      key: validatedData.objectKey,
      hasFile: !!validatedData.file,
      hasContent: !!validatedData.content,
    })

    // Initialize S3 client
    const s3Client = new S3Client({
      region: validatedData.region,
      credentials: {
        accessKeyId: validatedData.accessKeyId,
        secretAccessKey: validatedData.secretAccessKey,
      },
    })

    let uploadBody: Buffer | string
    let uploadContentType: string | undefined

    // Determine upload source (file or content)
    if (validatedData.file) {
      const file = validatedData.file
      logger.info(`[${requestId}] Processing file upload: ${file.name}`)

      // Extract storage key
      const storageKey = file.key || (file.path ? extractStorageKey(file.path) : null)

      if (!storageKey) {
        return NextResponse.json(
          {
            success: false,
            error: 'File has no storage key',
          },
          { status: 400 }
        )
      }

      // Download file from storage
      let buffer: Buffer
      if (isExecutionFile(file)) {
        logger.info(`[${requestId}] Downloading from execution storage: ${storageKey}`)
        buffer = await downloadExecutionFile(file)
      } else {
        logger.info(`[${requestId}] Downloading from regular storage: ${storageKey}`)
        buffer = await downloadFile(storageKey)
      }

      uploadBody = buffer
      uploadContentType = validatedData.contentType || file.type || 'application/octet-stream'
    } else if (validatedData.content) {
      // Upload text content
      uploadBody = Buffer.from(validatedData.content, 'utf-8')
      uploadContentType = validatedData.contentType || 'text/plain'
    } else {
      return NextResponse.json(
        {
          success: false,
          error: 'Either file or content must be provided',
        },
        { status: 400 }
      )
    }

    // Upload to S3
    const putCommand = new PutObjectCommand({
      Bucket: validatedData.bucketName,
      Key: validatedData.objectKey,
      Body: uploadBody,
      ContentType: uploadContentType,
      ACL: validatedData.acl as ObjectCannedACL | undefined,
    })

    const result = await s3Client.send(putCommand)

    logger.info(`[${requestId}] File uploaded successfully`, {
      etag: result.ETag,
      bucket: validatedData.bucketName,
      key: validatedData.objectKey,
    })

    // Generate public URL (properly encode the object key)
    const encodedKey = validatedData.objectKey.split('/').map(encodeURIComponent).join('/')
    const url = `https://${validatedData.bucketName}.s3.${validatedData.region}.amazonaws.com/${encodedKey}`

    return NextResponse.json({
      success: true,
      output: {
        url,
        etag: result.ETag,
        location: url,
        key: validatedData.objectKey,
        bucket: validatedData.bucketName,
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

    logger.error(`[${requestId}] Error uploading to S3:`, error)

    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Internal server error',
      },
      { status: 500 }
    )
  }
}
