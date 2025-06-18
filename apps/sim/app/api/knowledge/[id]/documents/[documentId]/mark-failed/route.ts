import { eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console-logger'
import { db } from '@/db'
import { document } from '@/db/schema'
import { checkDocumentAccess } from '../../../../utils'

const logger = createLogger('MarkFailedAPI')

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; documentId: string }> }
) {
  const requestId = crypto.randomUUID().slice(0, 8)
  const { id: knowledgeBaseId, documentId } = await params

  try {
    const session = await getSession()
    if (!session?.user?.id) {
      logger.warn(`[${requestId}] Unauthorized mark-failed attempt`)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const accessCheck = await checkDocumentAccess(knowledgeBaseId, documentId, session.user.id)

    if (!accessCheck.hasAccess) {
      if (accessCheck.notFound) {
        logger.warn(
          `[${requestId}] ${accessCheck.reason}: KB=${knowledgeBaseId}, Doc=${documentId}`
        )
        return NextResponse.json({ error: accessCheck.reason }, { status: 404 })
      }
      logger.warn(
        `[${requestId}] User ${session.user.id} attempted unauthorized mark-failed: ${accessCheck.reason}`
      )
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const doc = accessCheck.document

    // Verify the document is actually stuck in processing
    if (doc.processingStatus !== 'processing') {
      logger.warn(
        `[${requestId}] Document ${documentId} is not in processing state (current: ${doc.processingStatus})`
      )
      return NextResponse.json(
        { error: `Document is not in processing state (current: ${doc.processingStatus})` },
        { status: 400 }
      )
    }

    if (!doc.processingStartedAt) {
      logger.warn(`[${requestId}] Document ${documentId} has no processing start time`)
      return NextResponse.json({ error: 'Document has no processing start time' }, { status: 400 })
    }

    // Check if document has been processing for more than 150 seconds (dead process threshold)
    const now = new Date()
    const processingDuration = now.getTime() - new Date(doc.processingStartedAt).getTime()
    const DEAD_PROCESS_THRESHOLD_MS = 150 * 1000 // 150 seconds

    if (processingDuration <= DEAD_PROCESS_THRESHOLD_MS) {
      logger.warn(
        `[${requestId}] Document ${documentId} has only been processing for ${Math.round(processingDuration / 1000)}s (threshold: ${DEAD_PROCESS_THRESHOLD_MS / 1000}s)`
      )
      return NextResponse.json(
        { error: 'Document has not been processing long enough to be considered dead' },
        { status: 400 }
      )
    }

    // Mark document as failed due to dead process
    await db
      .update(document)
      .set({
        processingStatus: 'failed',
        processingError: 'Processing timed out - background process may have been terminated',
        processingCompletedAt: now,
      })
      .where(eq(document.id, documentId))

    logger.info(
      `[${requestId}] Marked document ${documentId} as failed due to dead process (processing time: ${Math.round(processingDuration / 1000)}s)`
    )

    return NextResponse.json({
      success: true,
      data: {
        documentId,
        previousStatus: 'processing',
        newStatus: 'failed',
        processingDuration: Math.round(processingDuration / 1000),
        message: 'Document marked as failed due to dead process',
      },
    })
  } catch (error) {
    logger.error(`[${requestId}] Error marking document as failed`, error)
    return NextResponse.json({ error: 'Failed to mark document as failed' }, { status: 500 })
  }
}
