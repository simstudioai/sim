import { DeleteObjectsCommand, S3Client } from '@aws-sdk/client-s3'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { awsS3DeleteObjectsContract } from '@/lib/api/contracts/tools/aws/s3-delete-objects'
import { parseToolRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

export const dynamic = 'force-dynamic'

const logger = createLogger('S3DeleteObjectsAPI')

export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()

  try {
    const authResult = await checkInternalAuth(request, { requireWorkflowId: false })

    if (!authResult.success) {
      logger.warn(`[${requestId}] Unauthorized S3 delete objects attempt: ${authResult.error}`)
      return NextResponse.json(
        {
          success: false,
          error: authResult.error || 'Authentication required',
        },
        { status: 401 }
      )
    }

    logger.info(
      `[${requestId}] Authenticated S3 delete objects request via ${authResult.authType}`,
      {
        userId: authResult.userId,
      }
    )

    const parsed = await parseToolRequest(awsS3DeleteObjectsContract, request, {
      errorFormat: 'details',
      logger,
    })
    if (!parsed.success) return parsed.response
    const validatedData = parsed.data.body

    logger.info(`[${requestId}] Deleting S3 objects`, {
      bucket: validatedData.bucketName,
      count: validatedData.keys.length,
    })

    const s3Client = new S3Client({
      region: validatedData.region,
      credentials: {
        accessKeyId: validatedData.accessKeyId,
        secretAccessKey: validatedData.secretAccessKey,
      },
    })

    const deleteCommand = new DeleteObjectsCommand({
      Bucket: validatedData.bucketName,
      Delete: {
        Objects: validatedData.keys.map((key) => ({ Key: key })),
        Quiet: validatedData.quiet ?? false,
      },
    })

    const result = await s3Client.send(deleteCommand)

    const deleted = (result.Deleted || []).map((obj) => ({
      key: obj.Key ?? null,
      versionId: obj.VersionId ?? null,
      deleteMarker: obj.DeleteMarker ?? null,
    }))

    const errors = (result.Errors || []).map((err) => ({
      key: err.Key ?? null,
      code: err.Code ?? null,
      message: err.Message ?? null,
    }))

    logger.info(`[${requestId}] Delete objects completed`, {
      bucket: validatedData.bucketName,
      deleted: deleted.length,
      errors: errors.length,
    })

    return NextResponse.json({
      success: true,
      output: {
        deleted,
        errors,
      },
    })
  } catch (error) {
    logger.error(`[${requestId}] Error deleting S3 objects:`, error)

    return NextResponse.json(
      {
        success: false,
        error: getErrorMessage(error, 'Internal server error'),
      },
      { status: 500 }
    )
  }
})
