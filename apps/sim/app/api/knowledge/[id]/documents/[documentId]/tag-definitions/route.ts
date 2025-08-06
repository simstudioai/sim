import { randomUUID } from 'crypto'
import { and, eq, sql } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import {
  getMaxSlotsForFieldType,
  getSlotsForFieldType,
  SUPPORTED_FIELD_TYPES,
} from '@/lib/constants/knowledge'
import { createLogger } from '@/lib/logs/console/logger'
import { checkKnowledgeBaseAccess, checkKnowledgeBaseWriteAccess } from '@/app/api/knowledge/utils'
import { db } from '@/db'
import { document, knowledgeBaseTagDefinitions } from '@/db/schema'

export const dynamic = 'force-dynamic'

const logger = createLogger('DocumentTagDefinitionsAPI')

const TagDefinitionSchema = z.object({
  tagSlot: z.string(), // Will be validated against field type slots
  displayName: z.string().min(1, 'Display name is required').max(100, 'Display name too long'),
  fieldType: z.enum(SUPPORTED_FIELD_TYPES as [string, ...string[]]).default('text'),
  // Optional: for editing existing definitions
  _originalDisplayName: z.string().optional(),
})

const BulkTagDefinitionsSchema = z.object({
  definitions: z.array(TagDefinitionSchema),
})

// Helper function to get the next available slot for a knowledge base and field type
async function getNextAvailableSlot(
  knowledgeBaseId: string,
  fieldType: string,
  existingBySlot?: Map<string, any>
): Promise<string | null> {
  // Get available slots for this field type
  const availableSlots = getSlotsForFieldType(fieldType)
  let usedSlots: Set<string>

  if (existingBySlot) {
    // Use provided map if available (for performance in batch operations)
    // Filter by field type
    usedSlots = new Set(
      Array.from(existingBySlot.entries())
        .filter(([_, def]) => def.fieldType === fieldType)
        .map(([slot, _]) => slot)
    )
  } else {
    // Query database for existing tag definitions of the same field type
    const existingDefinitions = await db
      .select({ tagSlot: knowledgeBaseTagDefinitions.tagSlot })
      .from(knowledgeBaseTagDefinitions)
      .where(
        and(
          eq(knowledgeBaseTagDefinitions.knowledgeBaseId, knowledgeBaseId),
          eq(knowledgeBaseTagDefinitions.fieldType, fieldType)
        )
      )

    usedSlots = new Set(existingDefinitions.map((def) => def.tagSlot))
  }

  // Find the first available slot for this field type
  for (const slot of availableSlots) {
    if (!usedSlots.has(slot)) {
      return slot
    }
  }

  return null // No available slots for this field type
}

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

    // Validate slots are valid for their field types
    for (const definition of validatedData.definitions) {
      const validSlots = getSlotsForFieldType(definition.fieldType)
      if (validSlots.length === 0) {
        return NextResponse.json(
          { error: `Unsupported field type: ${definition.fieldType}` },
          { status: 400 }
        )
      }

      if (!validSlots.includes(definition.tagSlot)) {
        return NextResponse.json(
          {
            error: `Invalid slot '${definition.tagSlot}' for field type '${definition.fieldType}'. Valid slots: ${validSlots.join(', ')}`,
          },
          { status: 400 }
        )
      }
    }

    // Validate no duplicate tag slots within the same field type
    const slotsByFieldType = new Map<string, Set<string>>()
    for (const definition of validatedData.definitions) {
      if (!slotsByFieldType.has(definition.fieldType)) {
        slotsByFieldType.set(definition.fieldType, new Set())
      }
      const slotsForType = slotsByFieldType.get(definition.fieldType)!
      if (slotsForType.has(definition.tagSlot)) {
        return NextResponse.json(
          {
            error: `Duplicate slot '${definition.tagSlot}' for field type '${definition.fieldType}'`,
          },
          { status: 400 }
        )
      }
      slotsForType.add(definition.tagSlot)
    }

    const now = new Date()
    const createdDefinitions: (typeof knowledgeBaseTagDefinitions.$inferSelect)[] = []

    // Get existing definitions
    const existingDefinitions = await db
      .select()
      .from(knowledgeBaseTagDefinitions)
      .where(eq(knowledgeBaseTagDefinitions.knowledgeBaseId, knowledgeBaseId))

    // Group by field type for validation
    const existingByFieldType = new Map<string, number>()
    for (const def of existingDefinitions) {
      existingByFieldType.set(def.fieldType, (existingByFieldType.get(def.fieldType) || 0) + 1)
    }

    // Validate we don't exceed limits per field type
    const newByFieldType = new Map<string, number>()
    for (const definition of validatedData.definitions) {
      // Skip validation for edit operations - they don't create new slots
      if (definition._originalDisplayName) {
        continue
      }

      const existingTagNames = new Set(
        existingDefinitions
          .filter((def) => def.fieldType === definition.fieldType)
          .map((def) => def.displayName)
      )

      if (!existingTagNames.has(definition.displayName)) {
        newByFieldType.set(
          definition.fieldType,
          (newByFieldType.get(definition.fieldType) || 0) + 1
        )
      }
    }

    for (const [fieldType, newCount] of newByFieldType.entries()) {
      const existingCount = existingByFieldType.get(fieldType) || 0
      const maxSlots = getMaxSlotsForFieldType(fieldType)

      if (existingCount + newCount > maxSlots) {
        return NextResponse.json(
          {
            error: `Cannot create ${newCount} new '${fieldType}' tags. Knowledge base already has ${existingCount} '${fieldType}' tag definitions. Maximum is ${maxSlots} per field type.`,
          },
          { status: 400 }
        )
      }
    }

    // Use transaction to ensure consistency
    await db.transaction(async (tx) => {
      // Create maps for lookups
      const existingByName = new Map(existingDefinitions.map((def) => [def.displayName, def]))
      const existingBySlot = new Map(existingDefinitions.map((def) => [def.tagSlot, def]))

      // Process each definition
      for (const definition of validatedData.definitions) {
        if (definition._originalDisplayName) {
          // This is an EDIT operation - find by original name and update
          const originalDefinition = existingByName.get(definition._originalDisplayName)

          if (originalDefinition) {
            logger.info(
              `[${requestId}] Editing tag definition: ${definition._originalDisplayName} -> ${definition.displayName} (slot ${originalDefinition.tagSlot})`
            )

            await tx
              .update(knowledgeBaseTagDefinitions)
              .set({
                displayName: definition.displayName,
                fieldType: definition.fieldType,
                updatedAt: now,
              })
              .where(eq(knowledgeBaseTagDefinitions.id, originalDefinition.id))

            createdDefinitions.push({
              ...originalDefinition,
              displayName: definition.displayName,
              fieldType: definition.fieldType,
              updatedAt: now,
            })
            continue
          }
          logger.warn(
            `[${requestId}] Could not find original definition for: ${definition._originalDisplayName}`
          )
        }

        // Regular create/update logic
        const existingByDisplayName = existingByName.get(definition.displayName)

        if (existingByDisplayName) {
          // Display name exists - UPDATE operation
          logger.info(
            `[${requestId}] Updating existing tag definition: ${definition.displayName} (slot ${existingByDisplayName.tagSlot})`
          )

          await tx
            .update(knowledgeBaseTagDefinitions)
            .set({
              fieldType: definition.fieldType,
              updatedAt: now,
            })
            .where(eq(knowledgeBaseTagDefinitions.id, existingByDisplayName.id))

          createdDefinitions.push({
            ...existingByDisplayName,
            fieldType: definition.fieldType,
            updatedAt: now,
          })
        } else {
          // Display name doesn't exist - CREATE operation
          const targetSlot = await getNextAvailableSlot(
            knowledgeBaseId,
            definition.fieldType,
            existingBySlot
          )

          if (!targetSlot) {
            logger.error(
              `[${requestId}] No available slots for new tag definition: ${definition.displayName}`
            )
            continue
          }

          logger.info(
            `[${requestId}] Creating new tag definition: ${definition.displayName} -> ${targetSlot}`
          )

          const newDefinition = {
            id: randomUUID(),
            knowledgeBaseId,
            tagSlot: targetSlot as any,
            displayName: definition.displayName,
            fieldType: definition.fieldType,
            createdAt: now,
            updatedAt: now,
          }

          await tx.insert(knowledgeBaseTagDefinitions).values(newDefinition)
          existingBySlot.set(targetSlot as any, newDefinition)
          createdDefinitions.push(newDefinition as any)
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
