import { ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { awsS3ListObjectsContract } from '@/lib/api/contracts/tools/aws/s3-list-objects'
import { parseToolRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

export const dynamic = 'force-dynamic'

const logger = createLogger('S3ListObjectsAPI')

export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()

  try {
    const authResult = await checkInternalAuth(request, { requireWorkflowId: false })

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

    const parsed = await parseToolRequest(awsS3ListObjectsContract, request, {
      errorFormat: 'details',
      logger,
    })
    if (!parsed.success) return parsed.response
    const validatedData = parsed.data.body

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
    logger.error(`[${requestId}] Error listing S3 objects:`, error)

    return NextResponse.json(
      {
        success: false,
        error: getErrorMessage(error, 'Internal server error'),
      },
      { status: 500 }
    )
  }
})
