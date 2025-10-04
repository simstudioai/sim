#!/usr/bin/env bun

import path from 'path'
import { db } from '@sim/db'
import { docsEmbeddings } from '@sim/db/schema'
import { sql } from 'drizzle-orm'
import { type DocChunk, DocsChunker } from '@/lib/chunkers'
import { isDev } from '@/lib/environment'
import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('ProcessDocs')

interface ProcessingOptions {
  /** Clear existing docs embeddings before processing */
  clearExisting?: boolean
  /** Path to docs directory */
  docsPath?: string
  /** Base URL for generating links */
  baseUrl?: string
  /** Chunk size in tokens */
  chunkSize?: number
  /** Minimum chunk size */
  minChunkSize?: number
  /** Overlap between chunks */
  overlap?: number
  /** Dry run - only display results, don't save to DB */
  dryRun?: boolean
  /** Verbose output */
  verbose?: boolean
}

/**
 * Process documentation files and optionally save embeddings to database
 */
async function processDocs(options: ProcessingOptions = {}) {
  const config = {
    docsPath: options.docsPath || path.join(process.cwd(), '../../apps/docs/content/docs'),
    baseUrl: options.baseUrl || (isDev ? 'http://localhost:4000' : 'https://docs.sim.ai'),
    chunkSize: options.chunkSize || 1024,
    minChunkSize: options.minChunkSize || 100,
    overlap: options.overlap || 200,
    clearExisting: options.clearExisting ?? false,
    dryRun: options.dryRun ?? false,
    verbose: options.verbose ?? false,
  }

  let processedChunks = 0
  let failedChunks = 0

  try {
    logger.info('🚀 Starting docs processing with config:', {
      docsPath: config.docsPath,
      baseUrl: config.baseUrl,
      chunkSize: config.chunkSize,
      clearExisting: config.clearExisting,
      dryRun: config.dryRun,
    })

    // Initialize the chunker
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

    // Group chunks by document for summary
    const chunksByDoc = chunks.reduce<Record<string, DocChunk[]>>((acc, chunk) => {
      if (!acc[chunk.sourceDocument]) {
        acc[chunk.sourceDocument] = []
      }
      acc[chunk.sourceDocument].push(chunk)
      return acc
    }, {})

    // Display summary
    logger.info(`\n=== DOCUMENT SUMMARY ===`)
    for (const [doc, docChunks] of Object.entries(chunksByDoc)) {
      logger.info(`${doc}: ${docChunks.length} chunks`)
    }

    // Display sample chunks in verbose or dry-run mode
    if (config.verbose || config.dryRun) {
      logger.info(`\n=== SAMPLE CHUNKS ===`)
      chunks.slice(0, 3).forEach((chunk, index) => {
        logger.info(`\nChunk ${index + 1}:`)
        logger.info(`  Source: ${chunk.sourceDocument}`)
        logger.info(`  Header: ${chunk.headerText} (Level ${chunk.headerLevel})`)
        logger.info(`  Link: ${chunk.headerLink}`)
        logger.info(`  Tokens: ${chunk.tokenCount}`)
        logger.info(`  Embedding: ${chunk.embedding.length} dimensions (${chunk.embeddingModel})`)
        if (config.verbose) {
          logger.info(`  Text Preview: ${chunk.text.substring(0, 200)}...`)
        }
      })
    }

    // If dry run, stop here
    if (config.dryRun) {
      logger.info('\n✅ Dry run complete - no data saved to database')
      return { success: true, processedChunks: chunks.length, failedChunks: 0 }
    }

    // Clear existing embeddings if requested
    if (config.clearExisting) {
      logger.info('🗑️ Clearing existing docs embeddings...')
      try {
        await db.delete(docsEmbeddings)
        logger.info(`✅ Successfully deleted existing embeddings`)
      } catch (error) {
        logger.error('❌ Failed to delete existing embeddings:', error)
        throw new Error('Failed to clear existing embeddings')
      }
    }

    // Save chunks to database in batches
    const batchSize = 10
    logger.info(`💾 Saving chunks to database (batch size: ${batchSize})...`)

    for (let i = 0; i < chunks.length; i += batchSize) {
      const batch = chunks.slice(i, i + batchSize)

      try {
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

    // Verify final count
    const savedCount = await db
      .select({ count: sql<number>`count(*)` })
      .from(docsEmbeddings)
      .then((res) => res[0]?.count || 0)

    logger.info(
      `\n✅ Processing complete!\n` +
        `   📊 Total chunks: ${chunks.length}\n` +
        `   ✅ Processed: ${processedChunks}\n` +
        `   ❌ Failed: ${failedChunks}\n` +
        `   💾 Total in DB: ${savedCount}`
    )

    return { success: failedChunks === 0, processedChunks, failedChunks }
  } catch (error) {
    logger.error('❌ Fatal error during processing:', error)
    return { success: false, processedChunks, failedChunks }
  }
}

/**
 * Main entry point with CLI argument parsing
 */
async function main() {
  const args = process.argv.slice(2)

  const options: ProcessingOptions = {
    clearExisting: args.includes('--clear'),
    dryRun: args.includes('--dry-run'),
    verbose: args.includes('--verbose'),
  }

  // Parse custom path if provided
  const pathIndex = args.indexOf('--path')
  if (pathIndex !== -1 && args[pathIndex + 1]) {
    options.docsPath = args[pathIndex + 1]
  }

  // Parse custom base URL if provided
  const urlIndex = args.indexOf('--url')
  if (urlIndex !== -1 && args[urlIndex + 1]) {
    options.baseUrl = args[urlIndex + 1]
  }

  // Parse chunk size if provided
  const chunkSizeIndex = args.indexOf('--chunk-size')
  if (chunkSizeIndex !== -1 && args[chunkSizeIndex + 1]) {
    options.chunkSize = Number.parseInt(args[chunkSizeIndex + 1], 10)
  }

  // Show help if requested
  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
📚 Process Documentation Script

Usage: bun run process-docs.ts [options]

Options:
  --clear          Clear existing embeddings before processing
  --dry-run        Process and display results without saving to DB
  --verbose        Show detailed output including text previews
  --path <path>    Custom path to docs directory
  --url <url>      Custom base URL for links
  --chunk-size <n> Custom chunk size in tokens (default: 1024)
  --help, -h       Show this help message

Examples:
  # Dry run to test chunking
  bun run process-docs.ts --dry-run

  # Process and save to database
  bun run process-docs.ts

  # Clear existing and reprocess
  bun run process-docs.ts --clear

  # Custom path with verbose output
  bun run process-docs.ts --path ./my-docs --verbose
    `)
    process.exit(0)
  }

  const result = await processDocs(options)
  process.exit(result.success ? 0 : 1)
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    logger.error('Fatal error:', error)
    process.exit(1)
  })
}

export { processDocs }
