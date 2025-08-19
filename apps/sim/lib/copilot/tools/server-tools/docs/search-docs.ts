import { sql } from 'drizzle-orm'
import { getCopilotConfig } from '@/lib/copilot/config'
import { createLogger } from '@/lib/logs/console/logger'
import { db } from '@/db'
import { docsEmbeddings } from '@/db/schema'
import { BaseCopilotTool } from '../base'

const logger = createLogger('SearchDocsTool')

interface DocsSearchParams {
  query: string
  topK?: number
  threshold?: number
}

interface DocumentationSearchResult {
  id: number
  title: string
  url: string
  content: string
  similarity: number
}

interface DocsSearchResult {
  results: DocumentationSearchResult[]
  query: string
  totalResults: number
}

class SearchDocsTool extends BaseCopilotTool<DocsSearchParams, DocsSearchResult> {
  readonly id = 'search_documentation'
  readonly displayName = 'Searching documentation'

  protected async executeImpl(params: DocsSearchParams): Promise<DocsSearchResult> {
    logger.info('=== SearchDocsTool.executeImpl START ===', {
      params: JSON.stringify(params),
      hasParams: !!params,
      paramsKeys: params ? Object.keys(params) : [],
      query: params?.query,
      queryLength: params?.query?.length,
      topK: params?.topK,
      threshold: params?.threshold,
      timestamp: new Date().toISOString(),
    })
    
    const result = await searchDocs(params)
    
    logger.info('=== SearchDocsTool.executeImpl COMPLETE ===', {
      resultsCount: result.results.length,
      totalResults: result.totalResults,
      query: result.query,
      hasResults: result.results.length > 0,
      topSimilarity: result.results[0]?.similarity,
      timestamp: new Date().toISOString(),
    })
    
    return result
  }
}

// Export the tool instance
export const searchDocsTool = new SearchDocsTool()

// Implementation function
async function searchDocs(params: DocsSearchParams): Promise<DocsSearchResult> {
  logger.info('=== searchDocs FUNCTION START ===', {
    receivedParams: JSON.stringify(params),
    paramsType: typeof params,
    timestamp: new Date().toISOString(),
  })

  const { query, topK = 10, threshold } = params

  // Validation logs
  logger.info('VALIDATION: search_documentation received params', {
    hasQuery: !!query,
    queryType: typeof query,
    queryLength: query?.length,
    queryPreview: query?.substring(0, 100),
    topK,
    topKType: typeof topK,
    hasThreshold: threshold !== undefined,
    threshold,
    thresholdType: typeof threshold,
  })

  if (!query || typeof query !== 'string' || query.trim().length === 0) {
    logger.error('VALIDATION FAILED: Invalid query', {
      query,
      queryType: typeof query,
      isEmpty: query?.trim().length === 0,
    })
    return {
      results: [],
      query: query || '',
      totalResults: 0,
    }
  }

  logger.info('Executing docs search for copilot - VALIDATION PASSED', {
    query,
    queryLength: query.length,
    topK,
    hasCustomThreshold: threshold !== undefined,
  })

  try {
    logger.info('Getting copilot config for RAG settings')
    const config = getCopilotConfig()
    const similarityThreshold = threshold ?? config.rag.similarityThreshold
    
    logger.info('Configuration loaded', {
      similarityThreshold,
      configThreshold: config.rag.similarityThreshold,
      usingCustomThreshold: threshold !== undefined,
      ragConfig: {
        similarityThreshold: config.rag.similarityThreshold,
      },
    })

    // Generate embedding for the query
    logger.info('Importing embedding generation module')
    const { generateEmbeddings } = await import('@/app/api/knowledge/utils')

    logger.info('About to generate embeddings for query', { 
      query, 
      queryLength: query.length,
      queryWords: query.split(' ').length,
      queryPreview: query.substring(0, 200),
    })

    const startEmbedTime = Date.now()
    const embeddings = await generateEmbeddings([query])
    const embeddingDuration = Date.now() - startEmbedTime
    
    logger.info('Embedding generation complete', {
      duration: embeddingDuration,
      embeddingsCount: embeddings.length,
      hasEmbedding: !!embeddings[0],
    })

    const queryEmbedding = embeddings[0]

    if (!queryEmbedding || queryEmbedding.length === 0) {
      logger.warn('Failed to generate query embedding', {
        queryEmbedding,
        embeddingsLength: embeddings.length,
        firstEmbedding: embeddings[0],
      })
      return {
        results: [],
        query,
        totalResults: 0,
      }
    }

    logger.info('Successfully generated query embedding', {
      embeddingLength: queryEmbedding.length,
      embeddingType: typeof queryEmbedding,
      isArray: Array.isArray(queryEmbedding),
      firstValues: queryEmbedding.slice(0, 5),
    })

    // Search docs embeddings using vector similarity
    logger.info('Starting database vector similarity search', {
      table: 'docsEmbeddings',
      limit: topK,
      vectorDimensions: queryEmbedding.length,
    })

    const startSearchTime = Date.now()
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
    
    const searchDuration = Date.now() - startSearchTime

    logger.info('Database search complete', {
      duration: searchDuration,
      rawResultsCount: results.length,
      hasResults: results.length > 0,
      topSimilarity: results[0]?.similarity,
      bottomSimilarity: results[results.length - 1]?.similarity,
    })

    // Log each raw result for debugging
    results.forEach((result, index) => {
      logger.info(`Raw result ${index + 1}/${results.length}`, {
        chunkId: result.chunkId,
        similarity: result.similarity,
        hasChunkText: !!result.chunkText,
        chunkTextLength: result.chunkText?.length,
        headerText: result.headerText,
        headerLevel: result.headerLevel,
        sourceDocument: result.sourceDocument,
        sourceLink: result.sourceLink,
      })
    })

    // Filter by similarity threshold
    logger.info('Applying similarity threshold filter', {
      threshold: similarityThreshold,
      beforeCount: results.length,
    })

    const filteredResults = results.filter((result) => result.similarity >= similarityThreshold)

    logger.info('Similarity filter applied', {
      afterCount: filteredResults.length,
      filtered: results.length - filteredResults.length,
      threshold: similarityThreshold,
      passedThreshold: filteredResults.map(r => r.similarity),
    })

    const documentationResults: DocumentationSearchResult[] = filteredResults.map(
      (result, index) => {
        const docResult = {
          id: index + 1,
          title: String(result.headerText || 'Untitled Section'),
          url: String(result.sourceLink || '#'),
          content: String(result.chunkText || ''),
          similarity: result.similarity,
        }
        
        logger.info(`Processing documentation result ${index + 1}/${filteredResults.length}`, {
          id: docResult.id,
          title: docResult.title,
          url: docResult.url,
          contentLength: docResult.content.length,
          similarity: docResult.similarity,
          contentPreview: docResult.content.substring(0, 100),
        })
        
        return docResult
      }
    )

    logger.info(`Found ${documentationResults.length} documentation results`, { 
      query,
      totalResults: documentationResults.length,
      topK,
      threshold: similarityThreshold,
      similarities: documentationResults.map(r => r.similarity),
      titles: documentationResults.map(r => r.title),
    })

    logger.info('=== searchDocs FUNCTION COMPLETE ===', {
      success: true,
      resultsCount: documentationResults.length,
      query,
      timestamp: new Date().toISOString(),
    })

    return {
      results: documentationResults,
      query,
      totalResults: documentationResults.length,
    }
  } catch (error) {
    logger.error('Documentation search failed with detailed error:', {
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
      query,
      errorType: error?.constructor?.name,
      status: (error as any)?.status,
      errorDetails: error,
      timestamp: new Date().toISOString(),
    })
    
    logger.info('=== searchDocs FUNCTION ERROR ===', {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      query,
      timestamp: new Date().toISOString(),
    })
    
    throw new Error(
      `Documentation search failed: ${error instanceof Error ? error.message : 'Unknown error'}`
    )
  }
}
