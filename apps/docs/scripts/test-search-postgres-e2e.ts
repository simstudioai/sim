import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { type Server, serve } from 'bun'
import postgres from 'postgres'
import { z } from 'zod'
import { getPage, getPages } from '@/lib/content/catalog'
import { pageSearchChunks } from '@/lib/search/chunks'
import { searchDatabase } from '@/lib/search/database'
import { searchDocs } from '@/lib/search/service'

const logger = createLogger('DocsSearchPostgresE2E')
const databaseSetting = process.env.DOCS_SEARCH_E2E_DATABASE_URL
const reportSetting = process.env.DOCS_SEARCH_E2E_REPORT_PATH
assert(
  databaseSetting && reportSetting,
  'Explicit disposable database and report paths are required'
)
const databaseUrl = new URL(databaseSetting)
assert(
  ['localhost', '127.0.0.1', '[::1]'].includes(databaseUrl.hostname),
  'Only loopback databases are permitted'
)
assert(databaseUrl.pathname === '/docs_search_test', 'Use a dedicated docs_search_test database')
assert(['postgres:', 'postgresql:'].includes(databaseUrl.protocol), 'A PostgreSQL URL is required')
process.env.DATABASE_URL = databaseUrl.href
process.env.OPENAI_API_KEY = ''
const reportPath: string = reportSetting
const directory = dirname(reportPath)
const workspace = resolve(import.meta.dirname, '..')
const sql = postgres(databaseUrl.href, { max: 1 })
const results: Array<{
  name: string
  status: 'passed' | 'failed'
  durationMs: number
  error?: string
}> = []
const vector = JSON.stringify([1, ...Array.from({ length: 1535 }, () => 0)])
let created = false
const preloadPath = join(directory, 'embedding-transport.mjs')
type ProviderScenario =
  | 'success'
  | '429'
  | '503'
  | '401'
  | 'dimensions'
  | 'indices'
  | 'batch-failure'
  | 'long-retry'
let providerScenario: ProviderScenario = 'success'
let scenarioRequests = 0
let provider: Server<undefined> | undefined
const providerRequests: Array<{
  scenario: ProviderScenario
  attempt: number
  status: number
  inputs: number
}> = []
await mkdir(directory, { recursive: true })

async function check(name: string, action: () => Promise<void>) {
  const started = performance.now()
  try {
    await action()
    results.push({ name, status: 'passed', durationMs: Math.round(performance.now() - started) })
  } catch (error) {
    results.push({
      name,
      status: 'failed',
      durationMs: Math.round(performance.now() - started),
      error: getErrorMessage(error),
    })
    throw error
  }
}

async function index(
  mode: 'check' | 'publish',
  name: string,
  paths: string[] = [],
  useProvider = false
) {
  const outputPath = join(directory, `${name}.json`)
  const child = spawn(
    process.execPath,
    [
      '--no-env-file',
      ...(useProvider ? ['--preload', preloadPath] : []),
      'scripts/index-search.ts',
      ...(mode === 'check' ? ['--check'] : []),
      ...paths.map((path) => `--path=${path}`),
    ],
    {
      cwd: workspace,
      env: {
        ...process.env,
        DATABASE_URL: databaseUrl.href,
        OPENAI_API_KEY: useProvider ? 'isolated-fixture' : '',
        DOCS_SEARCH_REPORT_PATH: outputPath,
      },
      stdio: 'ignore',
      timeout: 60000,
    }
  )
  const exitCode = await new Promise<number>((resolve, reject) => {
    child.once('error', reject)
    child.once('close', (code) => resolve(code ?? 1))
  })
  return { exitCode, report: await readFile(outputPath, 'utf8') }
}

function scenario(value: ProviderScenario) {
  providerScenario = value
  scenarioRequests = 0
}

async function documentState(source: string) {
  const [row] = await sql<Array<{ count: number; digest: string }>>`
    SELECT count(*)::int AS count, md5(string_agg(row_to_json(document)::text, '|' ORDER BY chunk_id)) AS digest
    FROM docs_embeddings AS document WHERE source_document = ${source}
  `
  assert(row)
  return row
}

async function fingerprint() {
  const [row] = await sql<Array<{ count: number; digest: string }>>`
    SELECT count(*)::int AS count, md5(string_agg(chunk_id::text, ',' ORDER BY chunk_id)) AS digest FROM docs_embeddings
  `
  assert(row)
  return row
}

try {
  const [existing] = await sql<
    Array<{ count: number }>
  >`SELECT count(*)::int AS count FROM information_schema.tables WHERE table_schema = 'public'`
  assert(existing?.count === 0, 'Refusing to mutate a database that already contains tables')
  await sql`CREATE EXTENSION IF NOT EXISTS vector`
  await sql`
    CREATE TABLE docs_embeddings (
      chunk_id uuid PRIMARY KEY,
      chunk_text text NOT NULL,
      source_document text NOT NULL,
      source_link text NOT NULL,
      header_text text NOT NULL,
      header_level integer NOT NULL,
      token_count integer NOT NULL,
      embedding vector(1536) NOT NULL,
      embedding_model text NOT NULL DEFAULT 'text-embedding-3-small',
      metadata jsonb NOT NULL DEFAULT '{}',
      chunk_text_tsv tsvector GENERATED ALWAYS AS (to_tsvector('english', chunk_text)) STORED,
      created_at timestamp NOT NULL DEFAULT now(),
      updated_at timestamp NOT NULL DEFAULT now()
    )
  `
  created = true
  await sql`CREATE INDEX ON docs_embeddings(source_document)`
  await sql`CREATE INDEX ON docs_embeddings USING gin(chunk_text_tsv)`
  const page = getPage('/introduction')
  assert(page)
  const probe = generateId()
  const query = 'simhybridprobe'
  await sql`
    INSERT INTO docs_embeddings (chunk_id, chunk_text, source_document, source_link, header_text, header_level, token_count, embedding, metadata)
    VALUES (${probe}, ${query}, ${page.sourcePath}, 'https://docs.sim.ai/introduction', 'Introduction', 1, 1, ${vector}::vector, ${sql.json({ contentHash: page.contentHash })})
  `
  await check('Real PostgreSQL keyword results work with no embedding key', async () => {
    assert.equal(process.env.OPENAI_API_KEY, '')
    const stored = await searchDatabase()<
      Array<{ chunk_id: string; metadata: { contentHash: string } }>
    >`SELECT chunk_id, metadata FROM docs_embeddings WHERE chunk_text_tsv @@ plainto_tsquery('english', ${query})`
    assert.equal(stored[0]?.chunk_id, probe)
    assert.equal(stored[0]?.metadata.contentHash, page.contentHash)
    const results = await searchDocs(query)
    assert.equal(results.length, 1)
    assert.equal(results[0]?.id, probe)
    assert.equal(results[0]?.url, 'https://docs.sim.ai/introduction')
  })
  await check('Stale index hashes cannot supply search citations', async () => {
    await sql`UPDATE docs_embeddings SET metadata = '{"contentHash":"stale"}' WHERE chunk_id = ${probe}`
    assert.deepEqual(await searchDocs(query), [])
    await sql`UPDATE docs_embeddings SET metadata = ${sql.json({ contentHash: page.contentHash })} WHERE chunk_id = ${probe}`
  })
  await check(
    'Foreign origins and nonexistent anchors cannot supply search citations',
    async () => {
      for (const url of [
        'https://untrusted.example/introduction',
        'https://docs.sim.ai/introduction#unknown-anchor',
      ]) {
        await sql`UPDATE docs_embeddings SET source_link = ${url} WHERE chunk_id = ${probe}`
        assert.deepEqual(await searchDocs(query), [])
      }
      await sql`UPDATE docs_embeddings SET source_link = 'https://docs.sim.ai/introduction' WHERE chunk_id = ${probe}`
    }
  )
  await check('Database query failures retain credential-free catalog results', async () => {
    await sql`ALTER TABLE docs_embeddings RENAME TO docs_embeddings_unavailable`
    try {
      assert(
        (await searchDocs('Slack')).some(
          (result) => new URL(result.url).pathname === '/integrations/slack'
        )
      )
    } finally {
      await sql`ALTER TABLE docs_embeddings_unavailable RENAME TO docs_embeddings`
    }
  })
  await sql`DELETE FROM docs_embeddings`
  const pages = getPages().filter((page) => page.url !== '/')
  for (const page of pages) {
    const chunks = [...pageSearchChunks(page)]
    const source = chunks[0]?.sourceDocument
    assert(source)
    const rows = chunks.map((chunk) => ({
      chunk_id: generateId(),
      chunk_text: chunk.text,
      source_link: chunk.sourceLink,
      header_text: chunk.headerText,
      header_level: chunk.headerLevel,
      token_count: Math.ceil(chunk.text.length / 4),
      metadata: {
        title: page.title,
        contentHash: page.contentHash,
        chunkId: chunk.id,
        embeddingInputHash: createHash('sha256')
          .update(
            JSON.stringify([
              'text-embedding-3-small',
              1536,
              `${page.title}\n${chunk.headerText}\n${chunk.text}`,
            ])
          )
          .digest('hex'),
        catalog: 'sim-docs-v2',
      },
    }))
    await sql`
      INSERT INTO docs_embeddings (chunk_id, chunk_text, source_document, source_link, header_text, header_level, token_count, embedding, metadata)
      SELECT chunk_id, chunk_text, ${source}, source_link, header_text, header_level, token_count, ${vector}::vector, metadata
      FROM jsonb_to_recordset(${sql.json(rows)}) AS fixture(chunk_id uuid, chunk_text text, source_link text, header_text text, header_level integer, token_count integer, metadata jsonb)
    `
  }
  const fresh = await fingerprint()
  await check(
    'Fresh index checks succeed and repeated publication preserves row identities without credentials',
    async () => {
      assert.equal((await index('check', 'fresh-check')).exitCode, 0)
      assert.equal((await index('publish', 'fresh-publish')).exitCode, 0)
      assert.deepEqual(await fingerprint(), fresh)
    }
  )
  await check(
    'Citation-only changes are stale and repair without replacing embeddings',
    async () => {
      await sql`UPDATE docs_embeddings SET source_link = 'https://old.example/introduction' WHERE source_document = ${page.sourcePath}`
      assert.equal((await index('check', 'citation-stale', ['/introduction'])).exitCode, 1)
      const repaired = await index('publish', 'citation-repaired', ['/introduction'])
      assert.equal(repaired.exitCode, 0)
      assert.deepEqual(await fingerprint(), fresh)
      const [row] = await sql<
        Array<{ source_link: string; embedding: string }>
      >`SELECT source_link, embedding::text FROM docs_embeddings WHERE source_document = ${page.sourcePath}`
      assert.equal(row?.source_link, 'https://docs.sim.ai/introduction')
      assert.equal(row?.embedding, vector)
      assert.equal((await index('check', 'citation-fresh', ['/introduction'])).exitCode, 0)
    }
  )
  await check('Concurrent publishers fail before modifying any rows', async () => {
    await sql`SELECT pg_advisory_lock(724130561)`
    try {
      const result = await index('publish', 'concurrent-publish', ['/introduction'])
      assert.equal(result.exitCode, 1)
      assert(result.report.includes('Another documentation index publisher or check is active'))
      assert.deepEqual(await fingerprint(), fresh)
    } finally {
      await sql`SELECT pg_advisory_unlock(724130561)`
    }
  })
  await check('Freshness rejects modified chunk bytes and embedding model identities', async () => {
    const [row] = await sql<
      Array<{ chunk_id: string; chunk_text: string }>
    >`SELECT chunk_id, chunk_text FROM docs_embeddings WHERE source_document = ${page.sourcePath} LIMIT 1`
    assert(row)
    await sql`UPDATE docs_embeddings SET chunk_text = 'corrupt stored chunk' WHERE chunk_id = ${row.chunk_id}`
    assert.equal((await index('check', 'corrupt-text', ['/introduction'])).exitCode, 1)
    const failure = await index('publish', 'corrupt-no-key', ['/introduction'])
    assert.equal(failure.exitCode, 1)
    assert(failure.report.includes('OPENAI_API_KEY is required'))
    assert.deepEqual(await fingerprint(), fresh)
    await sql`UPDATE docs_embeddings SET chunk_text = ${row.chunk_text}, embedding_model = 'wrong-model' WHERE chunk_id = ${row.chunk_id}`
    assert.equal((await index('check', 'wrong-model', ['/introduction'])).exitCode, 1)
    await sql`UPDATE docs_embeddings SET embedding_model = 'text-embedding-3-small' WHERE chunk_id = ${row.chunk_id}`
    assert.equal((await index('check', 'restored-chunk', ['/introduction'])).exitCode, 0)
  })
  await sql`
    INSERT INTO docs_embeddings (chunk_id, chunk_text, source_document, source_link, header_text, header_level, token_count, embedding, metadata)
    VALUES (${generateId()}, 'retired fixture', 'retired-fixture.mdx', 'https://docs.sim.ai/retired-fixture', 'Retired', 1, 1, ${vector}::vector, '{}')
  `
  await check(
    'Freshness checks reject retired pages and publication retires only those rows',
    async () => {
      const check = await index('check', 'retired-check')
      assert.equal(check.exitCode, 1)
      assert(check.report.includes('removed documents remain indexed'))
      assert.equal((await index('publish', 'retired-publish')).exitCode, 0)
      assert.deepEqual(await fingerprint(), fresh)
    }
  )
  const first = pages[0]
  assert(first)
  const source = [...pageSearchChunks(first)][0]?.sourceDocument
  assert(source)
  await sql`UPDATE docs_embeddings SET metadata = '{"contentHash":"stale"}' WHERE source_document = ${source}`
  await check(
    'A missing embedding key fails publication without deleting old document data',
    async () => {
      const before = await fingerprint()
      const result = await index('publish', 'failed-publish')
      assert.equal(result.exitCode, 1)
      assert(result.report.includes('OPENAI_API_KEY is required'))
      assert.deepEqual(await fingerprint(), before)
      assert.equal((await index('check', 'stale-check')).exitCode, 1)
    }
  )

  const responseValues = new Map<string, number>()
  const requestSchema = z.object({
    input: z.array(z.string().min(1).max(8000)).min(1).max(16),
    model: z.literal('text-embedding-3-small'),
    dimensions: z.literal(1536),
    encoding_format: z.literal('float'),
  })
  provider = serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(request) {
      assert.equal(new URL(request.url).pathname, '/v1/embeddings')
      assert.equal(request.method, 'POST')
      assert.equal(request.headers.get('authorization'), 'Bearer isolated-fixture')
      const body = requestSchema.parse(await request.json())
      scenarioRequests += 1
      assert(providerRequests.length < 16, 'Provider fixture request cap exceeded')
      const status =
        providerScenario === '401'
          ? 401
          : providerScenario === 'long-retry'
            ? 429
            : providerScenario === 'batch-failure' && scenarioRequests > 1
              ? 503
              : (providerScenario === '429' || providerScenario === '503') && scenarioRequests === 1
                ? Number(providerScenario)
                : 200
      providerRequests.push({
        scenario: providerScenario,
        attempt: scenarioRequests,
        status,
        inputs: body.input.length,
      })
      if (status !== 200)
        return Response.json(
          { error: { message: 'Isolated fixture failure' } },
          { status, headers: { 'Retry-After': providerScenario === 'long-retry' ? '120' : '0' } }
        )
      const data = body.input
        .map((input, index) => {
          responseValues.set(input, index + 1)
          return {
            index: providerScenario === 'indices' ? body.input.length : index,
            embedding: [
              index + 1,
              ...Array.from({ length: providerScenario === 'dimensions' ? 1534 : 1535 }, () => 0),
            ],
          }
        })
        .reverse()
      return Response.json({ data, usage: { total_tokens: body.input.length } })
    },
  })
  await writeFile(
    preloadPath,
    `
    const endpoint = ${JSON.stringify(new URL('/v1/embeddings', provider.url).href)};
    const transport = globalThis.fetch;
    globalThis.fetch = Object.assign(async (input, init) => {
      const request = new Request(input, init);
      if (request.url !== 'https://api.openai.com/v1/embeddings') throw new Error('Unexpected provider URL in isolated test');
      return transport(new Request(endpoint, request));
    }, transport);
  `
  )
  const introChunks = [...pageSearchChunks(page)]
  assert(
    introChunks.length > 0 && introChunks.length <= 16,
    'Introduction must fit one bounded fixture batch'
  )
  await check(
    'First publication writes provider vectors in input order and an unchanged repeat makes no requests',
    async () => {
      await sql`DELETE FROM docs_embeddings WHERE source_document = ${page.sourcePath}`
      scenario('success')
      assert.equal((await index('publish', 'provider-first', ['/introduction'], true)).exitCode, 0)
      assert.equal(scenarioRequests, 1)
      const rows = await sql<
        Array<{
          chunk_text: string
          header_text: string
          source_link: string
          embedding: string
          metadata: { title: string }
        }>
      >`
      SELECT chunk_text, header_text, source_link, embedding::text, metadata FROM docs_embeddings WHERE source_document = ${page.sourcePath}
    `
      assert.equal(rows.length, providerRequests.at(-1)?.inputs)
      for (const row of rows) {
        const input = `${row.metadata.title}\n${row.header_text}\n${row.chunk_text}`
        const values = z.array(z.number()).parse(JSON.parse(row.embedding))
        assert.equal(values.length, 1536)
        assert.equal(values[0], responseValues.get(input))
        assert.equal(new URL(row.source_link).pathname, '/introduction')
      }
      const before = await documentState(page.sourcePath)
      assert.equal(
        (await index('publish', 'provider-unchanged', ['/introduction'], true)).exitCode,
        0
      )
      assert.equal(scenarioRequests, 1)
      assert.deepEqual(await documentState(page.sourcePath), before)
    }
  )
  await check(
    'Changed stored chunk bytes are replaced while retaining other row identities',
    async () => {
      const rows = await sql<
        Array<{ chunk_id: string }>
      >`SELECT chunk_id FROM docs_embeddings WHERE source_document = ${page.sourcePath} ORDER BY chunk_id`
      const changed = rows[0]
      assert(changed)
      await sql`UPDATE docs_embeddings SET chunk_text = 'stale provider fixture' WHERE chunk_id = ${changed.chunk_id}`
      scenario('success')
      assert.equal(
        (await index('publish', 'provider-changed', ['/introduction'], true)).exitCode,
        0
      )
      assert.equal(scenarioRequests, 1)
      assert.equal(providerRequests.at(-1)?.inputs, 1)
      const after = await sql<
        Array<{ chunk_id: string }>
      >`SELECT chunk_id FROM docs_embeddings WHERE source_document = ${page.sourcePath}`
      assert.equal(after.length, rows.length)
      assert(!after.some((row) => row.chunk_id === changed.chunk_id))
      for (const retained of rows.slice(1))
        assert(after.some((row) => row.chunk_id === retained.chunk_id))
    }
  )
  for (const status of ['429', '503'] as const) {
    await check(
      `Provider HTTP ${status} retries once and publishes the successful response`,
      async () => {
        await sql`UPDATE docs_embeddings SET chunk_text = 'stale provider fixture' WHERE chunk_id = (SELECT chunk_id FROM docs_embeddings WHERE source_document = ${page.sourcePath} LIMIT 1)`
        scenario(status)
        assert.equal(
          (await index('publish', `provider-retry-${status}`, ['/introduction'], true)).exitCode,
          0
        )
        assert.equal(scenarioRequests, 2)
        assert.equal(providerRequests.at(-2)?.status, Number(status))
        assert.equal(providerRequests.at(-1)?.status, 200)
        assert.equal(
          (await index('check', `provider-fresh-${status}`, ['/introduction'])).exitCode,
          0
        )
      }
    )
  }
  for (const failure of ['401', 'dimensions', 'indices', 'long-retry'] as const) {
    await check(
      `Provider ${failure} fails without retry or modifying the previous document`,
      async () => {
        await sql`UPDATE docs_embeddings SET chunk_text = 'stale provider fixture' WHERE chunk_id = (SELECT chunk_id FROM docs_embeddings WHERE source_document = ${page.sourcePath} LIMIT 1)`
        const before = await documentState(page.sourcePath)
        scenario(failure)
        const result = await index(
          'publish',
          `provider-failure-${failure}`,
          ['/introduction'],
          true
        )
        assert.equal(result.exitCode, 1)
        assert.equal(scenarioRequests, 1)
        assert.deepEqual(await documentState(page.sourcePath), before)
      }
    )
  }
  await check(
    'A successful first batch followed by persistent failure leaves the entire previous document intact',
    async () => {
      const multiBatch = pages.find((candidate) => {
        const count = [...pageSearchChunks(candidate)].length
        return count > 16 && count <= 32
      })
      assert(multiBatch, 'A bounded two-batch document is required')
      const source = [...pageSearchChunks(multiBatch)][0]?.sourceDocument
      assert(source)
      await sql`UPDATE docs_embeddings SET chunk_text = 'stale batch fixture' WHERE source_document = ${source}`
      const before = await documentState(source)
      scenario('batch-failure')
      const result = await index('publish', 'provider-partial-failure', [multiBatch.url], true)
      assert.equal(result.exitCode, 1)
      assert(scenarioRequests >= 2 && scenarioRequests <= 4)
      const attempts = providerRequests.filter((row) => row.scenario === 'batch-failure')
      assert.equal(attempts[0]?.status, 200)
      assert.equal(attempts[0]?.inputs, 16)
      assert(attempts.slice(1).every((row) => row.status === 503))
      assert.deepEqual(await documentState(source), before)
    }
  )
} catch (error) {
  if (!results.some((result) => result.status === 'failed')) {
    results.push({
      name: 'Fixture lifecycle',
      status: 'failed',
      durationMs: 0,
      error: getErrorMessage(error),
    })
  }
} finally {
  await provider?.stop(true)
  await rm(preloadPath, { force: true })
  if (created) await sql`DROP TABLE docs_embeddings`
  await Promise.all([sql.end({ timeout: 5 }), searchDatabase().end({ timeout: 5 })])
  await writeFile(
    reportPath,
    `${JSON.stringify({ results, provider: { mode: 'loopback-http-fixture', maxRequests: 16, maxInputsPerRequest: 16, requests: providerRequests } }, null, 2)}\n`
  )
}
logger.info('Verified isolated PostgreSQL search boundary', { checks: results.length, reportPath })
if (results.some((result) => result.status === 'failed')) process.exitCode = 1
