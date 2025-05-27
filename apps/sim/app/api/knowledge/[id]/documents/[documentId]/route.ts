import { and, eq, isNull } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console-logger'
import { db } from '@/db'
import { document, knowledgeBase } from '@/db/schema'

const logger = createLogger('DocumentByIdAPI')

// Schema for document updates
const UpdateDocumentSchema = z.object({
  filename: z.string().min(1, 'Filename is required').optional(),
  enabled: z.boolean().optional(),
  chunkCount: z.number().min(0).optional(),
  tokenCount: z.number().min(0).optional(),
  characterCount: z.number().min(0).optional(),
})

async function checkDocumentAccess(knowledgeBaseId: string, documentId: string, userId: string) {
  // First check knowledge base access
  const kb = await db
    .select({
      id: knowledgeBase.id,
      userId: knowledgeBase.userId,
    })
    .from(knowledgeBase)
    .where(and(eq(knowledgeBase.id, knowledgeBaseId), isNull(knowledgeBase.deletedAt)))
    .limit(1)

  if (kb.length === 0) {
    return { hasAccess: false, notFound: true, reason: 'Knowledge base not found' }
  }

  const kbData = kb[0]

  // Check if user owns the knowledge base
  if (kbData.userId !== userId) {
    return { hasAccess: false, reason: 'Unauthorized knowledge base access' }
  }

  // Now check if document exists and belongs to the knowledge base
  const doc = await db
    .select()
    .from(document)
    .where(
      and(
        eq(document.id, documentId),
        eq(document.knowledgeBaseId, knowledgeBaseId),
        isNull(document.deletedAt)
      )
    )
    .limit(1)

  if (doc.length === 0) {
    return { hasAccess: false, notFound: true, reason: 'Document not found' }
  }

  return { hasAccess: true, document: doc[0], knowledgeBase: kbData }
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; documentId: string }> }
) {
  const requestId = crypto.randomUUID().slice(0, 8)
  const { id: knowledgeBaseId, documentId } = await params

  try {
    const session = await getSession()
    if (!session?.user?.id) {
      logger.warn(`[${requestId}] Unauthorized document access attempt`)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const accessCheck = await checkDocumentAccess(knowledgeBaseId, documentId, session.user.id)

    if (accessCheck.notFound) {
      logger.warn(`[${requestId}] ${accessCheck.reason}: KB=${knowledgeBaseId}, Doc=${documentId}`)
      return NextResponse.json({ error: accessCheck.reason }, { status: 404 })
    }

    if (!accessCheck.hasAccess) {
      logger.warn(
        `[${requestId}] User ${session.user.id} attempted unauthorized document access: ${accessCheck.reason}`
      )
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    logger.info(
      `[${requestId}] Retrieved document: ${documentId} from knowledge base ${knowledgeBaseId}`
    )

    return NextResponse.json({
      success: true,
      data: accessCheck.document,
    })
  } catch (error) {
    logger.error(`[${requestId}] Error fetching document`, error)
    return NextResponse.json({ error: 'Failed to fetch document' }, { status: 500 })
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; documentId: string }> }
) {
  const requestId = crypto.randomUUID().slice(0, 8)
  const { id: knowledgeBaseId, documentId } = await params

  try {
    const session = await getSession()
    if (!session?.user?.id) {
      logger.warn(`[${requestId}] Unauthorized document update attempt`)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const accessCheck = await checkDocumentAccess(knowledgeBaseId, documentId, session.user.id)

    if (accessCheck.notFound) {
      logger.warn(`[${requestId}] ${accessCheck.reason}: KB=${knowledgeBaseId}, Doc=${documentId}`)
      return NextResponse.json({ error: accessCheck.reason }, { status: 404 })
    }

    if (!accessCheck.hasAccess) {
      logger.warn(
        `[${requestId}] User ${session.user.id} attempted unauthorized document update: ${accessCheck.reason}`
      )
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json()

    try {
      const validatedData = UpdateDocumentSchema.parse(body)

      const updateData: any = {}

      if (validatedData.filename !== undefined) updateData.filename = validatedData.filename
      if (validatedData.enabled !== undefined) updateData.enabled = validatedData.enabled
      if (validatedData.chunkCount !== undefined) updateData.chunkCount = validatedData.chunkCount
      if (validatedData.tokenCount !== undefined) updateData.tokenCount = validatedData.tokenCount
      if (validatedData.characterCount !== undefined)
        updateData.characterCount = validatedData.characterCount

      await db.update(document).set(updateData).where(eq(document.id, documentId))

      // Fetch the updated document
      const updatedDocument = await db
        .select()
        .from(document)
        .where(eq(document.id, documentId))
        .limit(1)

      logger.info(
        `[${requestId}] Document updated: ${documentId} in knowledge base ${knowledgeBaseId}`
      )

      return NextResponse.json({
        success: true,
        data: updatedDocument[0],
      })
    } catch (validationError) {
      if (validationError instanceof z.ZodError) {
        logger.warn(`[${requestId}] Invalid document update data`, {
          errors: validationError.errors,
        })
        return NextResponse.json(
          { error: 'Invalid request data', details: validationError.errors },
          { status: 400 }
        )
      }
      throw validationError
    }
  } catch (error) {
    logger.error(`[${requestId}] Error updating document`, error)
    return NextResponse.json({ error: 'Failed to update document' }, { status: 500 })
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; documentId: string }> }
) {
  const requestId = crypto.randomUUID().slice(0, 8)
  const { id: knowledgeBaseId, documentId } = await params

  try {
    const session = await getSession()
    if (!session?.user?.id) {
      logger.warn(`[${requestId}] Unauthorized document delete attempt`)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const accessCheck = await checkDocumentAccess(knowledgeBaseId, documentId, session.user.id)

    if (accessCheck.notFound) {
      logger.warn(`[${requestId}] ${accessCheck.reason}: KB=${knowledgeBaseId}, Doc=${documentId}`)
      return NextResponse.json({ error: accessCheck.reason }, { status: 404 })
    }

    if (!accessCheck.hasAccess) {
      logger.warn(
        `[${requestId}] User ${session.user.id} attempted unauthorized document deletion: ${accessCheck.reason}`
      )
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Soft delete by setting deletedAt timestamp
    await db
      .update(document)
      .set({
        deletedAt: new Date(),
      })
      .where(eq(document.id, documentId))

    logger.info(
      `[${requestId}] Document deleted: ${documentId} from knowledge base ${knowledgeBaseId}`
    )

    return NextResponse.json({
      success: true,
      data: { message: 'Document deleted successfully' },
    })
  } catch (error) {
    logger.error(`[${requestId}] Error deleting document`, error)
    return NextResponse.json({ error: 'Failed to delete document' }, { status: 500 })
  }
}
