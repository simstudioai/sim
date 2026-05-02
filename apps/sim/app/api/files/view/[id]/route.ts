import { createLogger } from '@sim/logger'
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { fileViewContract } from '@/lib/api/contracts/storage-transfer'
import { parseRequest } from '@/lib/api/server'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { USE_BLOB_STORAGE } from '@/lib/uploads/config'
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

    const hasAccess = await verifyFileAccess(record.key, authResult.userId)
    if (!hasAccess) {
      logger.warn('Unauthorized file view attempt', { id, userId: authResult.userId })
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const storagePrefix = USE_BLOB_STORAGE ? 'blob' : 's3'
    const servePath = `/api/files/serve/${storagePrefix}/${encodeURIComponent(record.key)}`
    logger.info('Redirecting file view to serve path', { id, servePath })

    return NextResponse.redirect(new URL(servePath, request.url), { status: 302 })
  }
)
