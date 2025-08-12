import { randomUUID } from 'crypto'
import { and, eq, isNotNull } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console/logger'
import { checkKnowledgeBaseAccess } from '@/app/api/knowledge/utils'
import { db } from '@/db'
import { document, knowledgeBaseTagDefinitions } from '@/db/schema'

export const dynamic = 'force-dynamic'

const logger = createLogger('TagUsageAPI')

// GET /api/knowledge/[id]/tag-usage - Get usage statistics for all tag definitions
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const requestId = randomUUID().slice(0, 8)
  const { id: knowledgeBaseId } = await params

  try {
    logger.info(`[${requestId}] Getting tag usage statistics for knowledge base ${knowledgeBaseId}`)

    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Check if user has access to the knowledge base
    const accessCheck = await checkKnowledgeBaseAccess(knowledgeBaseId, session.user.id)
    if (!accessCheck.hasAccess) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Get all tag definitions for the knowledge base
    const tagDefinitions = await db
      .select({
        id: knowledgeBaseTagDefinitions.id,
        tagSlot: knowledgeBaseTagDefinitions.tagSlot,
        displayName: knowledgeBaseTagDefinitions.displayName,
      })
      .from(knowledgeBaseTagDefinitions)
      .where(eq(knowledgeBaseTagDefinitions.knowledgeBaseId, knowledgeBaseId))

    // Get usage statistics for each tag definition
    const usageStats = await Promise.all(
      tagDefinitions.map(async (tagDef) => {
        // Count documents using this tag slot
        const tagSlotColumn = tagDef.tagSlot as keyof typeof document.$inferSelect

        const documentsWithTag = await db
          .select({
            id: document.id,
            filename: document.filename,
            [tagDef.tagSlot]: document[tagSlotColumn as keyof typeof document.$inferSelect] as any,
          })
          .from(document)
          .where(
            and(
              eq(document.knowledgeBaseId, knowledgeBaseId),
              isNotNull(document[tagSlotColumn as keyof typeof document.$inferSelect])
            )
          )

        return {
          tagName: tagDef.displayName,
          tagSlot: tagDef.tagSlot,
          documentCount: documentsWithTag.length,
          documents: documentsWithTag.map((doc) => ({
            id: doc.id,
            name: doc.filename,
            tagValue: doc[tagDef.tagSlot],
          })),
        }
      })
    )

    logger.info(
      `[${requestId}] Retrieved usage statistics for ${tagDefinitions.length} tag definitions`
    )

    return NextResponse.json({
      success: true,
      data: usageStats,
    })
  } catch (error) {
    logger.error(`[${requestId}] Error getting tag usage statistics`, error)
    return NextResponse.json({ error: 'Failed to get tag usage statistics' }, { status: 500 })
  }
}
