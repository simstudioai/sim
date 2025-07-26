import { randomUUID } from 'crypto'
import { and, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console-logger'
import { checkKnowledgeBaseAccess, checkKnowledgeBaseWriteAccess } from '@/app/api/knowledge/utils'
import { db } from '@/db'
import { document, documentTagDefinitions } from '@/db/schema'

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

    // Get tag definitions for the document
    const tagDefinitions = await db
      .select({
        id: documentTagDefinitions.id,
        tagSlot: documentTagDefinitions.tagSlot,
        displayName: documentTagDefinitions.displayName,
        fieldType: documentTagDefinitions.fieldType,
        createdAt: documentTagDefinitions.createdAt,
        updatedAt: documentTagDefinitions.updatedAt,
      })
      .from(documentTagDefinitions)
      .where(eq(documentTagDefinitions.documentId, documentId))

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

    // Use transaction to ensure consistency
    await db.transaction(async (tx) => {
      // First, delete existing definitions for this document
      await tx
        .delete(documentTagDefinitions)
        .where(eq(documentTagDefinitions.documentId, documentId))

      // Then insert new definitions if any
      if (validatedData.definitions.length > 0) {
        const newDefinitions = validatedData.definitions.map((definition) => ({
          id: randomUUID(),
          documentId,
          tagSlot: definition.tagSlot,
          displayName: definition.displayName,
          fieldType: definition.fieldType,
          createdAt: now,
          updatedAt: now,
        }))

        await tx.insert(documentTagDefinitions).values(newDefinitions)
        createdDefinitions.push(...newDefinitions)
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

    // Delete tag definitions for the document
    const result = await db
      .delete(documentTagDefinitions)
      .where(eq(documentTagDefinitions.documentId, documentId))

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
