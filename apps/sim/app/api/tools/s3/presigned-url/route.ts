import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { awsS3PresignedUrlContract } from '@/lib/api/contracts/tools/aws/s3-presigned-url'
import { parseToolRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

export const dynamic = 'force-dynamic'

const logger = createLogger('S3PresignedUrlAPI')

export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()

  try {
    const authResult = await checkInternalAuth(request, { requireWorkflowId: false })

    if (!authResult.success) {
      logger.warn(`[${requestId}] Unauthorized S3 presigned URL attempt: ${authResult.error}`)
      return NextResponse.json(
        {
          success: false,
          error: authResult.error || 'Authentication required',
        },
        { status: 401 }
      )
    }

    logger.info(
      `[${requestId}] Authenticated S3 presigned URL request via ${authResult.authType}`,
      {
        userId: authResult.userId,
      }
    )

    const parsed = await parseToolRequest(awsS3PresignedUrlContract, request, {
      errorFormat: 'details',
      logger,
    })
    if (!parsed.success) return parsed.response
    const validatedData = parsed.data.body

    logger.info(`[${requestId}] Generating S3 presigned URL`, {
      bucket: validatedData.bucketName,
      key: validatedData.objectKey,
      method: validatedData.method,
      expiresIn: validatedData.expiresIn,
    })

    const s3Client = new S3Client({
      region: validatedData.region,
      credentials: {
        accessKeyId: validatedData.accessKeyId,
        secretAccessKey: validatedData.secretAccessKey,
      },
    })

    const command =
      validatedData.method === 'put'
        ? new PutObjectCommand({
            Bucket: validatedData.bucketName,
            Key: validatedData.objectKey,
            ContentType: validatedData.contentType || undefined,
          })
        : new GetObjectCommand({
            Bucket: validatedData.bucketName,
            Key: validatedData.objectKey,
          })

    const url = await getSignedUrl(s3Client, command, {
      expiresIn: validatedData.expiresIn,
    })

    const expiresAt = new Date(Date.now() + validatedData.expiresIn * 1000).toISOString()

    logger.info(`[${requestId}] Presigned URL generated`, {
      bucket: validatedData.bucketName,
      key: validatedData.objectKey,
    })

    return NextResponse.json({
      success: true,
      output: {
        url,
        method: validatedData.method,
        expiresIn: validatedData.expiresIn,
        expiresAt,
      },
    })
  } catch (error) {
    logger.error(`[${requestId}] Error generating S3 presigned URL:`, error)

    return NextResponse.json(
      {
        success: false,
        error: getErrorMessage(error, 'Internal server error'),
      },
      { status: 500 }
    )
  }
})
