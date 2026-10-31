import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { interruptibleSleep } from '@sim/utils/helpers'
import { generateId } from '@sim/utils/id'
import { backoffWithJitter, parseRetryAfter } from '@sim/utils/retry'
import type postgres from 'postgres'
import { z } from 'zod'
import { getPages } from '@/lib/content/catalog'
import { pageSearchChunks } from '@/lib/search/chunks'
import { searchDatabase } from '@/lib/search/database'
import type { SearchChunk } from '@/lib/search/types'

const logger = createLogger('DocsSearchIndex')
const check = process.argv.includes('--check')
const plan = process.argv.includes('--plan')
const selectedPaths = process.argv
  .filter((arg) => arg.startsWith('--path='))
  .map((arg) => arg.slice(7))
const reportPath = process.env.DOCS_SEARCH_REPORT_PATH ?? 'test-results/docs-search-index.json'
const EMBEDDING_MODEL = 'text-embedding-3-small'
const EMBEDDING_DIMENSIONS = 1536
const EMBEDDING_ATTEMPTS = 3
const EMBEDDING_BUDGET_MS = 30_000
const PUBLISH_LOCK = 724130561
let sourceRevision: string | null = null
try {
  sourceRevision = execFileSync('git', ['rev-parse', 'HEAD'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim()
} catch {}
const embeddingResponse = z.object({
  data: z.array(
    z.object({
      index: z.number().int(),
      embedding: z.array(z.number().finite()).length(EMBEDDING_DIMENSIONS),
    })
  ),
  usage: z.object({ total_tokens: z.number().int().nonnegative() }),
})
const pages = getPages().filter(
  (page) => page.url !== '/' && (!selectedPaths.length || selectedPaths.includes(page.url))
)
const checks: Array<{
  path: string
  status: string
  chunks: number
  durationMs: number
  error?: string
}> = []
let failed = false
let embeddingRequests = 0
let embeddingInputs = 0
let embeddingTokens = 0
let lock: postgres.ReservedSql | undefined

interface StoredChunk {
  chunk_id: string
  chunk_text: string
  source_link: string
  header_text: string
  header_level: number
  token_count: number
  embedding_model: string
  metadata: {
    title?: string
    contentHash?: string
    chunkId?: string
    embeddingInputHash?: string
    catalog?: string
  }
}

function inputFor(chunk: SearchChunk) {
  return `${chunk.documentTitle}\n${chunk.headerText}\n${chunk.text}`
}

function metadataFor(chunk: SearchChunk) {
  return {
    title: chunk.documentTitle,
    contentHash: chunk.contentHash,
    chunkId: chunk.id,
    embeddingInputHash: createHash('sha256')
      .update(JSON.stringify([EMBEDDING_MODEL, EMBEDDING_DIMENSIONS, inputFor(chunk)]))
      .digest('hex'),
    catalog: 'sim-docs-v2',
  }
}

function reusable(row: StoredChunk, chunk: SearchChunk) {
  return (
    row.embedding_model === EMBEDDING_MODEL &&
    row.chunk_text === chunk.text &&
    row.header_text === chunk.headerText &&
    row.metadata.title === chunk.documentTitle &&
    row.metadata.embeddingInputHash === metadataFor(chunk).embeddingInputHash
  )
}

function fresh(row: StoredChunk | undefined, chunk: SearchChunk) {
  const metadata = metadataFor(chunk)
  return (
    row &&
    reusable(row, chunk) &&
    row.source_link === chunk.sourceLink &&
    row.header_level === chunk.headerLevel &&
    row.token_count === Math.ceil(chunk.text.length / 4) &&
    row.metadata.contentHash === metadata.contentHash &&
    row.metadata.catalog === metadata.catalog
  )
}

async function embeddings(input: string[]) {
  const key = process.env.OPENAI_API_KEY
  if (!key) throw new Error('OPENAI_API_KEY is required to publish embeddings')
  const signal = AbortSignal.timeout(EMBEDDING_BUDGET_MS)
  const deadline = performance.now() + EMBEDDING_BUDGET_MS
  for (let attempt = 1; attempt <= EMBEDDING_ATTEMPTS; attempt += 1) {
    signal.throwIfAborted()
    embeddingRequests += 1
    embeddingInputs += input.length
    const response = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        input,
        model: EMBEDDING_MODEL,
        dimensions: EMBEDDING_DIMENSIONS,
        encoding_format: 'float',
      }),
      signal,
    })
    if (!response.ok) {
      await response.body?.cancel()
      const failure = new Error(`Embedding provider returned HTTP ${response.status}`)
      const retryable = response.status === 429 || (response.status >= 500 && response.status < 600)
      if (!retryable || attempt === EMBEDDING_ATTEMPTS) throw failure
      const delay = backoffWithJitter(
        attempt,
        parseRetryAfter(response.headers.get('retry-after'), Number.MAX_SAFE_INTEGER),
        { maxMs: EMBEDDING_BUDGET_MS }
      )
      if (delay >= deadline - performance.now()) throw failure
      await interruptibleSleep(delay, signal)
      continue
    }
    const payload = embeddingResponse.parse(await response.json())
    embeddingTokens += payload.usage.total_tokens
    const result = payload.data.sort((a, b) => a.index - b.index)
    if (result.length !== input.length || result.some((row, index) => row.index !== index)) {
      throw new Error('Embedding provider returned an incomplete batch')
    }
    return result.map((row) => row.embedding)
  }
  throw new Error('Embedding provider retry budget exhausted')
}

try {
  if (!pages.length || selectedPaths.some((path) => !pages.some((page) => page.url === path)))
    throw new Error('Every --path must identify a canonical documentation page')
  const database = plan ? undefined : searchDatabase()
  if (database) {
    lock = await database.reserve()
    const [result] = await lock<
      Array<{ acquired: boolean }>
    >`SELECT pg_try_advisory_lock(${PUBLISH_LOCK}) AS acquired`
    if (!result?.acquired)
      throw new Error('Another documentation index publisher or check is active')
  }
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
      const current = await database<StoredChunk[]>`
        SELECT chunk_id, chunk_text, source_link, header_text, header_level, token_count, embedding_model, coalesce(metadata, '{}'::jsonb) AS metadata
        FROM docs_embeddings WHERE source_document = ${source} LIMIT ${chunks.length + 1}
      `
      const byId = new Map(current.map((row) => [row.metadata.chunkId, row]))
      if (
        current.length === chunks.length &&
        byId.size === chunks.length &&
        chunks.every((chunk) => fresh(byId.get(chunk.id), chunk))
      ) {
        checks.push({
          path: page.url,
          status: 'fresh',
          chunks: chunks.length,
          durationMs: Math.round(performance.now() - started),
        })
        continue
      }
      if (check) throw new Error('Search index is missing or stale')
      const retained = new Map<string, StoredChunk>()
      for (const chunk of chunks) {
        const row = byId.get(chunk.id)
        if (row && reusable(row, chunk)) retained.set(chunk.id, row)
      }
      const changed = chunks.filter((chunk) => !retained.has(chunk.id))
      const vectors = new Map<string, number[]>()
      for (let offset = 0; offset < changed.length; offset += 16) {
        const batch = changed.slice(offset, offset + 16)
        const values = await embeddings(batch.map(inputFor))
        for (const [index, chunk] of batch.entries()) vectors.set(chunk.id, values[index])
      }
      await database.begin(async (transaction) => {
        const retainedIds = [...retained.values()].map((row) => row.chunk_id)
        await transaction`DELETE FROM docs_embeddings WHERE source_document = ${source} AND NOT (chunk_id = ANY(${retainedIds}::uuid[]))`
        for (const chunk of chunks) {
          const row = retained.get(chunk.id)
          if (row) {
            await transaction`
              UPDATE docs_embeddings SET source_link = ${chunk.sourceLink}, header_level = ${chunk.headerLevel},
                token_count = ${Math.ceil(chunk.text.length / 4)}, metadata = ${transaction.json(metadataFor(chunk))}, updated_at = now()
              WHERE chunk_id = ${row.chunk_id}
            `
          } else {
            await transaction`
              INSERT INTO docs_embeddings
                (chunk_id, chunk_text, source_document, source_link, header_text, header_level, token_count, embedding, embedding_model, metadata)
              VALUES (${generateId()}, ${chunk.text}, ${source}, ${chunk.sourceLink}, ${chunk.headerText},
                ${chunk.headerLevel}, ${Math.ceil(chunk.text.length / 4)}, ${JSON.stringify(vectors.get(chunk.id))}::vector,
                ${EMBEDDING_MODEL}, ${transaction.json(metadataFor(chunk))})
            `
          }
        }
      })
      checks.push({
        path: page.url,
        status: changed.length ? 'published' : 'reconciled',
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
  if (database && !failed && !selectedPaths.length) {
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
  if (lock) {
    try {
      await lock`SELECT pg_advisory_unlock(${PUBLISH_LOCK})`
    } catch (error) {
      failed = true
      checks.push({
        path: 'lock',
        status: 'failed',
        chunks: 0,
        durationMs: 0,
        error: getErrorMessage(error),
      })
    } finally {
      lock.release()
    }
  }
  if (!plan && process.env.DATABASE_URL) await searchDatabase().end({ timeout: 5 })
  await mkdir(dirname(reportPath), { recursive: true })
  await writeFile(
    reportPath,
    `${JSON.stringify({ sourceRevision, mode: plan ? 'plan' : check ? 'check' : 'publish', scope: selectedPaths.length ? selectedPaths : 'catalog', embeddingRequests, embeddingInputs, embeddingTokens, checks }, null, 2)}\n`
  )
}
if (failed) {
  logger.error('Documentation search index failed', { reportPath })
  process.exitCode = 1
} else logger.info('Documentation search index complete', { pages: checks.length, reportPath })
