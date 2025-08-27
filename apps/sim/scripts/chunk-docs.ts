#!/usr/bin/env bun

import path from 'path'
import { DocsChunker } from '@/lib/knowledge/documents/docs-chunker'
import type { DocChunk } from '@/lib/knowledge/documents/types'
import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('ChunkDocsScript')

/**
 * Script to chunk all .mdx files in the docs directory
 */
async function main() {
  try {
    // Initialize the docs chunker
    const chunker = new DocsChunker({
      chunkSize: 1024,
      minChunkSize: 100,
      overlap: 200,
      baseUrl: 'https://docs.sim.ai',
    })

    // Path to the docs content directory
    const docsPath = path.join(process.cwd(), '../../apps/docs/content/docs')

    logger.info(`Processing docs from: ${docsPath}`)

    // Process all .mdx files
    const chunks = await chunker.chunkAllDocs(docsPath)

    logger.info(`\n=== CHUNKING RESULTS ===`)
    logger.info(`Total chunks: ${chunks.length}`)

    // Group chunks by document
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

    // Display a few sample chunks
    logger.info(`\n=== SAMPLE CHUNKS ===`)
    chunks.slice(0, 3).forEach((chunk, index) => {
      logger.info(`\nChunk ${index + 1}:`)
      logger.info(`  Source: ${chunk.sourceDocument}`)
      logger.info(`  Header: ${chunk.headerText} (Level ${chunk.headerLevel})`)
      logger.info(`  Link: ${chunk.headerLink}`)
      logger.info(`  Tokens: ${chunk.tokenCount}`)
      logger.info(`  Embedding: ${chunk.embedding.length} dimensions (${chunk.embeddingModel})`)
      logger.info(
        `  Embedding Preview: [${chunk.embedding
          .slice(0, 5)
          .map((n) => n.toFixed(4))
          .join(', ')}...]`
      )
      logger.info(`  Text Preview: ${chunk.text.slice(0, 100)}...`)
    })

    // Calculate total token count
    const totalTokens = chunks.reduce((sum, chunk) => sum + chunk.tokenCount, 0)
    const chunksWithEmbeddings = chunks.filter((chunk) => chunk.embedding.length > 0).length

    logger.info(`\n=== STATISTICS ===`)
    logger.info(`Total tokens: ${totalTokens}`)
    logger.info(`Average tokens per chunk: ${Math.round(totalTokens / chunks.length)}`)
    logger.info(`Chunks with embeddings: ${chunksWithEmbeddings}/${chunks.length}`)
    if (chunks.length > 0 && chunks[0].embedding.length > 0) {
      logger.info(`Embedding model: ${chunks[0].embeddingModel}`)
      logger.info(`Embedding dimensions: ${chunks[0].embedding.length}`)
    }

    const headerLevels = chunks.reduce<Record<number, number>>((acc, chunk) => {
      acc[chunk.headerLevel] = (acc[chunk.headerLevel] || 0) + 1
      return acc
    }, {})

    logger.info(`Header level distribution:`)
    Object.entries(headerLevels)
      .sort(([a], [b]) => Number(a) - Number(b))
      .forEach(([level, count]) => {
        logger.info(`  H${level}: ${count} chunks`)
      })
  } catch (error) {
    logger.error('Error processing docs:', error)
    process.exit(1)
  }
}

// Run the script
main().catch(console.error)
