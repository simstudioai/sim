import { sql } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { db, docsEmbeddings } from '@/lib/db'
import { generateSearchEmbedding } from '@/lib/embeddings'

export const runtime = 'nodejs'
export const revalidate = 0

const DEFAULT_SEARCH_LIMIT = 10
const MAX_SEARCH_LIMIT = 20

/** PostgreSQL text-search configuration for the docs' English content. */
const TS_CONFIG = 'english'

function getSearchLimit(value: unknown): number {
  const limit = Number.parseInt(String(value ?? DEFAULT_SEARCH_LIMIT), 10)

  if (!Number.isFinite(limit) || limit <= 0) {
    return DEFAULT_SEARCH_LIMIT
  }

  return Math.min(limit, MAX_SEARCH_LIMIT)
}

function getSearchParams(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  return {
    query: searchParams.get('query') || searchParams.get('q') || '',
    limit: getSearchLimit(searchParams.get('limit')),
  }
}

/** Hybrid search API endpoint combining vector embeddings with keyword search. */
export async function GET(request: NextRequest) {
  try {
    const { query, limit } = getSearchParams(request)

    if (!query || query.trim().length === 0) {
      return NextResponse.json([])
    }

    const candidateLimit = limit * 3
    const similarityThreshold = 0.6

    const queryEmbedding = await generateSearchEmbedding(query)
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
        similarity: sql<number>`ts_rank(${docsEmbeddings.chunkTextTsv}, plainto_tsquery(${TS_CONFIG}, ${query}))`,
        searchType: sql<string>`'keyword'`,
      })
      .from(docsEmbeddings)
      .where(sql`${docsEmbeddings.chunkTextTsv} @@ plainto_tsquery(${TS_CONFIG}, ${query})`)
      .orderBy(
        sql`ts_rank(${docsEmbeddings.chunkTextTsv}, plainto_tsquery(${TS_CONFIG}, ${query})) DESC`
      )
      .limit(candidateLimit)

    const vectorRankMap = new Map<string, number>()
    vectorResults.forEach((r, idx) => vectorRankMap.set(r.chunkId, idx + 1))

    const keywordRankMap = new Map<string, number>()
    keywordResults.forEach((r, idx) => keywordRankMap.set(r.chunkId, idx + 1))

    const resultByChunkId = new Map<string, (typeof vectorResults)[number]>()
    keywordResults.forEach((result) => resultByChunkId.set(result.chunkId, result))
    vectorResults.forEach((result) => resultByChunkId.set(result.chunkId, result))

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

      const result = resultByChunkId.get(chunkId)

      if (result) {
        scoredResults.push({ ...result, rrfScore })
      }
    }

    scoredResults.sort((a, b) => b.rrfScore - a.rrfScore)

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

    scoredResults.sort((a, b) => {
      return b.rrfScore + getTitleBoost(b) - (a.rrfScore + getTitleBoost(a))
    })

    const pageMap = new Map<string, ResultWithRRF>()

    for (const result of scoredResults) {
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
        .reduce<string[]>((parts, part) => {
          if (part === 'index') {
            return parts
          }

          parts.push(
            part
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
          )

          return parts
        }, [])

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
