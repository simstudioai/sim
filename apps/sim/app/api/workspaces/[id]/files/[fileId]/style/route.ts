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
 * Extract a compact JSON style summary from an uploaded .docx or .pptx file.
 * Uses OOXML theme XML to return theme colors, font pair, and named styles.
 * Only works on binary OOXML files (ZIP format) — not on JS source files.
 */
export const GET = withRouteHandler(
  async (request: NextRequest, context: { params: Promise<{ id: string; fileId: string }> }) => {
    const parsed = await parseRequest(workspaceFileStyleContract, request, context)
    if (!parsed.success) return parsed.response
    const { id: workspaceId, fileId } = parsed.data.params

    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const membership = await verifyWorkspaceMembership(session.user.id, workspaceId)
    if (!membership) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
    }

    const fileRecord = await getWorkspaceFile(workspaceId, fileId)
    if (!fileRecord) {
      return NextResponse.json({ error: 'File not found' }, { status: 404 })
    }

    const rawExt = fileRecord.name.split('.').pop()?.toLowerCase()
    if (rawExt !== 'docx' && rawExt !== 'pptx') {
      return NextResponse.json(
        { error: 'Style extraction only supports .docx and .pptx files' },
        { status: 422 }
      )
    }
    const ext: 'docx' | 'pptx' = rawExt

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
            'File is not a compiled binary document — style extraction requires an uploaded or compiled .docx/.pptx file',
        },
        { status: 422 }
      )
    }

    logger.info('Extracted style summary via API', {
      fileId,
      format: ext,
      themeName: summary.theme.name,
    })

    return NextResponse.json(summary, {
      headers: { 'Cache-Control': 'private, max-age=300' },
    })
  }
)
