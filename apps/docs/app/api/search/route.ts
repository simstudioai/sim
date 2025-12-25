import { sql } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { db, docsEmbeddings } from '@/lib/db'
import { generateSearchEmbedding } from '@/lib/embeddings'

export const runtime = 'nodejs'
export const revalidate = 0

/**
 * Semantic search API endpoint using vector embeddings + hybrid search
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const query = searchParams.get('query') || searchParams.get('q') || ''
    const locale = searchParams.get('locale') || 'en'
    const limit = Number.parseInt(searchParams.get('limit') || '10', 10)

    if (!query || query.trim().length === 0) {
      return NextResponse.json([])
    }

    const queryEmbedding = await generateSearchEmbedding(query)
    const candidateLimit = limit * 3
    const similarityThreshold = 0.6

    const vectorResults = await db
      .select({
        chunkId: docsEmbeddings.chunkId,
        chunkText: docsEmbeddings.chunkText,
        sourceDocument: docsEmbeddings.sourceDocument,
        sourceLink: docsEmbeddings.sourceLink,
        headerText: docsEmbeddings.headerText,
        headerLevel: docsEmbeddings.headerLevel,
        similarity: sql<number>`1 - (${docsEmbeddings.embedding} <=> ${JSON.stringify(queryEmbedding)}::vector)`,
        searchType: sql<string>`'vector'`,
      })
      .from(docsEmbeddings)
      .where(
        sql`1 - (${docsEmbeddings.embedding} <=> ${JSON.stringify(queryEmbedding)}::vector) >= ${similarityThreshold}`
      )
      .orderBy(sql`${docsEmbeddings.embedding} <=> ${JSON.stringify(queryEmbedding)}::vector`)
      .limit(candidateLimit)

    const keywordResults = await db
      .select({
        chunkId: docsEmbeddings.chunkId,
        chunkText: docsEmbeddings.chunkText,
        sourceDocument: docsEmbeddings.sourceDocument,
        sourceLink: docsEmbeddings.sourceLink,
        headerText: docsEmbeddings.headerText,
        headerLevel: docsEmbeddings.headerLevel,
        similarity: sql<number>`ts_rank(${docsEmbeddings.chunkTextTsv}, plainto_tsquery('english', ${query}))`,
        searchType: sql<string>`'keyword'`,
      })
      .from(docsEmbeddings)
      .where(sql`${docsEmbeddings.chunkTextTsv} @@ plainto_tsquery('english', ${query})`)
      .orderBy(
        sql`ts_rank(${docsEmbeddings.chunkTextTsv}, plainto_tsquery('english', ${query})) DESC`
      )
      .limit(candidateLimit)

    const seenIds = new Set<string>()
    const mergedResults = []

    for (let i = 0; i < Math.max(vectorResults.length, keywordResults.length); i++) {
      if (i < vectorResults.length && !seenIds.has(vectorResults[i].chunkId)) {
        mergedResults.push(vectorResults[i])
        seenIds.add(vectorResults[i].chunkId)
      }
      if (i < keywordResults.length && !seenIds.has(keywordResults[i].chunkId)) {
        mergedResults.push(keywordResults[i])
        seenIds.add(keywordResults[i].chunkId)
      }
    }

    const filteredResults = mergedResults.slice(0, limit)
    const searchResults = filteredResults.map((result) => {
      const title = result.headerText || result.sourceDocument.replace('.mdx', '')
      const pathParts = result.sourceDocument
        .replace('.mdx', '')
        .split('/')
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))

      return {
        id: result.chunkId,
        type: 'page' as const,
        url: result.sourceLink,
        content: title,
        breadcrumbs: pathParts,
      }
    })

    return NextResponse.json(searchResults)
  } catch (error) {
    console.error('Semantic search error:', error)

    return NextResponse.json([])
  }
}
