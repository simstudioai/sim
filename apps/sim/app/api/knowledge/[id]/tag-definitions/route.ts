import { randomUUID } from 'crypto'
import { and, eq } from 'drizzle-orm'
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

// POST /api/knowledge/[id]/tag-definitions - Create a new tag definition
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const requestId = randomUUID().slice(0, 8)
  const { id: knowledgeBaseId } = await params

  try {
    logger.info(`[${requestId}] Creating tag definition for knowledge base ${knowledgeBaseId}`)

    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Check if user has access to the knowledge base
    const accessCheck = await checkKnowledgeBaseAccess(knowledgeBaseId, session.user.id)
    if (!accessCheck.hasAccess) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await req.json()
    const { tagSlot, displayName, fieldType } = body

    if (!tagSlot || !displayName || !fieldType) {
      return NextResponse.json(
        { error: 'tagSlot, displayName, and fieldType are required' },
        { status: 400 }
      )
    }

    // Check if tag slot is already used
    const existingTag = await db
      .select()
      .from(knowledgeBaseTagDefinitions)
      .where(
        and(
          eq(knowledgeBaseTagDefinitions.knowledgeBaseId, knowledgeBaseId),
          eq(knowledgeBaseTagDefinitions.tagSlot, tagSlot)
        )
      )
      .limit(1)

    if (existingTag.length > 0) {
      return NextResponse.json({ error: 'Tag slot is already in use' }, { status: 409 })
    }

    // Check if display name is already used
    const existingName = await db
      .select()
      .from(knowledgeBaseTagDefinitions)
      .where(
        and(
          eq(knowledgeBaseTagDefinitions.knowledgeBaseId, knowledgeBaseId),
          eq(knowledgeBaseTagDefinitions.displayName, displayName)
        )
      )
      .limit(1)

    if (existingName.length > 0) {
      return NextResponse.json({ error: 'Tag name is already in use' }, { status: 409 })
    }

    // Create the new tag definition
    const newTagDefinition = {
      id: randomUUID(),
      knowledgeBaseId,
      tagSlot,
      displayName,
      fieldType,
      createdAt: new Date(),
      updatedAt: new Date(),
    }

    await db.insert(knowledgeBaseTagDefinitions).values(newTagDefinition)

    logger.info(`[${requestId}] Successfully created tag definition ${displayName} (${tagSlot})`)

    return NextResponse.json({
      success: true,
      data: newTagDefinition,
    })
  } catch (error) {
    logger.error(`[${requestId}] Error creating tag definition`, error)
    return NextResponse.json({ error: 'Failed to create tag definition' }, { status: 500 })
  }
}
