import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { toRecord } from '@sim/utils/object'
import routes from '@/.content/routes.json'

const logger = createLogger('DocsInterfacesE2E')
const origin = process.env.DOCS_E2E_BASE_URL
const reportPath = process.env.DOCS_INTERFACES_REPORT_PATH
if (!origin || !reportPath)
  throw new Error('DOCS_E2E_BASE_URL and DOCS_INTERFACES_REPORT_PATH are required')
const base = new URL(origin)
if (!['localhost', '127.0.0.1', '[::1]'].includes(base.hostname))
  throw new Error('Only a loopback docs server may be tested')
const checks: Array<{
  name: string
  status: 'passed' | 'failed'
  durationMs: number
  error?: string
}> = []

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

async function check(name: string, run: () => Promise<void>) {
  const started = performance.now()
  try {
    await run()
    checks.push({ name, status: 'passed', durationMs: Math.round(performance.now() - started) })
  } catch (error) {
    checks.push({
      name,
      status: 'failed',
      durationMs: Math.round(performance.now() - started),
      error: getErrorMessage(error),
    })
  }
}

async function get(path: string, options?: RequestInit) {
  return fetch(new URL(path, base), { ...options, signal: AbortSignal.timeout(20000) })
}

const paths = [
  '/introduction',
  '/integrations/slack',
  '/api-reference/workflows/listWorkflows',
  '/cli',
  '/mcp/overview',
]
for (const path of paths) {
  await check(`Complete JSON and Markdown representations agree: ${path}`, async () => {
    const json = await get(`/api/docs/page?path=${encodeURIComponent(path)}`)
    assert(json.ok, `JSON page returned ${json.status}`)
    const page = toRecord(toRecord(await json.json()).page)
    assert(
      page.path === path && typeof page.markdown === 'string',
      'Page identity or content is missing'
    )
    assert(page.markdown.includes(`(${path})`), 'Markdown lost its canonical identity')
    assert(page.markdown.length > 100, 'Page content is incomplete')
    for (const suffix of [`${path}.md`, `${path}.mdx`, `/llms.mdx${path}`]) {
      const response = await get(suffix)
      assert(response.ok, `${suffix} returned ${response.status}`)
      assert(
        response.headers.get('Content-Type')?.startsWith('text/markdown'),
        'Wrong Markdown content type'
      )
      assert((await response.text()) === page.markdown, 'Representations disagree')
    }
    if (path.includes('/api-reference/')) {
      assert(page.markdown.includes('GET /api/v2/workflows'), 'API operation method/path missing')
      assert(page.markdown.includes('Responses'), 'API responses missing')
    }
  })
}

await check('Discovery pagination has no gaps, duplicates or unbounded pages', async () => {
  const seen = new Set<string>()
  const paths = new Set<string>()
  let cursor: string | null = null
  let total = 0
  for (let request = 0; request < 100; request += 1) {
    const response = await get(
      `/api/docs/pages?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`
    )
    assert(response.ok, `Discovery returned ${response.status}`)
    const data = toRecord(await response.json())
    assert(Array.isArray(data.pages) && data.pages.length <= 100, 'Unbounded discovery response')
    for (const value of data.pages) {
      const page = toRecord(value)
      assert(typeof page.id === 'string' && !seen.has(page.id), 'Duplicate or missing identity')
      seen.add(page.id)
      assert(typeof page.path === 'string', 'Discovery path is missing')
      paths.add(page.path)
    }
    assert(typeof data.total === 'number', 'Missing discovery total')
    total = data.total
    cursor = typeof data.nextCursor === 'string' ? data.nextCursor : null
    if (!cursor) break
  }
  const canonicalPaths = routes.filter((path) => path !== '/')
  assert(
    cursor === null &&
      seen.size === total &&
      paths.size === canonicalPaths.length &&
      canonicalPaths.every((path) => paths.has(path)),
    'Discovery does not match the complete canonical route catalog'
  )
  for (const query of ['limit=101', 'limit=-1', 'section=unknown', 'cursor=unknown']) {
    assert((await get(`/api/docs/pages?${query}`)).status === 400, `Invalid ${query} accepted`)
  }
})

await check('Unknown pages and arbitrary URL inputs fail explicitly', async () => {
  assert(
    (await get('/api/docs/page?path=/no-such-document')).status === 404,
    'Unknown JSON page did not return404'
  )
  assert(
    (await get('/no-such-document.mdx')).status === 404,
    'Unknown Markdown page did not return404'
  )
  for (const path of ['https://example.com', '//example.com', '/../secret', '/%2e%2e/secret']) {
    assert(
      (await get(`/api/docs/page?path=${encodeURIComponent(path)}`)).status === 400,
      `Non-canonical path accepted: ${path}`
    )
  }
})

for (const entry of [
  { query: 'Slack', prefix: '/integrations/' },
  { query: 'List workflows', prefix: '/api-reference/' },
  { query: 'CLI', prefix: '/cli' },
  { query: 'MCP', prefix: '/mcp/' },
]) {
  await check(`Credential-free search covers ${entry.prefix}`, async () => {
    const response = await get(`/api/search?q=${encodeURIComponent(entry.query)}&limit=20`)
    assert(response.ok, `Search returned ${response.status}`)
    const result: unknown = await response.json()
    assert(
      Array.isArray(result) && result.length > 0 && result.length <= 20,
      'Search is empty or unbounded'
    )
    assert(
      result.some((value) => {
        const url = toRecord(value).url
        return typeof url === 'string' && new URL(url).pathname.startsWith(entry.prefix)
      }),
      'Expected section missing from search'
    )
    for (const value of result) {
      const row = toRecord(value)
      assert(
        row.type === 'page' &&
          typeof row.id === 'string' &&
          typeof row.content === 'string' &&
          Array.isArray(row.breadcrumbs),
        'Search wire contract changed'
      )
    }
  })
}

await check('Search keeps empty, bounded, and alias behavior', async () => {
  const empty = await get('/api/search?query=')
  assert(JSON.stringify(await empty.json()) === '[]', 'Empty search is not an empty list')
  const query = await get('/api/search?query=slack&limit=1')
  const alias = await get('/api/search?q=slack&limit=1')
  const first: unknown = await query.json()
  assert(Array.isArray(first) && first.length === 1, 'Search limit ignored')
  assert(JSON.stringify(first) === JSON.stringify(await alias.json()), 'query and q disagree')
})

await check(
  'MCP rejects untrusted origins and oversized bodies before executing tools',
  async () => {
    const payload = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' })
    const denied = await get('/api/mcp', {
      method: 'POST',
      headers: {
        Origin: 'https://untrusted.example',
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      },
      body: payload,
    })
    assert(denied.status === 403, `Untrusted origin returned ${denied.status}`)
    const large = await get('/api/mcp', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      },
      body: ' '.repeat(20 * 1024),
    })
    assert(large.status === 413, `Oversized body returned ${large.status}`)
  }
)

const client = new Client({ name: 'sim-docs-e2e', version: '1.0.0' })
try {
  await check(
    'Official MCP client connects, discovers and invokes all read-only tools',
    async () => {
      await client.connect(new StreamableHTTPClientTransport(new URL('/api/mcp', base)))
      const tools = await client.listTools()
      for (const name of ['list_pages', 'get_page', 'search']) {
        assert(
          tools.tools.some((tool) => tool.name === name && tool.annotations?.readOnlyHint),
          `${name} was not advertised as read-only`
        )
      }
      const discovery = await client.callTool({ name: 'list_pages', arguments: { limit: 2 } })
      const discovered = toRecord(discovery.structuredContent)
      assert(
        Array.isArray(discovered.pages) && discovered.pages.length === 2 && discovered.nextCursor,
        'MCP discovery pagination failed'
      )
      const page = await client.callTool({
        name: 'get_page',
        arguments: { path: '/integrations/slack' },
      })
      const fetched = toRecord(toRecord(page.structuredContent).page)
      const canonical = toRecord(
        toRecord(await (await get('/api/docs/page?path=/integrations/slack')).json()).page
      )
      assert(
        fetched.markdown === canonical.markdown && fetched.url === canonical.url,
        'MCP page was truncated or changed'
      )
      const result = await client.callTool({
        name: 'search',
        arguments: { query: 'Slack', limit: 3 },
      })
      const http = await (await get('/api/search?query=Slack&limit=3')).json()
      assert(
        JSON.stringify(toRecord(result.structuredContent).results) === JSON.stringify(http),
        'MCP and HTTP search disagree'
      )
    }
  )
  await check(
    'MCP unknown pages and invalid inputs return errors through the real client',
    async () => {
      const missing = await client.callTool({
        name: 'get_page',
        arguments: { path: '/no-such-document' },
      })
      assert(missing.isError, 'Unknown MCP page reported success')
      for (const input of [
        { name: 'get_page', arguments: { path: 'https://example.com' } },
        { name: 'list_pages', arguments: { limit: 101 } },
      ]) {
        let rejected = false
        try {
          rejected = Boolean((await client.callTool(input)).isError)
        } catch (error) {
          if (toRecord(error).code !== -32602) throw error
          rejected = true
        }
        assert(rejected, 'Invalid MCP input reported success')
      }
    }
  )
} finally {
  await client.close()
  await mkdir(dirname(reportPath), { recursive: true })
  await writeFile(reportPath, `${JSON.stringify({ checks }, null, 2)}\n`)
}
const failed = checks.filter((entry) => entry.status === 'failed')
if (failed.length) {
  logger.error('Documentation interfaces failed', { failed })
  process.exitCode = 1
} else logger.info('Documentation interfaces passed', { checks: checks.length })
