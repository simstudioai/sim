import { randomUUID } from 'crypto'
import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { deleteTagDefinition } from '@/lib/knowledge/tags/service'
import { createLogger } from '@/lib/logs/console/logger'
import { checkKnowledgeBaseAccess } from '@/app/api/knowledge/utils'

export const dynamic = 'force-dynamic'

const logger = createLogger('TagDefinitionAPI')

// DELETE /api/knowledge/[id]/tag-definitions/[tagId] - Delete a tag definition
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; tagId: string }> }
) {
  const requestId = randomUUID().slice(0, 8)
  const { id: knowledgeBaseId, tagId } = await params

  try {
    logger.info(
      `[${requestId}] Deleting tag definition ${tagId} from knowledge base ${knowledgeBaseId}`
    )

    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const accessCheck = await checkKnowledgeBaseAccess(knowledgeBaseId, session.user.id)
    if (!accessCheck.hasAccess) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const deletedTag = await deleteTagDefinition(tagId, requestId)

    return NextResponse.json({
      success: true,
      message: `Tag definition "${deletedTag.displayName}" deleted successfully`,
    })
  } catch (error) {
    logger.error(`[${requestId}] Error deleting tag definition`, error)
    return NextResponse.json({ error: 'Failed to delete tag definition' }, { status: 500 })
  }
}
