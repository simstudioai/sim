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

    const knownLocales = ['en', 'es', 'fr', 'de', 'ja', 'zh']

    const vectorRankMap = new Map<string, number>()
    vectorResults.forEach((r, idx) => vectorRankMap.set(r.chunkId, idx + 1))

    const keywordRankMap = new Map<string, number>()
    keywordResults.forEach((r, idx) => keywordRankMap.set(r.chunkId, idx + 1))

    const allChunkIds = new Set([
      ...vectorResults.map((r) => r.chunkId),
      ...keywordResults.map((r) => r.chunkId),
    ])

    const k = 60
    type ResultWithRRF = (typeof vectorResults)[0] & { rrfScore: number }
    const scoredResults: ResultWithRRF[] = []

    for (const chunkId of allChunkIds) {
      const vectorRank = vectorRankMap.get(chunkId) ?? Number.POSITIVE_INFINITY
      const keywordRank = keywordRankMap.get(chunkId) ?? Number.POSITIVE_INFINITY

      const rrfScore = 1 / (k + vectorRank) + 1 / (k + keywordRank)

      const result =
        vectorResults.find((r) => r.chunkId === chunkId) ||
        keywordResults.find((r) => r.chunkId === chunkId)

      if (result) {
        scoredResults.push({ ...result, rrfScore })
      }
    }

    scoredResults.sort((a, b) => b.rrfScore - a.rrfScore)

    const localeFilteredResults = scoredResults.filter((result) => {
      const firstPart = result.sourceDocument.split('/')[0]
      if (knownLocales.includes(firstPart)) {
        return firstPart === locale
      }
      return locale === 'en'
    })

    const queryLower = query.toLowerCase()
    const getTitleBoost = (result: ResultWithRRF): number => {
      const fileName = result.sourceDocument
        .replace('.mdx', '')
        .split('/')
        .pop()
        ?.toLowerCase()
        ?.replace(/_/g, ' ')

      if (fileName === queryLower) return 0.01
      if (fileName?.includes(queryLower)) return 0.005
      return 0
    }

    localeFilteredResults.sort((a, b) => {
      return b.rrfScore + getTitleBoost(b) - (a.rrfScore + getTitleBoost(a))
    })

    const pageMap = new Map<string, ResultWithRRF>()

    for (const result of localeFilteredResults) {
      const pageKey = result.sourceDocument
      const existing = pageMap.get(pageKey)

      if (!existing || result.rrfScore > existing.rrfScore) {
        pageMap.set(pageKey, result)
      }
    }

    const deduplicatedResults = Array.from(pageMap.values())
      .sort((a, b) => b.rrfScore + getTitleBoost(b) - (a.rrfScore + getTitleBoost(a)))
      .slice(0, limit)

    const searchResults = deduplicatedResults.map((result) => {
      const title = result.headerText || result.sourceDocument.replace('.mdx', '')

      const pathParts = result.sourceDocument
        .replace('.mdx', '')
        .split('/')
        .filter((part) => part !== 'index' && !knownLocales.includes(part))
        .map((part) => {
          return part
            .replace(/_/g, ' ')
            .split(' ')
            .map((word) => {
              const acronyms = [
                'api',
                'mcp',
                'sdk',
                'url',
                'http',
                'json',
                'xml',
                'html',
                'css',
                'ai',
              ]
              if (acronyms.includes(word.toLowerCase())) {
                return word.toUpperCase()
              }
              return word.charAt(0).toUpperCase() + word.slice(1)
            })
            .join(' ')
        })

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
