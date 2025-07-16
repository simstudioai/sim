#!/usr/bin/env bun

import path from 'path'
import { sql } from 'drizzle-orm'
import { DocsChunker } from '@/lib/documents/docs-chunker'
import { isDev } from '@/lib/environment'
import { createLogger } from '@/lib/logs/console-logger'
import { db } from '@/db'
import { docsEmbeddings } from '@/db/schema'

const logger = createLogger('ProcessDocsEmbeddings')

interface ProcessingOptions {
  /** Clear existing docs embeddings before processing */
  clearExisting?: boolean
  /** Path to docs directory */
  docsPath?: string
  /** Base URL for generating links */
  baseUrl?: string
  /** Chunk size in tokens */
  chunkSize?: number
  /** Minimum chunk size in tokens */
  minChunkSize?: number
  /** Overlap between chunks in tokens */
  overlap?: number
}

/**
 * Production script to process documentation and save embeddings to database
 */
async function processDocsEmbeddings(options: ProcessingOptions = {}) {
  const startTime = Date.now()
  let processedChunks = 0
  let failedChunks = 0

  try {
    // Configuration
    const config = {
      clearExisting: options.clearExisting ?? false,
      docsPath: options.docsPath ?? path.join(process.cwd(), '../../apps/docs/content/docs'),
      // Use localhost docs in development, production docs otherwise
      baseUrl: options.baseUrl ?? (isDev ? 'http://localhost:3001' : 'https://docs.simstudio.ai'),
      chunkSize: options.chunkSize ?? 300, // Max 300 tokens per chunk
      minChunkSize: options.minChunkSize ?? 100,
      overlap: options.overlap ?? 50,
    }

    logger.info('🚀 Starting docs embedding processing...')
    logger.info(`Configuration:`, {
      docsPath: config.docsPath,
      baseUrl: config.baseUrl,
      chunkSize: config.chunkSize,
      clearExisting: config.clearExisting,
    })

    // Clear existing embeddings if requested
    if (config.clearExisting) {
      logger.info('🗑️ Clearing existing docs embeddings...')
      try {
        const deleteResult = await db.delete(docsEmbeddings)
        logger.info(`✅ Successfully deleted existing embeddings`)
      } catch (error) {
        logger.error('❌ Failed to delete existing embeddings:', error)
        throw new Error('Failed to clear existing embeddings')
      }
    }

    // Initialize the docs chunker
    const chunker = new DocsChunker({
      chunkSize: config.chunkSize,
      minChunkSize: config.minChunkSize,
      overlap: config.overlap,
      baseUrl: config.baseUrl,
    })

    // Process all .mdx files
    logger.info(`📚 Processing docs from: ${config.docsPath}`)
    const chunks = await chunker.chunkAllDocs(config.docsPath)

    if (chunks.length === 0) {
      logger.warn('⚠️ No chunks generated from docs')
      return { success: false, processedChunks: 0, failedChunks: 0 }
    }

    logger.info(`📊 Generated ${chunks.length} chunks with embeddings`)

    // Save chunks to database in batches for better performance
    const batchSize = 10
    logger.info(`💾 Saving chunks to database (batch size: ${batchSize})...`)

    for (let i = 0; i < chunks.length; i += batchSize) {
      const batch = chunks.slice(i, i + batchSize)

      try {
        // Prepare batch data
        const batchData = batch.map((chunk) => ({
          chunkText: chunk.text,
          sourceDocument: chunk.sourceDocument,
          sourceLink: chunk.headerLink,
          headerText: chunk.headerText,
          headerLevel: chunk.headerLevel,
          tokenCount: chunk.tokenCount,
          embedding: chunk.embedding,
          embeddingModel: chunk.embeddingModel,
          metadata: chunk.metadata,
        }))

        // Insert batch
        await db.insert(docsEmbeddings).values(batchData)

        processedChunks += batch.length

        if (i % (batchSize * 5) === 0 || i + batchSize >= chunks.length) {
          logger.info(
            `  💾 Saved ${Math.min(i + batchSize, chunks.length)}/${chunks.length} chunks`
          )
        }
      } catch (error) {
        logger.error(`❌ Failed to save batch ${Math.floor(i / batchSize) + 1}:`, error)
        failedChunks += batch.length
      }
    }

    // Verify results
    const savedCount = await db
      .select({ count: sql<number>`count(*)` })
      .from(docsEmbeddings)
      .then((result) => result[0]?.count || 0)

    const duration = Date.now() - startTime

    logger.info(`✅ Processing complete!`)
    logger.info(`📊 Results:`)
    logger.info(`  • Total chunks processed: ${chunks.length}`)
    logger.info(`  • Successfully saved: ${processedChunks}`)
    logger.info(`  • Failed: ${failedChunks}`)
    logger.info(`  • Database total: ${savedCount}`)
    logger.info(`  • Duration: ${Math.round(duration / 1000)}s`)

    // Summary by document
    const documentStats = chunks.reduce(
      (acc, chunk) => {
        if (!acc[chunk.sourceDocument]) {
          acc[chunk.sourceDocument] = { chunks: 0, tokens: 0 }
        }
        acc[chunk.sourceDocument].chunks++
        acc[chunk.sourceDocument].tokens += chunk.tokenCount
        return acc
      },
      {} as Record<string, { chunks: number; tokens: number }>
    )

    logger.info(`📋 Document breakdown:`)
    Object.entries(documentStats)
      .sort(([, a], [, b]) => b.chunks - a.chunks)
      .slice(0, 10) // Top 10 documents
      .forEach(([doc, stats]) => {
        logger.info(`  • ${doc}: ${stats.chunks} chunks, ${stats.tokens} tokens`)
      })

    if (Object.keys(documentStats).length > 10) {
      logger.info(`  • ... and ${Object.keys(documentStats).length - 10} more documents`)
    }

    return {
      success: failedChunks === 0,
      processedChunks,
      failedChunks,
      totalChunks: chunks.length,
      databaseCount: savedCount,
      duration,
    }
  } catch (error) {
    logger.error('💥 Fatal error during processing:', error)
    return {
      success: false,
      processedChunks,
      failedChunks,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

/**
 * Main function - handle command line arguments
 */
async function main() {
  const args = process.argv.slice(2)
  const options: ProcessingOptions = {}

  // Parse command line arguments
  if (args.includes('--clear')) {
    options.clearExisting = true
  }

  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
Usage: bun run scripts/process-docs-embeddings.ts [options]

Options:
  --clear     Clear existing docs embeddings before processing
  --help, -h  Show this help message

Examples:
  bun run scripts/process-docs-embeddings.ts
  bun run scripts/process-docs-embeddings.ts --clear
`)
    process.exit(0)
  }

  const result = await processDocsEmbeddings(options)

  if (!result.success) {
    process.exit(1)
  }
}

// Run the script if executed directly
if (import.meta.url.includes('process-docs-embeddings.ts')) {
  main().catch((error) => {
    console.error('Script failed:', error)
    process.exit(1)
  })
}

export { processDocsEmbeddings }
