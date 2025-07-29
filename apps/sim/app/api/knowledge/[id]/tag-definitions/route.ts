import { randomUUID } from 'crypto'
import { eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console/logger'
import { checkKnowledgeBaseAccess } from '@/app/api/knowledge/utils'
import { db } from '@/db'
import { knowledgeBaseTagDefinitions } from '@/db/schema'

export const dynamic = 'force-dynamic'

const logger = createLogger('KnowledgeBaseTagDefinitionsAPI')

// GET /api/knowledge/[id]/tag-definitions - Get all tag definitions for a knowledge base
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const requestId = randomUUID().slice(0, 8)
  const { id: knowledgeBaseId } = await params

  try {
    logger.info(`[${requestId}] Getting tag definitions for knowledge base ${knowledgeBaseId}`)

    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Check if user has access to the knowledge base
    const accessCheck = await checkKnowledgeBaseAccess(knowledgeBaseId, session.user.id)
    if (!accessCheck.hasAccess) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Get tag definitions for the knowledge base
    const tagDefinitions = await db
      .select({
        id: knowledgeBaseTagDefinitions.id,
        tagSlot: knowledgeBaseTagDefinitions.tagSlot,
        displayName: knowledgeBaseTagDefinitions.displayName,
        fieldType: knowledgeBaseTagDefinitions.fieldType,
        createdAt: knowledgeBaseTagDefinitions.createdAt,
        updatedAt: knowledgeBaseTagDefinitions.updatedAt,
      })
      .from(knowledgeBaseTagDefinitions)
      .where(eq(knowledgeBaseTagDefinitions.knowledgeBaseId, knowledgeBaseId))
      .orderBy(knowledgeBaseTagDefinitions.tagSlot)

    logger.info(`[${requestId}] Retrieved ${tagDefinitions.length} tag definitions`)

    return NextResponse.json({
      success: true,
      data: tagDefinitions,
    })
  } catch (error) {
    logger.error(`[${requestId}] Error getting tag definitions`, error)
    return NextResponse.json({ error: 'Failed to get tag definitions' }, { status: 500 })
  }
}
