import { and, eq, isNull } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import { type ProcessedDocument, processDocuments } from '@/lib/document-processor'
import { env } from '@/lib/env'
import { createLogger } from '@/lib/logs/console-logger'
import { db } from '@/db'
import { document, embedding, knowledgeBase } from '@/db/schema'

const logger = createLogger('ProcessDocumentsAPI')

// Schema for document processing request
const ProcessDocumentsSchema = z.object({
  documents: z
    .array(
      z.object({
        filename: z.string().min(1, 'Filename is required'),
        fileUrl: z.string().url('File URL must be valid'),
        fileSize: z.number().min(1, 'File size must be greater than 0'),
        mimeType: z.string().min(1, 'MIME type is required'),
        fileHash: z.string().optional(),
      })
    )
    .min(1, 'At least one document is required'),
  processingOptions: z
    .object({
      chunkSize: z.number().min(100).max(2048).default(512),
      minCharactersPerChunk: z.number().min(10).max(1000).default(24),
      recipe: z.string().default('default'),
      lang: z.string().default('en'),
    })
    .optional(),
})

async function checkKnowledgeBaseAccess(knowledgeBaseId: string, userId: string) {
  const kb = await db
    .select({
      id: knowledgeBase.id,
      userId: knowledgeBase.userId,
      chunkingConfig: knowledgeBase.chunkingConfig,
    })
    .from(knowledgeBase)
    .where(and(eq(knowledgeBase.id, knowledgeBaseId), isNull(knowledgeBase.deletedAt)))
    .limit(1)

  if (kb.length === 0) {
    return { hasAccess: false, notFound: true }
  }

  const kbData = kb[0]

  // Check if user owns the knowledge base
  if (kbData.userId === userId) {
    return { hasAccess: true, knowledgeBase: kbData }
  }

  return { hasAccess: false, knowledgeBase: kbData }
}

async function generateEmbeddings(
  texts: string[],
  embeddingModel = 'text-embedding-3-small'
): Promise<number[][]> {
  const openaiApiKey = env.OPENAI_API_KEY
  if (!openaiApiKey) {
    throw new Error('OPENAI_API_KEY not configured')
  }

  try {
    // Batch process embeddings for efficiency
    const batchSize = 100 // OpenAI allows up to 2048 inputs per request
    const allEmbeddings: number[][] = []

    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize)

      logger.info(
        `Generating embeddings for batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(texts.length / batchSize)} (${batch.length} texts)`
      )

      // Make direct API call to OpenAI embeddings
      const response = await fetch('https://api.openai.com/v1/embeddings', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${openaiApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          input: batch,
          model: embeddingModel,
          encoding_format: 'float',
        }),
      })

      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(
          `OpenAI API error: ${response.status} ${response.statusText} - ${errorText}`
        )
      }

      const data = await response.json()

      if (!data.data || !Array.isArray(data.data)) {
        throw new Error('Invalid response format from OpenAI embeddings API')
      }

      // Extract embeddings from response
      const batchEmbeddings = data.data.map((item: any) => item.embedding)
      allEmbeddings.push(...batchEmbeddings)
    }

    logger.info(`Successfully generated ${allEmbeddings.length} embeddings`)
    return allEmbeddings
  } catch (error) {
    logger.error('Failed to generate embeddings:', error)
    throw new Error(
      `Embedding generation failed: ${error instanceof Error ? error.message : 'Unknown error'}`
    )
  }
}

async function saveProcessedDocuments(
  knowledgeBaseId: string,
  processedDocuments: ProcessedDocument[],
  requestedDocuments: Array<{
    filename: string
    fileUrl: string
    fileSize: number
    mimeType: string
    fileHash?: string
  }>
) {
  const now = new Date()
  const results: Array<{
    documentId: string
    chunkCount: number
    success: boolean
    error?: string
  }> = []

  // Collect all chunk texts for batch embedding generation
  const allChunkTexts: string[] = []
  const chunkMapping: Array<{ docIndex: number; chunkIndex: number }> = []

  processedDocuments.forEach((processed, docIndex) => {
    processed.chunks.forEach((chunk, chunkIndex) => {
      allChunkTexts.push(chunk.text)
      chunkMapping.push({ docIndex, chunkIndex })
    })
  })

  // Generate embeddings for all chunks at once
  let allEmbeddings: number[][] = []
  if (allChunkTexts.length > 0) {
    try {
      logger.info(
        `Generating embeddings for ${allChunkTexts.length} chunks across ${processedDocuments.length} documents`
      )
      allEmbeddings = await generateEmbeddings(allChunkTexts, 'text-embedding-3-small')
      logger.info(`Successfully generated ${allEmbeddings.length} embeddings`)
    } catch (error) {
      logger.error('Failed to generate embeddings for chunks:', error)
      // Continue without embeddings rather than failing completely
      allEmbeddings = []
    }
  }

  for (let i = 0; i < processedDocuments.length; i++) {
    const processed = processedDocuments[i]
    const original = requestedDocuments.find((doc) => doc.filename === processed.metadata.filename)

    if (!original) {
      results.push({
        documentId: '',
        chunkCount: 0,
        success: false,
        error: `Original document data not found for ${processed.metadata.filename}`,
      })
      continue
    }

    try {
      // Check for duplicate file hash if provided
      if (original.fileHash) {
        const existingDocument = await db
          .select({ id: document.id })
          .from(document)
          .where(
            and(
              eq(document.knowledgeBaseId, knowledgeBaseId),
              eq(document.fileHash, original.fileHash),
              isNull(document.deletedAt)
            )
          )
          .limit(1)

        if (existingDocument.length > 0) {
          results.push({
            documentId: existingDocument[0].id,
            chunkCount: 0,
            success: false,
            error: 'Document with this file hash already exists',
          })
          continue
        }
      }

      // Insert document record
      const documentId = crypto.randomUUID()
      const newDocument = {
        id: documentId,
        knowledgeBaseId,
        filename: original.filename,
        fileUrl: processed.metadata.s3Url || original.fileUrl,
        fileSize: original.fileSize,
        mimeType: original.mimeType,
        fileHash: original.fileHash || null,
        chunkCount: processed.metadata.chunkCount,
        tokenCount: processed.metadata.tokenCount,
        characterCount: processed.metadata.characterCount,
        enabled: true,
        uploadedAt: now,
      }

      await db.insert(document).values(newDocument)

      // Insert embedding records for chunks with generated embeddings
      const embeddingRecords = processed.chunks.map((chunk, chunkIndex) => {
        // Find the corresponding embedding for this chunk
        const globalChunkIndex = chunkMapping.findIndex(
          (mapping) => mapping.docIndex === i && mapping.chunkIndex === chunkIndex
        )
        const embedding =
          globalChunkIndex >= 0 && globalChunkIndex < allEmbeddings.length
            ? allEmbeddings[globalChunkIndex]
            : null

        return {
          id: crypto.randomUUID(),
          knowledgeBaseId,
          documentId,
          chunkIndex: chunkIndex,
          chunkHash: crypto.randomUUID(), // Generate a hash for the chunk
          content: chunk.text,
          contentLength: chunk.text.length,
          tokenCount: Math.ceil(chunk.text.length / 4), // Rough token estimation
          embedding: embedding, // Store the generated OpenAI embedding
          embeddingModel: 'text-embedding-3-small',
          startOffset: chunk.startIndex || 0,
          endOffset: chunk.endIndex || chunk.text.length,
          overlapTokens: 0,
          metadata: {},
          searchRank: '1.0',
          accessCount: 0,
          lastAccessedAt: null,
          qualityScore: null,
          createdAt: now,
          updatedAt: now,
        }
      })

      if (embeddingRecords.length > 0) {
        await db.insert(embedding).values(embeddingRecords)
      }

      results.push({
        documentId,
        chunkCount: processed.metadata.chunkCount,
        success: true,
      })

      logger.info(
        `Document processed and saved: ${documentId} with ${processed.metadata.chunkCount} chunks and ${embeddingRecords.filter((r) => r.embedding).length} embeddings`
      )
    } catch (error) {
      logger.error(`Failed to save processed document ${processed.metadata.filename}:`, error)
      results.push({
        documentId: '',
        chunkCount: 0,
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error during save',
      })
    }
  }

  return results
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const requestId = crypto.randomUUID().slice(0, 8)
  const { id: knowledgeBaseId } = await params

  try {
    const session = await getSession()
    if (!session?.user?.id) {
      logger.warn(`[${requestId}] Unauthorized document processing attempt`)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const accessCheck = await checkKnowledgeBaseAccess(knowledgeBaseId, session.user.id)

    if (accessCheck.notFound) {
      logger.warn(`[${requestId}] Knowledge base not found: ${knowledgeBaseId}`)
      return NextResponse.json({ error: 'Knowledge base not found' }, { status: 404 })
    }

    if (!accessCheck.hasAccess) {
      logger.warn(
        `[${requestId}] User ${session.user.id} attempted to process documents in unauthorized knowledge base ${knowledgeBaseId}`
      )
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json()

    try {
      const validatedData = ProcessDocumentsSchema.parse(body)

      logger.info(
        `[${requestId}] Starting processing of ${validatedData.documents.length} documents`
      )

      // Get chunking config from knowledge base or use defaults
      const kbChunkingConfig = accessCheck.knowledgeBase?.chunkingConfig as any
      const processingOptions = {
        knowledgeBaseId,
        chunkSize: validatedData.processingOptions?.chunkSize || kbChunkingConfig?.maxSize || 512,
        minCharactersPerChunk:
          validatedData.processingOptions?.minCharactersPerChunk || kbChunkingConfig?.minSize || 24,
        recipe: validatedData.processingOptions?.recipe || 'default',
        lang: validatedData.processingOptions?.lang || 'en',
      }

      // Process documents (parsing + chunking)
      const processedDocuments = await processDocuments(
        validatedData.documents.map((doc) => ({
          fileUrl: doc.fileUrl,
          filename: doc.filename,
          mimeType: doc.mimeType,
          fileSize: doc.fileSize,
        })),
        processingOptions
      )

      // Save processed documents and chunks to database
      const saveResults = await saveProcessedDocuments(
        knowledgeBaseId,
        processedDocuments,
        validatedData.documents
      )

      const successfulCount = saveResults.filter((r) => r.success).length
      const totalChunks = saveResults.reduce((sum, r) => sum + r.chunkCount, 0)

      logger.info(
        `[${requestId}] Document processing completed: ${successfulCount}/${validatedData.documents.length} documents, ${totalChunks} total chunks`
      )

      return NextResponse.json({
        success: true,
        data: {
          processed: successfulCount,
          total: validatedData.documents.length,
          totalChunks,
          results: saveResults,
        },
      })
    } catch (validationError) {
      if (validationError instanceof z.ZodError) {
        logger.warn(`[${requestId}] Invalid document processing data`, {
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
    logger.error(`[${requestId}] Error processing documents`, error)
    return NextResponse.json(
      {
        error: 'Failed to process documents',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    )
  }
}
