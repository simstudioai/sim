import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import type { z } from 'zod'
import { defineRouteContract } from '@/lib/api/contracts'
import { getValidationErrorMessage, parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { MAX_DOCUMENT_PREVIEW_CODE_BYTES } from '@/lib/execution/constants'
import { runSandboxTask, SandboxUserCodeError } from '@/lib/execution/sandbox/run-task'
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
  /** Route params schema owned by the concrete route.ts boundary. */
  routeParamsSchema: z.ZodType<{ id: string }>
  /** JSON body schema owned by the concrete route.ts boundary. */
  previewBodySchema: z.ZodType<{ code: string }>
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

  const previewContract = defineRouteContract({
    method: 'POST',
    path: '/api/workspaces/[id]/_preview',
    params: config.routeParamsSchema,
    body: config.previewBodySchema,
    response: { mode: 'json', schema: config.previewBodySchema },
  })

  return async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
    const paramsResult = config.routeParamsSchema.safeParse(await context.params)
    if (!paramsResult.success) {
      return NextResponse.json(
        { error: getValidationErrorMessage(paramsResult.error, 'Invalid route parameters') },
        { status: 400 }
      )
    }
    const { id: workspaceId } = paramsResult.data

    try {
      const session = await getSession()
      if (!session?.user?.id) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }

      const membership = await verifyWorkspaceMembership(session.user.id, workspaceId)
      if (!membership) {
        return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
      }

      const parsed = await parseRequest(previewContract, req, context, {
        validationErrorResponse: (error) =>
          NextResponse.json(
            { error: getValidationErrorMessage(error, 'code is required') },
            { status: 400 }
          ),
        invalidJsonResponse: () =>
          NextResponse.json({ error: 'Invalid or missing JSON body' }, { status: 400 }),
      })
      if (!parsed.success) return parsed.response
      const { code } = parsed.data.body

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
      if (err instanceof SandboxUserCodeError) {
        logger.warn(`${config.label} preview user code failed`, {
          error: message,
          errorName: err.name,
          workspaceId,
        })
        return NextResponse.json({ error: message, errorName: err.name }, { status: 422 })
      }
      logger.error(`${config.label} preview generation failed`, { error: message, workspaceId })
      return NextResponse.json({ error: message }, { status: 500 })
    }
  }
}
