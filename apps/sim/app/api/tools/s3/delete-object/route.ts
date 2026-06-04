import { DeleteObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { awsS3DeleteObjectContract } from '@/lib/api/contracts/tools/aws/s3-delete-object'
import { parseToolRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

export const dynamic = 'force-dynamic'

const logger = createLogger('S3DeleteObjectAPI')

export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()

  try {
    const authResult = await checkInternalAuth(request, { requireWorkflowId: false })

    if (!authResult.success) {
      logger.warn(`[${requestId}] Unauthorized S3 delete object attempt: ${authResult.error}`)
      return NextResponse.json(
        {
          success: false,
          error: authResult.error || 'Authentication required',
        },
        { status: 401 }
      )
    }

    logger.info(
      `[${requestId}] Authenticated S3 delete object request via ${authResult.authType}`,
      {
        userId: authResult.userId,
      }
    )

    const parsed = await parseToolRequest(awsS3DeleteObjectContract, request, {
      errorFormat: 'details',
      logger,
    })
    if (!parsed.success) return parsed.response
    const validatedData = parsed.data.body

    logger.info(`[${requestId}] Deleting S3 object`, {
      bucket: validatedData.bucketName,
      key: validatedData.objectKey,
    })

    // Initialize S3 client
    const s3Client = new S3Client({
      region: validatedData.region,
      credentials: {
        accessKeyId: validatedData.accessKeyId,
        secretAccessKey: validatedData.secretAccessKey,
      },
    })

    // Delete object
    const deleteCommand = new DeleteObjectCommand({
      Bucket: validatedData.bucketName,
      Key: validatedData.objectKey,
    })

    const result = await s3Client.send(deleteCommand)

    logger.info(`[${requestId}] Object deleted successfully`, {
      bucket: validatedData.bucketName,
      key: validatedData.objectKey,
      deleteMarker: result.DeleteMarker,
    })

    return NextResponse.json({
      success: true,
      output: {
        key: validatedData.objectKey,
        deleteMarker: result.DeleteMarker,
        versionId: result.VersionId,
      },
    })
  } catch (error) {
    logger.error(`[${requestId}] Error deleting S3 object:`, error)

    return NextResponse.json(
      {
        success: false,
        error: getErrorMessage(error, 'Internal server error'),
      },
      { status: 500 }
    )
  }
})
