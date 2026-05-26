import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { restoreKnowledgeBaseContract } from '@/lib/api/contracts/knowledge'
import { parseRequest } from '@/lib/api/server'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import {
  getRestorableKnowledgeBase,
  performRestoreKnowledgeBase,
} from '@/lib/knowledge/orchestration'
import { getUserEntityPermissions } from '@/lib/workspaces/permissions/utils'

const logger = createLogger('RestoreKnowledgeBaseAPI')

export const POST = withRouteHandler(
  async (request: NextRequest, context: { params: Promise<{ id: string }> }) => {
    const requestId = generateRequestId()
    const parsed = await parseRequest(restoreKnowledgeBaseContract, request, context)
    if (!parsed.success) return parsed.response
    const { id } = parsed.data.params

    try {
      const auth = await checkSessionOrInternalAuth(request, { requireWorkflowId: false })
      if (!auth.success || !auth.userId) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }

      const kb = await getRestorableKnowledgeBase(id)

      if (!kb) {
        return NextResponse.json({ error: 'Knowledge base not found' }, { status: 404 })
      }

      if (kb.workspaceId) {
        const permission = await getUserEntityPermissions(auth.userId, 'workspace', kb.workspaceId)
        if (permission !== 'admin' && permission !== 'write') {
          return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
        }
      } else if (kb.userId !== auth.userId) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }

      const result = await performRestoreKnowledgeBase({
        knowledgeBaseId: id,
        userId: auth.userId,
        requestId,
      })
      if (!result.success) {
        const status =
          result.errorCode === 'not_found' ? 404 : result.errorCode === 'conflict' ? 409 : 500
        return NextResponse.json({ error: result.error }, { status })
      }

      logger.info(`[${requestId}] Restored knowledge base ${id}`)

      return NextResponse.json({ success: true })
    } catch (error) {
      logger.error(`[${requestId}] Error restoring knowledge base ${id}`, error)
      return NextResponse.json(
        { error: getErrorMessage(error, 'Internal server error') },
        { status: 500 }
      )
    }
  }
)
