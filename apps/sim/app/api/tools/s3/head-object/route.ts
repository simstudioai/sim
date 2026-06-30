import { HeadObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { awsS3HeadObjectContract } from '@/lib/api/contracts/tools/aws/s3-head-object'
import { parseToolRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

export const dynamic = 'force-dynamic'

const logger = createLogger('S3HeadObjectAPI')

export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()

  try {
    const authResult = await checkInternalAuth(request, { requireWorkflowId: false })

    if (!authResult.success) {
      logger.warn(`[${requestId}] Unauthorized S3 head object attempt: ${authResult.error}`)
      return NextResponse.json(
        {
          success: false,
          error: authResult.error || 'Authentication required',
        },
        { status: 401 }
      )
    }

    logger.info(`[${requestId}] Authenticated S3 head object request via ${authResult.authType}`, {
      userId: authResult.userId,
    })

    const parsed = await parseToolRequest(awsS3HeadObjectContract, request, {
      errorFormat: 'details',
      logger,
    })
    if (!parsed.success) return parsed.response
    const validatedData = parsed.data.body

    logger.info(`[${requestId}] Fetching S3 object metadata`, {
      bucket: validatedData.bucketName,
      key: validatedData.objectKey,
    })

    const s3Client = new S3Client({
      region: validatedData.region,
      credentials: {
        accessKeyId: validatedData.accessKeyId,
        secretAccessKey: validatedData.secretAccessKey,
      },
    })

    const headCommand = new HeadObjectCommand({
      Bucket: validatedData.bucketName,
      Key: validatedData.objectKey,
      VersionId: validatedData.versionId || undefined,
    })

    const result = await s3Client.send(headCommand)

    logger.info(`[${requestId}] Object metadata retrieved`, {
      bucket: validatedData.bucketName,
      key: validatedData.objectKey,
    })

    return NextResponse.json({
      success: true,
      output: {
        exists: true,
        contentLength: result.ContentLength ?? null,
        contentType: result.ContentType ?? null,
        etag: result.ETag ?? null,
        lastModified: result.LastModified?.toISOString() ?? null,
        versionId: result.VersionId ?? null,
        storageClass: result.StorageClass ?? null,
        serverSideEncryption: result.ServerSideEncryption ?? null,
        deleteMarker: result.DeleteMarker ?? null,
        metadata: result.Metadata ?? {},
      },
    })
  } catch (error) {
    const metadata = error as { name?: string; $metadata?: { httpStatusCode?: number } }
    if (metadata?.name === 'NotFound' || metadata?.$metadata?.httpStatusCode === 404) {
      return NextResponse.json({
        success: true,
        output: {
          exists: false,
          contentLength: null,
          contentType: null,
          etag: null,
          lastModified: null,
          versionId: null,
          storageClass: null,
          serverSideEncryption: null,
          deleteMarker: null,
          metadata: {},
        },
      })
    }

    logger.error(`[${requestId}] Error fetching S3 object metadata:`, error)

    return NextResponse.json(
      {
        success: false,
        error: getErrorMessage(error, 'Internal server error'),
      },
      { status: 500 }
    )
  }
})
