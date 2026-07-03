import { DeleteBucketCommand, S3Client } from '@aws-sdk/client-s3'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { awsS3DeleteBucketContract } from '@/lib/api/contracts/tools/aws/s3-delete-bucket'
import { parseToolRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

export const dynamic = 'force-dynamic'

const logger = createLogger('S3DeleteBucketAPI')

export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()

  try {
    const authResult = await checkInternalAuth(request, { requireWorkflowId: false })

    if (!authResult.success) {
      logger.warn(`[${requestId}] Unauthorized S3 delete bucket attempt: ${authResult.error}`)
      return NextResponse.json(
        {
          success: false,
          error: authResult.error || 'Authentication required',
        },
        { status: 401 }
      )
    }

    logger.info(
      `[${requestId}] Authenticated S3 delete bucket request via ${authResult.authType}`,
      {
        userId: authResult.userId,
      }
    )

    const parsed = await parseToolRequest(awsS3DeleteBucketContract, request, {
      errorFormat: 'details',
      logger,
    })
    if (!parsed.success) return parsed.response
    const validatedData = parsed.data.body

    logger.info(`[${requestId}] Deleting S3 bucket`, {
      bucket: validatedData.bucketName,
    })

    const s3Client = new S3Client({
      region: validatedData.region,
      credentials: {
        accessKeyId: validatedData.accessKeyId,
        secretAccessKey: validatedData.secretAccessKey,
      },
    })

    const deleteCommand = new DeleteBucketCommand({
      Bucket: validatedData.bucketName,
    })

    await s3Client.send(deleteCommand)

    logger.info(`[${requestId}] Bucket deleted successfully`, {
      bucket: validatedData.bucketName,
    })

    return NextResponse.json({
      success: true,
      output: {
        deleted: true,
        bucket: validatedData.bucketName,
      },
    })
  } catch (error) {
    logger.error(`[${requestId}] Error deleting S3 bucket:`, error)

    return NextResponse.json(
      {
        success: false,
        error: getErrorMessage(error, 'Internal server error'),
      },
      { status: 500 }
    )
  }
})
