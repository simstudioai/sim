import { type ObjectCannedACL, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkHybridAuth } from '@/lib/auth/hybrid'
import { createLogger } from '@/lib/logs/console/logger'
import { processSingleFileToUserFile } from '@/lib/uploads/utils/file-utils'
import { downloadFileFromStorage } from '@/lib/uploads/utils/file-utils.server'
import { generateRequestId } from '@/lib/utils'

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

    const s3Client = new S3Client({
      region: validatedData.region,
      credentials: {
        accessKeyId: validatedData.accessKeyId,
        secretAccessKey: validatedData.secretAccessKey,
      },
    })

    let uploadBody: Buffer | string
    let uploadContentType: string | undefined

    if (validatedData.file) {
      const rawFile = validatedData.file
      logger.info(`[${requestId}] Processing file upload: ${rawFile.name}`)

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

      const buffer = await downloadFileFromStorage(userFile, requestId, logger)

      uploadBody = buffer
      uploadContentType = validatedData.contentType || userFile.type || 'application/octet-stream'
    } else if (validatedData.content) {
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
