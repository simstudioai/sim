import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { z } from 'zod'
import { getPages } from '@/lib/content/catalog'
import { pageSearchChunks } from '@/lib/search/chunks'
import { searchDatabase } from '@/lib/search/database'

const logger = createLogger('DocsSearchIndex')
const check = process.argv.includes('--check')
const plan = process.argv.includes('--plan')
const reportPath = process.env.DOCS_SEARCH_REPORT_PATH ?? 'test-results/docs-search-index.json'
const embeddingResponse = z.object({
  data: z.array(
    z.object({ index: z.number().int(), embedding: z.array(z.number().finite()).length(1536) })
  ),
})
const pages = getPages().filter((page) => page.url !== '/')
const checks: Array<{
  path: string
  status: string
  chunks: number
  durationMs: number
  error?: string
}> = []
let failed = false

async function embeddings(input: string[]) {
  const key = process.env.OPENAI_API_KEY
  if (!key) throw new Error('OPENAI_API_KEY is required to publish embeddings')
  const response = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ input, model: 'text-embedding-3-small', encoding_format: 'float' }),
    signal: AbortSignal.timeout(30000),
  })
  if (!response.ok) throw new Error(`Embedding provider returned HTTP ${response.status}`)
  const result = embeddingResponse
    .parse(await response.json())
    .data.sort((a, b) => a.index - b.index)
  if (result.length !== input.length || result.some((row, index) => row.index !== index)) {
    throw new Error('Embedding provider returned an incomplete batch')
  }
  return result.map((row) => row.embedding)
}

try {
  const database = plan ? undefined : searchDatabase()
  for (const page of pages) {
    const started = performance.now()
    const chunks = [...pageSearchChunks(page)]
    const source = chunks[0]?.sourceDocument
    if (!source) throw new Error(`No search content for ${page.url}`)
    try {
      if (plan || !database) {
        checks.push({
          path: page.url,
          status: 'planned',
          chunks: chunks.length,
          durationMs: Math.round(performance.now() - started),
        })
        continue
      }
      const [current] = await database<Array<{ count: number; matching: number }>>`
        SELECT count(*)::int AS count,
          count(*) FILTER (WHERE metadata->>'contentHash' = ${page.contentHash})::int AS matching
        FROM docs_embeddings WHERE source_document = ${source}
      `
      const fresh = current?.count === chunks.length && current.matching === chunks.length
      if (fresh) {
        checks.push({
          path: page.url,
          status: 'fresh',
          chunks: chunks.length,
          durationMs: Math.round(performance.now() - started),
        })
        continue
      }
      if (check) throw new Error('Search index is missing or stale')
      const vectors: number[][] = []
      for (let offset = 0; offset < chunks.length; offset += 16) {
        const batch = chunks.slice(offset, offset + 16)
        vectors.push(
          ...(await embeddings(
            batch.map((chunk) => `${page.title}\n${chunk.headerText}\n${chunk.text}`)
          ))
        )
      }
      await database.begin(async (transaction) => {
        await transaction`DELETE FROM docs_embeddings WHERE source_document = ${source}`
        for (const [index, chunk] of chunks.entries()) {
          await transaction`
            INSERT INTO docs_embeddings
              (chunk_id, chunk_text, source_document, source_link, header_text, header_level, token_count, embedding, embedding_model, metadata)
            VALUES (${generateId()}, ${chunk.text}, ${source}, ${chunk.sourceLink}, ${chunk.headerText},
              ${chunk.headerLevel}, ${Math.ceil(chunk.text.length / 4)}, ${JSON.stringify(vectors[index])}::vector,
              'text-embedding-3-small', ${transaction.json({ title: page.title, contentHash: page.contentHash, catalog: 'sim-docs-v1' })})
          `
        }
      })
      checks.push({
        path: page.url,
        status: 'published',
        chunks: chunks.length,
        durationMs: Math.round(performance.now() - started),
      })
    } catch (error) {
      failed = true
      checks.push({
        path: page.url,
        status: 'failed',
        chunks: chunks.length,
        durationMs: Math.round(performance.now() - started),
        error: getErrorMessage(error),
      })
      if (!check) break
    }
  }
  if (database && !failed) {
    const sources = pages.map((page) =>
      page.operation ? `${page.url.slice(1)}.mdx` : page.sourcePath.replace(/^content\/docs\//, '')
    )
    const retired = await database<Array<{ source_document: string }>>`
      SELECT DISTINCT source_document FROM docs_embeddings WHERE NOT (source_document = ANY(${sources}::text[]))
    `
    if (check && retired.length) {
      failed = true
      checks.push({
        path: 'retired-pages',
        status: 'failed',
        chunks: 0,
        durationMs: 0,
        error: `${retired.length} removed documents remain indexed`,
      })
    } else if (!check && retired.length) {
      await database`DELETE FROM docs_embeddings WHERE NOT (source_document = ANY(${sources}::text[]))`
    }
  }
} catch (error) {
  failed = true
  checks.push({
    path: 'index',
    status: 'failed',
    chunks: 0,
    durationMs: 0,
    error: getErrorMessage(error),
  })
} finally {
  if (!plan && process.env.DATABASE_URL) await searchDatabase().end({ timeout: 5 })
  await mkdir(dirname(reportPath), { recursive: true })
  await writeFile(
    reportPath,
    `${JSON.stringify({ mode: plan ? 'plan' : check ? 'check' : 'publish', checks }, null, 2)}\n`
  )
}
if (failed) {
  logger.error('Documentation search index failed', { reportPath })
  process.exitCode = 1
} else logger.info('Documentation search index complete', { pages: checks.length, reportPath })
