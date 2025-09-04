import { randomUUID } from 'crypto'
import { and, eq, isNotNull } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console/logger'
import { checkKnowledgeBaseAccess } from '@/app/api/knowledge/utils'
import { db } from '@/db'
import { document, embedding, knowledgeBaseTagDefinitions } from '@/db/schema'

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

    // Check if user has access to the knowledge base
    const accessCheck = await checkKnowledgeBaseAccess(knowledgeBaseId, session.user.id)
    if (!accessCheck.hasAccess) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Get the tag definition to find which slot it uses
    const tagDefinition = await db
      .select({
        id: knowledgeBaseTagDefinitions.id,
        tagSlot: knowledgeBaseTagDefinitions.tagSlot,
        displayName: knowledgeBaseTagDefinitions.displayName,
      })
      .from(knowledgeBaseTagDefinitions)
      .where(
        and(
          eq(knowledgeBaseTagDefinitions.id, tagId),
          eq(knowledgeBaseTagDefinitions.knowledgeBaseId, knowledgeBaseId)
        )
      )
      .limit(1)

    if (tagDefinition.length === 0) {
      return NextResponse.json({ error: 'Tag definition not found' }, { status: 404 })
    }

    const tagDef = tagDefinition[0]

    // Delete the tag definition and clear all document tags in a transaction
    await db.transaction(async (tx) => {
      logger.info(`[${requestId}] Starting transaction to delete ${tagDef.tagSlot}`)

      try {
        // Clear the tag from documents that actually have this tag set
        logger.info(`[${requestId}] Clearing tag from documents...`)
        await tx
          .update(document)
          .set({ [tagDef.tagSlot]: null })
          .where(
            and(
              eq(document.knowledgeBaseId, knowledgeBaseId),
              isNotNull(document[tagDef.tagSlot as keyof typeof document.$inferSelect])
            )
          )

        logger.info(`[${requestId}] Documents updated successfully`)

        // Clear the tag from embeddings that actually have this tag set
        logger.info(`[${requestId}] Clearing tag from embeddings...`)
        await tx
          .update(embedding)
          .set({ [tagDef.tagSlot]: null })
          .where(
            and(
              eq(embedding.knowledgeBaseId, knowledgeBaseId),
              isNotNull(embedding[tagDef.tagSlot as keyof typeof embedding.$inferSelect])
            )
          )

        logger.info(`[${requestId}] Embeddings updated successfully`)

        // Delete the tag definition
        logger.info(`[${requestId}] Deleting tag definition...`)
        await tx
          .delete(knowledgeBaseTagDefinitions)
          .where(eq(knowledgeBaseTagDefinitions.id, tagId))

        logger.info(`[${requestId}] Tag definition deleted successfully`)
      } catch (error) {
        logger.error(`[${requestId}] Error in transaction:`, error)
        throw error
      }
    })

    logger.info(
      `[${requestId}] Successfully deleted tag definition ${tagDef.displayName} (${tagDef.tagSlot})`
    )

    return NextResponse.json({
      success: true,
      message: `Tag definition "${tagDef.displayName}" deleted successfully`,
    })
  } catch (error) {
    logger.error(`[${requestId}] Error deleting tag definition`, error)
    return NextResponse.json({ error: 'Failed to delete tag definition' }, { status: 500 })
  }
}
