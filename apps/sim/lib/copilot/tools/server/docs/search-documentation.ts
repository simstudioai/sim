import { sql } from 'drizzle-orm'
import type { BaseServerTool } from '@/lib/copilot/tools/server/base-tool'
import { createLogger } from '@/lib/logs/console/logger'
import { db } from '@/db'
import { docsEmbeddings } from '@/db/schema'

interface DocsSearchParams {
  query: string
  topK?: number
  threshold?: number
}

export const searchDocumentationServerTool: BaseServerTool<DocsSearchParams, any> = {
  name: 'search_documentation',
  async execute(params: DocsSearchParams): Promise<any> {
    const logger = createLogger('SearchDocumentationServerTool')
    const { query, topK = 10, threshold } = params
    if (!query || typeof query !== 'string') throw new Error('query is required')

    logger.info('Executing docs search (new runtime)', { query, topK })

    const { getCopilotConfig } = await import('@/lib/copilot/config')
    const config = getCopilotConfig()
    const similarityThreshold = threshold ?? config.rag.similarityThreshold

    const { generateEmbeddings } = await import('@/app/api/knowledge/utils')
    const embeddings = await generateEmbeddings([query])
    const queryEmbedding = embeddings[0]
    if (!queryEmbedding || queryEmbedding.length === 0) {
      return { results: [], query, totalResults: 0 }
    }

    const results = await db
      .select({
        chunkId: docsEmbeddings.chunkId,
        chunkText: docsEmbeddings.chunkText,
        sourceDocument: docsEmbeddings.sourceDocument,
        sourceLink: docsEmbeddings.sourceLink,
        headerText: docsEmbeddings.headerText,
        headerLevel: docsEmbeddings.headerLevel,
        similarity: sql<number>`1 - (${docsEmbeddings.embedding} <=> ${JSON.stringify(queryEmbedding)}::vector)`,
      })
      .from(docsEmbeddings)
      .orderBy(sql`${docsEmbeddings.embedding} <=> ${JSON.stringify(queryEmbedding)}::vector`)
      .limit(topK)

    const filteredResults = results.filter((r) => r.similarity >= similarityThreshold)
    const documentationResults = filteredResults.map((r, idx) => ({
      id: idx + 1,
      title: String(r.headerText || 'Untitled Section'),
      url: String(r.sourceLink || '#'),
      content: String(r.chunkText || ''),
      similarity: r.similarity,
    }))

    logger.info('Docs search complete', { count: documentationResults.length })
    return { results: documentationResults, query, totalResults: documentationResults.length }
  },
}
