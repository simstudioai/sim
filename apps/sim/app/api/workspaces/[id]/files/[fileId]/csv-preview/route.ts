import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { getWorkspaceCsvPreviewContract } from '@/lib/api/contracts/workspace-file-table'
import { parseRequest } from '@/lib/api/server'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { getCsvPreviewSlice } from '@/lib/file-parsers/csv-preview-slice'
import { getWorkspaceFile } from '@/lib/uploads/contexts/workspace/workspace-file-manager'
import { getUserEntityPermissions } from '@/lib/workspaces/permissions/utils'

const logger = createLogger('WorkspaceCsvPreviewAPI')

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const GET = withRouteHandler(
  async (request: NextRequest, context: { params: Promise<{ id: string; fileId: string }> }) => {
    const authResult = await checkSessionOrInternalAuth(request, { requireWorkflowId: false })
    if (!authResult.success || !authResult.userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    }
    const userId = authResult.userId

    const parsed = await parseRequest(getWorkspaceCsvPreviewContract, request, context)
    if (!parsed.success) return parsed.response
    const { id: workspaceId, fileId } = parsed.data.params
    const { key } = parsed.data.query

    const permission = await getUserEntityPermissions(userId, 'workspace', workspaceId)
    if (!permission) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }

    // Resolve the file record (active, in this workspace) and read from its authoritative key —
    // never the client-supplied one. This rejects archived/deleted files and keys with no live
    // row, matching the access guarantees of /api/files/serve.
    const record = await getWorkspaceFile(workspaceId, fileId)
    if (!record || record.key !== key) {
      return NextResponse.json({ error: 'File not found' }, { status: 404 })
    }

    const slice = await getCsvPreviewSlice({
      key: record.key,
      context: 'workspace',
      signal: request.signal,
    })

    logger.info('CSV preview served', {
      workspaceId,
      rows: slice.rows.length,
      truncated: slice.truncated,
    })

    return NextResponse.json({ success: true, ...slice })
  }
)
