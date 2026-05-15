import { type ObjectCannedACL, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { awsS3PutObjectContract } from '@/lib/api/contracts/tools/aws/s3-put-object'
import { parseToolRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { processSingleFileToUserFile } from '@/lib/uploads/utils/file-utils'
import { downloadFileFromStorage } from '@/lib/uploads/utils/file-utils.server'
import { assertToolFileAccess } from '@/app/api/files/authorization'

export const dynamic = 'force-dynamic'

const logger = createLogger('S3PutObjectAPI')

export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()

  try {
    const authResult = await checkInternalAuth(request, { requireWorkflowId: false })

    if (!authResult.success || !authResult.userId) {
      logger.warn(`[${requestId}] Unauthorized S3 put object attempt: ${authResult.error}`)
      return NextResponse.json(
        {
          success: false,
          error: authResult.error || 'Authentication required',
        },
        { status: 401 }
      )
    }

    logger.info(`[${requestId}] Authenticated S3 put object request via ${authResult.authType}`, {
      userId: authResult.userId,
    })

    const parsed = await parseToolRequest(awsS3PutObjectContract, request, {
      errorFormat: 'details',
      logger,
    })
    if (!parsed.success) return parsed.response
    const validatedData = parsed.data.body

    logger.info(`[${requestId}] Uploading to S3`, {
      bucket: validatedData.bucketName,
      key: validatedData.objectKey,
      hasFile: !!validatedData.file,
      hasContent: !!validatedData.content,
    })

    const s3Client = new S3Client({
      region: validatedData.region,
      credentials: {
        accessKeyId: validatedData.accessKeyId,
        secretAccessKey: validatedData.secretAccessKey,
      },
    })

    let uploadBody: Buffer | string
    let uploadContentType: string | undefined

    if (validatedData.file) {
      const rawFile = validatedData.file
      logger.info(`[${requestId}] Processing file upload: ${rawFile.name}`)

      let userFile
      try {
        userFile = processSingleFileToUserFile(rawFile, requestId, logger)
      } catch (error) {
        return NextResponse.json(
          {
            success: false,
            error: error instanceof Error ? error.message : 'Failed to process file',
          },
          { status: 400 }
        )
      }

      const denied = await assertToolFileAccess(userFile.key, authResult.userId, requestId, logger)
      if (denied) return denied

      const buffer = await downloadFileFromStorage(userFile, requestId, logger)

      uploadBody = buffer
      uploadContentType = validatedData.contentType || userFile.type || 'application/octet-stream'
    } else if (validatedData.content) {
      uploadBody = Buffer.from(validatedData.content, 'utf-8')
      uploadContentType = validatedData.contentType || 'text/plain'
    } else {
      return NextResponse.json(
        {
          success: false,
          error: 'Either file or content must be provided',
        },
        { status: 400 }
      )
    }

    const putCommand = new PutObjectCommand({
      Bucket: validatedData.bucketName,
      Key: validatedData.objectKey,
      Body: uploadBody,
      ContentType: uploadContentType,
      ACL: validatedData.acl as ObjectCannedACL | undefined,
    })

    const result = await s3Client.send(putCommand)

    logger.info(`[${requestId}] File uploaded successfully`, {
      etag: result.ETag,
      bucket: validatedData.bucketName,
      key: validatedData.objectKey,
    })

    const encodedKey = validatedData.objectKey.split('/').map(encodeURIComponent).join('/')
    const url = `https://${validatedData.bucketName}.s3.${validatedData.region}.amazonaws.com/${encodedKey}`
    const uri = `s3://${validatedData.bucketName}/${validatedData.objectKey}`

    return NextResponse.json({
      success: true,
      output: {
        url,
        uri,
        etag: result.ETag,
        location: url,
        key: validatedData.objectKey,
        bucket: validatedData.bucketName,
      },
    })
  } catch (error) {
    logger.error(`[${requestId}] Error uploading to S3:`, error)

    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Internal server error',
      },
      { status: 500 }
    )
  }
})
