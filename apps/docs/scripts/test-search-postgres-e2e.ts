import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import postgres from 'postgres'
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

async function index(mode: 'check' | 'publish', name: string) {
  const outputPath = join(directory, `${name}.json`)
  const child = spawn(
    process.execPath,
    ['--no-env-file', 'scripts/index-search.ts', ...(mode === 'check' ? ['--check'] : [])],
    {
      cwd: workspace,
      env: {
        ...process.env,
        DATABASE_URL: databaseUrl.href,
        OPENAI_API_KEY: '',
        DOCS_SEARCH_REPORT_PATH: outputPath,
      },
      stdio: 'ignore',
    }
  )
  const exitCode = await new Promise<number>((resolve, reject) => {
    child.once('error', reject)
    child.once('close', (code) => resolve(code ?? 1))
  })
  return { exitCode, report: await readFile(outputPath, 'utf8') }
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
    const ids = chunks.map(() => generateId())
    await sql`
      INSERT INTO docs_embeddings (chunk_id, chunk_text, source_document, source_link, header_text, header_level, token_count, embedding, metadata)
      SELECT fixture_id, 'synthetic fixture content', ${source}, ${`https://docs.sim.ai${page.url}`}, ${page.title}, 1, 1, ${vector}::vector, ${sql.json({ contentHash: page.contentHash })}
      FROM unnest(${ids}::uuid[]) AS fixture_id
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
  if (created) await sql`DROP TABLE docs_embeddings`
  await Promise.all([sql.end({ timeout: 5 }), searchDatabase().end({ timeout: 5 })])
  await writeFile(reportPath, `${JSON.stringify({ results }, null, 2)}\n`)
}
logger.info('Verified isolated PostgreSQL search boundary', { checks: results.length, reportPath })
if (results.some((result) => result.status === 'failed')) process.exitCode = 1
