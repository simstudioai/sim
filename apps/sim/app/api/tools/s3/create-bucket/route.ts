import {
  type BucketCannedACL,
  type BucketLocationConstraint,
  CreateBucketCommand,
  S3Client,
} from '@aws-sdk/client-s3'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { awsS3CreateBucketContract } from '@/lib/api/contracts/tools/aws/s3-create-bucket'
import { parseToolRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

export const dynamic = 'force-dynamic'

const logger = createLogger('S3CreateBucketAPI')

export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()

  try {
    const authResult = await checkInternalAuth(request, { requireWorkflowId: false })

    if (!authResult.success) {
      logger.warn(`[${requestId}] Unauthorized S3 create bucket attempt: ${authResult.error}`)
      return NextResponse.json(
        {
          success: false,
          error: authResult.error || 'Authentication required',
        },
        { status: 401 }
      )
    }

    logger.info(
      `[${requestId}] Authenticated S3 create bucket request via ${authResult.authType}`,
      {
        userId: authResult.userId,
      }
    )

    const parsed = await parseToolRequest(awsS3CreateBucketContract, request, {
      errorFormat: 'details',
      logger,
    })
    if (!parsed.success) return parsed.response
    const validatedData = parsed.data.body

    logger.info(`[${requestId}] Creating S3 bucket`, {
      bucket: validatedData.bucketName,
      region: validatedData.region,
    })

    const s3Client = new S3Client({
      region: validatedData.region,
      credentials: {
        accessKeyId: validatedData.accessKeyId,
        secretAccessKey: validatedData.secretAccessKey,
      },
    })

    const createCommand = new CreateBucketCommand({
      Bucket: validatedData.bucketName,
      ACL: (validatedData.acl as BucketCannedACL | undefined) || undefined,
      CreateBucketConfiguration:
        validatedData.region === 'us-east-1'
          ? undefined
          : { LocationConstraint: validatedData.region as BucketLocationConstraint },
    })

    const result = await s3Client.send(createCommand)

    logger.info(`[${requestId}] Bucket created successfully`, {
      bucket: validatedData.bucketName,
      location: result.Location,
    })

    return NextResponse.json({
      success: true,
      output: {
        bucket: validatedData.bucketName,
        location: result.Location ?? null,
        bucketArn: result.BucketArn ?? null,
      },
    })
  } catch (error) {
    logger.error(`[${requestId}] Error creating S3 bucket:`, error)

    return NextResponse.json(
      {
        success: false,
        error: getErrorMessage(error, 'Internal server error'),
      },
      { status: 500 }
    )
  }
})
