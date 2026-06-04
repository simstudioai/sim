import { CopyObjectCommand, type ObjectCannedACL, S3Client } from '@aws-sdk/client-s3'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { awsS3CopyObjectContract } from '@/lib/api/contracts/tools/aws/s3-copy-object'
import { parseToolRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

export const dynamic = 'force-dynamic'

const logger = createLogger('S3CopyObjectAPI')

export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()

  try {
    const authResult = await checkInternalAuth(request, { requireWorkflowId: false })

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

    const parsed = await parseToolRequest(awsS3CopyObjectContract, request, {
      errorFormat: 'details',
      logger,
    })
    if (!parsed.success) return parsed.response
    const validatedData = parsed.data.body

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
    const uri = `s3://${validatedData.destinationBucket}/${validatedData.destinationKey}`

    return NextResponse.json({
      success: true,
      output: {
        url,
        uri,
        copySourceVersionId: result.CopySourceVersionId,
        versionId: result.VersionId,
        etag: result.CopyObjectResult?.ETag,
      },
    })
  } catch (error) {
    logger.error(`[${requestId}] Error copying S3 object:`, error)

    return NextResponse.json(
      {
        success: false,
        error: getErrorMessage(error, 'Internal server error'),
      },
      { status: 500 }
    )
  }
})
