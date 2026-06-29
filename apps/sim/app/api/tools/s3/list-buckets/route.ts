import { ListBucketsCommand, S3Client } from '@aws-sdk/client-s3'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { awsS3ListBucketsContract } from '@/lib/api/contracts/tools/aws/s3-list-buckets'
import { parseToolRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

export const dynamic = 'force-dynamic'

const logger = createLogger('S3ListBucketsAPI')

export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()

  try {
    const authResult = await checkInternalAuth(request, { requireWorkflowId: false })

    if (!authResult.success) {
      logger.warn(`[${requestId}] Unauthorized S3 list buckets attempt: ${authResult.error}`)
      return NextResponse.json(
        {
          success: false,
          error: authResult.error || 'Authentication required',
        },
        { status: 401 }
      )
    }

    logger.info(`[${requestId}] Authenticated S3 list buckets request via ${authResult.authType}`, {
      userId: authResult.userId,
    })

    const parsed = await parseToolRequest(awsS3ListBucketsContract, request, {
      errorFormat: 'details',
      logger,
    })
    if (!parsed.success) return parsed.response
    const validatedData = parsed.data.body

    logger.info(`[${requestId}] Listing S3 buckets`, {
      prefix: validatedData.prefix || '(none)',
      maxBuckets: validatedData.maxBuckets || '(all)',
    })

    const s3Client = new S3Client({
      region: validatedData.region,
      credentials: {
        accessKeyId: validatedData.accessKeyId,
        secretAccessKey: validatedData.secretAccessKey,
      },
    })

    const listCommand = new ListBucketsCommand({
      Prefix: validatedData.prefix || undefined,
      MaxBuckets: validatedData.maxBuckets || undefined,
      ContinuationToken: validatedData.continuationToken || undefined,
    })

    const result = await s3Client.send(listCommand)

    const buckets = (result.Buckets || []).map((bucket) => ({
      name: bucket.Name || '',
      creationDate: bucket.CreationDate?.toISOString() ?? null,
      region: bucket.BucketRegion ?? null,
    }))

    logger.info(`[${requestId}] Listed ${buckets.length} buckets`)

    return NextResponse.json({
      success: true,
      output: {
        buckets,
        owner: result.Owner
          ? {
              displayName: result.Owner.DisplayName ?? null,
              id: result.Owner.ID ?? null,
            }
          : null,
        continuationToken: result.ContinuationToken ?? null,
        prefix: result.Prefix ?? null,
      },
    })
  } catch (error) {
    logger.error(`[${requestId}] Error listing S3 buckets:`, error)

    return NextResponse.json(
      {
        success: false,
        error: getErrorMessage(error, 'Internal server error'),
      },
      { status: 500 }
    )
  }
})
