import { createLogger } from '@sim/logger'
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { fileViewContract } from '@/lib/api/contracts/storage-transfer'
import { parseRequest } from '@/lib/api/server'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { getServeStoragePrefix, type StorageContext } from '@/lib/uploads/config'
import { getFileMetadataById } from '@/lib/uploads/server/metadata'
import { verifyFileAccess } from '@/app/api/files/authorization'

const logger = createLogger('FilesViewAPI')

export const GET = withRouteHandler(
  async (request: NextRequest, context: { params: Promise<{ id: string }> }) => {
    const parsed = await parseRequest(fileViewContract, request, context)
    if (!parsed.success) return parsed.response

    const { id } = parsed.data.params

    const authResult = await checkSessionOrInternalAuth(request, { requireWorkflowId: false })
    if (!authResult.success || !authResult.userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const record = await getFileMetadataById(id)
    if (!record) {
      logger.warn('File not found by ID', { id })
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    // Authorize before disclosing anything about the file. Pass the record's own context so access is
    // resolved from the DB row (workspace and mothership both map to workspace membership) rather than
    // re-inferred from the key, and deny with 404 so a caller without access cannot distinguish a
    // file's existence or context from a missing id.
    const hasAccess = await verifyFileAccess(
      record.key,
      authResult.userId,
      undefined,
      record.context as StorageContext | 'general'
    )
    if (!hasAccess) {
      logger.warn('Unauthorized file view attempt', { id, userId: authResult.userId })
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    // Only workspace-scoped files are embeddable/viewable here. Other contexts (e.g. chat-scoped
    // `mothership` uploads) are not durable workspace artifacts; now that the caller is known to have
    // access, reject with a legible 422 so the embed fails cleanly and the file agent can self-correct.
    if (record.context !== 'workspace') {
      logger.warn('Rejected non-workspace file view', { id, context: record.context })
      return NextResponse.json(
        {
          error: `File ${id} has context "${record.context}" and is not embeddable. Only workspace files can be viewed via /api/files/view. Save it into the workspace and reference the workspace copy.`,
        },
        { status: 422 }
      )
    }

    const storagePrefix = getServeStoragePrefix()
    const servePath = `/api/files/serve/${storagePrefix}/${encodeURIComponent(record.key)}`
    logger.info('Redirecting file view to serve path', { id, servePath })

    // Emit a relative Location so the browser resolves it against the public origin it requested.
    // `NextResponse.redirect(new URL(servePath, request.url))` bakes in the host from `request.url`,
    // which behind the load balancer is the internal pod host (e.g. ip-10-0-x.ec2.internal:3000) —
    // unreachable from the browser, so embedded <img src="/api/files/view/<id>"> loads fail. A
    // relative Location resolves against the original public URL (matching how the Files tab fetches
    // serve URLs directly).
    return new NextResponse(null, { status: 302, headers: { Location: servePath } })
  }
)
