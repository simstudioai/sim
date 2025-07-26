import { randomUUID } from 'crypto'
import { and, eq, isNotNull, or } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console-logger'
import { checkKnowledgeBaseAccess, checkKnowledgeBaseWriteAccess } from '@/app/api/knowledge/utils'
import { db } from '@/db'
import { document, knowledgeBaseTagDefinitions } from '@/db/schema'

export const dynamic = 'force-dynamic'

const logger = createLogger('DocumentTagDefinitionsAPI')

const TagDefinitionSchema = z.object({
  tagSlot: z.enum(['tag1', 'tag2', 'tag3', 'tag4', 'tag5', 'tag6', 'tag7']),
  displayName: z.string().min(1, 'Display name is required').max(100, 'Display name too long'),
  fieldType: z.string().default('text'), // Currently only 'text', future: 'date', 'number', 'range'
})

const BulkTagDefinitionsSchema = z.object({
  definitions: z.array(TagDefinitionSchema).max(7, 'Cannot define more than 7 tags'),
})

// Helper function to clean up unused tag definitions
async function cleanupUnusedTagDefinitions(knowledgeBaseId: string, requestId: string) {
  try {
    // Get all current tag definitions for this KB
    const currentDefinitions = await db
      .select({
        id: knowledgeBaseTagDefinitions.id,
        displayName: knowledgeBaseTagDefinitions.displayName,
        tagSlot: knowledgeBaseTagDefinitions.tagSlot,
      })
      .from(knowledgeBaseTagDefinitions)
      .where(eq(knowledgeBaseTagDefinitions.knowledgeBaseId, knowledgeBaseId))

    if (currentDefinitions.length === 0) {
      return 0 // No definitions to clean up
    }

    // Check which tag names are actually in use by documents
    const documentsWithTags = await db
      .select({
        tag1: document.tag1,
        tag2: document.tag2,
        tag3: document.tag3,
        tag4: document.tag4,
        tag5: document.tag5,
        tag6: document.tag6,
        tag7: document.tag7,
      })
      .from(document)
      .where(
        and(
          eq(document.knowledgeBaseId, knowledgeBaseId),
          or(
            isNotNull(document.tag1),
            isNotNull(document.tag2),
            isNotNull(document.tag3),
            isNotNull(document.tag4),
            isNotNull(document.tag5),
            isNotNull(document.tag6),
            isNotNull(document.tag7)
          )
        )
      )

    // Collect all tag names that are actually in use
    const usedTagNames = new Set<string>()
    for (const doc of documentsWithTags) {
      const tagSlots = ['tag1', 'tag2', 'tag3', 'tag4', 'tag5', 'tag6', 'tag7'] as const
      for (const slot of tagSlots) {
        const tagValue = doc[slot]
        if (tagValue?.trim()) {
          // Find the tag definition for this slot to get the display name
          const definition = currentDefinitions.find((def) => def.tagSlot === slot)
          if (definition) {
            usedTagNames.add(definition.displayName)
          }
        }
      }
    }

    // Find definitions that are not in use
    const unusedDefinitions = currentDefinitions.filter((def) => !usedTagNames.has(def.displayName))

    if (unusedDefinitions.length === 0) {
      return 0 // No unused definitions
    }

    // Remove unused definitions
    const unusedIds = unusedDefinitions.map((def) => def.id)
    await db
      .delete(knowledgeBaseTagDefinitions)
      .where(
        and(
          eq(knowledgeBaseTagDefinitions.knowledgeBaseId, knowledgeBaseId),
          or(...unusedIds.map((id) => eq(knowledgeBaseTagDefinitions.id, id)))
        )
      )

    logger.info(`[${requestId}] Cleaned up ${unusedDefinitions.length} unused tag definitions`)
    return unusedDefinitions.length
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

    const body = await req.json()
    const validatedData = BulkTagDefinitionsSchema.parse(body)

    // Validate no duplicate tag slots
    const tagSlots = validatedData.definitions.map((def) => def.tagSlot)
    const uniqueTagSlots = new Set(tagSlots)
    if (tagSlots.length !== uniqueTagSlots.size) {
      return NextResponse.json({ error: 'Duplicate tag slots not allowed' }, { status: 400 })
    }

    const now = new Date()
    const createdDefinitions = []

    // Get existing definitions count before transaction for cleanup check
    const existingDefinitions = await db
      .select()
      .from(knowledgeBaseTagDefinitions)
      .where(eq(knowledgeBaseTagDefinitions.knowledgeBaseId, knowledgeBaseId))

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

    // Run cleanup immediately - document values should be saved before tag definitions
    const cleanedUpCount = await cleanupUnusedTagDefinitions(knowledgeBaseId, requestId)
    if (cleanedUpCount > 0) {
      logger.info(
        `[${requestId}] Created/updated ${createdDefinitions.length} tag definitions, cleaned up ${cleanedUpCount} unused definitions`
      )
    } else {
      logger.info(`[${requestId}] Created/updated ${createdDefinitions.length} tag definitions`)
    }

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

  try {
    logger.info(`[${requestId}] Deleting tag definitions for document ${documentId}`)

    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Check if user has write access to the knowledge base
    const accessCheck = await checkKnowledgeBaseWriteAccess(knowledgeBaseId, session.user.id)
    if (!accessCheck.hasAccess) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Delete tag definitions for the knowledge base
    const result = await db
      .delete(knowledgeBaseTagDefinitions)
      .where(eq(knowledgeBaseTagDefinitions.knowledgeBaseId, knowledgeBaseId))

    logger.info(`[${requestId}] Deleted tag definitions for document ${documentId}`)

    return NextResponse.json({
      success: true,
      message: 'Tag definitions deleted successfully',
    })
  } catch (error) {
    logger.error(`[${requestId}] Error deleting tag definitions`, error)
    return NextResponse.json({ error: 'Failed to delete tag definitions' }, { status: 500 })
  }
}
