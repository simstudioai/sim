import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { workspacePresignedUploadContract } from '@/lib/api/contracts/workspace-files'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { checkStorageQuota } from '@/lib/billing/storage'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { USE_BLOB_STORAGE } from '@/lib/uploads/config'
import { assertWorkspaceFileFolderTarget } from '@/lib/uploads/contexts/workspace'
import { generateWorkspaceFileKey } from '@/lib/uploads/contexts/workspace/workspace-file-manager'
import { generatePresignedUploadUrl, hasCloudStorage } from '@/lib/uploads/core/storage-service'
import { MAX_WORKSPACE_FILE_SIZE } from '@/lib/uploads/shared/types'
import { getUserEntityPermissions } from '@/lib/workspaces/permissions/utils'

const logger = createLogger('WorkspacePresignedAPI')

/**
 * POST /api/workspaces/[id]/files/presigned
 * Returns a presigned PUT URL for a workspace-scoped object key. The client
 * uploads the bytes directly to S3/Blob, then calls /files/register to
 * insert metadata.
 */
export const POST = withRouteHandler(
  async (request: NextRequest, context: { params: Promise<{ id: string }> }) => {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const userId = session.user.id

    const parsed = await parseRequest(workspacePresignedUploadContract, request, context)
    if (!parsed.success) return parsed.response
    const { params, body } = parsed.data
    const workspaceId = params.id
    const { fileName, contentType, fileSize, folderId } = body

    const permission = await getUserEntityPermissions(userId, 'workspace', workspaceId)
    if (permission !== 'admin' && permission !== 'write') {
      logger.warn(`User ${userId} lacks write permission for ${workspaceId}`)
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    if (fileSize > MAX_WORKSPACE_FILE_SIZE) {
      return NextResponse.json(
        { error: `File size exceeds maximum of ${MAX_WORKSPACE_FILE_SIZE} bytes` },
        { status: 413 }
      )
    }

    let targetFolderId: string | null
    try {
      targetFolderId = await assertWorkspaceFileFolderTarget(workspaceId, folderId)
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : 'Invalid target folder' },
        { status: 400 }
      )
    }

    if (!hasCloudStorage()) {
      logger.info(`Local storage detected, signaling API fallback for ${fileName}`)
      return NextResponse.json({
        fileName,
        presignedUrl: '',
        fileInfo: { path: '', key: '', name: fileName, size: fileSize, type: contentType },
        directUploadSupported: false,
      })
    }

    const quotaCheck = await checkStorageQuota(userId, fileSize)
    if (!quotaCheck.allowed) {
      return NextResponse.json(
        { error: quotaCheck.error || 'Storage limit exceeded' },
        { status: 413 }
      )
    }

    const key = generateWorkspaceFileKey(workspaceId, fileName)
    const presigned = await generatePresignedUploadUrl({
      fileName,
      contentType,
      fileSize,
      context: 'workspace',
      userId,
      customKey: key,
      expirationSeconds: 3600,
      metadata: { workspaceId, ...(targetFolderId ? { folderId: targetFolderId } : {}) },
    })

    const finalPath = `/api/files/serve/${USE_BLOB_STORAGE ? 'blob' : 's3'}/${encodeURIComponent(key)}?context=workspace`

    logger.info(`Issued workspace presigned URL for ${fileName} -> ${key}`)

    return NextResponse.json({
      fileName,
      presignedUrl: presigned.url,
      fileInfo: {
        path: finalPath,
        key: presigned.key,
        name: fileName,
        size: fileSize,
        type: contentType,
      },
      uploadHeaders: presigned.uploadHeaders,
      directUploadSupported: true,
    })
  }
)
