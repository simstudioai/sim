import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { workspaceFileStyleContract } from '@/lib/api/contracts/workspace-files'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { extractDocumentStyle } from '@/lib/copilot/vfs/document-style'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { fetchWorkspaceFileBuffer, getWorkspaceFile } from '@/lib/uploads/contexts/workspace'
import { verifyWorkspaceMembership } from '@/app/api/workflows/utils'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const logger = createLogger('WorkspaceFileStyleAPI')

/**
 * GET /api/workspaces/[id]/files/[fileId]/style
 * Extract a compact JSON style summary from an uploaded .docx, .pptx, or .pdf file.
 * OOXML files return theme colors, font pair, and named styles.
 * PDF files return page dimensions and embedded font names.
 */
const MAX_STYLE_FILE_BYTES = 100 * 1024 * 1024 // 100 MB

export const GET = withRouteHandler(
  async (request: NextRequest, context: { params: Promise<{ id: string; fileId: string }> }) => {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const parsed = await parseRequest(workspaceFileStyleContract, request, context)
    if (!parsed.success) return parsed.response
    const { id: workspaceId, fileId } = parsed.data.params

    const membership = await verifyWorkspaceMembership(session.user.id, workspaceId)
    if (!membership) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
    }

    const fileRecord = await getWorkspaceFile(workspaceId, fileId)
    if (!fileRecord) {
      return NextResponse.json({ error: 'File not found' }, { status: 404 })
    }

    const rawExt = fileRecord.name.split('.').pop()?.toLowerCase()
    if (rawExt !== 'docx' && rawExt !== 'pptx' && rawExt !== 'pdf') {
      return NextResponse.json(
        { error: 'Style extraction supports .docx, .pptx, and .pdf files' },
        { status: 422 }
      )
    }
    const ext: 'docx' | 'pptx' | 'pdf' = rawExt

    if (fileRecord.size > MAX_STYLE_FILE_BYTES) {
      return NextResponse.json(
        { error: 'File is too large for style extraction (limit: 100 MB)' },
        { status: 422 }
      )
    }

    let buffer: Buffer
    try {
      buffer = await fetchWorkspaceFileBuffer(fileRecord)
    } catch (err) {
      logger.error('Failed to download file for style extraction', {
        fileId,
        error: toError(err).message,
      })
      return NextResponse.json({ error: 'Failed to read file' }, { status: 500 })
    }

    const summary = await extractDocumentStyle(buffer, ext)
    if (!summary) {
      return NextResponse.json(
        {
          error:
            'Could not extract style — file may be encrypted, corrupt, image-only, or contain no parseable style information',
        },
        { status: 422 }
      )
    }

    logger.info('Extracted style summary via API', { fileId, format: ext })

    return NextResponse.json(summary, {
      headers: { 'Cache-Control': 'private, max-age=300' },
    })
  }
)
