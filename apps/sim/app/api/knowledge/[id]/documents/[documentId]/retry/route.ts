import { eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console-logger'
import { db } from '@/db'
import { document, embedding } from '@/db/schema'
import { checkDocumentAccess, processDocumentAsync } from '../../../../utils'

const logger = createLogger('DocumentRetryAPI')

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; documentId: string }> }
) {
  const requestId = crypto.randomUUID().slice(0, 8)
  const { id: knowledgeBaseId, documentId } = await params

  try {
    const session = await getSession()
    if (!session?.user?.id) {
      logger.warn(`[${requestId}] Unauthorized document retry attempt`)
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
        `[${requestId}] User ${session.user.id} attempted unauthorized document retry: ${accessCheck.reason}`
      )
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const doc = accessCheck.document

    if (doc.processingStatus !== 'failed') {
      logger.warn(
        `[${requestId}] Document ${documentId} is not in failed state (current: ${doc.processingStatus})`
      )
      return NextResponse.json({ error: 'Document is not in failed state' }, { status: 400 })
    }

    await db.transaction(async (tx) => {
      await tx.delete(embedding).where(eq(embedding.documentId, documentId))

      await tx
        .update(document)
        .set({
          processingStatus: 'pending',
          processingStartedAt: null,
          processingCompletedAt: null,
          processingError: null,
          chunkCount: 0,
          tokenCount: 0,
          characterCount: 0,
        })
        .where(eq(document.id, documentId))
    })

    const processingOptions = {
      chunkSize: 1024,
      minCharactersPerChunk: 24,
      recipe: 'default',
      lang: 'en',
    }

    const docData = {
      filename: doc.filename,
      fileUrl: doc.fileUrl,
      fileSize: doc.fileSize,
      mimeType: doc.mimeType,
      fileHash: doc.fileHash,
    }

    processDocumentAsync(knowledgeBaseId, documentId, docData, processingOptions).catch(
      (error: unknown) => {
        logger.error(`[${requestId}] Background retry processing error:`, error)
      }
    )

    logger.info(`[${requestId}] Document retry initiated: ${documentId}`)

    return NextResponse.json({
      success: true,
      data: {
        documentId,
        status: 'pending',
        message: 'Document retry processing started',
      },
    })
  } catch (error) {
    logger.error(`[${requestId}] Error retrying document processing`, error)
    return NextResponse.json({ error: 'Failed to retry document processing' }, { status: 500 })
  }
}
