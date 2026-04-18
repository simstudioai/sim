import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { toError } from '@/lib/core/utils/helpers'
import { MAX_DOCUMENT_PREVIEW_CODE_BYTES } from '@/lib/execution/constants'
import { runSandboxTask } from '@/lib/execution/sandbox/run-task'
import { verifyWorkspaceMembership } from '@/app/api/workflows/utils'
import type { SandboxTaskId } from '@/sandbox-tasks/registry'

/**
 * Config for a document preview route handler.
 *
 * All three document preview endpoints (PDF / PPTX / DOCX) share the same
 * shape: auth → workspace membership → JSON body parse → `code` validation →
 * size guard → `runSandboxTask(taskId, ...)` → binary response. The only
 * differences between them are the sandbox task, the response MIME type, and
 * the logger/label used for the 500 path.
 */
export interface DocumentPreviewRouteConfig {
  /** Sandbox task registered in `apps/sim/sandbox-tasks/registry.ts`. */
  taskId: SandboxTaskId
  /** Content-Type of the binary returned on success. */
  contentType: string
  /** Short label used for the logger name + 500 log message. */
  label: 'PDF' | 'PPTX' | 'DOCX'
}

/**
 * Build a Next.js POST handler for one of the document preview endpoints.
 *
 * Everything security-relevant (session, workspace membership, JSON shape,
 * empty/oversized code) is enforced before we ever reach the isolated-vm
 * sandbox, and `runSandboxTask` is always invoked with the session owner key
 * + `req.signal` so pool fairness and client-disconnect cancellation behave
 * identically across all three formats.
 */
export function createDocumentPreviewRoute(config: DocumentPreviewRouteConfig) {
  const logger = createLogger(`${config.label}PreviewAPI`)

  return async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const { id: workspaceId } = await params

    try {
      const session = await getSession()
      if (!session?.user?.id) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }

      const membership = await verifyWorkspaceMembership(session.user.id, workspaceId)
      if (!membership) {
        return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
      }

      let body: unknown
      try {
        body = await req.json()
      } catch {
        return NextResponse.json({ error: 'Invalid or missing JSON body' }, { status: 400 })
      }
      const { code } = body as { code?: string }

      if (typeof code !== 'string' || code.trim().length === 0) {
        return NextResponse.json({ error: 'code is required' }, { status: 400 })
      }

      if (Buffer.byteLength(code, 'utf-8') > MAX_DOCUMENT_PREVIEW_CODE_BYTES) {
        return NextResponse.json({ error: 'code exceeds maximum size' }, { status: 413 })
      }

      const buffer = await runSandboxTask(
        config.taskId,
        { code, workspaceId },
        { ownerKey: `user:${session.user.id}`, signal: req.signal }
      )

      return new NextResponse(new Uint8Array(buffer), {
        status: 200,
        headers: {
          'Content-Type': config.contentType,
          'Content-Length': String(buffer.length),
          'Cache-Control': 'private, no-store',
        },
      })
    } catch (err) {
      const message = toError(err).message
      logger.error(`${config.label} preview generation failed`, { error: message, workspaceId })
      return NextResponse.json({ error: message }, { status: 500 })
    }
  }
}
