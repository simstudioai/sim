import { db } from '@sim/db'
import { knowledgeBase } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { AuditAction, AuditResourceType, recordAudit } from '@/lib/audit/log'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import { restoreKnowledgeBase } from '@/lib/knowledge/service'
import { getUserEntityPermissions } from '@/lib/workspaces/permissions/utils'

const logger = createLogger('RestoreKnowledgeBaseAPI')

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const requestId = generateRequestId()
  const { id } = await params

  try {
    const auth = await checkSessionOrInternalAuth(request, { requireWorkflowId: false })
    if (!auth.success || !auth.userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const [kb] = await db
      .select({
        id: knowledgeBase.id,
        name: knowledgeBase.name,
        workspaceId: knowledgeBase.workspaceId,
        userId: knowledgeBase.userId,
      })
      .from(knowledgeBase)
      .where(eq(knowledgeBase.id, id))
      .limit(1)

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

    await restoreKnowledgeBase(id, requestId)

    logger.info(`[${requestId}] Restored knowledge base ${id}`)

    recordAudit({
      workspaceId: kb.workspaceId,
      actorId: auth.userId,
      actorName: auth.userName,
      actorEmail: auth.userEmail,
      action: AuditAction.KNOWLEDGE_BASE_RESTORED,
      resourceType: AuditResourceType.KNOWLEDGE_BASE,
      resourceId: id,
      resourceName: kb.name,
      description: `Restored knowledge base "${kb.name}"`,
      request,
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    logger.error(`[${requestId}] Error restoring knowledge base ${id}`, error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    )
  }
}
