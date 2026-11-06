import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { SIM_DOCS_URL } from '@sim/utils/site'

/**
 * Exercises the public ownership challenge, host isolation, the RFC 9727 API catalog, the
 * app-wide JSON 404, and the Markdown 404 for `Accept: text/markdown` through a running local app.
 */
const logger = createLogger('McpHostE2E')
const CHALLENGE_PATH = '/.well-known/openai-apps-challenge'
const EXPECTED_CHALLENGE = 'lFJ1-XIWpHGRNcgzTPl2Y_yYCTWLvlIbAvNRD08EvLI'
const MCP_HOST = 'mcp.sim.test'
const PROTECTED_RESOURCE_PATH = '/.well-known/oauth-protected-resource'
const API_CATALOG_PATH = '/.well-known/api-catalog'
const API_CATALOG_CONTENT_TYPE =
  'application/linkset+json; profile="https://www.rfc-editor.org/info/rfc9727"'
const MARKDOWN_ACCEPT = 'text/markdown'
const BROWSER_ACCEPT = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
const startedAt = new Date().toISOString()

const configuredBaseUrl = process.env.MCP_HOST_E2E_BASE_URL
const reportPath = process.env.MCP_HOST_E2E_REPORT_PATH
assert(configuredBaseUrl, 'MCP_HOST_E2E_BASE_URL must be explicitly provided')
assert(reportPath, 'MCP_HOST_E2E_REPORT_PATH must be explicitly provided')
const baseUrl = new URL(configuredBaseUrl)
assert(['localhost', '127.0.0.1', '[::1]'].includes(baseUrl.hostname), 'Use a loopback app')
assert.equal(baseUrl.protocol, 'http:', 'Use a local HTTP app')
assert.equal(baseUrl.pathname, '/', 'App URL must be an origin')
assert(!baseUrl.username && !baseUrl.password, 'App URL must not contain credentials')
assert.equal(process.env.SIM_MCP_URL, `http://${MCP_HOST}/mcp`, 'Configure the fixture MCP host')

interface CheckResult {
  name: string
  status: 'passed' | 'failed'
  durationMs: number
  error?: string
}

const checks: CheckResult[] = []
const requests: {
  method: string
  path: string
  userAgent: string
  host: string
  accept: string
  status: number
}[] = []

async function request(
  path: string,
  userAgent: string,
  host = MCP_HOST,
  method = 'GET',
  accept = '*/*'
) {
  // boundary-raw-fetch: exercise the real proxy and route over local HTTP.
  const response = await fetch(new URL(path, baseUrl), {
    method,
    headers: { Host: host, 'User-Agent': userAgent, Accept: accept },
    redirect: 'error',
    signal: AbortSignal.timeout(120_000),
  })
  requests.push({ method, path, userAgent, host, accept, status: response.status })
  const body = await response.text()
  return { response, body }
}

async function check(name: string, run: () => Promise<void>) {
  const started = performance.now()
  try {
    await run()
    checks.push({ name, status: 'passed', durationMs: Math.round(performance.now() - started) })
    logger.info(`PASS ${name}`)
  } catch (error) {
    checks.push({
      name,
      status: 'failed',
      durationMs: Math.round(performance.now() - started),
      error: getErrorMessage(error),
    })
    logger.error(`FAIL ${name}`, { error: getErrorMessage(error) })
  }
}

try {
  for (const userAgent of ['', 'python-requests/2.32.3']) {
    await check(`ownership challenge for ${userAgent || 'an empty User-Agent'}`, async () => {
      const { response, body } = await request(CHALLENGE_PATH, userAgent)
      assert.equal(response.status, 200)
      assert.equal(body, EXPECTED_CHALLENGE)
      assert.equal(response.headers.get('content-type'), 'text/plain; charset=utf-8')
      assert.equal(response.headers.get('cache-control'), 'no-store')
    })
  }

  for (const path of [`${CHALLENGE_PATH}/extra`, '/login', '/api/health', API_CATALOG_PATH]) {
    await check(`dedicated MCP host rejects ${path}`, async () => {
      const { response } = await request(path, 'Mozilla/5.0')
      assert.equal(response.status, 404)
    })
  }

  await check('application host serves no root protected-resource metadata', async () => {
    const { response } = await request(PROTECTED_RESOURCE_PATH, 'Mozilla/5.0', baseUrl.host)
    assert.equal(response.status, 404)
  })

  for (const method of ['GET', 'POST']) {
    await check(`application host answers an unknown API ${method} with JSON`, async () => {
      const { response, body } = await request(
        '/api/not-a-real-route/nested',
        'Mozilla/5.0',
        baseUrl.host,
        method
      )
      assert.equal(response.status, 404)
      assert.match(response.headers.get('content-type') ?? '', /^application\/json/)
      assert.deepEqual(JSON.parse(body), { error: 'Not found' })
    })
  }

  for (const userAgent of ['', 'python-requests/2.32.3']) {
    await check(`API catalog for ${userAgent || 'an empty User-Agent'}`, async () => {
      const { response, body } = await request(API_CATALOG_PATH, userAgent, baseUrl.host)
      assert.equal(response.status, 200)
      assert.equal(response.headers.get('content-type'), API_CATALOG_CONTENT_TYPE)
      assert.equal(
        response.headers.get('link'),
        `<${baseUrl.origin}${API_CATALOG_PATH}>; rel="api-catalog"`
      )
      const [catalog, api] = JSON.parse(body).linkset
      assert.deepEqual(catalog, {
        anchor: `${baseUrl.origin}${API_CATALOG_PATH}`,
        item: [{ href: `${baseUrl.origin}/api/v2` }],
      })
      assert.equal(api.anchor, `${baseUrl.origin}/api/v2`)
      assert.equal(api['service-desc'][0].href, `${SIM_DOCS_URL}/openapi.json`)
      assert.equal(api.status[0].href, `${baseUrl.origin}/api/health`)
      const health = await request(new URL(api.status[0].href).pathname, userAgent, baseUrl.host)
      assert.equal(health.response.status, 200, 'The catalog status link must resolve')
    })
  }

  await check('API catalog answers HEAD with its Link header (RFC 9727 §2)', async () => {
    const { response, body } = await request(API_CATALOG_PATH, '', baseUrl.host, 'HEAD')
    assert.equal(response.status, 200)
    assert.equal(body, '')
    assert.match(response.headers.get('link') ?? '', /rel="api-catalog"$/)
  })

  for (const path of ['/not-a-real-page', '/not-a-real/nested/page']) {
    await check(`unknown page ${path} answers a Markdown client in Markdown`, async () => {
      const { response, body } = await request(
        path,
        'python-requests/2.32.3',
        baseUrl.host,
        'GET',
        MARKDOWN_ACCEPT
      )
      assert.equal(response.status, 404)
      assert.equal(response.headers.get('content-type'), 'text/markdown; charset=utf-8')
      assert.match(response.headers.get('vary') ?? '', /\bAccept\b/)
      assert.match(response.headers.get('cache-control') ?? '', /\bno-store\b/)
      assert.match(body, /^# Page not found\n/)
      assert.match(body, /\/llms\.txt\)/)
    })
  }

  for (const method of ['POST', 'OPTIONS']) {
    await check(`an unknown page answers a Markdown ${method} in Markdown`, async () => {
      const { response } = await request(
        '/not-a-real-page',
        'python-requests/2.32.3',
        baseUrl.host,
        method,
        MARKDOWN_ACCEPT
      )
      assert.equal(response.status, 404)
      assert.equal(response.headers.get('content-type'), 'text/markdown; charset=utf-8')
    })
  }

  await check('a client that refuses Markdown with q=0 gets the HTML 404', async () => {
    const { response } = await request(
      '/not-a-real-page',
      'python-requests/2.32.3',
      baseUrl.host,
      'GET',
      'text/html, text/markdown;q=0'
    )
    assert.equal(response.status, 404)
    assert.match(response.headers.get('content-type') ?? '', /^text\/html/)
  })

  await check('unknown page still answers a browser with the HTML 404', async () => {
    const { response } = await request(
      '/not-a-real-page',
      'Mozilla/5.0',
      baseUrl.host,
      'GET',
      BROWSER_ACCEPT
    )
    assert.equal(response.status, 404)
    assert.match(response.headers.get('content-type') ?? '', /^text\/html/)
  })

  await check('an unknown API path keeps its JSON 404 for a Markdown client', async () => {
    const { response, body } = await request(
      '/api/not-a-real-route',
      'Mozilla/5.0',
      baseUrl.host,
      'GET',
      MARKDOWN_ACCEPT
    )
    assert.equal(response.status, 404)
    assert.deepEqual(JSON.parse(body), { error: 'Not found' })
  })

  await check('application host still serves health checks', async () => {
    const { response } = await request('/api/health', 'Mozilla/5.0', baseUrl.host)
    assert.equal(response.status, 200)
  })
} finally {
  await mkdir(dirname(reportPath), { recursive: true })
  await writeFile(
    reportPath,
    JSON.stringify({ startedAt, finishedAt: new Date().toISOString(), checks, requests }, null, 2)
  )
}

if (checks.some((result) => result.status === 'failed')) process.exitCode = 1
