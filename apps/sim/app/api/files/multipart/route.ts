import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import {
  getStorageConfig,
  getStorageProvider,
  isUsingCloudStorage,
  type StorageContext,
} from '@/lib/uploads'
import {
  signUploadToken,
  type UploadTokenPayload,
  verifyUploadToken,
} from '@/lib/uploads/core/upload-token'
import { getUserEntityPermissions } from '@/lib/workspaces/permissions/utils'

const logger = createLogger('MultipartUploadAPI')

const ALLOWED_UPLOAD_CONTEXTS = new Set<StorageContext>([
  'knowledge-base',
  'chat',
  'copilot',
  'mothership',
  'execution',
  'workspace',
  'profile-pictures',
  'og-images',
  'logs',
  'workspace-logos',
])

interface InitiateMultipartRequest {
  fileName: string
  contentType: string
  fileSize: number
  workspaceId: string
  context?: StorageContext
}

interface TokenBoundRequest {
  uploadToken: string
}

interface GetPartUrlsRequest extends TokenBoundRequest {
  partNumbers: number[]
}

interface CompleteSingleRequest extends TokenBoundRequest {
  parts: unknown
}

interface CompleteBatchRequest {
  uploads: Array<TokenBoundRequest & { parts: unknown }>
}

const verifyTokenForUser = (token: string | undefined, userId: string) => {
  if (!token || typeof token !== 'string') {
    return null
  }
  const result = verifyUploadToken(token)
  if (!result.valid || result.payload.userId !== userId) {
    return null
  }
  return result.payload
}

export const POST = withRouteHandler(async (request: NextRequest) => {
  try {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const userId = session.user.id

    const action = request.nextUrl.searchParams.get('action')

    if (!isUsingCloudStorage()) {
      return NextResponse.json(
        { error: 'Multipart upload is only available with cloud storage (S3 or Azure Blob)' },
        { status: 400 }
      )
    }

    const storageProvider = getStorageProvider()

    switch (action) {
      case 'initiate': {
        const data = (await request.json()) as InitiateMultipartRequest
        const { fileName, contentType, fileSize, workspaceId, context = 'knowledge-base' } = data

        if (!workspaceId || typeof workspaceId !== 'string') {
          return NextResponse.json({ error: 'workspaceId is required' }, { status: 400 })
        }

        if (!ALLOWED_UPLOAD_CONTEXTS.has(context)) {
          return NextResponse.json({ error: 'Invalid storage context' }, { status: 400 })
        }

        const permission = await getUserEntityPermissions(userId, 'workspace', workspaceId)
        if (permission !== 'write' && permission !== 'admin') {
          return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
        }

        const config = getStorageConfig(context)

        let uploadId: string
        let key: string

        if (storageProvider === 's3') {
          const { initiateS3MultipartUpload } = await import('@/lib/uploads/providers/s3/client')
          const result = await initiateS3MultipartUpload({ fileName, contentType, fileSize })
          uploadId = result.uploadId
          key = result.key
        } else if (storageProvider === 'blob') {
          const { initiateMultipartUpload } = await import('@/lib/uploads/providers/blob/client')
          const result = await initiateMultipartUpload({
            fileName,
            contentType,
            fileSize,
            customConfig: {
              containerName: config.containerName!,
              accountName: config.accountName!,
              accountKey: config.accountKey,
              connectionString: config.connectionString,
            },
          })
          uploadId = result.uploadId
          key = result.key
        } else {
          return NextResponse.json(
            { error: `Unsupported storage provider: ${storageProvider}` },
            { status: 400 }
          )
        }

        const uploadToken = signUploadToken({
          uploadId,
          key,
          userId,
          workspaceId,
          context,
        })

        logger.info(
          `Initiated ${storageProvider} multipart upload for ${fileName} (context: ${context}, workspace: ${workspaceId}): ${uploadId}`
        )

        return NextResponse.json({ uploadId, key, uploadToken })
      }

      case 'get-part-urls': {
        const data = (await request.json()) as GetPartUrlsRequest
        const { partNumbers } = data

        const tokenPayload = verifyTokenForUser(data.uploadToken, userId)
        if (!tokenPayload) {
          return NextResponse.json({ error: 'Invalid or expired upload token' }, { status: 403 })
        }

        const { uploadId, key, context } = tokenPayload
        const config = getStorageConfig(context)

        if (storageProvider === 's3') {
          const { getS3MultipartPartUrls } = await import('@/lib/uploads/providers/s3/client')
          const presignedUrls = await getS3MultipartPartUrls(key, uploadId, partNumbers)
          return NextResponse.json({ presignedUrls })
        }
        if (storageProvider === 'blob') {
          const { getMultipartPartUrls } = await import('@/lib/uploads/providers/blob/client')
          const presignedUrls = await getMultipartPartUrls(key, partNumbers, {
            containerName: config.containerName!,
            accountName: config.accountName!,
            accountKey: config.accountKey,
            connectionString: config.connectionString,
          })
          return NextResponse.json({ presignedUrls })
        }

        return NextResponse.json(
          { error: `Unsupported storage provider: ${storageProvider}` },
          { status: 400 }
        )
      }

      case 'complete': {
        const data = (await request.json()) as CompleteSingleRequest | CompleteBatchRequest

        if ('uploads' in data && Array.isArray(data.uploads)) {
          const verified = data.uploads.map((upload) => {
            const payload = verifyTokenForUser(upload.uploadToken, userId)
            return payload ? { payload, parts: upload.parts } : null
          })

          if (verified.some((entry) => entry === null)) {
            return NextResponse.json({ error: 'Invalid or expired upload token' }, { status: 403 })
          }

          const verifiedEntries = verified.filter(
            (entry): entry is { payload: UploadTokenPayload; parts: unknown } => entry !== null
          )

          const results = await Promise.all(
            verifiedEntries.map(async ({ payload, parts }) => {
              const { uploadId, key, context } = payload
              const config = getStorageConfig(context)

              if (storageProvider === 's3') {
                const { completeS3MultipartUpload } = await import(
                  '@/lib/uploads/providers/s3/client'
                )
                const result = await completeS3MultipartUpload(key, uploadId, parts as any)
                return {
                  success: true,
                  location: result.location,
                  path: result.path,
                  key: result.key,
                }
              }
              if (storageProvider === 'blob') {
                const { completeMultipartUpload } = await import(
                  '@/lib/uploads/providers/blob/client'
                )
                const result = await completeMultipartUpload(key, parts as any, {
                  containerName: config.containerName!,
                  accountName: config.accountName!,
                  accountKey: config.accountKey,
                  connectionString: config.connectionString,
                })
                return {
                  success: true,
                  location: result.location,
                  path: result.path,
                  key: result.key,
                }
              }

              throw new Error(`Unsupported storage provider: ${storageProvider}`)
            })
          )

          logger.info(`Completed ${verifiedEntries.length} multipart uploads`)
          return NextResponse.json({ results })
        }

        const single = data as CompleteSingleRequest
        const tokenPayload = verifyTokenForUser(single.uploadToken, userId)
        if (!tokenPayload) {
          return NextResponse.json({ error: 'Invalid or expired upload token' }, { status: 403 })
        }

        const { uploadId, key, context } = tokenPayload
        const config = getStorageConfig(context)

        if (storageProvider === 's3') {
          const { completeS3MultipartUpload } = await import('@/lib/uploads/providers/s3/client')
          const result = await completeS3MultipartUpload(key, uploadId, single.parts as any)
          logger.info(`Completed S3 multipart upload for key ${key} (context: ${context})`)
          return NextResponse.json({
            success: true,
            location: result.location,
            path: result.path,
            key: result.key,
          })
        }
        if (storageProvider === 'blob') {
          const { completeMultipartUpload } = await import('@/lib/uploads/providers/blob/client')
          const result = await completeMultipartUpload(key, single.parts as any, {
            containerName: config.containerName!,
            accountName: config.accountName!,
            accountKey: config.accountKey,
            connectionString: config.connectionString,
          })
          logger.info(`Completed Azure multipart upload for key ${key} (context: ${context})`)
          return NextResponse.json({
            success: true,
            location: result.location,
            path: result.path,
            key: result.key,
          })
        }

        return NextResponse.json(
          { error: `Unsupported storage provider: ${storageProvider}` },
          { status: 400 }
        )
      }

      case 'abort': {
        const data = (await request.json()) as TokenBoundRequest
        const tokenPayload = verifyTokenForUser(data.uploadToken, userId)
        if (!tokenPayload) {
          return NextResponse.json({ error: 'Invalid or expired upload token' }, { status: 403 })
        }

        const { uploadId, key, context } = tokenPayload
        const config = getStorageConfig(context)

        if (storageProvider === 's3') {
          const { abortS3MultipartUpload } = await import('@/lib/uploads/providers/s3/client')
          await abortS3MultipartUpload(key, uploadId)
          logger.info(`Aborted S3 multipart upload for key ${key} (context: ${context})`)
        } else if (storageProvider === 'blob') {
          const { abortMultipartUpload } = await import('@/lib/uploads/providers/blob/client')
          await abortMultipartUpload(key, {
            containerName: config.containerName!,
            accountName: config.accountName!,
            accountKey: config.accountKey,
            connectionString: config.connectionString,
          })
          logger.info(`Aborted Azure multipart upload for key ${key} (context: ${context})`)
        } else {
          return NextResponse.json(
            { error: `Unsupported storage provider: ${storageProvider}` },
            { status: 400 }
          )
        }

        return NextResponse.json({ success: true })
      }

      default:
        return NextResponse.json(
          { error: 'Invalid action. Use: initiate, get-part-urls, complete, or abort' },
          { status: 400 }
        )
    }
  } catch (error) {
    logger.error('Multipart upload error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Multipart upload failed' },
      { status: 500 }
    )
  }
})
