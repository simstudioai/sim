import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { workspaceFileCompiledCheckContract } from '@/lib/api/contracts/workspace-files'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { BINARY_DOC_TASKS, MAX_DOCUMENT_PREVIEW_CODE_BYTES } from '@/lib/execution/constants'
import { runSandboxTask, SandboxUserCodeError } from '@/lib/execution/sandbox/run-task'
import { validateMermaidSource } from '@/lib/mermaid/validate'
import { fetchWorkspaceFileBuffer, getWorkspaceFile } from '@/lib/uploads/contexts/workspace'
import { verifyWorkspaceMembership } from '@/app/api/workflows/utils'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const logger = createLogger('WorkspaceFileCompiledCheckAPI')

/**
 * GET /api/workspaces/[id]/files/[fileId]/compiled-check
 *
 * Compiles or validates the saved source for generated document-like files and
 * returns whether it succeeds. Used by the file agent to self-verify generated
 * code or diagram syntax before finalising an edit.
 *
 * Returns:
 *   200 { ok: true }
 *   200 { ok: false, error: string, errorName: string }   — user code error
 *   4xx on auth / missing file / unsupported extension
 *   500 on system (sandbox infra) failure
 */
export const GET = withRouteHandler(
  async (request: NextRequest, context: { params: Promise<{ id: string; fileId: string }> }) => {
    const parsed = await parseRequest(workspaceFileCompiledCheckContract, request, context)
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

    const ext = fileRecord.name.split('.').pop()?.toLowerCase() ?? ''
    const taskId = BINARY_DOC_TASKS[ext]
    const isMermaidFile = ext === 'mmd' || ext === 'mermaid'
    if (!taskId && !isMermaidFile) {
      return NextResponse.json(
        { error: `Compiled check only supports .docx, .pptx, .pdf, and .mmd files` },
        { status: 422 }
      )
    }

    let buffer: Buffer
    try {
      buffer = await fetchWorkspaceFileBuffer(fileRecord)
    } catch (err) {
      logger.error('Failed to download file for compiled check', {
        fileId,
        error: toError(err).message,
      })
      return NextResponse.json({ error: 'Failed to read file' }, { status: 500 })
    }

    const code = buffer.toString('utf-8')

    if (Buffer.byteLength(code, 'utf-8') > MAX_DOCUMENT_PREVIEW_CODE_BYTES) {
      return NextResponse.json({ error: 'File source exceeds maximum size' }, { status: 413 })
    }

    if (isMermaidFile) {
      return NextResponse.json(await validateMermaidSource(code))
    }

    try {
      if (!taskId) {
        return NextResponse.json({ error: 'Unsupported compiled check target' }, { status: 422 })
      }
      await runSandboxTask(taskId, { code, workspaceId }, { ownerKey: `user:${session.user.id}` })
      return NextResponse.json({ ok: true })
    } catch (err) {
      if (err instanceof SandboxUserCodeError) {
        logger.info('Compiled check failed with user code error', {
          fileId,
          taskId,
          error: toError(err).message,
          errorName: err.name,
        })
        return NextResponse.json({ ok: false, error: toError(err).message, errorName: err.name })
      }
      throw err
    }
  }
)
