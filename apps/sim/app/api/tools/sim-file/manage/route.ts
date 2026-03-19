import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import {
  downloadWorkspaceFile,
  getWorkspaceFile,
  getWorkspaceFileByName,
  updateWorkspaceFileContent,
  uploadWorkspaceFile,
} from '@/lib/uploads/contexts/workspace/workspace-file-manager'

export const dynamic = 'force-dynamic'

const logger = createLogger('SimFileManageAPI')

const EXT_TO_MIME: Record<string, string> = {
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.html': 'text/html',
  '.json': 'application/json',
  '.csv': 'text/csv',
  '.xml': 'application/xml',
  '.yaml': 'application/x-yaml',
  '.yml': 'application/x-yaml',
}

function inferContentType(fileName: string, explicitType?: string): string {
  if (explicitType) return explicitType
  const ext = fileName.slice(fileName.lastIndexOf('.')).toLowerCase()
  return EXT_TO_MIME[ext] || 'text/plain'
}

export async function POST(request: NextRequest) {
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
        const fileId = body.fileId as string | undefined
        const content = body.content as string | undefined
        const contentType = body.contentType as string | undefined
        const append = Boolean(body.append)

        if (!content && content !== '') {
          return NextResponse.json(
            { success: false, error: 'content is required for write operation' },
            { status: 400 }
          )
        }

        if (fileName && !fileId) {
          const existing = await getWorkspaceFileByName(workspaceId, fileName)

          if (existing) {
            let finalContent: string
            if (append) {
              const existingBuffer = await downloadWorkspaceFile(existing)
              finalContent = existingBuffer.toString('utf-8') + content
            } else {
              finalContent = content ?? ''
            }

            const fileBuffer = Buffer.from(finalContent, 'utf-8')
            await updateWorkspaceFileContent(workspaceId, existing.id, userId, fileBuffer)

            logger.info('File overwritten by name', {
              fileId: existing.id,
              name: existing.name,
              size: fileBuffer.length,
              append,
            })

            return NextResponse.json({
              success: true,
              data: { id: existing.id, name: existing.name, size: fileBuffer.length },
            })
          }

          const mimeType = inferContentType(fileName, contentType)
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
            data: { id: result.id, name: result.name, size: fileBuffer.length, url: result.url },
          })
        }

        if (fileId) {
          const fileRecord = await getWorkspaceFile(workspaceId, fileId)
          if (!fileRecord) {
            return NextResponse.json(
              { success: false, error: `File with ID "${fileId}" not found` },
              { status: 404 }
            )
          }

          let finalContent: string
          if (append) {
            const existingBuffer = await downloadWorkspaceFile(fileRecord)
            const existingContent = existingBuffer.toString('utf-8')
            finalContent = existingContent + content
          } else {
            finalContent = content ?? ''
          }

          const fileBuffer = Buffer.from(finalContent, 'utf-8')
          await updateWorkspaceFileContent(workspaceId, fileId, userId, fileBuffer)

          logger.info('Sim file written', {
            fileId,
            name: fileRecord.name,
            size: fileBuffer.length,
            append,
          })

          return NextResponse.json({
            success: true,
            data: { id: fileId, name: fileRecord.name, size: fileBuffer.length },
          })
        }

        return NextResponse.json(
          {
            success: false,
            error: 'Either fileName (to create) or fileId (to update) is required',
          },
          { status: 400 }
        )
      }

      default:
        return NextResponse.json(
          { success: false, error: `Unknown operation: ${operation}. Supported: write` },
          { status: 400 }
        )
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    logger.error('Sim file operation failed', { operation, error: message })
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
