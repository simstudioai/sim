import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { acquireLock, releaseLock } from '@/lib/core/config/redis'
import { ensureAbsoluteUrl } from '@/lib/core/utils/urls'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import {
  downloadWorkspaceFile,
  getWorkspaceFileByName,
  updateWorkspaceFileContent,
  uploadWorkspaceFile,
} from '@/lib/uploads/contexts/workspace/workspace-file-manager'
import { getFileExtension, getMimeTypeFromExtension } from '@/lib/uploads/utils/file-utils'

export const dynamic = 'force-dynamic'

const logger = createLogger('FileManageAPI')

export const POST = withRouteHandler(async (request: NextRequest) => {
  const auth = await checkInternalAuth(request, { requireWorkflowId: false })
  if (!auth.success) {
    return NextResponse.json({ success: false, error: auth.error }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const userId = auth.userId || searchParams.get('userId')

  if (!userId) {
    return NextResponse.json({ success: false, error: 'userId is required' }, { status: 400 })
  }

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON body' }, { status: 400 })
  }

  const workspaceId = (body.workspaceId as string) || searchParams.get('workspaceId')
  if (!workspaceId) {
    return NextResponse.json({ success: false, error: 'workspaceId is required' }, { status: 400 })
  }

  const operation = body.operation as string

  try {
    switch (operation) {
      case 'write': {
        const fileName = body.fileName as string | undefined
        const content = body.content as string | undefined
        const contentType = body.contentType as string | undefined

        if (!fileName) {
          return NextResponse.json(
            { success: false, error: 'fileName is required for write operation' },
            { status: 400 }
          )
        }

        if (!content && content !== '') {
          return NextResponse.json(
            { success: false, error: 'content is required for write operation' },
            { status: 400 }
          )
        }

        const mimeType = contentType || getMimeTypeFromExtension(getFileExtension(fileName))
        const fileBuffer = Buffer.from(content ?? '', 'utf-8')
        const result = await uploadWorkspaceFile(
          workspaceId,
          userId,
          fileBuffer,
          fileName,
          mimeType
        )

        logger.info('File created', {
          fileId: result.id,
          name: fileName,
          size: fileBuffer.length,
        })

        return NextResponse.json({
          success: true,
          data: {
            id: result.id,
            name: result.name,
            size: fileBuffer.length,
            url: ensureAbsoluteUrl(result.url),
          },
        })
      }

      case 'append': {
        const fileName = body.fileName as string | undefined
        const content = body.content as string | undefined

        if (!fileName) {
          return NextResponse.json(
            { success: false, error: 'fileName is required for append operation' },
            { status: 400 }
          )
        }

        if (!content && content !== '') {
          return NextResponse.json(
            { success: false, error: 'content is required for append operation' },
            { status: 400 }
          )
        }

        const existing = await getWorkspaceFileByName(workspaceId, fileName)
        if (!existing) {
          return NextResponse.json(
            { success: false, error: `File not found: "${fileName}"` },
            { status: 404 }
          )
        }

        const lockKey = `file-append:${workspaceId}:${existing.id}`
        const lockValue = `${Date.now()}-${Math.random().toString(36).slice(2)}`
        const acquired = await acquireLock(lockKey, lockValue, 30)
        if (!acquired) {
          return NextResponse.json(
            { success: false, error: 'File is busy, please retry' },
            { status: 409 }
          )
        }

        try {
          const existingBuffer = await downloadWorkspaceFile(existing)
          const finalContent = existingBuffer.toString('utf-8') + content
          const fileBuffer = Buffer.from(finalContent, 'utf-8')
          await updateWorkspaceFileContent(workspaceId, existing.id, userId, fileBuffer)

          logger.info('File appended', {
            fileId: existing.id,
            name: existing.name,
            size: fileBuffer.length,
          })

          return NextResponse.json({
            success: true,
            data: {
              id: existing.id,
              name: existing.name,
              size: fileBuffer.length,
              url: ensureAbsoluteUrl(existing.path),
            },
          })
        } finally {
          await releaseLock(lockKey, lockValue)
        }
      }

      default:
        return NextResponse.json(
          { success: false, error: `Unknown operation: ${operation}. Supported: write, append` },
          { status: 400 }
        )
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    logger.error('File operation failed', { operation, error: message })
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
})
