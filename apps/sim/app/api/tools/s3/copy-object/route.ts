import { CopyObjectCommand, type ObjectCannedACL, S3Client } from '@aws-sdk/client-s3'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkHybridAuth } from '@/lib/auth/hybrid'
import { createLogger } from '@/lib/logs/console/logger'
import { generateRequestId } from '@/lib/utils'

export const dynamic = 'force-dynamic'

const logger = createLogger('S3CopyObjectAPI')

const S3CopyObjectSchema = z.object({
  accessKeyId: z.string().min(1, 'Access Key ID is required'),
  secretAccessKey: z.string().min(1, 'Secret Access Key is required'),
  region: z.string().min(1, 'Region is required'),
  sourceBucket: z.string().min(1, 'Source bucket name is required'),
  sourceKey: z.string().min(1, 'Source object key is required'),
  destinationBucket: z.string().min(1, 'Destination bucket name is required'),
  destinationKey: z.string().min(1, 'Destination object key is required'),
  acl: z.string().optional().nullable(),
})

export async function POST(request: NextRequest) {
  const requestId = generateRequestId()

  try {
    const authResult = await checkHybridAuth(request, { requireWorkflowId: false })

    if (!authResult.success) {
      logger.warn(`[${requestId}] Unauthorized S3 copy object attempt: ${authResult.error}`)
      return NextResponse.json(
        {
          success: false,
          error: authResult.error || 'Authentication required',
        },
        { status: 401 }
      )
    }

    logger.info(`[${requestId}] Authenticated S3 copy object request via ${authResult.authType}`, {
      userId: authResult.userId,
    })

    const body = await request.json()
    const validatedData = S3CopyObjectSchema.parse(body)

    logger.info(`[${requestId}] Copying S3 object`, {
      source: `${validatedData.sourceBucket}/${validatedData.sourceKey}`,
      destination: `${validatedData.destinationBucket}/${validatedData.destinationKey}`,
    })

    // Initialize S3 client
    const s3Client = new S3Client({
      region: validatedData.region,
      credentials: {
        accessKeyId: validatedData.accessKeyId,
        secretAccessKey: validatedData.secretAccessKey,
      },
    })

    // Copy object (properly encode the source key for CopySource parameter)
    const encodedSourceKey = validatedData.sourceKey.split('/').map(encodeURIComponent).join('/')
    const copySource = `${validatedData.sourceBucket}/${encodedSourceKey}`
    const copyCommand = new CopyObjectCommand({
      Bucket: validatedData.destinationBucket,
      Key: validatedData.destinationKey,
      CopySource: copySource,
      ACL: validatedData.acl as ObjectCannedACL | undefined,
    })

    const result = await s3Client.send(copyCommand)

    logger.info(`[${requestId}] Object copied successfully`, {
      source: copySource,
      destination: `${validatedData.destinationBucket}/${validatedData.destinationKey}`,
      etag: result.CopyObjectResult?.ETag,
    })

    // Generate public URL for destination (properly encode the destination key)
    const encodedDestKey = validatedData.destinationKey.split('/').map(encodeURIComponent).join('/')
    const url = `https://${validatedData.destinationBucket}.s3.${validatedData.region}.amazonaws.com/${encodedDestKey}`

    return NextResponse.json({
      success: true,
      output: {
        url,
        copySourceVersionId: result.CopySourceVersionId,
        versionId: result.VersionId,
        etag: result.CopyObjectResult?.ETag,
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

    logger.error(`[${requestId}] Error copying S3 object:`, error)

    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Internal server error',
      },
      { status: 500 }
    )
  }
}
