import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import { type NextRequest, NextResponse } from 'next/server'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { deleteTagDefinition } from '@/lib/knowledge/tags/service'
import { checkKnowledgeBaseWriteAccess } from '@/app/api/knowledge/utils'

export const dynamic = 'force-dynamic'

const logger = createLogger('TagDefinitionAPI')

// DELETE /api/knowledge/[id]/tag-definitions/[tagId] - Delete a tag definition
export const DELETE = withRouteHandler(
  async (req: NextRequest, { params }: { params: Promise<{ id: string; tagId: string }> }) => {
    const requestId = generateId().slice(0, 8)
    const { id: knowledgeBaseId, tagId } = await params

    try {
      logger.info(
        `[${requestId}] Deleting tag definition ${tagId} from knowledge base ${knowledgeBaseId}`
      )

      const auth = await checkSessionOrInternalAuth(req, { requireWorkflowId: false })
      if (!auth.success || !auth.userId) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }

      const accessCheck = await checkKnowledgeBaseWriteAccess(knowledgeBaseId, auth.userId)
      if (!accessCheck.hasAccess) {
        return NextResponse.json(
          { error: accessCheck.notFound ? 'Not found' : 'Forbidden' },
          { status: accessCheck.notFound ? 404 : 403 }
        )
      }

      const deletedTag = await deleteTagDefinition(knowledgeBaseId, tagId, requestId)

      return NextResponse.json({
        success: true,
        message: `Tag definition "${deletedTag.displayName}" deleted successfully`,
      })
    } catch (error) {
      logger.error(`[${requestId}] Error deleting tag definition`, error)
      return NextResponse.json({ error: 'Failed to delete tag definition' }, { status: 500 })
    }
  }
)
