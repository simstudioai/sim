import { ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkHybridAuth } from '@/lib/auth/hybrid'
import { createLogger } from '@/lib/logs/console/logger'
import { generateRequestId } from '@/lib/utils'

export const dynamic = 'force-dynamic'

const logger = createLogger('S3ListObjectsAPI')

const S3ListObjectsSchema = z.object({
  accessKeyId: z.string().min(1, 'Access Key ID is required'),
  secretAccessKey: z.string().min(1, 'Secret Access Key is required'),
  region: z.string().min(1, 'Region is required'),
  bucketName: z.string().min(1, 'Bucket name is required'),
  prefix: z.string().optional().nullable(),
  maxKeys: z.number().optional().nullable(),
  continuationToken: z.string().optional().nullable(),
})

export async function POST(request: NextRequest) {
  const requestId = generateRequestId()

  try {
    const authResult = await checkHybridAuth(request, { requireWorkflowId: false })

    if (!authResult.success) {
      logger.warn(`[${requestId}] Unauthorized S3 list objects attempt: ${authResult.error}`)
      return NextResponse.json(
        {
          success: false,
          error: authResult.error || 'Authentication required',
        },
        { status: 401 }
      )
    }

    logger.info(`[${requestId}] Authenticated S3 list objects request via ${authResult.authType}`, {
      userId: authResult.userId,
    })

    const body = await request.json()
    const validatedData = S3ListObjectsSchema.parse(body)

    logger.info(`[${requestId}] Listing S3 objects`, {
      bucket: validatedData.bucketName,
      prefix: validatedData.prefix || '(none)',
      maxKeys: validatedData.maxKeys || 1000,
    })

    // Initialize S3 client
    const s3Client = new S3Client({
      region: validatedData.region,
      credentials: {
        accessKeyId: validatedData.accessKeyId,
        secretAccessKey: validatedData.secretAccessKey,
      },
    })

    // List objects
    const listCommand = new ListObjectsV2Command({
      Bucket: validatedData.bucketName,
      Prefix: validatedData.prefix || undefined,
      MaxKeys: validatedData.maxKeys || undefined,
      ContinuationToken: validatedData.continuationToken || undefined,
    })

    const result = await s3Client.send(listCommand)

    const objects = (result.Contents || []).map((obj) => ({
      key: obj.Key || '',
      size: obj.Size || 0,
      lastModified: obj.LastModified?.toISOString() || '',
      etag: obj.ETag || '',
    }))

    logger.info(`[${requestId}] Listed ${objects.length} objects`, {
      bucket: validatedData.bucketName,
      isTruncated: result.IsTruncated,
    })

    return NextResponse.json({
      success: true,
      output: {
        objects,
        isTruncated: result.IsTruncated,
        nextContinuationToken: result.NextContinuationToken,
        keyCount: result.KeyCount,
        prefix: validatedData.prefix,
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

    logger.error(`[${requestId}] Error listing S3 objects:`, error)

    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Internal server error',
      },
      { status: 500 }
    )
  }
}
