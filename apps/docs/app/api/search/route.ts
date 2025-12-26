import { sql } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { db, docsEmbeddings } from '@/lib/db'
import { generateSearchEmbedding } from '@/lib/embeddings'

export const runtime = 'nodejs'
export const revalidate = 0

/**
 * Hybrid search API endpoint
 * - English: Vector embeddings + keyword search
 * - Other languages: Keyword search only
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

    const candidateLimit = limit * 3
    const similarityThreshold = 0.6

    const localeMap: Record<string, string> = {
      en: 'english',
      es: 'spanish',
      fr: 'french',
      de: 'german',
      ja: 'simple', // PostgreSQL doesn't have Japanese support, use simple
      zh: 'simple', // PostgreSQL doesn't have Chinese support, use simple
    }
    const tsConfig = localeMap[locale] || 'simple'

    const useVectorSearch = locale === 'en'
    let vectorResults: Array<{
      chunkId: string
      chunkText: string
      sourceDocument: string
      sourceLink: string
      headerText: string
      headerLevel: number
      similarity: number
      searchType: string
    }> = []

    if (useVectorSearch) {
      const queryEmbedding = await generateSearchEmbedding(query)
      vectorResults = await db
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
    }

    const keywordResults = await db
      .select({
        chunkId: docsEmbeddings.chunkId,
        chunkText: docsEmbeddings.chunkText,
        sourceDocument: docsEmbeddings.sourceDocument,
        sourceLink: docsEmbeddings.sourceLink,
        headerText: docsEmbeddings.headerText,
        headerLevel: docsEmbeddings.headerLevel,
        similarity: sql<number>`ts_rank(${docsEmbeddings.chunkTextTsv}, plainto_tsquery(${tsConfig}, ${query}))`,
        searchType: sql<string>`'keyword'`,
      })
      .from(docsEmbeddings)
      .where(sql`${docsEmbeddings.chunkTextTsv} @@ plainto_tsquery(${tsConfig}, ${query})`)
      .orderBy(
        sql`ts_rank(${docsEmbeddings.chunkTextTsv}, plainto_tsquery(${tsConfig}, ${query})) DESC`
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
