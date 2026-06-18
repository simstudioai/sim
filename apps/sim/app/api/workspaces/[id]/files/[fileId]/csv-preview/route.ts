import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { getWorkspaceCsvPreviewContract } from '@/lib/api/contracts/workspace-file-table'
import { parseRequest } from '@/lib/api/server'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { getCsvPreviewSlice } from '@/lib/file-parsers/csv-preview-slice'
import { parseWorkspaceFileKey } from '@/lib/uploads/contexts/workspace/workspace-file-manager'
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
    const { id: workspaceId } = parsed.data.params
    const { key } = parsed.data.query

    const permission = await getUserEntityPermissions(userId, 'workspace', workspaceId)
    if (!permission) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }

    // The key is client-supplied — confine it to this workspace's storage prefix so a caller
    // can't read another workspace's object.
    if (parseWorkspaceFileKey(key) !== workspaceId) {
      return NextResponse.json({ error: 'Invalid file key for workspace' }, { status: 400 })
    }

    const slice = await getCsvPreviewSlice({ key, context: 'workspace', signal: request.signal })

    logger.info('CSV preview served', {
      workspaceId,
      rows: slice.rows.length,
      truncated: slice.truncated,
    })

    return NextResponse.json({ success: true, ...slice })
  }
)
