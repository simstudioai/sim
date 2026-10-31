import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import { dirname, join, resolve } from 'node:path'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import postgres from 'postgres'
import { z } from 'zod'

const logger = createLogger('DocsProviderE2E')
const setting = process.env.DOCS_PROVIDER_E2E_DATABASE_URL
const reportSetting = process.env.DOCS_PROVIDER_E2E_REPORT_PATH
const origin = process.env.DOCS_PROVIDER_E2E_BASE_URL
const providerKey = process.env.OPENAI_API_KEY
const live = process.env.DOCS_PROVIDER_E2E_ALLOW_LIVE === '1'
assert(
  setting && reportSetting && origin && (!live || providerKey),
  'Fixture, report, docs origin and provider credential are required'
)
const databaseUrl = new URL(setting)
const docsOrigin = new URL(origin)
assert(
  ['localhost', '127.0.0.1', '[::1]'].includes(databaseUrl.hostname),
  'Only loopback database is permitted'
)
assert(
  databaseUrl.pathname === '/docs_search_provider_test' ||
    (!live && databaseUrl.pathname === '/docs_search_test'),
  'Use a dedicated docs_search_provider_test database (or the empty docs_search_test fixture without live providers)'
)
assert(['postgres:', 'postgresql:'].includes(databaseUrl.protocol))
assert(
  ['localhost', '127.0.0.1', '[::1]'].includes(docsOrigin.hostname),
  'Only a loopback docs build may be tested'
)
const systemVariables = new Set(['PATH', 'HOME', 'TMPDIR', 'TMP', 'TEMP', 'USER'])
for (const key of Object.keys(process.env)) if (!systemVariables.has(key)) delete process.env[key]
Object.assign(process.env, {
  DATABASE_URL: databaseUrl.href,
  OPENAI_API_KEY: live ? (providerKey ?? '') : '',
  NEXT_PUBLIC_APP_URL: 'http://localhost:3000',
  NODE_ENV: 'test',
})
const reportPath: string = reportSetting
const directory = dirname(reportPath)
const docsWorkspace = resolve(import.meta.dirname, '../../docs')
const sql = postgres(databaseUrl.href, { max: 1, connect_timeout: 2 })
const checks: Array<{
  name: string
  status: 'passed' | 'failed'
  durationMs: number
  error?: string
}> = []
const requests: Array<{ origin: string; path: string; status: number; durationMs: number }> = []
const reportSchema = z.object({
  scope: z.array(z.string()),
  embeddingRequests: z.number(),
  embeddingInputs: z.number(),
  embeddingTokens: z.number(),
  checks: z.array(z.object({ path: z.string(), status: z.string(), chunks: z.number() })),
})
let created = false
let providerRequests = 0
let fixtureRequests = 0
let fixture: Server | undefined
let fixtureOrigin: string | undefined
let publisherRequests = 0
let publisherTokens = 0
let queryTokens = 0
let closePlatform: (() => Promise<void>) | undefined
const nativeFetch = globalThis.fetch
await mkdir(directory, { recursive: true })

async function check(name: string, action: () => Promise<void>) {
  const started = performance.now()
  try {
    await action()
    checks.push({ name, status: 'passed', durationMs: Math.round(performance.now() - started) })
  } catch (error) {
    checks.push({
      name,
      status: 'failed',
      durationMs: Math.round(performance.now() - started),
      error: getErrorMessage(error),
    })
    throw error
  }
}

async function publish(mode: 'plan' | 'publish' | 'check', name: string, key = '') {
  const path = join(directory, `${name}.json`)
  const child = spawn(
    process.execPath,
    [
      '--no-env-file',
      'scripts/index-search.ts',
      '--path=/introduction',
      ...(mode === 'publish' ? [] : [`--${mode}`]),
    ],
    {
      cwd: docsWorkspace,
      env: { ...process.env, OPENAI_API_KEY: key, DOCS_SEARCH_REPORT_PATH: path },
      stdio: 'ignore',
      timeout: 60000,
    }
  )
  const exitCode = await new Promise<number>((resolve, reject) => {
    child.once('error', reject)
    child.once('close', (code) => resolve(code ?? 1))
  })
  const result = reportSchema.parse(JSON.parse(await readFile(path, 'utf8')))
  publisherRequests += result.embeddingRequests
  publisherTokens += result.embeddingTokens
  assert.equal(exitCode, 0, `Publisher failed; inspect ${path}`)
  return result
}

try {
  const [existing] = await sql<
    Array<{ count: number }>
  >`SELECT count(*)::int AS count FROM information_schema.tables WHERE table_schema = 'public'`
  assert.equal(existing?.count, 0, 'Refusing a database containing existing tables')
  await sql`CREATE EXTENSION IF NOT EXISTS vector`
  await sql`CREATE TABLE docs_embeddings (
    chunk_id uuid PRIMARY KEY, chunk_text text NOT NULL, source_document text NOT NULL,
    source_link text NOT NULL, header_text text NOT NULL, header_level integer NOT NULL,
    token_count integer NOT NULL, embedding vector(1536) NOT NULL,
    embedding_model text NOT NULL, metadata jsonb NOT NULL,
    chunk_text_tsv tsvector GENERATED ALWAYS AS (to_tsvector('english', chunk_text)) STORED,
    created_at timestamp NOT NULL DEFAULT now(), updated_at timestamp NOT NULL DEFAULT now()
  )`
  created = true
  await sql`CREATE TABLE rate_limit_bucket (
    key text PRIMARY KEY, tokens decimal NOT NULL,
    last_refill_at timestamp NOT NULL, blocked_until timestamp,
    capacity_state jsonb, updated_at timestamp NOT NULL DEFAULT now()
  )`
  let expectedChunks = 0
  await check(
    'Scoped publication fits one bounded provider batch before calling the provider',
    async () => {
      const plan = await publish('plan', 'plan')
      assert.deepEqual(plan.scope, ['/introduction'])
      assert.equal(plan.checks.length, 1)
      expectedChunks = plan.checks[0]?.chunks ?? 0
      assert(expectedChunks > 0 && expectedChunks <= 15)
      assert.equal(plan.embeddingRequests, 0)
    }
  )
  let rowIds: string[] = []
  if (live) {
    await check(
      'First publication persists a real 1536-dimensional provider vector and canonical citation',
      async () => {
        const result = await publish('publish', 'first-publish', providerKey)
        assert(result.embeddingRequests >= 1 && result.embeddingRequests <= 3)
        assert.equal(result.embeddingInputs, expectedChunks * result.embeddingRequests)
        const rows = await sql<
          Array<{
            chunk_id: string
            source_link: string
            dimensions: number
            embedding_model: string
            content: string
          }>
        >`
      SELECT chunk_id, source_link, vector_dims(embedding) AS dimensions, embedding_model, chunk_text AS content FROM docs_embeddings
    `
        assert.equal(rows.length, expectedChunks)
        for (const row of rows) {
          assert.equal(row.dimensions, 1536)
          assert.equal(row.embedding_model, 'text-embedding-3-small')
          const citation = new URL(row.source_link)
          assert.equal(citation.origin, 'https://docs.sim.ai')
          assert.equal(citation.pathname, '/introduction')
        }
        assert(rows.some((row) => row.content.includes('# Introduction')))
        rowIds = rows.map((row) => row.chunk_id).sort()
      }
    )
    await check(
      'Second publication and freshness check perform no embedding requests or row replacement',
      async () => {
        for (const mode of ['publish', 'check'] as const) {
          const result = await publish(mode, `repeat-${mode}`)
          assert.equal(result.embeddingRequests, 0)
          assert.equal(result.embeddingInputs, 0)
        }
        const rows = await sql<Array<{ chunk_id: string }>>`SELECT chunk_id FROM docs_embeddings`
        assert.deepEqual(rows.map((row) => row.chunk_id).sort(), rowIds)
      }
    )
  }
  if (!live) {
    const server = createServer(async (request, response) => {
      try {
        assert.equal(
          new URL(request.url ?? '/', 'http://127.0.0.1').pathname,
          '/openai/deployments/text-embedding-3-small/embeddings'
        )
        const chunks: Buffer[] = []
        let bytes = 0
        for await (const chunk of request) {
          const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
          bytes += buffer.length
          assert(bytes <= 8192, 'Local fixture request body exceeded its limit')
          chunks.push(buffer)
        }
        const body = z
          .object({
            input: z.array(z.string().max(256)).length(1),
            dimensions: z.literal(1536),
            encoding_format: z.literal('float'),
          })
          .parse(JSON.parse(Buffer.concat(chunks).toString('utf8')))
        assert(body.input[0])
        fixtureRequests += 1
        assert(fixtureRequests <= 3, 'Local fixture request budget exceeded')
        response.writeHead(200, { 'Content-Type': 'application/json' })
        response.end(
          JSON.stringify({
            data: [{ index: 0, embedding: [1, ...Array.from({ length: 1535 }, () => 0)] }],
            usage: { total_tokens: 1 },
          })
        )
      } catch (error) {
        response.writeHead(500, { 'Content-Type': 'application/json' })
        response.end(JSON.stringify({ error: getErrorMessage(error) }))
      }
    })
    fixture = server
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => {
        server.removeListener('error', reject)
        resolve()
      })
    })
    const address = server.address()
    assert(address && typeof address !== 'string')
    fixtureOrigin = `http://127.0.0.1:${address.port}`
    process.env.AZURE_OPENAI_ENDPOINT = fixtureOrigin
    process.env.AZURE_OPENAI_API_KEY = 'isolated-fixture'
    process.env.AZURE_OPENAI_API_VERSION = '2024-10-21'
  }
  globalThis.fetch = Object.assign(async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init)
    const url = new URL(request.url)
    let destination = url
    if (url.origin === 'https://api.openai.com' && url.pathname === '/v1/embeddings') {
      assert(live && providerRequests < 1, 'Live query embedding request budget exceeded')
      providerRequests += 1
    } else if (url.origin === fixtureOrigin) {
      assert(!live)
    } else if (url.origin === 'https://docs.sim.ai') {
      destination = new URL(`${url.pathname}${url.search}`, docsOrigin)
    } else {
      throw new Error(`Unexpected outbound request origin: ${url.origin}`)
    }
    const started = performance.now()
    const response = await nativeFetch(new Request(destination, request))
    requests.push({
      origin: url.origin,
      path: url.pathname,
      status: response.status,
      durationMs: Math.round(performance.now() - started),
    })
    if (url.origin === 'https://api.openai.com' && response.ok) {
      const usage = z
        .object({ usage: z.object({ total_tokens: z.number() }) })
        .parse(await response.clone().json())
      queryTokens += usage.usage.total_tokens
    }
    return response
  }, nativeFetch)
  await check(
    live
      ? 'Actual platform semantic search returns a readable VFS page and valid public citation'
      : 'Local embedding HTTP fixture exercises direct-table search, VFS reads, scopes and citations',
    async () => {
      const { searchDocs } = await import('@/lib/mothership/docs/search')
      const { readDocsPage, globDocs, docsPathForSourceDocument } = await import(
        '@/lib/mothership/docs/corpus'
      )
      const { db } = await import('@sim/db')
      closePlatform = () => db.$client.end({ timeout: 1 })
      let hit: { path: string; url: string; content: string }
      if (live) {
        const result = await searchDocs(
          'What is Sim and how can I build repeatable AI workflows?',
          { path: 'docs/introduction.mdx', topK: 1 }
        )
        assert.equal(providerRequests, 1)
        assert.equal(result.results.length, 1)
        const first = result.results[0]
        assert(first)
        hit = first
      } else {
        const child = spawn(
          process.execPath,
          [
            '--no-env-file',
            '--conditions=react-server',
            '-e',
            `
          const { getPage } = await import('./lib/content/catalog');
          const { searchDatabase } = await import('./lib/search/database');
          const { searchDocs } = await import('./lib/search/service');
          const { generateId } = await import('@sim/utils/id');
          const page = getPage('/introduction');
          if (!page) throw new Error('Missing introduction');
          const sql = searchDatabase();
          const vector = JSON.stringify([1, ...Array.from({length:1535}, () => 0)]);
          await sql\`INSERT INTO docs_embeddings (chunk_id, chunk_text, source_document, source_link, header_text, header_level, token_count, embedding, embedding_model, metadata)
            VALUES (\${generateId()}, 'simdocsconsumerprobe', \${page.sourcePath}, 'https://docs.sim.ai/introduction', 'Introduction', 1, 1, \${vector}::vector, 'text-embedding-3-small', \${sql.json({contentHash:page.contentHash})})\`;
          const result = await searchDocs('simdocsconsumerprobe', 1);
          process.stdout.write(JSON.stringify(result));
          await sql.end({timeout:1});
        `,
          ],
          {
            cwd: docsWorkspace,
            env: process.env,
            stdio: ['ignore', 'pipe', 'pipe'],
            timeout: 15000,
          }
        )
        let output = ''
        child.stdout.on('data', (chunk: Buffer) => {
          output += chunk.toString()
        })
        child.stderr.resume()
        const code = await new Promise<number>((resolve, reject) => {
          child.once('error', reject)
          child.once('close', (value) => resolve(value ?? 1))
        })
        assert.equal(code, 0, 'Isolated keyword search process failed')
        const rows = z.array(z.object({ url: z.string() })).parse(JSON.parse(output))
        assert.equal(rows.length, 1)
        const [stored] = await sql<
          Array<{ source_document: string }>
        >`SELECT source_document FROM docs_embeddings`
        const path = docsPathForSourceDocument(stored?.source_document ?? null)
        assert(path)
        const first = rows[0]
        assert(first)
        assert.equal(path, 'docs/introduction.mdx')
        assert.equal(first.url, 'https://docs.sim.ai/introduction')
        await sql`UPDATE docs_embeddings SET chunk_text = '# Introduction'`
        const near = JSON.stringify([1, ...Array.from({ length: 1535 }, () => 0)])
        const orthogonal = JSON.stringify([0, 1, ...Array.from({ length: 1534 }, () => 0)])
        for (const source of [
          'workflows/index.mdx',
          'api-reference/workflows/listWorkflows.mdx',
          'academy/introduction.mdx',
          'index.mdx',
        ]) {
          await sql`INSERT INTO docs_embeddings (chunk_id, chunk_text, source_document, source_link, header_text, header_level, token_count, embedding, embedding_model, metadata)
            VALUES (${generateId()}, 'isolated contrast row', ${source}, 'https://docs.sim.ai/workflows', 'Workflows', 1, 1, ${source === 'workflows/index.mdx' ? orthogonal : near}::vector, 'text-embedding-3-small', '{}')`
        }
        const scoped = await searchDocs('introduction fixture query', { path, topK: 1 })
        assert.equal(scoped.results.length, 1)
        const result = scoped.results[0]
        assert(result)
        assert(result.similarity > 0.99)
        hit = result
        const unscoped = await searchDocs('introduction fixture query', { topK: 2 })
        assert.equal(unscoped.results.length, 1)
        assert.equal(unscoped.results[0]?.path, path)
        assert.equal(unscoped.candidatesConsidered, 2)
        assert.equal(unscoped.droppedBelowThreshold, 1)
        await assert.rejects(
          searchDocs('introduction fixture query', {
            path: 'docs/api-reference/workflows/listWorkflows.mdx',
          }),
          /not a page or section/
        )
        assert.equal(fixtureRequests, 2)
        assert.equal(providerRequests, 0)
      }
      assert.equal(hit.path, 'docs/introduction.mdx')
      assert.equal(hit.url, 'https://docs.sim.ai/introduction')
      assert(globDocs('docs/**').includes(hit.path))
      assert.equal(docsPathForSourceDocument('api-reference/workflows/listWorkflows.mdx'), null)
      const page = await readDocsPage(hit.path)
      const response = await nativeFetch(new URL('/introduction.mdx', docsOrigin), {
        headers: { Accept: 'text/markdown, text/plain' },
      })
      assert(response.ok)
      assert(response.headers.get('content-type')?.startsWith('text/markdown'))
      assert.equal(page.content, await response.text())
      assert(page.content.includes(hit.content.trim()))
      assert(page.content.includes('# Introduction'))
      assert.equal(page.totalLines, page.content.split('\n').length)
      const citation = await nativeFetch(new URL(new URL(hit.url).pathname, docsOrigin))
      assert(citation.ok)
      assert(citation.headers.get('content-type')?.startsWith('text/html'))
    }
  )
} catch (error) {
  if (!checks.some((row) => row.status === 'failed'))
    checks.push({
      name: 'Fixture lifecycle',
      status: 'failed',
      durationMs: 0,
      error: getErrorMessage(error),
    })
} finally {
  globalThis.fetch = nativeFetch
  await closePlatform?.()
  if (fixture?.listening) {
    const server = fixture
    server.closeAllConnections()
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()))
    })
  }
  if (created) await sql`DROP TABLE IF EXISTS docs_embeddings, rate_limit_bucket`
  await sql.end({ timeout: 1 })
  await writeFile(
    reportPath,
    `${JSON.stringify({ checks, requests, provider: { mode: live ? 'live' : 'local-http-fixture-contract-only', model: 'text-embedding-3-small', maxRequests: live ? 4 : 0, requests: publisherRequests + providerRequests, fixtureRequests, publisherTokens, queryTokens, totalTokens: publisherTokens + queryTokens }, docsTransport: 'Public docs origin forwarded to the loopback production build; real HTTP responses preserved', database: 'isolated loopback; table removed' }, null, 2)}\n`
  )
}
logger.info('Verified docs provider and platform boundary', { reportPath, checks: checks.length })
if (checks.some((row) => row.status === 'failed')) process.exitCode = 1
