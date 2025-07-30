import { randomUUID } from 'crypto'
import { and, eq, sql } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import { MAX_TAG_SLOTS, TAG_SLOTS } from '@/lib/constants/knowledge'
import { createLogger } from '@/lib/logs/console/logger'
import { checkKnowledgeBaseAccess, checkKnowledgeBaseWriteAccess } from '@/app/api/knowledge/utils'
import { db } from '@/db'
import { document, knowledgeBaseTagDefinitions } from '@/db/schema'

export const dynamic = 'force-dynamic'

const logger = createLogger('DocumentTagDefinitionsAPI')

const TagDefinitionSchema = z.object({
  tagSlot: z.enum(TAG_SLOTS as [string, ...string[]]),
  displayName: z.string().min(1, 'Display name is required').max(100, 'Display name too long'),
  fieldType: z.string().default('text'), // Currently only 'text', future: 'date', 'number', 'range'
})

const BulkTagDefinitionsSchema = z.object({
  definitions: z
    .array(TagDefinitionSchema)
    .max(MAX_TAG_SLOTS, `Cannot define more than ${MAX_TAG_SLOTS} tags`),
})

// Helper function to clean up unused tag definitions
async function cleanupUnusedTagDefinitions(knowledgeBaseId: string, requestId: string) {
  try {
    logger.info(`[${requestId}] Starting cleanup for KB ${knowledgeBaseId}`)

    // Get all tag definitions for this KB
    const allDefinitions = await db
      .select()
      .from(knowledgeBaseTagDefinitions)
      .where(eq(knowledgeBaseTagDefinitions.knowledgeBaseId, knowledgeBaseId))

    logger.info(`[${requestId}] Found ${allDefinitions.length} tag definitions to check`)

    if (allDefinitions.length === 0) {
      return 0
    }

    let cleanedCount = 0

    // For each tag definition, check if any documents use that tag slot
    for (const definition of allDefinitions) {
      const slot = definition.tagSlot

      // Use raw SQL with proper column name injection
      const countResult = await db.execute(sql`
        SELECT count(*) as count
        FROM document
        WHERE knowledge_base_id = ${knowledgeBaseId}
        AND ${sql.raw(slot)} IS NOT NULL
        AND trim(${sql.raw(slot)}) != ''
      `)
      const count = Number(countResult[0]?.count) || 0

      logger.info(
        `[${requestId}] Tag ${definition.displayName} (${slot}): ${count} documents using it`
      )

      // If count is 0, remove this tag definition
      if (count === 0) {
        await db
          .delete(knowledgeBaseTagDefinitions)
          .where(eq(knowledgeBaseTagDefinitions.id, definition.id))

        cleanedCount++
        logger.info(
          `[${requestId}] Removed unused tag definition: ${definition.displayName} (${definition.tagSlot})`
        )
      }
    }

    return cleanedCount
  } catch (error) {
    logger.warn(`[${requestId}] Failed to cleanup unused tag definitions:`, error)
    return 0 // Don't fail the main operation if cleanup fails
  }
}

// GET /api/knowledge/[id]/documents/[documentId]/tag-definitions - Get tag definitions for a document
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; documentId: string }> }
) {
  const requestId = randomUUID().slice(0, 8)
  const { id: knowledgeBaseId, documentId } = await params

  try {
    logger.info(`[${requestId}] Getting tag definitions for document ${documentId}`)

    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Check if user has access to the knowledge base
    const accessCheck = await checkKnowledgeBaseAccess(knowledgeBaseId, session.user.id)
    if (!accessCheck.hasAccess) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Verify document exists and belongs to the knowledge base
    const documentExists = await db
      .select({ id: document.id })
      .from(document)
      .where(and(eq(document.id, documentId), eq(document.knowledgeBaseId, knowledgeBaseId)))
      .limit(1)

    if (documentExists.length === 0) {
      return NextResponse.json({ error: 'Document not found' }, { status: 404 })
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

// POST /api/knowledge/[id]/documents/[documentId]/tag-definitions - Create/update tag definitions
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; documentId: string }> }
) {
  const requestId = randomUUID().slice(0, 8)
  const { id: knowledgeBaseId, documentId } = await params

  try {
    logger.info(`[${requestId}] Creating/updating tag definitions for document ${documentId}`)

    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Check if user has write access to the knowledge base
    const accessCheck = await checkKnowledgeBaseWriteAccess(knowledgeBaseId, session.user.id)
    if (!accessCheck.hasAccess) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Verify document exists and belongs to the knowledge base
    const documentExists = await db
      .select({ id: document.id })
      .from(document)
      .where(and(eq(document.id, documentId), eq(document.knowledgeBaseId, knowledgeBaseId)))
      .limit(1)

    if (documentExists.length === 0) {
      return NextResponse.json({ error: 'Document not found' }, { status: 404 })
    }

    let body
    try {
      body = await req.json()
    } catch (error) {
      logger.error(`[${requestId}] Failed to parse JSON body:`, error)
      return NextResponse.json({ error: 'Invalid JSON in request body' }, { status: 400 })
    }

    if (!body || typeof body !== 'object') {
      logger.error(`[${requestId}] Invalid request body:`, body)
      return NextResponse.json(
        { error: 'Request body must be a valid JSON object' },
        { status: 400 }
      )
    }

    const validatedData = BulkTagDefinitionsSchema.parse(body)

    // Validate no duplicate tag slots
    const tagSlots = validatedData.definitions.map((def) => def.tagSlot)
    const uniqueTagSlots = new Set(tagSlots)
    if (tagSlots.length !== uniqueTagSlots.size) {
      return NextResponse.json({ error: 'Duplicate tag slots not allowed' }, { status: 400 })
    }

    const now = new Date()
    const createdDefinitions: (typeof knowledgeBaseTagDefinitions.$inferSelect)[] = []

    // Get existing definitions count before transaction for cleanup check
    const existingDefinitions = await db
      .select()
      .from(knowledgeBaseTagDefinitions)
      .where(eq(knowledgeBaseTagDefinitions.knowledgeBaseId, knowledgeBaseId))

    // Check if we're trying to create more tag definitions than available slots
    const existingTagNames = new Set(existingDefinitions.map((def) => def.displayName))
    const trulyNewTags = validatedData.definitions.filter(
      (def) => !existingTagNames.has(def.displayName)
    )

    if (existingDefinitions.length + trulyNewTags.length > MAX_TAG_SLOTS) {
      return NextResponse.json(
        {
          error: `Cannot create ${trulyNewTags.length} new tags. Knowledge base already has ${existingDefinitions.length} tag definitions. Maximum is ${MAX_TAG_SLOTS} total.`,
        },
        { status: 400 }
      )
    }

    // Use transaction to ensure consistency
    await db.transaction(async (tx) => {
      // Create maps for lookups
      const existingByName = new Map(existingDefinitions.map((def) => [def.displayName, def]))
      const existingBySlot = new Map(existingDefinitions.map((def) => [def.tagSlot, def]))

      // Process each new definition
      for (const definition of validatedData.definitions) {
        const existingByDisplayName = existingByName.get(definition.displayName)
        const existingByTagSlot = existingBySlot.get(definition.tagSlot)

        if (existingByDisplayName) {
          // Update existing definition (same display name)
          if (existingByDisplayName.tagSlot !== definition.tagSlot) {
            // Slot is changing - check if target slot is available
            if (existingByTagSlot && existingByTagSlot.id !== existingByDisplayName.id) {
              // Target slot is occupied by a different definition - this is a conflict
              // For now, keep the existing slot to avoid constraint violation
              logger.warn(
                `[${requestId}] Slot conflict for ${definition.displayName}: keeping existing slot ${existingByDisplayName.tagSlot}`
              )
              createdDefinitions.push(existingByDisplayName)
              continue
            }
          }

          await tx
            .update(knowledgeBaseTagDefinitions)
            .set({
              tagSlot: definition.tagSlot,
              fieldType: definition.fieldType,
              updatedAt: now,
            })
            .where(eq(knowledgeBaseTagDefinitions.id, existingByDisplayName.id))

          createdDefinitions.push({
            ...existingByDisplayName,
            tagSlot: definition.tagSlot,
            fieldType: definition.fieldType,
            updatedAt: now,
          })
        } else if (existingByTagSlot) {
          // Slot is occupied by a different display name - update it
          await tx
            .update(knowledgeBaseTagDefinitions)
            .set({
              displayName: definition.displayName,
              fieldType: definition.fieldType,
              updatedAt: now,
            })
            .where(eq(knowledgeBaseTagDefinitions.id, existingByTagSlot.id))

          createdDefinitions.push({
            ...existingByTagSlot,
            displayName: definition.displayName,
            fieldType: definition.fieldType,
            updatedAt: now,
          })
        } else {
          // Create new definition
          const newDefinition = {
            id: randomUUID(),
            knowledgeBaseId,
            tagSlot: definition.tagSlot,
            displayName: definition.displayName,
            fieldType: definition.fieldType,
            createdAt: now,
            updatedAt: now,
          }

          await tx.insert(knowledgeBaseTagDefinitions).values(newDefinition)
          createdDefinitions.push(newDefinition)
        }
      }
    })

    logger.info(`[${requestId}] Created/updated ${createdDefinitions.length} tag definitions`)

    return NextResponse.json({
      success: true,
      data: createdDefinitions,
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid request data', details: error.errors },
        { status: 400 }
      )
    }

    logger.error(`[${requestId}] Error creating/updating tag definitions`, error)
    return NextResponse.json({ error: 'Failed to create/update tag definitions' }, { status: 500 })
  }
}

// DELETE /api/knowledge/[id]/documents/[documentId]/tag-definitions - Delete all tag definitions for a document
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; documentId: string }> }
) {
  const requestId = randomUUID().slice(0, 8)
  const { id: knowledgeBaseId, documentId } = await params
  const { searchParams } = new URL(req.url)
  const action = searchParams.get('action') // 'cleanup' or 'all'

  try {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Check if user has write access to the knowledge base
    const accessCheck = await checkKnowledgeBaseWriteAccess(knowledgeBaseId, session.user.id)
    if (!accessCheck.hasAccess) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    if (action === 'cleanup') {
      // Just run cleanup
      logger.info(`[${requestId}] Running cleanup for KB ${knowledgeBaseId}`)
      const cleanedUpCount = await cleanupUnusedTagDefinitions(knowledgeBaseId, requestId)

      return NextResponse.json({
        success: true,
        data: { cleanedUp: cleanedUpCount },
      })
    }
    // Delete all tag definitions (original behavior)
    logger.info(`[${requestId}] Deleting all tag definitions for KB ${knowledgeBaseId}`)

    const result = await db
      .delete(knowledgeBaseTagDefinitions)
      .where(eq(knowledgeBaseTagDefinitions.knowledgeBaseId, knowledgeBaseId))

    return NextResponse.json({
      success: true,
      message: 'Tag definitions deleted successfully',
    })
  } catch (error) {
    logger.error(`[${requestId}] Error with tag definitions operation`, error)
    return NextResponse.json({ error: 'Failed to process tag definitions' }, { status: 500 })
  }
}
