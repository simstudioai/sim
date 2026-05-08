import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import {
  abortMultipartUploadContract,
  type CompleteMultipartBody,
  completeMultipartUploadContract,
  getMultipartPartUrlsContract,
  initiateMultipartUploadContract,
  multipartActionSchema,
} from '@/lib/api/contracts/storage-transfer'
import { getValidationErrorMessage, parseRequest } from '@/lib/api/server'
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
import type { StorageConfig } from '@/lib/uploads/shared/types'
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

/**
 * Unified part identity sent by the client when completing a multipart upload.
 * `etag` is required for S3 (CompleteMultipartUpload). For Azure the server
 * derives the block id from `partNumber` via {@link deriveBlobBlockId}.
 */
interface ClientCompletedPart {
  partNumber: number
  etag?: string
}

const isClientCompletedParts = (value: unknown): value is ClientCompletedPart[] =>
  Array.isArray(value) &&
  value.every(
    (p) =>
      p !== null &&
      typeof p === 'object' &&
      typeof (p as ClientCompletedPart).partNumber === 'number' &&
      ((p as ClientCompletedPart).etag === undefined ||
        typeof (p as ClientCompletedPart).etag === 'string')
  )

const buildS3CustomConfig = (config: StorageConfig) =>
  config.bucket && config.region ? { bucket: config.bucket, region: config.region } : undefined

const buildBlobCustomConfig = (config: StorageConfig) => ({
  containerName: config.containerName!,
  accountName: config.accountName!,
  accountKey: config.accountKey,
  connectionString: config.connectionString,
})

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

    const actionParam = request.nextUrl.searchParams.get('action')
    const actionResult = multipartActionSchema.safeParse(actionParam)
    const action = actionResult.success ? actionResult.data : null

    if (!isUsingCloudStorage()) {
      return NextResponse.json(
        { error: 'Multipart upload is only available with cloud storage (S3 or Azure Blob)' },
        { status: 400 }
      )
    }

    const storageProvider = getStorageProvider()

    switch (action) {
      case 'initiate': {
        const parsed = await parseRequest(
          initiateMultipartUploadContract,
          request,
          {},
          {
            validationErrorResponse: (error) =>
              NextResponse.json({ error: getValidationErrorMessage(error) }, { status: 400 }),
          }
        )
        if (!parsed.success) return parsed.response

        const data = parsed.data.body
        const { fileName, contentType, fileSize, workspaceId, context = 'knowledge-base' } = data

        if (!workspaceId || typeof workspaceId !== 'string') {
          return NextResponse.json({ error: 'workspaceId is required' }, { status: 400 })
        }

        if (!ALLOWED_UPLOAD_CONTEXTS.has(context as StorageContext)) {
          return NextResponse.json({ error: 'Invalid storage context' }, { status: 400 })
        }
        const storageContext = context as StorageContext

        const permission = await getUserEntityPermissions(userId, 'workspace', workspaceId)
        if (permission !== 'write' && permission !== 'admin') {
          return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
        }

        const config = getStorageConfig(storageContext)

        let customKey: string | undefined
        if (context === 'workspace') {
          const { MAX_WORKSPACE_FILE_SIZE } = await import('@/lib/uploads/shared/types')
          if (typeof fileSize === 'number' && fileSize > MAX_WORKSPACE_FILE_SIZE) {
            return NextResponse.json(
              { error: `File size exceeds maximum of ${MAX_WORKSPACE_FILE_SIZE} bytes` },
              { status: 413 }
            )
          }

          const { generateWorkspaceFileKey } = await import(
            '@/lib/uploads/contexts/workspace/workspace-file-manager'
          )
          customKey = generateWorkspaceFileKey(workspaceId, fileName)

          const { checkStorageQuota } = await import('@/lib/billing/storage')
          const quotaCheck = await checkStorageQuota(userId, fileSize)
          if (!quotaCheck.allowed) {
            return NextResponse.json(
              { error: quotaCheck.error || 'Storage limit exceeded' },
              { status: 413 }
            )
          }
        } else if (context === 'mothership') {
          const { generateWorkspaceFileKey } = await import(
            '@/lib/uploads/contexts/workspace/workspace-file-manager'
          )
          customKey = generateWorkspaceFileKey(workspaceId, fileName)
        } else if (context === 'execution') {
          const workflowId = (data as { workflowId?: unknown }).workflowId
          const executionId = (data as { executionId?: unknown }).executionId
          if (typeof workflowId !== 'string' || !workflowId.trim()) {
            return NextResponse.json(
              { error: 'workflowId is required for execution uploads' },
              { status: 400 }
            )
          }
          if (typeof executionId !== 'string' || !executionId.trim()) {
            return NextResponse.json(
              { error: 'executionId is required for execution uploads' },
              { status: 400 }
            )
          }
          const { generateExecutionFileKey } = await import(
            '@/lib/uploads/contexts/execution/utils'
          )
          customKey = generateExecutionFileKey({ workspaceId, workflowId, executionId }, fileName)
        }

        let uploadId: string
        let key: string

        if (storageProvider === 's3') {
          const { initiateS3MultipartUpload } = await import('@/lib/uploads/providers/s3/client')
          const result = await initiateS3MultipartUpload({
            fileName,
            contentType,
            fileSize,
            customConfig: buildS3CustomConfig(config),
            customKey,
            purpose: context,
          })
          uploadId = result.uploadId
          key = result.key
        } else if (storageProvider === 'blob') {
          const { initiateMultipartUpload } = await import('@/lib/uploads/providers/blob/client')
          const result = await initiateMultipartUpload({
            fileName,
            contentType,
            fileSize,
            customConfig: buildBlobCustomConfig(config),
            customKey,
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
          context: storageContext,
        })

        logger.info(
          `Initiated ${storageProvider} multipart upload for ${fileName} (context: ${storageContext}, workspace: ${workspaceId}): ${uploadId}`
        )

        return NextResponse.json({ uploadId, key, uploadToken })
      }

      case 'get-part-urls': {
        const parsed = await parseRequest(
          getMultipartPartUrlsContract,
          request,
          {},
          {
            validationErrorResponse: (error) =>
              NextResponse.json({ error: getValidationErrorMessage(error) }, { status: 400 }),
          }
        )
        if (!parsed.success) return parsed.response

        const data = parsed.data.body
        const { partNumbers } = data

        const tokenPayload = verifyTokenForUser(data.uploadToken, userId)
        if (!tokenPayload) {
          return NextResponse.json({ error: 'Invalid or expired upload token' }, { status: 403 })
        }

        const { uploadId, key, context } = tokenPayload
        const config = getStorageConfig(context)

        if (storageProvider === 's3') {
          const { getS3MultipartPartUrls } = await import('@/lib/uploads/providers/s3/client')
          const presignedUrls = await getS3MultipartPartUrls(
            key,
            uploadId,
            partNumbers,
            buildS3CustomConfig(config)
          )
          return NextResponse.json({ presignedUrls })
        }
        if (storageProvider === 'blob') {
          const { getMultipartPartUrls } = await import('@/lib/uploads/providers/blob/client')
          const presignedUrls = await getMultipartPartUrls(
            key,
            partNumbers,
            buildBlobCustomConfig(config)
          )
          return NextResponse.json({ presignedUrls })
        }

        return NextResponse.json(
          { error: `Unsupported storage provider: ${storageProvider}` },
          { status: 400 }
        )
      }

      case 'complete': {
        const parsed = await parseRequest(
          completeMultipartUploadContract,
          request,
          {},
          {
            validationErrorResponse: (error) =>
              NextResponse.json({ error: getValidationErrorMessage(error) }, { status: 400 }),
          }
        )
        if (!parsed.success) return parsed.response

        const data: CompleteMultipartBody = parsed.data.body

        const s3Module =
          storageProvider === 's3' ? await import('@/lib/uploads/providers/s3/client') : null
        const blobModule =
          storageProvider === 'blob' ? await import('@/lib/uploads/providers/blob/client') : null

        const completeOne = async (payload: UploadTokenPayload, parts: ClientCompletedPart[]) => {
          const { uploadId, key, context } = payload
          const config = getStorageConfig(context)

          if (storageProvider === 's3' && s3Module) {
            const { completeS3MultipartUpload } = s3Module
            const s3Parts = parts.map((p) => {
              if (!p.etag) {
                throw new Error(`Missing etag for S3 part ${p.partNumber}`)
              }
              return { ETag: p.etag, PartNumber: p.partNumber }
            })
            const result = await completeS3MultipartUpload(
              key,
              uploadId,
              s3Parts,
              buildS3CustomConfig(config)
            )
            return {
              success: true as const,
              location: result.location,
              path: result.path,
              key: result.key,
            }
          }

          if (storageProvider === 'blob' && blobModule) {
            const { completeMultipartUpload, deriveBlobBlockId } = blobModule
            const blobParts = parts.map((p) => ({
              partNumber: p.partNumber,
              blockId: deriveBlobBlockId(p.partNumber),
            }))
            const result = await completeMultipartUpload(
              key,
              blobParts,
              buildBlobCustomConfig(config)
            )
            return {
              success: true as const,
              location: result.location,
              path: result.path,
              key: result.key,
            }
          }

          throw new Error(`Unsupported storage provider: ${storageProvider}`)
        }

        if ('uploads' in data && Array.isArray(data.uploads)) {
          const verified: Array<{ payload: UploadTokenPayload; parts: ClientCompletedPart[] }> = []
          for (const upload of data.uploads) {
            const payload = verifyTokenForUser(upload.uploadToken, userId)
            if (!payload) {
              return NextResponse.json(
                { error: 'Invalid or expired upload token' },
                { status: 403 }
              )
            }
            if (!isClientCompletedParts(upload.parts)) {
              return NextResponse.json(
                { error: 'Invalid parts payload: expected [{ partNumber, etag? }]' },
                { status: 400 }
              )
            }
            verified.push({ payload, parts: upload.parts })
          }

          const results = await Promise.all(
            verified.map(({ payload, parts }) => completeOne(payload, parts))
          )

          logger.info(`Completed ${verified.length} multipart uploads`)
          return NextResponse.json({ results })
        }

        const single = data
        const tokenPayload = verifyTokenForUser(single.uploadToken, userId)
        if (!tokenPayload) {
          return NextResponse.json({ error: 'Invalid or expired upload token' }, { status: 403 })
        }
        if (!isClientCompletedParts(single.parts)) {
          return NextResponse.json(
            { error: 'Invalid parts payload: expected [{ partNumber, etag? }]' },
            { status: 400 }
          )
        }

        const result = await completeOne(tokenPayload, single.parts)
        logger.info(
          `Completed ${storageProvider} multipart upload for key ${tokenPayload.key} (context: ${tokenPayload.context})`
        )
        return NextResponse.json(result)
      }

      case 'abort': {
        const parsed = await parseRequest(
          abortMultipartUploadContract,
          request,
          {},
          {
            validationErrorResponse: (error) =>
              NextResponse.json({ error: getValidationErrorMessage(error) }, { status: 400 }),
          }
        )
        if (!parsed.success) return parsed.response

        const data = parsed.data.body
        const tokenPayload = verifyTokenForUser(data.uploadToken, userId)
        if (!tokenPayload) {
          return NextResponse.json({ error: 'Invalid or expired upload token' }, { status: 403 })
        }

        const { uploadId, key, context } = tokenPayload
        const config = getStorageConfig(context)

        if (storageProvider === 's3') {
          const { abortS3MultipartUpload } = await import('@/lib/uploads/providers/s3/client')
          await abortS3MultipartUpload(key, uploadId, buildS3CustomConfig(config))
          logger.info(`Aborted S3 multipart upload for key ${key} (context: ${context})`)
        } else if (storageProvider === 'blob') {
          const { abortMultipartUpload } = await import('@/lib/uploads/providers/blob/client')
          await abortMultipartUpload(key, buildBlobCustomConfig(config))
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
